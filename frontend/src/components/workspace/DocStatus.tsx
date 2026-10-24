import { AlertTriangle, CheckCircle2, Clock3, Loader2 } from 'lucide-react';
import type { KBDocument } from '../../types/kb';

export function DocStatus({ status, error }: { status: KBDocument['status']; error?: string | null }) {
  if (status === 'ready') {
    return <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11.5px] font-medium text-brand-700"><CheckCircle2 className="h-3 w-3" /> Ready</span>;
  }
  if (status === 'failed') {
    return <span className="inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-[11.5px] font-medium text-danger-ink" title={error ?? undefined}><AlertTriangle className="h-3 w-3" /> Failed</span>;
  }
  if (status === 'processing') {
    return <span className="inline-flex items-center gap-1 rounded-md bg-info-soft px-1.5 py-0.5 text-[11.5px] font-medium text-info-ink"><Loader2 className="h-3 w-3 animate-spin" /> Processing</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-[11.5px] font-medium text-ink-soft"><Clock3 className="h-3 w-3" /> Queued</span>;
}
