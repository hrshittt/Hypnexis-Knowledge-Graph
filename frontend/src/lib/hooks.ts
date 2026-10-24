import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './http';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** true only for the first load; refetches keep the previous data on screen */
  initialLoading: boolean;
  reload: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | undefined>>;
}

/**
 * Runs `fn` whenever `deps` change. Refetching keeps the previous result rendered (no skeleton flash);
 * results from superseded calls are dropped.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList, enabled = true): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const r = await fnRef.current();
      if (id === seq.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(errorMessage(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { data, error, loading, initialLoading: loading && data === undefined, reload: run, setData };
}

export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** A per-browser convenience preference (collapsed sidebar, last tab…). Never used for data that matters. */
export function usePreference<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`hx:${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback((next: T) => {
    setV(next);
    try { localStorage.setItem(`hx:${key}`, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, [key]);
  return [v, set];
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · Paheli` : 'Paheli — Ask your documents anything';
    return () => { document.title = prev; };
  }, [title]);
}
