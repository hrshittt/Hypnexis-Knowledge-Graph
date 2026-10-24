import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { ServerCrash } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { LogoMark } from '../components/brand/Logo';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Feedback';

/** Only same-site paths are accepted as a post-login destination (no open redirects). */
export function safeNext(raw: string | null | undefined, fallback = '/app'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}

function FullPage({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">{children}</div>;
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, signedOutReason, bootError, refresh } = useAuth();
  const loc = useLocation();
  if (status === 'loading') {
    return <FullPage><LogoMark className="h-10 w-10" /><Spinner label="Checking your session…" /></FullPage>;
  }
  if (status === 'anonymous') {
    if (bootError) {
      return (
        <FullPage>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-danger-soft text-danger"><ServerCrash className="h-6 w-6" /></div>
          <h1 className="text-lg font-semibold text-ink">Can’t reach the Hypnexis API</h1>
          <p className="max-w-lg break-words text-[13.5px] text-ink-muted">{bootError}</p>
          <Button onClick={() => refresh()}>Try again</Button>
        </FullPage>
      );
    }
    const next = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/login?next=${next}${signedOutReason === 'session_expired' ? '&expired=1' : ''}`} replace />;
  }
  return <>{children}</>;
}

/** Sign-in and registration pages send signed-in users straight into the app. */
export function PublicOnly({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const [params] = useSearchParams();
  if (status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <>{children}</>;
}
