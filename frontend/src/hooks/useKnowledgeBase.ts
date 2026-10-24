import { useCallback, useEffect, useRef, useState } from 'react';
import { kbApi } from '../api/kb';
import type { GraphPayload, Job, KBDocument, KBStatus, UploadResult } from '../types/kb';

/**
 * Polls /status (fast while ingestion jobs run) and refetches the graph and the
 * document list whenever the backend's graph_version changes.
 */
export function useKnowledgeBase() {
  const [status, setStatus] = useState<KBStatus | null>(null);
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [lastUpload, setLastUpload] = useState<UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const versionRef = useRef<number>(-1);
  const activeJobs = useRef<Set<string>>(new Set());
  const failures = useRef(0); // consecutive failed polls → back off instead of hammering a down backend

  const refreshData = useCallback(async () => {
    const [docs, g] = await Promise.all([kbApi.documents(), kbApi.graph()]);
    setDocuments(docs);
    setGraph(g);
    versionRef.current = g.version;
  }, []);

  const poll = useCallback(async () => {
    try {
      const s = await kbApi.status();
      setStatus(s);
      setError(null);
      for (const id of Array.from(activeJobs.current)) {
        const j = await kbApi.job(id).catch(() => null);
        if (!j) { activeJobs.current.delete(id); continue; }
        setJobs((prev) => ({ ...prev, [id]: j }));
        if (!['queued', 'running'].includes(j.status)) activeJobs.current.delete(id);
      }
      if (s.graph_version !== versionRef.current || activeJobs.current.size > 0) {
        await refreshData();
      }
      failures.current = 0;
    } catch (e) {
      failures.current += 1;
      setError((e as Error).message);
    }
  }, [refreshData]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await poll();
      if (!alive) return;
      const delay = failures.current > 0
        ? Math.min(30000, 5000 * 2 ** (failures.current - 1))   // 5s, 10s, 20s, 30s… while the backend is down
        : activeJobs.current.size > 0 ? 800 : 5000;
      timer = setTimeout(tick, delay);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [poll]);

  const track = (job: Job | null) => {
    if (!job) return;
    activeJobs.current.add(job.id);
    setJobs((prev) => ({ ...prev, [job.id]: job }));
    setTimeout(poll, 300);
  };

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      setError(null);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const upload = (files: File[]) => run(async () => {
    const r = await kbApi.upload(files);
    setLastUpload(r.results);
    track(r.job);
    await refreshData();
  });

  const loadSamples = () => run(async () => {
    const r = await kbApi.loadSamples();
    setLastUpload(r.results);
    track(r.job);
    await refreshData();
  });

  const remove = (docId: string) => run(async () => { await kbApi.deleteDocument(docId); await refreshData(); });
  const retry = (docId: string) => run(async () => { const r = await kbApi.retryDocument(docId); track(r.job); });
  const reset = () => run(async () => { await kbApi.reset(); setLastUpload([]); await refreshData(); });

  const runningJobs = Object.values(jobs).filter((j) => ['queued', 'running'].includes(j.status));

  return {
    status, documents, graph, jobs, runningJobs, lastUpload, error, busy,
    upload, loadSamples, remove, retry, reset, refresh: poll, clearUploadResults: () => setLastUpload([]),
  };
}
