/**
 * The one HTTP client every API module uses.
 *
 * - Same-origin by default (Vite proxies /api → :8000, Vercel rewrites /api). VITE_API_BASE points at a
 *   separate backend; cookies are then sent cross-origin (the backend must list the origin in CORS_ORIGINS
 *   and use AUTH_COOKIE_SAMESITE=none over HTTPS).
 * - The session lives in an HttpOnly cookie the page cannot read. The per-session CSRF token is held
 *   in memory only (never localStorage) and sent as X-CSRF-Token on state-changing requests.
 * - Error bodies are normalised into ApiError: {detail: {code, message, fields}} from the platform,
 *   {detail: "text"} from the knowledge-base routes, FastAPI validation lists, and rate-limit replies.
 */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
  get unreachable() {
    return this.status === 0;
  }
}

export const UNREACHABLE =
  'The Paheli API is not reachable. Start the backend with: .venv\\Scripts\\python.exe -m uvicorn backend.main:app --reload --port 8000 ' +
  '(the first start loads the models and takes about 30 seconds).';

let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null) => { csrfToken = token; };

// Called when a signed-in request comes back 401 (session expired or revoked elsewhere).
let authLost: ((code: string) => void) | null = null;
export const onAuthLost = (fn: ((code: string) => void) | null) => { authLost = fn; };

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// The Vite dev proxy answers an empty-bodied 500 when the backend is down or still starting.
const isProxyFailure = (status: number, text: string) => [500, 502, 503, 504].includes(status) && text.trim() === '';

type Query = Record<string, string | number | boolean | null | undefined | string[]>;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Query;
}

function queryString(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** fetch() with the session cookie, CSRF header and "backend down" detection. Resolves with the raw Response. */
export async function rawFetch(path: string, opts: RequestOptions = {}): Promise<Response> {
  const { body, query, headers, ...rest } = opts;
  const method = (rest.method ?? (body !== undefined ? 'POST' : 'GET')).toUpperCase();
  const h = new Headers(headers);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    h.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }
  if (!SAFE.has(method) && csrfToken) h.set('X-CSRF-Token', csrfToken);
  try {
    return await fetch(`${BASE}${path}${queryString(query)}`, {
      ...rest, method, headers: h, body: payload, credentials: BASE ? 'include' : 'same-origin',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, UNREACHABLE);
  }
}

function errorFrom(status: number, body: unknown, statusText: string): ApiError {
  const b = (body ?? {}) as Record<string, unknown>;
  const detail = b.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as { code?: string; message?: string; fields?: Record<string, string> };
    return new ApiError(status, d.message ?? statusText, d.code, d.fields);
  }
  if (Array.isArray(detail)) {
    // FastAPI request validation: [{loc: ["body", "email"], msg: "..."}]
    const fields: Record<string, string> = {};
    for (const item of detail as { loc?: (string | number)[]; msg?: string }[]) {
      const key = String(item.loc?.[item.loc.length - 1] ?? 'request');
      fields[key] = item.msg ?? 'Invalid value';
    }
    return new ApiError(status, 'Some fields are invalid: ' + Object.entries(fields).map(([k, v]) => `${k} — ${v}`).join('; '),
      'invalid_input', fields);
  }
  if (typeof detail === 'string') return new ApiError(status, detail);
  if (status === 429) {
    return new ApiError(429, `Too many requests (${typeof b.error === 'string' ? b.error : 'rate limit'}). Wait a minute and try again.`,
      'rate_limited');
  }
  if (typeof b.error === 'string') return new ApiError(status, b.error);
  if (typeof body === 'string' && body) return new ApiError(status, body);
  return new ApiError(status, statusText || `Request failed (${status})`);
}

/** Turns a non-OK Response into an ApiError (and reports a lost session). */
export async function failure(res: Response): Promise<ApiError> {
  const text = await res.text();
  if (isProxyFailure(res.status, text)) return new ApiError(0, UNREACHABLE);
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* plain text */ }
  const err = errorFrom(res.status, body, res.statusText);
  if (res.status === 401 && csrfToken && (err.code === 'session_expired' || err.code === 'not_authenticated')) {
    authLost?.(err.code);
  }
  return err;
}

export async function http<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawFetch(path, opts);
  if (!res.ok) throw await failure(res);
  const text = await res.text();
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    return text as unknown as T;
  }
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
