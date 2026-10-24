import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, FileText, Loader2, PhoneCall, ScanText, Search, Waypoints } from 'lucide-react';
import { platformApi } from '../../api/platform';
import { useAuth } from '../../lib/auth';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { plural, timeAgo } from '../../lib/format';
import { OTHERS_INFO, WORKSPACE_TYPES, type WorkspaceTypeInfo } from '../../lib/workspaceTypes';
import { useCreateWorkspace } from '../../lib/useCreateWorkspace';
import type { Overview as OverviewData, Workspace } from '../../types/platform';
import { Page } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { ErrorState, Skeleton } from '../../components/ui/Feedback';
import { DocStatus } from '../../components/workspace/DocStatus';
import { openCallPaheli } from '../../components/CallPaheli';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Overview() {
  useDocumentTitle('Overview');
  const { user } = useAuth();
  const q = useAsync(() => platformApi.overview(), []);
  const d = q.data;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Page>
      <header>
        <p className="text-[13px] font-medium text-ink-muted">{today}</p>
        <h1 className="mt-1 font-display text-[40px] leading-[1.05] text-ink sm:text-[48px]">
          {greeting()}, <span className="italic text-brand-700">{user?.name.split(' ')[0]}.</span>
        </h1>
        <p className="mt-2 text-[15px] text-ink-muted">Ask a question, open a workspace, or pick up where you left off.</p>
      </header>

      <AskBar />

      {q.error && !d && <ErrorState className="mt-8" message={q.error} onRetry={q.reload} />}

      <Section title="Your workspaces" className="mt-12"
        action={<Link to="/app/others" className="text-[13px] font-medium text-brand-700 hover:underline">More industries</Link>}>
        <ul className="stagger divide-y divide-line">
          {q.initialLoading
            ? [0, 1, 2, 3].map((i) => <li key={i} className="py-4"><Skeleton className="h-5 w-2/3" /></li>)
            : (
              <>
                {WORKSPACE_TYPES.map((t) => <WorkspaceRow key={t.type} info={t} items={(d?.workspaces ?? []).filter((w) => w.type === t.type)} />)}
                <li>
                  <Link to="/app/others" className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 py-4 transition-colors hover:bg-canvas/70 sm:-mx-3 sm:px-3">
                    <OTHERS_INFO.icon className="h-5 w-5 text-ink-muted" strokeWidth={1.7} />
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-ink">{OTHERS_INFO.label}</span>
                      <span className="block truncate text-[13px] text-ink-muted">{OTHERS_INFO.tagline}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700">
                      Explore <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              </>
            )}
        </ul>
      </Section>

      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-12">
          <RecentDocuments data={d} loading={q.initialLoading} />
          <RecentQueries data={d} loading={q.initialLoading} />
        </div>
        <div className="space-y-12">
          <Shortcuts />
          <Processing data={d} />
          <RecentTopics data={d} />
          <SavedAnalyses data={d} />
          {d?.shared_corpus && (
            <p className="text-[13px] leading-relaxed text-ink-muted">
              The shared demo graph holds {plural(d.shared_corpus.documents, 'document')}, {plural(d.shared_corpus.entities, 'entity', 'entities')} and{' '}
              {plural(d.shared_corpus.topics, 'topic')} from fictional sample files.{' '}
              <Link to="/app/graph" className="font-medium text-brand-700 hover:underline">Explore it</Link>
            </p>
          )}
        </div>
      </div>
    </Page>
  );
}

function AskBar() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form className="mt-8" role="search"
      onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) nav(`/app/search?q=${encodeURIComponent(q.trim())}`); }}>
      <label className="group relative block">
        <span className="sr-only">Ask or search across your workspaces</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint transition-colors group-focus-within:text-brand-700" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about your documents…"
          className="h-14 w-full rounded-2xl border border-line-strong bg-white pl-12 pr-28 text-[16px] text-ink shadow-card transition-shadow placeholder:text-ink-faint focus:border-brand-600 focus:outline-none focus:shadow-glow" />
        <Button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2" disabled={q.trim().length < 2}>Search</Button>
      </label>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        <Link to="/app/graph" className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink"><Waypoints className="h-4 w-4" /> Open the knowledge graph</Link>
        <Link to="/app/ocr" className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink"><ScanText className="h-4 w-4" /> Scan a document</Link>
        <button type="button" onClick={openCallPaheli} className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink"><PhoneCall className="h-4 w-4" /> Have Paheli call you</button>
      </div>
    </form>
  );
}

/** A heading with a hairline under it; the content sits on the page, not in a box. */
function Section({ title, action, children, className = '' }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-[13.5px] text-ink-muted">{children}</p>;
}

function WorkspaceRow({ info, items }: { info: WorkspaceTypeInfo; items: Workspace[] }) {
  const { create, creating } = useCreateWorkspace();
  const ws = items[0];
  const s = ws?.stats;
  const href = ws ? (items.length > 1 ? `/app/${info.type}` : `/app/w/${ws.id}`) : `/app/${info.type}`;
  const stats = ws && (info.type === 'placement'
    ? `${(s?.placement_students ?? 0).toLocaleString()} students · ${(s?.placement_records ?? 0).toLocaleString()} records`
    : `${s?.documents ?? 0} documents · ${s?.entities ?? 0} entities · ${s?.topics ?? 0} topics`);
  return (
    <li>
      <div className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 py-4 transition-colors hover:bg-canvas/70 sm:-mx-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-3">
        <info.icon className={`h-5 w-5 ${ws ? 'text-brand-700' : 'text-ink-muted'}`} strokeWidth={1.7} />
        <Link to={href} className="min-w-0">
          <span className="block text-[15px] font-semibold text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{info.label}</span>
          <span className="block truncate text-[13px] text-ink-muted">
            {ws ? <>{ws.name}{items.length > 1 ? ` and ${items.length - 1} more` : ''}</> : info.tagline}
          </span>
        </Link>
        <span className="num hidden text-[12.5px] text-ink-muted sm:block">
          {(s?.processing ?? 0) > 0
            ? <span className="inline-flex items-center gap-1 text-brand-700"><Loader2 className="h-3 w-3 animate-spin" /> Processing</span>
            : stats}
        </span>
        {ws ? (
          <Link to={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700">
            Open <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : (
          <Button variant="secondary" size="sm" loading={creating === info.type} onClick={() => create(info.type)}>Set up</Button>
        )}
      </div>
    </li>
  );
}

function RecentDocuments({ data, loading }: { data?: OverviewData; loading: boolean }) {
  return (
    <Section title="Recent documents" action={<Link to="/app/documents" className="text-[13px] font-medium text-brand-700 hover:underline">All documents</Link>}>
      {loading ? <div className="space-y-3 py-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        : !data?.recent_documents.length ? <Quiet>No documents yet. Upload files to a workspace, or load its sample set, and they appear here.</Quiet>
        : (
          <ul className="stagger divide-y divide-line">
            {data.recent_documents.map((doc) => (
              <li key={`${doc.workspace_id}-${doc.doc_id}`}>
                <Link to={`/app/w/${doc.workspace_id}?tab=documents`} className="flex items-center gap-3 py-3 transition-colors hover:bg-canvas/70 sm:-mx-3 sm:px-3">
                  <FileText className="h-4 w-4 shrink-0 text-ink-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-ink">{doc.title || doc.filename}</div>
                    <div className="truncate text-[12.5px] text-ink-muted">{doc.workspace_name} · {timeAgo(doc.uploaded_at)}</div>
                  </div>
                  <DocStatus status={doc.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Section>
  );
}

function RecentQueries({ data, loading }: { data?: OverviewData; loading: boolean }) {
  return (
    <Section title="Recent questions" action={<Link to="/app/activity?kind=query" className="text-[13px] font-medium text-brand-700 hover:underline">History</Link>}>
      {loading ? <div className="space-y-3 py-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
        : !data?.recent_queries.length ? <Quiet>Questions you ask in any workspace appear here.</Quiet>
        : (
          <ul className="stagger divide-y divide-line">
            {data.recent_queries.map((a) => (
              <li key={a.activity_id}>
                <Link to={a.workspace_id ? `/app/w/${a.workspace_id}` : '/app/graph'} className="group flex items-start gap-3 py-3 transition-colors hover:bg-canvas/70 sm:-mx-3 sm:px-3">
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[14px] text-ink">{a.summary}</div>
                    <div className="mt-0.5 text-[12px] text-ink-muted">{a.workspace_name ?? 'Shared demo graph'} · {timeAgo(a.created_at)}</div>
                  </div>
                  <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Section>
  );
}

function Shortcuts() {
  const items = [
    { label: 'Explore the knowledge graph', to: '/app/graph' },
    { label: 'Search every workspace', to: '/app/search' },
    { label: 'Scan a paper document (OCR)', to: '/app/ocr' },
    { label: 'Browse all documents', to: '/app/documents' },
    { label: 'Read the help guide', to: '/app/help' },
  ];
  return (
    <Section title="Shortcuts">
      <ul className="divide-y divide-line">
        {items.map((a) => (
          <li key={a.label}>
            <Link to={a.to} className="group flex items-center justify-between py-2.5 text-[14px] text-ink transition-colors hover:text-brand-700">
              {a.label}<ArrowRight className="h-4 w-4 text-ink-faint transition-all group-hover:translate-x-0.5 group-hover:text-brand-700" />
            </Link>
          </li>
        ))}
        <li>
          <button onClick={openCallPaheli} className="group flex w-full items-center justify-between py-2.5 text-left text-[14px] text-ink transition-colors hover:text-brand-700">
            Have Paheli call you<PhoneCall className="h-4 w-4 text-ink-faint transition-colors group-hover:text-brand-700" />
          </button>
        </li>
      </ul>
    </Section>
  );
}

function Processing({ data }: { data?: OverviewData }) {
  if (!data?.processing.length) return null;
  return (
    <Section title="Processing now">
      <ul className="space-y-4 pt-4">
        {data.processing.map((j) => {
          const pct = j.progress.chunks_total ? Math.round((100 * j.progress.chunks_done) / j.progress.chunks_total) : 0;
          return (
            <li key={j.id}>
              <Link to={`/app/w/${j.workspace_id}?tab=documents`} className="block">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium text-ink">{j.workspace_name}</span>
                  <span className="num text-ink-muted">{j.done.length}/{j.doc_ids.length} docs</span>
                </div>
                <div className="mt-0.5 truncate text-[12px] text-ink-muted">{j.stage}</div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-brand-50" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-brand-600 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function RecentTopics({ data }: { data?: OverviewData }) {
  return (
    <Section title="Topics you explored">
      {!data?.recent_topics.length ? <Quiet>Topics you open in a knowledge graph appear here.</Quiet> : (
        <div className="flex flex-wrap gap-1.5 pt-4">
          {data.recent_topics.map((a) => (
            <Link key={a.activity_id} to={`/app/graph${a.workspace_id ? `?scope=${a.workspace_id}` : ''}`}
              className="rounded-full border border-line px-3 py-1 text-[13px] text-ink-soft transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800" title={a.workspace_name ?? 'Shared demo graph'}>
              {a.summary}
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}

function SavedAnalyses({ data }: { data?: OverviewData }) {
  return (
    <Section title="Saved" action={<Link to="/app/activity?tab=saved" className="text-[13px] font-medium text-brand-700 hover:underline">All saved</Link>}>
      {!data?.saved.length ? <Quiet>Save an answer, a paper or an analysis to keep it here.</Quiet> : (
        <ul className="divide-y divide-line">
          {data.saved.map((s) => (
            <li key={s.analysis_id}>
              <Link to={`/app/saved/${s.analysis_id}`} className="block py-2.5 transition-colors hover:text-brand-700">
                <div className="truncate text-[14px] font-medium text-ink">{s.title}</div>
                <div className="mt-0.5 text-[12px] text-ink-muted">{s.workspace_name ?? 'Personal'} · {timeAgo(s.created_at)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
