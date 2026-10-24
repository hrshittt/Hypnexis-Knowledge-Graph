import { Link } from 'react-router-dom';
import {
  ArrowRight, BookOpenText, Bookmark, Building2, FileText, GraduationCap, History, Layers, Loader2, MessageSquareText,
  Plus, Scale, Search, Waypoints,
} from 'lucide-react';
import { platformApi } from '../../api/platform';
import { useAuth } from '../../lib/auth';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { plural, timeAgo } from '../../lib/format';
import { TYPE_INFO, WORKSPACE_TYPES } from '../../lib/workspaceTypes';
import { useCreateWorkspace } from '../../lib/useCreateWorkspace';
import type { Overview as OverviewData, Workspace, WorkspaceType } from '../../types/platform';
import { Page } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState, ErrorState, Skeleton, SkeletonCard } from '../../components/ui/Feedback';
import { DocStatus } from '../../components/workspace/DocStatus';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Overview() {
  useDocumentTitle('Overview');
  const { user } = useAuth();
  const q = useAsync(() => platformApi.overview(), []);
  const d = q.data;

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{greeting()}, {user?.name.split(' ')[0]}</h1>
          <p className="mt-1 text-[14px] text-ink-muted">Here’s what’s happening across your workspaces.</p>
        </div>
        <div className="flex gap-2">
          <ButtonLink to="/app/search" variant="secondary" icon={<Search className="h-4 w-4" />}>Ask a question</ButtonLink>
          <ButtonLink to="/app/graph" icon={<Waypoints className="h-4 w-4" />}>Open knowledge graph</ButtonLink>
        </div>
      </div>

      {q.error && !d && <Card className="mt-6"><ErrorState message={q.error} onRetry={q.reload} /></Card>}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workspaces">
        {q.initialLoading
          ? Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} lines={2} />)
          : WORKSPACE_TYPES.map((t) => <WorkspaceCard key={t.type} type={t.type} items={(d?.workspaces ?? []).filter((w) => w.type === t.type)} />)}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <RecentDocuments data={d} loading={q.initialLoading} />
          <div className="grid gap-6 lg:grid-cols-2">
            <RecentQueries data={d} loading={q.initialLoading} />
            <SavedAnalyses data={d} loading={q.initialLoading} />
          </div>
        </div>
        <div className="space-y-6">
          <QuickActions workspaces={d?.workspaces ?? []} />
          <Processing data={d} loading={q.initialLoading} />
          <RecentTopics data={d} loading={q.initialLoading} />
          {d?.shared_corpus && (
            <Card padded>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[14px] font-semibold text-ink">Shared demo corpus</h2>
                  <p className="mt-0.5 text-[12.5px] text-ink-muted">The original knowledge graph built from the fictional sample documents.</p>
                </div>
                <Waypoints className="h-5 w-5 text-brand-600" />
              </div>
              <p className="num mt-3 text-[13px] text-ink-soft">
                {plural(d.shared_corpus.documents, 'document')} · {plural(d.shared_corpus.entities, 'entity', 'entities')} · {plural(d.shared_corpus.topics, 'topic')}
              </p>
              <ButtonLink to="/app/graph" variant="subtle" size="sm" className="mt-3">Explore the graph <ArrowRight className="h-3.5 w-3.5" /></ButtonLink>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}

function WorkspaceCard({ type, items }: { type: WorkspaceType; items: Workspace[] }) {
  const info = TYPE_INFO[type];
  const { create, creating } = useCreateWorkspace();
  const ws = items[0];
  const s = ws?.stats;
  return (
    <Card className="flex flex-col p-4 transition-shadow hover:shadow-pop">
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><info.icon className="h-[18px] w-[18px]" /></span>
        {items.length > 1 && <Badge tone="outline">{items.length} workspaces</Badge>}
      </div>
      <h2 className="mt-3 text-[14.5px] font-semibold text-ink">{info.label}</h2>
      {ws ? (
        <>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">{ws.name}</p>
          <p className="num mt-3 text-[12.5px] text-ink-soft">
            {type === 'placement'
              ? `${(s?.placement_students ?? 0).toLocaleString()} students · ${(s?.placement_records ?? 0).toLocaleString()} records`
              : `${s?.documents ?? 0} documents · ${s?.entities ?? 0} entities · ${s?.topics ?? 0} topics`}
          </p>
          {(s?.processing ?? 0) > 0 && <p className="mt-1 flex items-center gap-1 text-[12px] text-brand-700"><Loader2 className="h-3 w-3 animate-spin" /> Processing documents</p>}
          <Link to={items.length > 1 ? `/app/${type}` : `/app/w/${ws.id}`} className="mt-auto inline-flex items-center gap-1 pt-3 text-[13px] font-medium text-brand-700 hover:underline">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </>
      ) : (
        <>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{info.tagline}</p>
          <Button variant="secondary" size="sm" className="mt-auto self-start" icon={<Plus className="h-3.5 w-3.5" />}
            loading={creating === type} onClick={() => create(type)}>
            Set up
          </Button>
        </>
      )}
    </Card>
  );
}

function RecentDocuments({ data, loading }: { data?: OverviewData; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Recent documents" icon={<FileText className="h-4 w-4" />}
        actions={<Link to="/app/documents" className="text-[13px] font-medium text-brand-700 hover:underline">All documents</Link>} />
      {loading ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        : !data?.recent_documents.length ? (
          <EmptyState compact icon={<FileText />} title="No documents yet">
            Upload documents to a workspace, or load its sample set, to see them here.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {data.recent_documents.map((doc) => (
              <li key={`${doc.workspace_id}-${doc.doc_id}`}>
                <Link to={`/app/w/${doc.workspace_id}?tab=documents`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                  <FileText className="h-4 w-4 shrink-0 text-ink-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-ink">{doc.title || doc.filename}</div>
                    <div className="truncate text-[12px] text-ink-muted">{doc.workspace_name} · {timeAgo(doc.uploaded_at)}</div>
                  </div>
                  <DocStatus status={doc.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function RecentQueries({ data, loading }: { data?: OverviewData; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Recent questions" icon={<MessageSquareText className="h-4 w-4" />}
        actions={<Link to="/app/activity?kind=query" className="text-[13px] font-medium text-brand-700 hover:underline">History</Link>} />
      {loading ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
        : !data?.recent_queries.length ? (
          <EmptyState compact icon={<MessageSquareText />} title="No questions yet">Questions you ask in any workspace appear here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {data.recent_queries.map((a) => (
              <li key={a.activity_id}>
                <Link to={a.workspace_id ? `/app/w/${a.workspace_id}` : '/app/graph'} className="block px-5 py-2.5 hover:bg-canvas">
                  <div className="line-clamp-2 text-[13px] text-ink">{a.summary}</div>
                  <div className="mt-0.5 text-[11.5px] text-ink-muted">{a.workspace_name ?? 'Shared demo corpus'} · {timeAgo(a.created_at)}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function SavedAnalyses({ data, loading }: { data?: OverviewData; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Saved analyses" icon={<Bookmark className="h-4 w-4" />}
        actions={<Link to="/app/activity?tab=saved" className="text-[13px] font-medium text-brand-700 hover:underline">All saved</Link>} />
      {loading ? <div className="space-y-3 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
        : !data?.saved.length ? (
          <EmptyState compact icon={<Bookmark />} title="Nothing saved yet">Save a legal research result, a paper, a company analysis or a placement answer to keep it here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {data.saved.map((s) => (
              <li key={s.analysis_id}>
                <Link to={`/app/saved/${s.analysis_id}`} className="block px-5 py-2.5 hover:bg-canvas">
                  <div className="truncate text-[13px] font-medium text-ink">{s.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-ink-muted">{s.workspace_name ?? 'Personal'} · {timeAgo(s.created_at)}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function QuickActions({ workspaces }: { workspaces: Workspace[] }) {
  const first = (t: WorkspaceType) => workspaces.find((w) => w.type === t);
  const to = (t: WorkspaceType, tab?: string) => {
    const ws = first(t);
    return ws ? `/app/w/${ws.id}${tab ? `?tab=${tab}` : ''}` : `/app/${t}`;
  };
  const actions = [
    { label: 'Analyze an annual report', icon: Building2, to: to('corporate', 'documents') },
    { label: 'Explore a research paper', icon: BookOpenText, to: to('research') },
    { label: 'Investigate a regulation', icon: Scale, to: to('legal') },
    { label: 'Review placement outcomes', icon: GraduationCap, to: to('placement') },
    { label: 'Ask a question', icon: Search, to: '/app/search' },
    { label: 'Open the knowledge graph', icon: Waypoints, to: '/app/graph' },
  ];
  return (
    <Card>
      <CardHeader title="Quick actions" icon={<Layers className="h-4 w-4" />} />
      <div className="grid grid-cols-2 gap-2 p-3">
        {actions.map((a) => (
          <Link key={a.label} to={a.to} className="flex items-start gap-2 rounded-lg border border-line p-2.5 text-[12.5px] font-medium leading-snug text-ink transition-colors hover:border-brand-200 hover:bg-brand-50">
            <a.icon className="mt-px h-4 w-4 shrink-0 text-brand-700" />{a.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Processing({ data, loading }: { data?: OverviewData; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Processing activity" icon={<Loader2 className="h-4 w-4" />} />
      <div className="px-5 py-3.5">
        {loading ? <Skeleton className="h-4 w-full" />
          : !data?.processing.length ? <p className="text-[13px] text-ink-muted">No documents are being processed right now.</p>
          : (
            <ul className="space-y-3">
              {data.processing.map((j) => {
                const pct = j.progress.chunks_total ? Math.round((100 * j.progress.chunks_done) / j.progress.chunks_total) : 0;
                return (
                  <li key={j.id}>
                    <Link to={`/app/w/${j.workspace_id}?tab=documents`} className="block">
                      <div className="flex items-center justify-between text-[12.5px]">
                        <span className="font-medium text-ink">{j.workspace_name}</span>
                        <span className="num text-ink-muted">{j.done.length}/{j.doc_ids.length} docs</span>
                      </div>
                      <div className="mt-0.5 truncate text-[11.5px] text-ink-muted">{j.stage}</div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-50" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </Card>
  );
}

function RecentTopics({ data, loading }: { data?: OverviewData; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Recently explored topics" icon={<History className="h-4 w-4" />} />
      <div className="px-5 py-3.5">
        {loading ? <Skeleton className="h-4 w-full" />
          : !data?.recent_topics.length ? <p className="text-[13px] text-ink-muted">Topics you open in a knowledge graph appear here.</p>
          : (
            <div className="flex flex-wrap gap-1.5">
              {data.recent_topics.map((a) => (
                <Link key={a.activity_id} to={`/app/graph${a.workspace_id ? `?scope=${a.workspace_id}` : ''}`}
                  className="rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-soft hover:border-brand-200 hover:bg-brand-50" title={a.workspace_name ?? 'Shared demo corpus'}>
                  {a.summary}
                </Link>
              ))}
            </div>
          )}
      </div>
    </Card>
  );
}
