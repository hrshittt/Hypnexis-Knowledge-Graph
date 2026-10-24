import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bookmark, Building2, FileSpreadsheet, FileText, History, KeyRound, Layers, MessageSquareText, Search, Trash2, Waypoints } from 'lucide-react';
import { platformApi } from '../../api/platform';
import { errorMessage } from '../../lib/http';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { fmtDate, timeAgo } from '../../lib/format';
import { useToast } from '../../lib/toast';
import type { Activity, SavedAnalysisSummary } from '../../types/platform';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { IconButton } from '../../components/ui/Button';
import { Select } from '../../components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Overlay';
import { TabBar, useTab } from '../../components/ui/Tabs';

const KINDS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  query: { label: 'Questions', icon: MessageSquareText },
  search: { label: 'Searches', icon: Search },
  upload: { label: 'Uploads', icon: FileText },
  document: { label: 'Document changes', icon: FileText },
  import: { label: 'Placement imports', icon: FileSpreadsheet },
  analysis: { label: 'Saved analyses', icon: Bookmark },
  topic_view: { label: 'Topics explored', icon: Waypoints },
  graph_view: { label: 'Graphs explored', icon: Waypoints },
  workspace: { label: 'Workspace changes', icon: Building2 },
  account: { label: 'Account', icon: KeyRound },
};

export const SAVED_KIND: Record<string, string> = { legal: 'Legal research', paper: 'Research paper', corporate: 'Company analysis', placement: 'Placement answer' };

export default function ActivityPage() {
  useDocumentTitle('Recent activity');
  const [tab, setTab] = useTab(['activity', 'saved'] as const, 'activity');
  return (
    <Page>
      <PageHeader icon={<History />} title="Recent activity" description="Your own history across the workspaces you belong to. Other members can’t see it." />
      <TabBar label="Activity sections" active={tab} onChange={(k) => setTab(k)} className="mb-5 mt-5" items={[
        { key: 'activity', label: 'Activity', icon: <History /> },
        { key: 'saved', label: 'Saved analyses', icon: <Bookmark /> },
      ]} />
      {tab === 'activity' ? <ActivityList /> : <SavedList />}
    </Page>
  );
}

function ActivityList() {
  const [params, setParams] = useSearchParams();
  const kind = params.get('kind') ?? '';
  const q = useAsync(() => platformApi.activity(kind || undefined, 200), [kind]);
  const groups = new Map<string, Activity[]>();
  (q.data ?? []).forEach((a) => {
    const day = fmtDate(a.created_at);
    groups.set(day, [...(groups.get(day) ?? []), a]);
  });
  return (
    <div className="space-y-4">
      <Select compact value={kind} aria-label="Activity type" className="w-56"
        onChange={(e) => setParams((p) => { const n = new URLSearchParams(p); if (e.target.value) n.set('kind', e.target.value); else n.delete('kind'); return n; })}>
        <option value="">All activity</option>
        {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </Select>
      {q.error && !q.data ? <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>
        : q.initialLoading ? <Card padded><div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5 w-full" />)}</div></Card>
        : !q.data?.length ? <Card><EmptyState icon={<History />} title="No activity yet">Uploads, questions, imports and saved analyses appear here.</EmptyState></Card>
        : [...groups.entries()].map(([day, items]) => (
          <section key={day}>
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{day}</h2>
            <Card>
              <ul className="divide-y divide-line">
                {items.map((a) => {
                  const k = KINDS[a.kind] ?? { label: a.kind, icon: Layers };
                  return (
                    <li key={a.activity_id} className="flex items-start gap-3 px-5 py-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-canvas text-ink-muted"><k.icon className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-[13.5px] text-ink">{a.summary}</p>
                        <p className="mt-0.5 text-[12px] text-ink-muted">
                          {k.label} · {a.workspace_id ? <Link to={`/app/w/${a.workspace_id}`} className="hover:underline">{a.workspace_name}</Link> : (a.detail as { scope?: string }).scope === 'shared' ? 'Shared demo corpus' : 'Account'} · {timeAgo(a.created_at)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        ))}
    </div>
  );
}

function SavedList() {
  const toast = useToast();
  const q = useAsync(() => platformApi.saved(), []);
  const [deleting, setDeleting] = useState<SavedAnalysisSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await platformApi.deleteSaved(deleting.analysis_id);
      toast.success('Saved analysis deleted.');
      setDeleting(null);
      q.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  if (q.error && !q.data) return <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>;
  if (q.initialLoading) return <Card padded><Skeleton className="h-6 w-full" /></Card>;
  if (!q.data?.length) {
    return <Card><EmptyState icon={<Bookmark />} title="Nothing saved yet">Use “Save” on a legal research result, a paper, a company analysis or a placement answer to keep a snapshot here.</EmptyState></Card>;
  }
  return (
    <Card>
      <ul className="divide-y divide-line">
        {q.data.map((s) => (
          <li key={s.analysis_id} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60">
            <Link to={`/app/saved/${s.analysis_id}`} className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink hover:underline">{s.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
                <Badge>{SAVED_KIND[s.kind] ?? s.kind}</Badge>{s.workspace_name ?? 'Personal'} · saved {timeAgo(s.created_at)}
              </span>
            </Link>
            <IconButton label="Delete saved analysis" size="sm" onClick={() => setDeleting(s)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={!!deleting} title="Delete this saved analysis?" confirmLabel="Delete" busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)}>
        “{deleting?.title}” will be removed from your saved analyses. The underlying documents and data are not affected.
      </ConfirmDialog>
    </Card>
  );
}

