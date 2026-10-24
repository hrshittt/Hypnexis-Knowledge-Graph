import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpenText, Bookmark, FileText, GitCompareArrows, Library, MessageSquareText, Network, Users } from 'lucide-react';
import { workspaceKbApi } from '../../api/kb';
import { platformApi, researchApi } from '../../api/platform';
import { useAsync, type AsyncState } from '../../lib/hooks';
import { timeAgo } from '../../lib/format';
import { roleAtLeast } from '../../lib/workspaceTypes';
import type { GraphPayload } from '../../types/kb';
import type { Paper } from '../../types/platform';
import type { WorkspaceModuleProps } from '../types';
import { TabBar, useTab } from '../../components/ui/Tabs';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge, SampleBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select, SearchInput } from '../../components/ui/Form';
import { EmptyState, ErrorState, Notice, Skeleton, SkeletonCard, Spinner } from '../../components/ui/Feedback';
import { WorkspaceDocuments } from '../../components/workspace/WorkspaceDocuments';
import { WelcomePanel } from '../../components/workspace/WelcomePanel';
import KnowledgeWorkspace from '../../components/kb/KnowledgeWorkspace';
import { colorForIndex } from '../../lib/graphColors';
import { CitationQuote } from '../../components/evidence/Evidence';
import { PaperView, paperSnippet } from './PaperView';

const TABS = ['library', 'paper', 'compare', 'graph', 'documents'] as const;
type Tab = typeof TABS[number];

export default function ResearchWorkspace({ ws }: WorkspaceModuleProps) {
  const [tab, setTab] = useTab<Tab>(TABS, 'library');
  const [params] = useSearchParams();
  const api = useMemo(() => workspaceKbApi(ws.id), [ws.id]);
  const papers = useAsync(() => researchApi.papers(ws.id), [ws.id]);
  const canWrite = roleAtLeast(ws.role, 'analyst');
  const paperId = params.get('paper');

  const openPaper = (id: string) => setTab('paper', { paper: id, q: null, doc: null });
  const ask = (q: string, docId?: string) => setTab('graph', { q, doc: docId ?? null, paper: null });
  const compareWith = (id: string) => setTab('compare', { a: id, paper: null });

  return (
    <div>
      <WelcomePanel ws={ws} onLoaded={() => setTab('documents')} onUpload={() => setTab('documents')} />
      <TabBar label="Research workspace sections" active={tab} className="mb-5"
        onChange={(k) => setTab(k, { q: null, doc: null })} items={[
          { key: 'library', label: 'Paper library', icon: <Library /> },
          { key: 'paper', label: 'Paper analysis', icon: <BookOpenText /> },
          { key: 'compare', label: 'Compare', icon: <GitCompareArrows /> },
          { key: 'graph', label: 'Concept graph & Q&A', icon: <Network /> },
          { key: 'documents', label: 'Documents', icon: <FileText /> },
        ]} />

      {tab === 'library' && <LibraryView wsId={ws.id} papers={papers} api={api} onOpen={openPaper} onAsk={ask} canWrite={canWrite} onUpload={() => setTab('documents')} />}
      {tab === 'paper' && (paperId
        ? <div className="space-y-4">
            <button onClick={() => setTab('library', { paper: null })} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> All papers</button>
            <PaperView key={paperId} wsId={ws.id} docId={paperId} api={api} onAsk={ask} onCompare={compareWith} onOpen={openPaper} />
          </div>
        : <PickPaper papers={papers.data?.papers} loading={papers.initialLoading} onOpen={openPaper} />)}
      {tab === 'compare' && <CompareView wsId={ws.id} papers={papers.data?.papers ?? []} api={api} />}
      {tab === 'graph' && (
        <div className="space-y-3">
          <Notice tone="neutral">
            Concepts, methods, people and organisations extracted from your papers, with topic communities. Relationships exist only where a sentence supports them; select one to read it.
            {params.get('doc') && ' Answers are limited to the selected paper until you choose “Use all documents”.'}
          </Notice>
          <KnowledgeWorkspace key={`${ws.id}-${params.get('q') ?? ''}-${params.get('doc') ?? ''}`} api={api} workspaceId={ws.id}
            canWrite={canWrite} canDelete={ws.role === 'owner'} initialQuestion={params.get('q') ?? undefined}
            initialDocScope={params.get('doc') ? [params.get('doc')!] : undefined}
            className="h-auto lg:h-[calc(100vh-21rem)] lg:min-h-[560px]" readOnlyNote="You have viewer access: you can ask questions and explore, but not add papers." />
        </div>
      )}
      {tab === 'documents' && (
        <WorkspaceDocuments ws={ws} metaFields={['doc_kind']} onChanged={papers.reload}
          intro={<Notice tone="info">Upload papers as PDF, TXT or Markdown. Structure (problem, method, findings…) is extracted from section headings; scanned PDFs without a text layer can’t be read.</Notice>} />
      )}
    </div>
  );
}

function LibraryView({ wsId, papers, api, onOpen, onAsk, canWrite, onUpload }: {
  wsId: string; papers: AsyncState<{ papers: Paper[]; processing: number }>; api: ReturnType<typeof workspaceKbApi>;
  onOpen: (id: string) => void; onAsk: (q: string, docId?: string) => void; canWrite: boolean; onUpload: () => void;
}) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [onlySaved, setOnlySaved] = useState(false);
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const saved = useAsync(() => platformApi.saved(), []);
  const recent = useAsync(() => platformApi.activity('query', 40), []);
  const [question, setQuestion] = useState('');

  useEffect(() => { api.graph().then(setGraph).catch(() => setGraph(null)); }, [api]);

  const savedPapers = (saved.data ?? []).filter((s) => s.workspace_id === wsId && s.kind === 'paper');
  const savedTitles = new Set(savedPapers.map((s) => s.title));
  const topics = graph?.topics.filter((t) => t.doc_ids.length > 0) ?? [];
  const topicDocs = topic ? new Set(topics.find((t) => t.id === topic)?.doc_ids ?? []) : null;
  const list = (papers.data?.papers ?? []).filter((p) =>
    (!topicDocs || topicDocs.has(p.doc_id)) && (!onlySaved || savedTitles.has(p.title))
    && (!query || `${p.title} ${p.authors.value.join(' ')} ${p.fields.abstract?.items.map((i) => i.text).join(' ') ?? ''}`.toLowerCase().includes(query.toLowerCase())));
  const recentQs = (recent.data ?? []).filter((a) => a.workspace_id === wsId).slice(0, 6);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Card padded>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (question.trim()) onAsk(question.trim()); }}>
            <label className="sr-only" htmlFor="research-q">Research question</label>
            <input id="research-q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a research question across your papers…"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong px-3 text-[14px] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15" />
            <Button type="submit" icon={<MessageSquareText className="h-4 w-4" />} disabled={!question.trim()}>Ask</Button>
          </form>
          <p className="mt-2 text-[12px] text-ink-muted">Answers cite passages from your papers and highlight the supporting concepts in the graph.</p>
        </Card>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search titles, authors, abstracts" className="w-72" />
          <Select compact value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Filter by topic" className="w-60">
            <option value="">All topics</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
          <button onClick={() => setOnlySaved((s) => !s)} aria-pressed={onlySaved}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] ${onlySaved ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-line-strong bg-white text-ink-soft hover:bg-canvas'}`}>
            <Bookmark className="h-3.5 w-3.5" /> Saved papers
          </button>
          {(papers.data?.processing ?? 0) > 0 && <Spinner label={`${papers.data!.processing} paper(s) processing…`} />}
        </div>
        {papers.error && !papers.data ? <Card><ErrorState message={papers.error} onRetry={papers.reload} /></Card>
          : papers.initialLoading ? <div className="grid gap-4 md:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>
          : !papers.data?.papers.length ? (
            <Card><EmptyState icon={<Library />} title="Your library is empty"
              actions={canWrite && <Button onClick={onUpload}>Add papers</Button>}>
              Upload research papers (or load the fictional samples) to extract their structure and build a concept graph.
            </EmptyState></Card>
          ) : !list.length ? <Card><EmptyState compact title="No papers match">Clear the search or filters.</EmptyState></Card>
          : (
            <div className="grid gap-4 md:grid-cols-2">
              {list.map((p) => <PaperCard key={p.doc_id} p={p} onOpen={() => onOpen(p.doc_id)} saved={savedTitles.has(p.title)}
                topics={topics.filter((t) => t.doc_ids.includes(p.doc_id))} />)}
            </div>
          )}
      </div>
      <aside className="space-y-5">
        <Card>
          <CardHeader title="Recent research questions" />
          <div className="p-3">
            {recent.initialLoading ? <Skeleton className="h-8 w-full" />
              : !recentQs.length ? <p className="px-2 py-1 text-[13px] text-ink-muted">Questions you ask here will appear in this list.</p>
              : <ul className="space-y-1">{recentQs.map((a) => (
                  <li key={a.activity_id}><button onClick={() => onAsk(a.summary)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas">
                    <span className="line-clamp-2 text-[13px] text-ink">{a.summary}</span><span className="text-[11.5px] text-ink-muted">{timeAgo(a.created_at)}</span>
                  </button></li>
                ))}</ul>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Saved papers" />
          <div className="p-3">
            {!savedPapers.length ? <p className="px-2 py-1 text-[13px] text-ink-muted">Save a paper from its analysis page to find it quickly.</p>
              : <ul className="space-y-1">{savedPapers.map((s) => (
                  <li key={s.analysis_id}><Link to={`/app/saved/${s.analysis_id}`} className="block rounded-lg px-2 py-1.5 text-[13px] text-ink hover:bg-canvas">{s.title}</Link></li>
                ))}</ul>}
          </div>
        </Card>
        {topics.length > 0 && (
          <Card>
            <CardHeader title="Topics in your library" />
            <div className="flex flex-wrap gap-1.5 p-4">
              {topics.map((t) => (
                <button key={t.id} onClick={() => setTopic(topic === t.id ? '' : t.id)} aria-pressed={topic === t.id}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-[12px] ${topic === t.id ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-line text-ink-soft hover:bg-canvas'}`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: colorForIndex(t.color_index) }} />{t.label}
                </button>
              ))}
            </div>
          </Card>
        )}
      </aside>
    </div>
  );
}

function PaperCard({ p, onOpen, saved, topics }: { p: Paper; onOpen: () => void; saved: boolean; topics: { id: string; label: string; color_index: number }[] }) {
  const snippet = paperSnippet(p);
  const found = Object.values(p.fields).filter((f) => f.found).length;
  return (
    <button onClick={onOpen} className="group flex h-full flex-col rounded-xl border border-line bg-white p-4 text-left shadow-card transition-all hover:border-brand-200 hover:shadow-pop">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14.5px] font-semibold leading-snug text-ink group-hover:underline">{p.title}</h3>
        {saved && <Bookmark className="h-4 w-4 shrink-0 fill-brand-600 text-brand-600" aria-label="Saved" />}
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-muted">
        <Users className="h-3.5 w-3.5" /> {p.authors.found ? p.authors.value.join(', ') : 'Authors not found'} · {p.year.found ? p.year.value : 'year not found'}
      </p>
      {snippet && <p className="mt-2.5 line-clamp-3 flex-1 text-[13px] leading-relaxed text-ink-soft">{snippet}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone="outline">{found} of {Object.keys(p.fields).length} fields found</Badge>
        {topics.slice(0, 2).map((t) => (
          <span key={t.id} className="flex items-center gap-1 rounded-md bg-canvas px-1.5 py-0.5 text-[11px] text-ink-soft">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorForIndex(t.color_index) }} />{t.label}
          </span>
        ))}
        {p.meta.is_sample ? <SampleBadge /> : null}
      </div>
    </button>
  );
}

function PickPaper({ papers, loading, onOpen }: { papers?: Paper[]; loading: boolean; onOpen: (id: string) => void }) {
  if (loading) return <SkeletonCard />;
  if (!papers?.length) return <Card><EmptyState icon={<BookOpenText />} title="No papers to analyse yet">Add papers on the Documents tab.</EmptyState></Card>;
  return (
    <Card>
      <CardHeader title="Choose a paper to analyse" />
      <ul className="divide-y divide-line">
        {papers.map((p) => (
          <li key={p.doc_id}><button onClick={() => onOpen(p.doc_id)} className="w-full px-5 py-3 text-left hover:bg-canvas">
            <span className="block text-[13.5px] font-medium text-ink">{p.title}</span>
            <span className="text-[12px] text-ink-muted">{p.authors.found ? p.authors.value.join(', ') : 'Authors not found'}</span>
          </button></li>
        ))}
      </ul>
    </Card>
  );
}

function CompareView({ wsId, papers, api }: { wsId: string; papers: Paper[]; api: ReturnType<typeof workspaceKbApi> }) {
  const [params, setParams] = useSearchParams();
  const a = params.get('a') ?? papers[0]?.doc_id ?? '';
  const b = params.get('b') ?? papers.find((p) => p.doc_id !== a)?.doc_id ?? '';
  const set = (k: 'a' | 'b', v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set(k, v); return n; });
  const cmp = useAsync(() => researchApi.compare(wsId, a, b), [wsId, a, b], !!a && !!b && a !== b);

  if (papers.length < 2) {
    return <Card><EmptyState icon={<GitCompareArrows />} title="Add at least two papers to compare">Comparison needs two ready papers in this workspace.</EmptyState></Card>;
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        {(['a', 'b'] as const).map((k) => (
          <label key={k} className="block text-[13px] font-medium text-ink">Paper {k.toUpperCase()}
            <Select value={k === 'a' ? a : b} onChange={(e) => set(k, e.target.value)} className="mt-1">
              {papers.map((p) => <option key={p.doc_id} value={p.doc_id}>{p.title}</option>)}
            </Select>
          </label>
        ))}
      </div>
      {a === b && <Notice tone="warn">Choose two different papers.</Notice>}
      {cmp.error && <Card><ErrorState message={cmp.error} onRetry={cmp.reload} /></Card>}
      {cmp.initialLoading && <SkeletonCard lines={6} />}
      {cmp.data && a !== b && (
        <div className={`space-y-5 ${cmp.loading ? 'opacity-60' : ''}`}>
          <Notice tone="info">{cmp.data.note}</Notice>
          <Card>
            <div className="grid grid-cols-1 border-b border-line md:grid-cols-[180px_1fr_1fr]">
              <div className="hidden px-4 py-3 md:block" />
              {[cmp.data.a, cmp.data.b].map((x, i) => (
                <div key={x.doc_id} className="border-t border-line px-4 py-3 md:border-l md:border-t-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Paper {i ? 'B' : 'A'}</div>
                  <div className="text-[13.5px] font-semibold leading-snug text-ink">{x.title}</div>
                  <div className="text-[12px] text-ink-muted">{x.authors.found ? x.authors.value.join(', ') : 'Authors not found'} · {x.year.found ? x.year.value : 'year not found'}</div>
                </div>
              ))}
            </div>
            {cmp.data.rows.map((r) => (
              <div key={r.field} className="grid grid-cols-1 border-b border-line last:border-b-0 md:grid-cols-[180px_1fr_1fr]">
                <div className="bg-canvas/60 px-4 py-3 text-[13px] font-semibold text-ink">{r.label}</div>
                {[r.a, r.b].map((f, i) => (
                  <div key={i} className="space-y-2 border-t border-line px-4 py-3 md:border-l md:border-t-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint md:hidden">Paper {i ? 'B' : 'A'}</div>
                    {!f.found ? <p className="text-[13px] text-ink-muted">Not found in this paper.</p>
                      : f.items.map((it, j) => it.citation ? <CitationQuote key={j} c={it.citation} api={api} compact />
                        : <p key={j} className="rounded-lg bg-canvas px-2.5 py-1.5 text-[13px] text-ink-soft">{it.text}</p>)}
                  </div>
                ))}
              </div>
            ))}
          </Card>
          <div className="grid gap-4 md:grid-cols-3">
            {([['Concepts in both', cmp.data.shared_entities], ['Only in paper A', cmp.data.only_a], ['Only in paper B', cmp.data.only_b]] as const).map(([t, list]) => (
              <Card key={t} padded>
                <h3 className="text-[13.5px] font-semibold text-ink">{t} <span className="font-normal text-ink-muted">({list.length})</span></h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {list.slice(0, 30).map((e) => <span key={e.id} className="rounded-md bg-canvas px-2 py-0.5 text-[12px] text-ink-soft">{e.name}</span>)}
                  {!list.length && <span className="text-[12.5px] text-ink-muted">None</span>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
