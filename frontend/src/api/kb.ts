import type {
  Answer, ChunkDetail, EntityDetail, ExampleQuestion, GraphPayload, Job, KBDocument, KBStatus,
  RelationDetail, StageEvent, UploadResult,
} from '../types/kb';

// Same-origin by default (Vite proxies /api → :8000). Override for split deployments.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
  get unreachable() {
    return this.status === 0;
  }
}

const UNREACHABLE =
  'Backend not reachable on port 8000. Start it with: .venv\\Scripts\\python.exe -m uvicorn backend.main:app --reload --port 8000 ' +
  '(the first start loads the models and takes ~30 s).';

// The Vite dev proxy answers an empty-bodied 500 when the backend is down or still starting.
const isProxyFailure = (status: number, text: string) => [500, 502, 503, 504].includes(status) && text.trim() === '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  const text = await res.text();
  if (isProxyFailure(res.status, text)) throw new ApiError(0, UNREACHABLE);
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = body?.detail ?? body?.error ?? (typeof body === 'string' ? body : res.statusText);
    throw new ApiError(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const kbApi = {
  status: () => request<KBStatus>('/api/kb/status'),
  documents: () => request<{ documents: KBDocument[] }>('/api/kb/documents').then((r) => r.documents),
  graph: () => request<GraphPayload>('/api/kb/graph?limit=800'),
  job: (id: string) => request<Job>(`/api/kb/jobs/${id}`),
  entity: (id: string) => request<EntityDetail>(`/api/kb/entities/${encodeURIComponent(id)}`),
  relation: (id: string) => request<RelationDetail>(`/api/kb/relations/${encodeURIComponent(id)}`),
  chunk: (id: string) => request<ChunkDetail>(`/api/kb/chunks/${encodeURIComponent(id)}`),
  examples: () => request<{ questions: ExampleQuestion[] }>('/api/kb/examples').then((r) => r.questions ?? []),
  loadSamples: () => request<{ job: Job | null; results: UploadResult[] }>('/api/kb/samples/load', { method: 'POST' }),
  deleteDocument: (id: string) => request<{ deleted: string }>(`/api/kb/documents/${id}`, { method: 'DELETE' }),
  retryDocument: (id: string) => request<{ job: Job }>(`/api/kb/documents/${id}/retry`, { method: 'POST' }),
  reset: () => request<{ reset: boolean }>('/api/kb?confirm=true', { method: 'DELETE' }),
  query: (question: string) => request<Answer>('/api/kb/query', json({ question })),

  upload(files: File[]) {
    const form = new FormData();
    files.forEach((f) => form.append('files', f, f.name));
    return request<{ job: Job | null; results: UploadResult[] }>('/api/kb/documents', { method: 'POST', body: form });
  },

  /** Streams LangGraph stage events, resolves with the final answer. */
  async queryStream(
    question: string,
    onStage: (e: StageEvent) => void,
    signal?: AbortSignal,
  ): Promise<Answer> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/kb/query/stream`, { ...json({ question }), signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ApiError(0, UNREACHABLE);
    }
    if (!res.ok || !res.body) {
      const t = await res.text();
      if (isProxyFailure(res.status, t)) throw new ApiError(0, UNREACHABLE);
      let msg = t;
      try { msg = JSON.parse(t).detail ?? t; } catch { /* plain text */ }
      throw new ApiError(res.status, msg || res.statusText);
    }
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
