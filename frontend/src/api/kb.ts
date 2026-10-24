import type {
  Answer, ChunkDetail, EntityDetail, ExampleQuestion, GraphPayload, Job, KBDocument, KBStatus,
  RelationDetail, StageEvent, UploadResult,
} from '../types/kb';
import { ApiError, failure, http, rawFetch } from '../lib/http';

export { ApiError };

/**
 * Client for one mounted copy of the knowledge-base routes: the shared demo corpus at /api/kb
 * (default) or a workspace's isolated knowledge base at /api/workspaces/{id}/kb. The route set,
 * payloads and behaviour are identical; only access rules differ (enforced by the server).
 */
export function createKbApi(base = '/api/kb') {
  const get = <T,>(path: string, query?: Record<string, string | number>) => http<T>(`${base}${path}`, { query });

  return {
    base,
    status: () => get<KBStatus>('/status'),
    documents: () => get<{ documents: KBDocument[] }>('/documents').then((r) => r.documents),
    graph: () => get<GraphPayload>('/graph', { limit: 800 }),
    job: (id: string) => get<Job>(`/jobs/${id}`),
    entity: (id: string) => get<EntityDetail>(`/entities/${encodeURIComponent(id)}`),
    relation: (id: string) => get<RelationDetail>(`/relations/${encodeURIComponent(id)}`),
    chunk: (id: string) => get<ChunkDetail>(`/chunks/${encodeURIComponent(id)}`),
    examples: () => get<{ questions: ExampleQuestion[] }>('/examples').then((r) => r.questions ?? []),
    loadSamples: () => http<{ job: Job | null; results: UploadResult[] }>(`${base}/samples/load`, { method: 'POST' }),
    deleteDocument: (id: string) => http<{ deleted: string }>(`${base}/documents/${id}`, { method: 'DELETE' }),
    retryDocument: (id: string) => http<{ job: Job }>(`${base}/documents/${id}/retry`, { method: 'POST' }),
    reset: () => http<{ reset: boolean }>(base, { method: 'DELETE', query: { confirm: true } }),
    query: (question: string, docIds?: string[]) =>
      http<Answer>(`${base}/query`, { body: { question, doc_ids: docIds?.length ? docIds : null } }),

    upload(files: File[]) {
      const form = new FormData();
      files.forEach((f) => form.append('files', f, f.name));
      return http<{ job: Job | null; results: UploadResult[] }>(`${base}/documents`, { method: 'POST', body: form });
    },

    /** Streams LangGraph stage events, resolves with the final answer. */
    async queryStream(
      question: string,
      onStage: (e: StageEvent) => void,
      signal?: AbortSignal,
      docIds?: string[],
    ): Promise<Answer> {
      const res = await rawFetch(`${base}/query/stream`, {
        body: { question, doc_ids: docIds?.length ? docIds : null }, signal,
      });
      if (!res.ok || !res.body) throw await failure(res);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer: Answer | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by a blank line; keep any partial event in the buffer
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (!data || data === '[DONE]') continue;
          const ev = JSON.parse(data);
          if (ev.type === 'stage') onStage(ev as StageEvent);
          else if (ev.type === 'result') answer = ev as Answer;
          else if (ev.type === 'error') throw new ApiError(500, ev.message);
        }
      }
      if (!answer) throw new ApiError(500, 'Stream ended without an answer');
      return answer;
    },
  };
}

export type KbApi = ReturnType<typeof createKbApi>;

/** The shared demo corpus (the original knowledge graph). */
export const kbApi = createKbApi();

export const workspaceKbApi = (workspaceId: string) => createKbApi(`/api/workspaces/${workspaceId}/kb`);
