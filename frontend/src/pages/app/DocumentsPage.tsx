import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText, FileUp, RotateCcw, Trash2 } from 'lucide-react';
import { createKbApi, kbApi, workspaceKbApi } from '../../api/kb';
import { platformApi } from '../../api/platform';
import { errorMessage } from '../../lib/http';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { fmtBytes, fmtDateTime, timeAgo } from '../../lib/format';
import { TYPE_INFO, roleAtLeast } from '../../lib/workspaceTypes';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import type { KBStatus, UploadResult } from '../../types/kb';
import type { PlatformDocument } from '../../types/platform';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader, KeyValue } from '../../components/ui/Card';
import { Badge, SampleBadge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Field, SearchInput, Select } from '../../components/ui/Form';
import { EmptyState, ErrorState, Notice, Skeleton } from '../../components/ui/Feedback';
import { ConfirmDialog, Drawer, Modal } from '../../components/ui/Overlay';
import { Pagination, Table, Td, Th } from '../../components/ui/Table';
import { DocStatus } from '../../components/workspace/DocStatus';

const PAGE = 25;
const apiFor = (d: { workspace_id: string | null }) => (d.workspace_id ? workspaceKbApi(d.workspace_id) : kbApi);

export default function DocumentsPage() {
  useDocumentTitle('Documents');
  const toast = useToast();
  const { workspaces } = useAuth();
  const docs = useAsync(() => platformApi.documents(), []);
  const [query, setQuery] = useState('');
  const [wsFilter, setWsFilter] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<PlatformDocument | null>(null);
  const [details, setDetails] = useState<PlatformDocument | null>(null);
  const [busy, setBusy] = useState(false);

  const all = docs.data?.documents ?? [];
  const processing = all.some((d) => d.status === 'queued' || d.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const t = setTimeout(() => docs.reload(), 2000);
    return () => clearTimeout(t);
  }, [processing, docs]);

  const places = useMemo(() => {
    const m = new Map<string, { id: string; name: string; type: string; canUpload: boolean }>();
    all.forEach((d) => m.set(d.workspace_id ?? 'shared', { id: d.workspace_id ?? 'shared', name: d.workspace_name, type: d.workspace_type, canUpload: d.can_upload }));
    return [...m.values()];
  }, [all]);

  const filtered = all.filter((d) => (wsFilter === 'all' || (d.workspace_id ?? 'shared') === wsFilter)
    && (status === 'all' || d.status === status)
    && (!query || `${d.title ?? ''} ${d.filename} ${d.workspace_name}`.toLowerCase().includes(query.toLowerCase())));
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);

  const retry = async (d: PlatformDocument) => {
    try {
      await apiFor(d).retryDocument(d.doc_id);
      toast.info(`Retrying ${d.filename}…`);
      docs.reload();
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await apiFor(deleting).deleteDocument(deleting.doc_id);
      toast.success(`Removed ${deleting.filename}.`);
      setDeleting(null);
      docs.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Page>
      <PageHeader icon={<FileText />} title="Documents" description="Every document in your workspaces, plus the shared demo corpus. Documents are visible only to members of their workspace."
        actions={<Button icon={<FileUp className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>Upload documents</Button>} />
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Search by title, file or workspace" className="w-72" />
        <Select compact value={wsFilter} onChange={(e) => { setWsFilter(e.target.value); setPage(1); }} aria-label="Workspace" className="w-60">
          <option value="all">All workspaces</option>
          {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select compact value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status" className="w-40">
          <option value="all">All statuses</option><option value="ready">Ready</option><option value="processing">Processing</option>
          <option value="queued">Queued</option><option value="failed">Failed</option>
        </Select>
      </div>
      <Card className="mt-4">
        <CardHeader title={docs.data ? `${filtered.length} document${filtered.length === 1 ? '' : 's'}` : 'Documents'} />
        {docs.error && !docs.data ? <ErrorState message={docs.error} onRetry={docs.reload} />
          : docs.initialLoading ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          : !all.length ? (
            <EmptyState icon={<FileText />} title="No documents yet" actions={<Button onClick={() => setUploadOpen(true)}>Upload documents</Button>}>
              Add documents to a workspace to analyse them, or load a workspace’s sample set from its Documents tab.
            </EmptyState>
          ) : !filtered.length ? <EmptyState compact title="No documents match">Clear the search or filters.</EmptyState>
          : (
            <>
              <Table caption="All documents">
                <thead><tr><Th>Document</Th><Th>Workspace</Th><Th>Status</Th><Th align="right" className="hidden md:table-cell">Entities</Th><Th className="hidden sm:table-cell">Added</Th><Th align="right"><span className="sr-only">Actions</span></Th></tr></thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={`${d.workspace_id}-${d.doc_id}`} className="hover:bg-canvas/60">
                      <Td>
                        <button onClick={() => setDetails(d)} className="block max-w-[360px] text-left">
                          <span className="block truncate font-medium text-ink hover:underline">{d.title || d.filename}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-muted"><span className="truncate">{d.filename}</span>{d.is_sample && <SampleBadge />}</span>
                        </button>
                      </Td>
                      <Td>
                        <div className="text-[13px] text-ink">{d.workspace_name}</div>
                        <div className="text-[12px] text-ink-muted">{d.workspace_type === 'shared' ? 'Shared · read-only' : TYPE_INFO[d.workspace_type].short} · {d.role}</div>
                      </Td>
                      <Td><DocStatus status={d.status} error={d.error} /></Td>
                      <Td align="right" className="hidden md:table-cell">{d.status === 'ready' ? d.num_entities : '—'}</Td>
                      <Td className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{timeAgo(d.uploaded_at)}</Td>
                      <Td align="right">
                        <div className="flex justify-end gap-0.5">
                          <Link to={d.workspace_id ? `/app/w/${d.workspace_id}?tab=documents` : '/app/graph'} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted hover:bg-ink/5 hover:text-ink"
                            title="Open in workspace" aria-label="Open in workspace"><ExternalLink className="h-3.5 w-3.5" /></Link>
                          {d.can_upload && d.status === 'failed' && <IconButton label="Retry processing" size="sm" onClick={() => retry(d)}><RotateCcw className="h-3.5 w-3.5" /></IconButton>}
                          {d.can_delete && d.status !== 'queued' && d.status !== 'processing' && (
                            <IconButton label="Delete document" size="sm" className="hover:!bg-danger-soft hover:!text-danger" onClick={() => setDeleting(d)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="px-4"><Pagination page={page} pageSize={PAGE} total={filtered.length} onPage={setPage} /></div>
            </>
          )}
      </Card>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={docs.reload}
        places={[
          ...workspaces.filter((w) => roleAtLeast(w.role, 'analyst')).map((w) => ({ id: w.id, name: w.name, type: w.type as string })),
          ...(docs.data?.shared_write ? [{ id: 'shared', name: 'Shared demo corpus', type: 'shared' }] : []),
        ]} />
      <ConfirmDialog open={!!deleting} title="Delete this document?" confirmLabel="Delete document" busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)}>
        <p><b className="font-medium text-ink">{deleting?.filename}</b> will be removed from <b className="font-medium text-ink">{deleting?.workspace_name}</b>, with every passage, entity and relationship extracted only from it. This can’t be undone.</p>
      </ConfirmDialog>
      <Drawer open={!!details} onClose={() => setDetails(null)} title={details?.title || details?.filename || ''} subtitle={details?.workspace_name}>
        {details && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2"><DocStatus status={details.status} error={details.error} />{details.is_sample && <SampleBadge />}
              {details.extractor && <Badge>{details.extractor === 'llm' ? 'Gemini extraction' : 'Rule-based extraction'}</Badge>}</div>
            {details.status === 'failed' && details.error && <Notice tone="danger">{details.error}</Notice>}
            <dl className="grid grid-cols-2 gap-4">
              <KeyValue label="File">{details.filename}</KeyValue>
              <KeyValue label="Size">{fmtBytes(details.size_bytes)}</KeyValue>
              <KeyValue label="Pages">{details.num_pages}</KeyValue>
              <KeyValue label="Passages">{details.num_chunks}</KeyValue>
              <KeyValue label="Entities">{details.num_entities}</KeyValue>
              <KeyValue label="Relations">{details.num_relations}</KeyValue>
              <KeyValue label="Added">{fmtDateTime(details.uploaded_at)}</KeyValue>
              <KeyValue label="Your access">{details.can_delete ? 'Can delete' : details.can_upload ? 'Can upload' : 'Read only'}</KeyValue>
              {Object.entries(details.meta ?? {}).filter(([, v]) => v).map(([k, v]) => <KeyValue key={k} label={k.replace(/_/g, ' ')}>{String(v)}</KeyValue>)}
            </dl>
          </div>
        )}
      </Drawer>
    </Page>
  );
}

function UploadModal({ open, onClose, places, onUploaded }: {
  open: boolean; onClose: () => void; places: { id: string; name: string; type: string }[]; onUploaded: () => void;
}) {
  const toast = useToast();
  const [target, setTarget] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<KBStatus | null>(null);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dest = target || places[0]?.id || '';
  const api = useMemo(() => (dest === 'shared' ? kbApi : dest ? workspaceKbApi(dest) : createKbApi()), [dest]);

  useEffect(() => {
    if (!open || !dest) return;
    setStatus(null);
    api.status().then(setStatus).catch(() => {});
  }, [open, dest, api]);

  const close = () => { setFiles([]); setResults(null); onClose(); };
  const upload = async () => {
    setBusy(true);
    try {
      const r = await api.upload(files);
      setResults(r.results);
      const queued = r.results.filter((x) => x.status === 'queued').length;
      if (queued) toast.success(`${queued} document${queued === 1 ? '' : 's'} uploaded. Processing has started.`);
      setFiles([]);
      onUploaded();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={close} title="Upload documents" description="Documents are processed in the background and appear in the list straight away."
      footer={<><Button variant="secondary" onClick={close}>Close</Button><Button onClick={upload} loading={busy} disabled={!files.length || !dest}>Upload {files.length || ''}</Button></>}>
      {!places.length ? (
        <Notice tone="warn">You don’t have upload access to any workspace. Create a workspace, or ask an owner to make you an analyst.</Notice>
      ) : (
        <div className="space-y-4">
          <Field label="Workspace">
            {({ id }) => (
              <Select id={id} value={dest} onChange={(e) => { setTarget(e.target.value); setResults(null); }}>
                {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
          </Field>
          <div>
            <button type="button" onClick={() => input.current?.click()}
              className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-line-strong px-4 py-6 text-center hover:border-brand-600 hover:bg-brand-50">
              <FileUp className="h-6 w-6 text-brand-700" />
              <span className="mt-2 text-[14px] font-medium text-ink">{files.length ? `${files.length} file(s) selected` : 'Choose files'}</span>
              <span className="mt-0.5 text-[12.5px] text-ink-muted">
                {status?.upload ? `${status.upload.types.join(', ')} · up to ${status.upload.max_mb} MB each` : 'PDF, TXT or MD'} · validated on the server, never executed
              </span>
            </button>
            <input ref={input} type="file" multiple className="hidden" accept={status?.upload?.types.join(',') ?? '.pdf,.txt,.md'}
              onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setResults(null); if (input.current) input.current.value = ''; }} />
            {files.length > 0 && <ul className="mt-2 space-y-0.5 text-[12.5px] text-ink-soft">{files.map((f) => <li key={f.name}>{f.name} · {fmtBytes(f.size)}</li>)}</ul>}
          </div>
          {results && results.some((r) => r.status !== 'queued') && (
            <Notice tone="warn" title="Some files were not added">
              <ul>{results.filter((r) => r.status !== 'queued').map((r, i) => <li key={i}><b className="font-medium">{r.filename}</b> — {r.error}</li>)}</ul>
            </Notice>
          )}
        </div>
      )}
    </Modal>
  );
}
