import { useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FileText, FileUp, Loader2, RotateCcw, ScanText, Sparkles, Trash2, X,
} from 'lucide-react';
import type { Job, KBDocument, UploadResult } from '../../types/kb';
import { Modal } from '../ui/Overlay';
import OcrScanner from '../ocr/OcrScanner';

interface Props {
  open: boolean;
  onToggle: () => void;
  documents: KBDocument[];
  runningJobs: Job[];
  lastUpload: UploadResult[];
  busy: boolean;
  onUpload: (files: File[]) => void;
  onLoadSamples: () => void;
  onDelete: (docId: string) => void;
  onRetry: (docId: string) => void;
  onReset: () => void;
  onDismissResults: () => void;
  /** permissions the server will enforce anyway; the panel only hides what would be refused */
  canUpload?: boolean;
  canDelete?: boolean;
  readOnlyNote?: string;
  collapsible?: boolean;
  uploadLimits?: { max_mb: number; types: string[] };
}

const ACCEPT = '.pdf,.txt,.md';

export default function DocumentPanel(p: Props) {
  const { canUpload = true, canDelete = true, collapsible = true } = p;
  const open = collapsible ? p.open : true;
  const [drag, setDrag] = useState(false);
  const [ocr, setOcr] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const issues = p.lastUpload.filter((r) => r.status !== 'queued');
  const ready = p.documents.filter((d) => d.status === 'ready').length;

  const pick = (list: FileList | null) => {
    if (list && list.length) p.onUpload(Array.from(list));
    if (input.current) input.current.value = '';
  };

  return (
    <section className="border-b border-slate-200 bg-white">
      {collapsible ? (
        <button onClick={p.onToggle} className="flex w-full items-center justify-between px-4 py-2.5" aria-expanded={open}>
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <FileText className="h-4 w-4 text-slate-500" /> Documents
            <span className="rounded-full bg-slate-100 px-2 text-xs font-medium text-slate-600">{ready} ready</span>
            {p.runningJobs.length > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />}
          </span>
          {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-800">
          <FileText className="h-4 w-4 text-slate-500" /> Documents
          <span className="rounded-full bg-slate-100 px-2 text-xs font-medium text-slate-600">{ready} ready</span>
          {p.runningJobs.length > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />}
        </div>
      )}

      {open && (
        <div className="space-y-3 px-4 pb-3">
          {!canUpload && p.readOnlyNote && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">{p.readOnlyNote}</p>
          )}
          {canUpload && <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
            onClick={() => input.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 transition-colors ${
              drag ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <FileUp className="h-6 w-6 shrink-0 text-brand-600" />
            <div className="min-w-0 text-sm">
              <div className="font-medium text-slate-800">Drop PDF / TXT files or click to browse</div>
              <div className="text-xs text-slate-500">
                {p.uploadLimits ? `${p.uploadLimits.types.join(', ')} · up to ${p.uploadLimits.max_mb} MB each · ` : 'Multiple files · '}
                duplicates and unreadable files are rejected with a reason
              </div>
            </div>
            <input ref={input} type="file" multiple accept={p.uploadLimits ? p.uploadLimits.types.join(',') : ACCEPT} className="hidden" onChange={(e) => pick(e.target.files)} />
          </div>}

          <div className="flex flex-wrap items-center gap-2">
            {canUpload && <button onClick={() => setOcr(true)}
              className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas">
              <ScanText className="h-3.5 w-3.5 text-brand-700" /> Scan a photo (OCR)
            </button>}
            {canUpload && <button onClick={p.onLoadSamples} disabled={p.busy}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50">
              <Sparkles className="h-3.5 w-3.5" /> Load sample documents
            </button>}
            {canDelete && p.documents.length > 0 && (
              <button
                onClick={() => window.confirm('Delete every document and the whole knowledge graph?') && p.onReset()}
                className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600">
                Reset knowledge base
              </button>
            )}
          </div>

          {p.runningJobs.map((j) => {
            const pct = j.progress.chunks_total ? Math.round((100 * j.progress.chunks_done) / j.progress.chunks_total) : 0;
            return (
              <div key={j.id} className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building graph</span>
                  <span>{j.done.length}/{j.doc_ids.length} docs</span>
                </div>
                <div className="mt-0.5 truncate text-brand-700">{j.stage}</div>
                <div className="mt-1.5 h-1 overflow-hidden rounded bg-brand-100">
                  <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}

          {issues.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="mb-1 flex items-center justify-between font-medium">
                <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> {issues.length} file(s) not ingested</span>
                <button onClick={p.onDismissResults} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
              </div>
              <ul className="space-y-0.5">
                {issues.map((r, i) => (
                  <li key={i}><span className="font-medium">{r.filename}</span> — {r.status === 'duplicate' ? 'duplicate: ' : ''}{r.error}</li>
                ))}
              </ul>
            </div>
          )}

          {p.documents.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
              {p.documents.map((d) => (
                <li key={d.doc_id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <StatusIcon status={d.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-slate-800" title={d.title ?? d.filename}>{d.filename}</div>
                    <div className="truncate text-[11px] text-slate-500" title={d.error ?? undefined}>
                      {d.status === 'ready'
                        ? `${d.file_type === 'pdf' ? `${d.num_pages} pages · ` : ''}${d.num_chunks} chunks · ${d.num_entities} entities · ${d.num_relations} relations · ${d.extractor === 'llm' ? 'Gemini' : 'rule'} extraction`
                        : d.status === 'failed' ? d.error : d.status}
                    </div>
                  </div>
                  {canUpload && d.status === 'failed' && (
                    <button onClick={() => p.onRetry(d.doc_id)} title="Retry ingestion" className="rounded p-1 text-slate-400 hover:bg-white hover:text-brand-600">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {canDelete && d.status !== 'processing' && d.status !== 'queued' && (
                    <button
                      onClick={() => window.confirm(`Remove “${d.filename}” and everything extracted only from it?`) && p.onDelete(d.doc_id)}
                      title="Remove document"
                      className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-white hover:text-red-600 group-hover:opacity-100 focus:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Modal open={ocr} onClose={() => setOcr(false)} size="lg" title="Scan a photo or scanned PDF"
        description="Paheli reads the page in your browser. Check the text, then add it to this knowledge base.">
        <OcrScanner compact onAdd={(f) => p.onUpload([f])} />
      </Modal>
    </section>
  );
}

function StatusIcon({ status }: { status: KBDocument['status'] }) {
  if (status === 'ready') return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (status === 'failed') return <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />;
  return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-600" />;
}
