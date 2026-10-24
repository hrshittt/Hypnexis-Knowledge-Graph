import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookMarked, FileText, Gavel, Library, MessageSquareText, Network, Search } from 'lucide-react';
import { workspaceKbApi } from '../../api/kb';
import { legalApi, platformApi } from '../../api/platform';
import { errorMessage } from '../../lib/http';
import { useAsync, type AsyncState } from '../../lib/hooks';
import { fmtDate, timeAgo } from '../../lib/format';
import { roleAtLeast } from '../../lib/workspaceTypes';
import type { ExampleQuestion } from '../../types/kb';
import type { LegalAnalysis, LegalSource } from '../../types/platform';
import type { WorkspaceModuleProps } from '../types';
import { TabBar, useTab } from '../../components/ui/Tabs';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge, SampleBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Field, Select, Textarea } from '../../components/ui/Form';
import { EmptyState, ErrorState, Notice, Skeleton, SkeletonCard, Spinner } from '../../components/ui/Feedback';
import { Drawer } from '../../components/ui/Overlay';
import { Table, Td, Th } from '../../components/ui/Table';
import { WorkspaceDocuments } from '../../components/workspace/WorkspaceDocuments';
import { WelcomePanel } from '../../components/workspace/WelcomePanel';
import { SaveButton } from '../../components/workspace/SaveButton';
import KnowledgeWorkspace from '../../components/kb/KnowledgeWorkspace';
import AnalysisGraphPanel from '../../components/kb/AnalysisGraphPanel';
import { CitationQuote } from '../../components/evidence/Evidence';
import { AnalysisSummary, LawCard } from './LawCard';

const TABS = ['research', 'sources', 'graph', 'qa', 'documents'] as const;
type Tab = typeof TABS[number];

// Mirrors the fact vocabulary the analyser recognises (backend/intel/legal.py FACTS).
const TOPICS = [
  ['personal data', 'Personal data and privacy'], ['payments', 'Payments'], ['online', 'Online services'],
  ['employees', 'Employment'], ['energy', 'Energy and utilities'], ['environment', 'Environment'],
  ['health', 'Health information'], ['startup', 'Small business / startup'],
] as const;

const CLASS_LABEL: Record<string, string> = {
  obligation: 'Obligation', prohibition: 'Prohibition', definition: 'Definition', penalty: 'Penalty', exemption: 'Exemption',
  condition: 'Condition', scope: 'Scope', deadline: 'Deadline', commencement: 'Commencement',
};

export default function LegalWorkspace({ ws }: WorkspaceModuleProps) {
  const [tab, setTab] = useTab<Tab>(TABS, 'research');
  const [params] = useSearchParams();
  const api = useMemo(() => workspaceKbApi(ws.id), [ws.id]);
  const sources = useAsync(() => legalApi.sources(ws.id), [ws.id]);
  const canWrite = roleAtLeast(ws.role, 'analyst');

  return (
    <div>
      <WelcomePanel ws={ws} onLoaded={() => setTab('documents')} onUpload={() => setTab('documents')} />
      <TabBar label="Legal workspace sections" active={tab} className="mb-5" onChange={(k) => setTab(k, { q: null })} items={[
        { key: 'research', label: 'Legal research', icon: <Gavel /> },
        { key: 'sources', label: 'Sources & provisions', icon: <Library /> },
        { key: 'graph', label: 'Provision graph', icon: <Network /> },
        { key: 'qa', label: 'Ask the sources', icon: <MessageSquareText /> },
        { key: 'documents', label: 'Documents', icon: <FileText /> },
      ]} />
      {tab === 'research' && <ResearchFlow wsId={ws.id} api={api} sources={sources.data} sourcesLoading={sources.initialLoading} canWrite={canWrite} onAddSources={() => setTab('documents')} />}
      {tab === 'sources' && <SourcesView wsId={ws.id} api={api} sources={sources} canWrite={canWrite} onTag={() => setTab('documents')} />}
      {tab === 'graph' && <LegalGraph wsId={ws.id} api={api} />}
      {tab === 'qa' && (
        <div className="space-y-3">
          <Notice tone="neutral">Ask anything about your sources. Answers quote the provisions they rely on. This is legal information, not legal advice.</Notice>
          <KnowledgeWorkspace key={`${ws.id}-${params.get('q') ?? ''}`} api={api} workspaceId={ws.id} canWrite={canWrite} canDelete={ws.role === 'owner'}
            initialQuestion={params.get('q') ?? undefined} className="h-auto lg:h-[calc(100vh-21rem)] lg:min-h-[560px]"
            readOnlyNote="You have viewer access: you can ask questions and explore, but not add sources." />
        </div>
      )}
      {tab === 'documents' && (
        <WorkspaceDocuments ws={ws} metaFields={['jurisdiction', 'authority', 'effective_date', 'doc_kind', 'source_url']} allowVerified onChanged={sources.reload}
          intro={<Notice tone="info">Prefer official government and regulator texts. Tag each source with its <b>jurisdiction</b>, issuing authority and, once you have checked it, its effective date and official link. Results show exactly what you record here.</Notice>} />
      )}
    </div>
  );
}

type SourcesData = { sources: LegalSource[]; jurisdictions: string[]; untagged: number; disclaimer: string };

function ResearchFlow({ wsId, api, sources, sourcesLoading, canWrite, onAddSources }: {
  wsId: string; api: ReturnType<typeof workspaceKbApi>; sources?: SourcesData; sourcesLoading: boolean; canWrite: boolean; onAddSources: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [topic, setTopic] = useState('');
  const [result, setResult] = useState<LegalAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<ExampleQuestion[]>([]);
  const saved = useAsync(() => platformApi.saved(), []);
  const recent = useAsync(() => platformApi.activity('query', 50), []);

  useEffect(() => { api.examples().then(setExamples).catch(() => {}); }, [api]);

  const run = async (q = question) => {
    if (q.trim().length < 3) { setError('Describe your situation in a few words first.'); return; }
    setQuestion(q);
    setBusy(true);
    setError(null);
    try {
      setResult(await legalApi.analyze(wsId, q.trim(), jurisdiction || null, topic || null));
      recent.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const savedLegal = (saved.data ?? []).filter((s) => s.workspace_id === wsId && s.kind === 'legal');
  const recentLegal = (recent.data ?? []).filter((a) => a.workspace_id === wsId && (a.detail as { kind?: string }).kind === 'legal_applicability').slice(0, 6);
  const noSources = !sourcesLoading && sources && sources.sources.length === 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Card padded>
          <h2 className="text-[16px] font-semibold text-ink">What laws, rules and policies may apply to my situation?</h2>
          <p className="mt-1 text-[13.5px] text-ink-muted">Describe what your organisation does. Hypnexis searches the sources in this workspace and explains which provisions may apply, and why.</p>
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <Field label="Your situation" error={error}>
              {({ id, describedBy, invalid }) => (
                <Textarea id={id} rows={3} invalid={invalid} aria-describedby={describedBy} value={question} maxLength={2000}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. Our startup collects customer data and processes online card payments. What applies to us?" />
              )}
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-[13px] font-medium text-ink">Jurisdiction
                <Select compact value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} className="mt-1 w-56">
                  <option value="">Any in my sources</option>
                  {sources?.jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
                </Select>
              </label>
              <label className="block text-[13px] font-medium text-ink">Topic
                <Select compact value={topic} onChange={(e) => setTopic(e.target.value)} className="mt-1 w-56">
                  <option value="">Any topic</option>
                  {TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </label>
              <Button type="submit" icon={<Search className="h-4 w-4" />} loading={busy} disabled={!!noSources}>Find applicable provisions</Button>
            </div>
          </form>
          {sources && sources.jurisdictions.length > 0 && (
            <p className="mt-3 text-[12px] text-ink-muted">Coverage is limited to your sources: {sources.jurisdictions.join(', ')}. Hypnexis does not cover every jurisdiction or law.</p>
          )}
          {examples.length > 0 && !result && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {examples.slice(0, 4).map((e) => (
                <button key={e.question} onClick={() => run(e.question)} className="rounded-full border border-line px-3 py-1 text-left text-[12.5px] text-ink-soft hover:border-brand-200 hover:bg-brand-50">{e.question}</button>
              ))}
            </div>
          )}
        </Card>

        {noSources && (
          <Card><EmptyState icon={<Library />} title="No legal sources yet" actions={canWrite && <Button onClick={onAddSources}>Add sources</Button>}>
            Upload the official texts you want to research, or load the fictional sample set.
          </EmptyState></Card>
        )}
        {busy && <Card padded><Spinner label="Reading the provisions in your sources…" /></Card>}
        {result && !busy && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-ink">{result.laws.length} source{result.laws.length === 1 ? '' : 's'} may apply</h2>
              {result.laws.length > 0 && <SaveButton workspaceId={wsId} kind="legal" label="Save research" title={result.question}
                payload={() => ({ result, jurisdiction: jurisdiction || null, topic: topic || null })} />}
            </div>
            <AnalysisSummary result={result} />
            {result.message && <Notice tone="info">{result.message}</Notice>}
            {result.laws.map((l, i) => <LawCard key={l.doc_id} law={l} api={api} defaultOpen={i === 0} />)}
            <Notice tone="neutral">{result.disclaimer}</Notice>
          </div>
        )}
        {!result && !busy && sources && sources.sources.length > 0 && (
          <Notice tone="neutral">{sources.disclaimer}</Notice>
        )}
      </div>
      <aside className="space-y-5">
        <Card>
          <CardHeader title="Sources in scope" />
          <div className="px-5 py-3.5 text-[13px]">
            {sourcesLoading ? <Skeleton className="h-4 w-full" /> : (
              <>
                <p className="text-ink"><b className="font-semibold">{sources?.sources.length ?? 0}</b> source{sources?.sources.length === 1 ? '' : 's'} · {sources?.jurisdictions.length ?? 0} jurisdiction{sources?.jurisdictions.length === 1 ? '' : 's'}</p>
                {(sources?.untagged ?? 0) > 0 && <p className="mt-1 text-warn-ink">{sources!.untagged} source(s) have no jurisdiction tag.</p>}
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Saved legal research" icon={<BookMarked className="h-4 w-4" />} />
          <div className="p-3">
            {!savedLegal.length ? <p className="px-2 py-1 text-[13px] text-ink-muted">Save a result to keep it for later.</p>
              : <ul className="space-y-1">{savedLegal.map((s) => (
                  <li key={s.analysis_id}><Link to={`/app/saved/${s.analysis_id}`} className="block rounded-lg px-2 py-1.5 hover:bg-canvas">
                    <span className="line-clamp-2 text-[13px] text-ink">{s.title}</span><span className="text-[11.5px] text-ink-muted">{timeAgo(s.created_at)}</span>
                  </Link></li>
                ))}</ul>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recently researched" />
          <div className="p-3">
            {!recentLegal.length ? <p className="px-2 py-1 text-[13px] text-ink-muted">Your recent questions appear here.</p>
              : <ul className="space-y-1">{recentLegal.map((a) => (
                  <li key={a.activity_id}><button onClick={() => run(a.summary)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas">
                    <span className="line-clamp-2 text-[13px] text-ink">{a.summary}</span><span className="text-[11.5px] text-ink-muted">{timeAgo(a.created_at)}</span>
                  </button></li>
                ))}</ul>}
          </div>
        </Card>
      </aside>
    </div>
  );
}

function SourcesView({ wsId, api, sources, canWrite, onTag }: {
  wsId: string; api: ReturnType<typeof workspaceKbApi>; sources: AsyncState<SourcesData>; canWrite: boolean; onTag: () => void;
}) {
  const [open, setOpen] = useState<LegalSource | null>(null);
  const d = sources.data;
  if (sources.error && !d) return <Card><ErrorState message={sources.error} onRetry={sources.reload} /></Card>;
  if (!d) return <SkeletonCard lines={5} />;
  return (
    <div className="space-y-4">
      {d.untagged > 0 && (
        <Notice tone="warn" action={canWrite && <Button size="sm" variant="secondary" onClick={onTag}>Tag sources</Button>}>
          {d.untagged} source{d.untagged === 1 ? ' has' : 's have'} no jurisdiction. Jurisdiction filters can’t include {d.untagged === 1 ? 'it' : 'them'} until tagged.
        </Notice>
      )}
      <Card>
        <CardHeader title="Legal sources" description="Provision counts come from sentence classification. Select a source to browse its provisions." />
        {!d.sources.length ? <EmptyState compact title="No ready sources">Add official texts on the Documents tab.</EmptyState> : (
          <Table caption="Legal sources">
            <thead><tr><Th>Source</Th><Th>Jurisdiction</Th><Th className="hidden lg:table-cell">Authority</Th><Th className="hidden md:table-cell">Effective</Th><Th className="hidden md:table-cell">Verified</Th><Th align="right">Provisions</Th><Th className="hidden xl:table-cell">Classified sentences</Th></tr></thead>
            <tbody>
              {d.sources.map((s) => (
                <tr key={s.doc_id} className="cursor-pointer hover:bg-canvas/60" onClick={() => setOpen(s)}>
                  <Td><button className="text-left font-medium text-ink hover:underline" onClick={() => setOpen(s)}>{s.title}</button>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-muted">{s.filename}{s.meta.is_sample ? <SampleBadge /> : null}</div></Td>
                  <Td>{s.meta.jurisdiction ?? <span className="text-ink-faint">Not tagged</span>}</Td>
                  <Td className="hidden lg:table-cell">{s.meta.authority ?? <span className="text-ink-faint">—</span>}</Td>
                  <Td className="hidden md:table-cell">{s.meta.effective_date ?? <span className="text-ink-faint">—</span>}</Td>
                  <Td className="hidden md:table-cell">{s.meta.verified_at ? fmtDate(s.meta.verified_at) : <span className="text-ink-faint">No</span>}</Td>
                  <Td align="right">{s.provisions}</Td>
                  <Td className="hidden xl:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(s.counts).filter(([, n]) => n > 0).map(([k, n]) => <Badge key={k} tone="outline">{CLASS_LABEL[k] ?? k} {n}</Badge>)}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="text-[12px] text-ink-muted">{d.disclaimer}</p>
      {open && <ProvisionsDrawer wsId={wsId} api={api} source={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ProvisionsDrawer({ wsId, api, source, onClose }: { wsId: string; api: ReturnType<typeof workspaceKbApi>; source: LegalSource; onClose: () => void }) {
  const q = useAsync(() => legalApi.provisions(wsId, source.doc_id), [wsId, source.doc_id]);
  const [filter, setFilter] = useState('');
  return (
    <Drawer open onClose={onClose} title={source.title} width="max-w-2xl"
      subtitle={<span>{source.meta.jurisdiction ?? 'Jurisdiction not tagged'} · {source.meta.authority ?? 'authority not recorded'}</span>}>
      {q.error && <ErrorState message={q.error} onRetry={q.reload} />}
      {!q.data && !q.error && <Spinner label="Loading provisions…" />}
      {q.data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select compact value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show sentence type" className="w-52">
              <option value="">All sentences</option>
              {Object.entries(CLASS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}s</option>)}
            </Select>
            {q.data.authorities_mentioned.length > 0 && <span className="text-[12.5px] text-ink-muted">Authorities named: {q.data.authorities_mentioned.join(', ')}</span>}
          </div>
          {q.data.provisions.map((p) => {
            const sentences = filter ? p.sentences.filter((s) => s.classes.includes(filter)) : p.sentences;
            if (filter && !sentences.length) return null;
            return (
              <section key={p.id} className="rounded-xl border border-line">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas/60 px-4 py-2.5">
                  <h3 className="text-[13.5px] font-semibold text-ink">{p.label}</h3>
                  <span className="text-[12px] text-ink-muted">p.{p.page}{p.references.length ? ` · refers to ${p.references.join(', ')}` : ''}</span>
                </div>
                <div className="space-y-2 px-4 py-3">
                  {sentences.map((s, i) => (
                    <div key={i}>
                      {s.classes.length > 0 && <div className="mb-1 flex flex-wrap gap-1">{s.classes.map((c) => <Badge key={c} tone={c === 'penalty' || c === 'prohibition' ? 'danger' : c === 'obligation' ? 'brand' : 'neutral'}>{CLASS_LABEL[c] ?? c}</Badge>)}</div>}
                      <CitationQuote c={s.citation} api={api} compact />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          <p className="text-[12px] text-ink-muted">{q.data.disclaimer}</p>
        </div>
      )}
    </Drawer>
  );
}

function LegalGraph({ wsId, api }: { wsId: string; api: ReturnType<typeof workspaceKbApi> }) {
  const g = useAsync(() => legalApi.graph(wsId), [wsId]);
  if (g.error && !g.data) return <Card><ErrorState message={g.error} onRetry={g.reload} /></Card>;
  return (
    <div className="space-y-3">
      <Notice tone="neutral">Laws, their provisions, defined terms and the authorities they name. Edges such as “references”, “exempts from” and “penalises breach of” come from the text; select one to read the sentence behind it.</Notice>
      <AnalysisGraphPanel graph={g.data ?? null} api={api} className="h-[calc(100vh-20rem)] min-h-[520px]"
        emptyHint={g.loading ? 'Building the provision graph…' : 'Add legal sources to build the provision graph.'} />
    </div>
  );
}
