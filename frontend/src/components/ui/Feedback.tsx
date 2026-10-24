import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from './Button';

type Tone = 'info' | 'warn' | 'danger' | 'success' | 'neutral';

const NOTICE: Record<Tone, { box: string; icon: React.ComponentType<{ className?: string }>; iconClass: string }> = {
  info: { box: 'border-info/25 bg-info-soft text-info-ink', icon: Info, iconClass: 'text-info' },
  warn: { box: 'border-warn/30 bg-warn-soft text-warn-ink', icon: AlertTriangle, iconClass: 'text-warn' },
  danger: { box: 'border-danger/25 bg-danger-soft text-danger-ink', icon: ShieldAlert, iconClass: 'text-danger' },
  success: { box: 'border-brand-200 bg-brand-50 text-brand-800', icon: CheckCircle2, iconClass: 'text-brand-600' },
  neutral: { box: 'border-line bg-canvas text-ink-soft', icon: Info, iconClass: 'text-ink-muted' },
};

interface NoticeProps {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}

export function Notice({ tone = 'info', title, children, action, className = '', icon }: NoticeProps) {
  const t = NOTICE[tone];
  const Icon = t.icon;
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] leading-snug ${t.box} ${className}`}
      role={tone === 'danger' ? 'alert' : undefined}>
      <span className={`mt-px shrink-0 ${t.iconClass}`}>{icon ?? <Icon className="h-4 w-4" />}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon, title, children, actions, className = '', compact }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'px-4 py-8' : 'px-6 py-14'} ${className}`}>
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 [&_svg]:h-5 [&_svg]:w-5">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-[13.5px] leading-relaxed text-ink-muted">{children}</div>}
      {actions && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className = '' }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={`flex flex-col items-center px-6 py-10 text-center ${className}`} role="alert">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-danger-soft text-danger">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">Something went wrong</h3>
      <p className="mt-1 max-w-lg break-words text-[13.5px] text-ink-muted">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Spinner({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] text-ink-muted ${className}`} role="status">
      <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
      {label ?? <span className="sr-only">Loading</span>}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-ink/[0.06] ${className}`} aria-hidden />;
}

/** A card-shaped placeholder for the first load of a panel. */
export function SkeletonCard({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-white p-5 shadow-card ${className}`} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={`h-3 ${i % 3 === 2 ? 'w-2/3' : 'w-full'}`} />)}
      </div>
    </div>
  );
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}
