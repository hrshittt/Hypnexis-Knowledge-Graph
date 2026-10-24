import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, workspacesApi } from '../api/platform';
import { ApiError, onAuthLost, setCsrfToken } from './http';
import type { SessionPayload, User, Workspace, WorkspaceType } from '../types/platform';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: Status;
  session: SessionPayload | null;
  user: User | null;
  workspaces: Workspace[];
  /** why the user was signed out: 'session_expired' when the server rejected a live session */
  signedOutReason: string | null;
  /** the API could not be reached while checking the session */
  bootError: string | null;
  login: (email: string, password: string, remember: boolean) => Promise<SessionPayload>;
  register: (body: { name: string; email: string; password: string; workspace_type: WorkspaceType | null; accept_terms: boolean }) => Promise<SessionPayload>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshWorkspaces: () => Promise<Workspace[]>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const apply = useCallback((p: SessionPayload) => {
    setCsrfToken(p.csrf_token);
    setSession(p);
    setStatus('authenticated');
    setSignedOutReason(null);
    setBootError(null);
    return p;
  }, []);

  const clear = useCallback((reason: string | null) => {
    setCsrfToken(null);
    setSession(null);
    setStatus('anonymous');
    setSignedOutReason(reason);
  }, []);

  const check = useCallback(async () => {
    try {
      const s = await authApi.session();
      if (s.authenticated) apply(s);
      else clear(s.expired ? 'session_expired' : null);
    } catch (e) {
      clear(null);
      if (!(e instanceof ApiError && (e.status === 401 || e.status === 403))) setBootError((e as Error).message);
    }
  }, [apply, clear]);

  useEffect(() => {
    onAuthLost((code) => clear(code));
    check();
    return () => onAuthLost(null);
  }, [check, clear]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    session,
    user: session?.user ?? null,
    workspaces: session?.workspaces ?? [],
    signedOutReason,
    bootError,
    login: async (email, password, remember) => apply(await authApi.login(email, password, remember)),
    register: async (body) => apply(await authApi.register(body)),
    logout: async () => {
      try { await authApi.logout(); } catch { /* the cookie is cleared server-side when reachable */ }
      clear(null);
    },
    refresh: check,
    refreshWorkspaces: async () => {
      const list = await workspacesApi.list();
      setSession((s) => (s ? { ...s, workspaces: list } : s));
      return list;
    },
    setUser: (u) => setSession((s) => (s ? { ...s, user: u } : s)),
  }), [status, session, signedOutReason, bootError, apply, clear, check]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
