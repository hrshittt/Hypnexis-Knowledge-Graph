import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, FileUp, Pencil, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { workspaceKbApi } from '../../api/kb';
import { workspacesApi } from '../../api/platform';
import { errorMessage } from '../../lib/http';
import { useAsync } from '../../lib/hooks';
import { fmtBytes, fmtDateTime, timeAgo } from '../../lib/format';
import { roleAtLeast } from '../../lib/workspaceTypes';
import { useToast } from '../../lib/toast';
import type { KBStatus, UploadResult } from '../../types/kb';
import type { Workspace, WorkspaceDocument } from '../../types/platform';
import { Card, CardHeader, KeyValue } from '../ui/Card';
import { Badge, SampleBadge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { Select, SearchInput } from '../ui/Form';
import { EmptyState, ErrorState, Notice, Skeleton } from '../ui/Feedback';
import { ConfirmDialog, Drawer } from '../ui/Overlay';
import { Table, Td, Th } from '../ui/Table';
import { DocStatus } from './DocStatus';
import { META_LABEL, MetaEditor, type MetaField } from './MetaEditor';

interface Props {
  ws: Workspace;
  metaFields: MetaField[];
  allowVerified?: boolean;
  /** called after uploads finish processing or documents change, so analyses can refresh */
  onChanged?: () => void;
  intro?: React.ReactNode;
}

export function WorkspaceDocuments({ ws, metaFields, allowVerified, onChanged, intro }: Props) {
  const api = useMemo(() => workspaceKbApi(ws.id), [ws.id]);
  const toast = useToast();
  const canUpload = roleAtLeast(ws.role, 'analyst');
  const canDelete = ws.role === 'owner';
  const docs = useAsync(() => workspacesApi.documents(ws.id).then((r) => r.documents), [ws.id]);
  const [status, setStatus] = useState<KBStatus | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<WorkspaceDocument | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceDocument | null>(null);
  const [details, setDetails] = useState<WorkspaceDocument | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wasBusy = useRef(false);

  const list = useMemo(() => docs.data ?? [], [docs.data]);
  const active = list.some((d) => d.status === 'queued' || d.status === 'processing') || (status?.jobs.length ?? 0) > 0;

  useEffect(() => { api.status().then(setStatus).catch(() => {}); }, [api]);

  // Poll while ingestion runs; tell the parent once everything has settled.
  useEffect(() => {
    if (!active) {
      if (wasBusy.current) { wasBusy.current = false; onChanged?.(); }
      return;
    }
    wasBusy.current = true;
    const t = setTimeout(() => {
      docs.reload();
      api.status().then(setStatus).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [active, list, api, docs, onChanged]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const r = await api.upload(files);
      setResults(r.results);
      const queued = r.results.filter((x) => x.status === 'queued').length;
      if (queued) toast.success(`${queued} document${queued === 1 ? '' : 's'} uploaded. Processing has started.`);
      await docs.reload();
      api.status().then(setStatus).catch(() => {});
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const loadSamples = async () => {
    setBusy(true);
    try {
      const r = await api.loadSamples();
      setResults(r.results);
      toast.success('Loading the sample documents. They are marked as sample data.');
      await docs.reload();
      api.status().then(setStatus).catch(() => {});
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const retry = async (d: WorkspaceDocument) => {
    try {
      await api.retryDocument(d.doc_id);
      toast.info(`Retrying ${d.filename}…`);
      await docs.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.deleteDocument(deleting.doc_id);
      toast.success(`Removed ${deleting.filename}.`);
      setDeleting(null);
      await docs.reload();
      onChanged?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = list.filter((d) => (filter === 'all' || d.status === filter)
    && (!query || `${d.title ?? ''} ${d.filename} ${Object.values(d.meta).join(' ')}`.toLowerCase().includes(query.toLowerCase())));
  const issues = results.filter((r) => r.status !== 'queued');
  const limits = status?.upload;

  return (
    <div className="space-y-4">
      {intro}
      {canUpload ? (
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(Array.from(e.dataTransfer.files)); }}
          className={`flex flex-wrap items-center gap-4 rounded-xl border-2 border-dashed px-5 py-4 transition-colors ${
            drag ? 'border-brand-600 bg-brand-50' : 'border-line-strong bg-white'}`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><FileUp className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-ink">Drop documents here or browse</p>
            <p className="text-[12.5px] text-ink-muted">
              {limits ? `${limits.types.map((t) => t.replace('.', '').toUpperCase()).join(', ')} · up to ${limits.max_mb} MB each` : 'PDF, TXT or MD'}
              {' · '}files are validated on the server, never executed, and visible only to members of this workspace
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} onClick={loadSamples} disabled={busy}>Load sample documents</Button>
            <Button icon={<FileUp className="h-4 w-4" />} onClick={() => input.current?.click()} loading={busy}>Upload</Button>
          </div>
          <input ref={input} type="file" multiple className="hidden" accept={limits?.types.join(',') ?? '.pdf,.txt,.md'}
            onChange={(e) => upload(Array.from(e.target.files ?? []))} />
        </div>
      ) : (
        <Notice tone="neutral">You have viewer access to this workspace: you can read documents and analyses, but not upload or change them.</Notice>
      )}

      {issues.length > 0 && (
        <Notice tone="warn" title={`${issues.length} file${issues.length === 1 ? '' : 's'} not added`}
          action={<IconButton label="Dismiss" size="sm" onClick={() => setResults([])}><X className="h-3.5 w-3.5" /></IconButton>}>
          <ul className="mt-1 space-y-0.5">
            {issues.map((r, i) => <li key={i}><b className="font-medium">{r.filename}</b> — {r.status === 'duplicate' ? 'already in this workspace. ' : ''}{r.error}</li>)}
          </ul>
        </Notice>
      )}

      {status?.jobs.map((j) => {
        const pct = j.progress.chunks_total ? Math.round((100 * j.progress.chunks_done) / j.progress.chunks_total) : 0;
        return (
          <div key={j.id} className="rounded-lg border border-info/20 bg-info-soft px-4 py-2.5 text-[13px] text-info-ink">
            <div className="flex items-center justify-between"><span className="font-medium">Building the knowledge graph · {j.stage}</span><span className="num">{j.done.length}/{j.doc_ids.length} documents</span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/70" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-info transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}

      <Card>
        <CardHeader title="Documents" description={docs.data ? `${list.length} in this workspace` : undefined}
          actions={<>
            <SearchInput value={query} onChange={setQuery} placeholder="Search documents" compact className="w-56" />
            <Select compact value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status" className="w-36">
              <option value="all">All statuses</option><option value="ready">Ready</option><option value="processing">Processing</option>
              <option value="queued">Queued</option><option value="failed">Failed</option>
            </Select>
          </>} />
        {docs.error && !docs.data ? <ErrorState message={docs.error} onRetry={docs.reload} />
          : docs.initialLoading ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          : !list.length ? (
            <EmptyState icon={<FileText />} title="No documents yet"
              actions={canUpload && <Button icon={<Sparkles className="h-4 w-4" />} onClick={loadSamples} loading={busy}>Load sample documents</Button>}>
              {canUpload ? 'Upload your own documents, or load the fictional sample set to explore.' : 'An analyst or owner hasn’t added documents yet.'}
            </EmptyState>
          ) : !shown.length ? <EmptyState compact title="No documents match">Try a different search or status filter.</EmptyState>
          : (
            <Table caption="Workspace documents">
              <thead>
                <tr>
                  <Th>Document</Th>
                  {metaFields.slice(0, 3).map((f) => <Th key={f} className="hidden md:table-cell">{META_LABEL[f]}</Th>)}
                  <Th>Status</Th>
                  <Th className="hidden sm:table-cell">Added</Th>
                  <Th align="right"><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.doc_id} className="hover:bg-canvas/60">
                    <Td>
                      <button onClick={() => setDetails(d)} className="block max-w-[340px] text-left">
                        <span className="block truncate font-medium text-ink hover:underline">{d.title || d.filename}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-muted">
                          <span className="truncate">{d.filename}</span>{d.is_sample && <SampleBadge />}
                        </span>
                      </button>
                    </Td>
                    {metaFields.slice(0, 3).map((f) => (
                      <Td key={f} className="hidden md:table-cell">{d.meta[f] ? <span className="text-ink-soft">{d.meta[f]}</span> : <span className="text-ink-faint">Not set</span>}</Td>
                    ))}
                    <Td>
                      <DocStatus status={d.status} error={d.error} />
                      {d.status === 'failed' && d.error && <p className="mt-1 max-w-[260px] text-[11.5px] text-danger-ink">{d.error}</p>}
                    </Td>
                    <Td className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{timeAgo(d.uploaded_at)}</Td>
                    <Td align="right">
                      <div className="flex justify-end gap-0.5">
                        {canUpload && d.status === 'failed' && <IconButton label="Retry processing" size="sm" onClick={() => retry(d)}><RotateCcw className="h-3.5 w-3.5" /></IconButton>}
                        {canUpload && metaFields.length > 0 && <IconButton label="Edit details" size="sm" onClick={() => setEditing(d)}><Pencil className="h-3.5 w-3.5" /></IconButton>}
                        {canDelete && d.status !== 'processing' && d.status !== 'queued' && (
                          <IconButton label="Delete document" size="sm" className="hover:!bg-danger-soft hover:!text-danger" onClick={() => setDeleting(d)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Card>

      <MetaEditor open={!!editing} onClose={() => setEditing(null)} workspaceId={ws.id} doc={editing} fields={metaFields}
        allowVerified={allowVerified} onSaved={() => { docs.reload(); onChanged?.(); }} />
      <ConfirmDialog open={!!deleting} title="Delete this document?" confirmLabel="Delete document" busy={busy}
        onConfirm={remove} onCancel={() => setDeleting(null)}>
        <p><b className="font-medium text-ink">{deleting?.filename}</b> and everything extracted only from it — passages, entities,
          relationships and analysis figures — will be permanently removed from this workspace. This can’t be undone.</p>
      </ConfirmDialog>
      <Drawer open={!!details} onClose={() => setDetails(null)} title={details?.title || details?.filename || ''}
        subtitle={details && <span className="flex items-center gap-2">{details.filename}{details.is_sample && <SampleBadge />}</span>}
        footer={details && canUpload && metaFields.length > 0 ? <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => { setEditing(details); setDetails(null); }}>Edit details</Button> : undefined}>
        {details && (
          <div className="space-y-5">
            <div className="flex items-center gap-2"><DocStatus status={details.status} error={details.error} />
              {details.extractor && <Badge>{details.extractor === 'llm' ? 'Gemini extraction' : 'Rule-based extraction'}</Badge>}</div>
            {details.status === 'failed' && details.error && <Notice tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>{details.error}</Notice>}
            <dl className="grid grid-cols-2 gap-4">
              <KeyValue label="Type">{details.file_type.toUpperCase()}</KeyValue>
              <KeyValue label="Size">{fmtBytes(details.size_bytes)}</KeyValue>
              <KeyValue label="Pages">{details.num_pages}</KeyValue>
              <KeyValue label="Passages">{details.num_chunks}</KeyValue>
              <KeyValue label="Entities">{details.num_entities}</KeyValue>
              <KeyValue label="Relations">{details.num_relations}</KeyValue>
              <KeyValue label="Added">{fmtDateTime(details.uploaded_at)}</KeyValue>
              <KeyValue label="Last verified">{details.verified_at ? fmtDateTime(details.verified_at) : 'Not verified'}</KeyValue>
            </dl>
            {metaFields.length > 0 && (
              <div>
                <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Details you supplied</h3>
                <dl className="grid grid-cols-2 gap-4">
                  {metaFields.map((f) => (
                    <KeyValue key={f} label={META_LABEL[f]}>
                      {f === 'source_url' && details.meta[f]
                        ? <a href={details.meta[f]!} target="_blank" rel="noreferrer noopener" className="break-all text-brand-700 underline">{details.meta[f]}</a>
                        : details.meta[f] ?? <span className="text-ink-faint">Not set</span>}
                    </KeyValue>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
