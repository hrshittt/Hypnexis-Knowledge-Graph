import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, FileText, LayoutDashboard, MessageSquareText, Network, RefreshCw, ShieldAlert } from 'lucide-react';
import { workspaceKbApi } from '../../api/kb';
import { corporateApi } from '../../api/platform';
import { useAsync } from '../../lib/hooks';
import { roleAtLeast } from '../../lib/workspaceTypes';
import type { ExampleQuestion } from '../../types/kb';
import type { WorkspaceModuleProps } from '../types';
import { TabBar, useTab } from '../../components/ui/Tabs';
import { Select } from '../../components/ui/Form';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, Notice, SkeletonCard } from '../../components/ui/Feedback';
import { WorkspaceDocuments } from '../../components/workspace/WorkspaceDocuments';
import { WelcomePanel } from '../../components/workspace/WelcomePanel';
import { SaveButton } from '../../components/workspace/SaveButton';
import KnowledgeWorkspace from '../../components/kb/KnowledgeWorkspace';
import AnalysisGraphPanel from '../../components/kb/AnalysisGraphPanel';
import { CorporateOverview } from './CorporateOverview';
import { Financials } from './Financials';
import { Risks } from './Risks';
import { EvidenceDrawer, periodLabel, type Evidence } from './shared';

const TABS = ['overview', 'financials', 'risks', 'documents', 'assistant', 'graph'] as const;
type Tab = typeof TABS[number];

export default function CorporateWorkspace({ ws }: WorkspaceModuleProps) {
  const [tab, setTab] = useTab<Tab>(TABS, 'overview');
  const [params, setParams] = useSearchParams();
  const api = useMemo(() => workspaceKbApi(ws.id), [ws.id]);
  const company = params.get('company');
  const [yearSel, setYearSel] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [examples, setExamples] = useState<ExampleQuestion[]>([]);

  const analysis = useAsync(() => corporateApi.analysis(ws.id, company), [ws.id, company]);
  const a = analysis.data;

  // Scope the analysis to one company so figures from different companies are never mixed.
  useEffect(() => {
    if (a && !company && a.companies.length > 0) {
      setParams((p) => { const n = new URLSearchParams(p); n.set('company', a.companies[0]); return n; }, { replace: true });
    }
  }, [a, company, setParams]);

  useEffect(() => { api.examples().then(setExamples).catch(() => {}); }, [api]);

  const periods = a ? [...a.periods].sort((x, y) => y - x) : [];
  const year = yearSel !== null && periods.includes(yearSel) ? yearSel : periods[0] ?? null;
  const canWrite = roleAtLeast(ws.role, 'analyst');
  const ask = (q: string) => setTab('assistant', { q });
  const ready = a ? a.documents.length > 0 : false;

  const filters = (tab === 'overview' || tab === 'financials' || tab === 'risks' || tab === 'graph') && a && (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 whitespace-nowrap text-[13px] text-ink-muted">Company
        <Select compact value={company ?? ''} className="w-52"
          onChange={(e) => setParams((p) => { const n = new URLSearchParams(p); if (e.target.value) n.set('company', e.target.value); else n.delete('company'); return n; })}>
          {a.companies.length === 0 && <option value="">All documents</option>}
          {a.companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </label>
      {tab === 'overview' && periods.length > 0 && (
        <label className="flex items-center gap-2 whitespace-nowrap text-[13px] text-ink-muted">Financial year
          <Select compact value={year ?? ''} className="w-32" onChange={(e) => setYearSel(Number(e.target.value))}>
            {periods.map((y) => <option key={y} value={y}>{periodLabel(a, y)}</option>)}
          </Select>
        </label>
      )}
      <Button variant="ghost" size="sm" icon={<RefreshCw className={`h-3.5 w-3.5 ${analysis.loading ? 'animate-spin' : ''}`} />} onClick={analysis.reload}>Refresh</Button>
      <div className="ml-auto">
        {ready && <SaveButton workspaceId={ws.id} kind="corporate" label="Save analysis"
          title={`${company ?? 'Company'} financial analysis${year ? ` · ${periodLabel(a, year)}` : ''}`}
          payload={() => ({ company, year, analysis: a })} />}
      </div>
    </div>
  );

  const analysisBody = (render: () => React.ReactNode) => {
    if (analysis.error && !a) return <Card><ErrorState message={analysis.error} onRetry={analysis.reload} /></Card>;
    if (!a) return <div className="grid gap-4 md:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;
    if (!ready) {
      return (
        <Card>
          <EmptyState icon={<FileText />} title={company ? `No ready documents for ${company}` : 'No analysed documents yet'}
            actions={canWrite && <Button onClick={() => setTab('documents')}>Add documents</Button>}>
            Upload annual reports or financial statements (or load the sample set) and set their company and financial year.
            Figures appear here once processing finishes.
          </EmptyState>
        </Card>
      );
    }
    return (
      <div className={analysis.loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {a.unassigned_documents > 0 && (
          <Notice tone="warn" className="mb-4" title={`${a.unassigned_documents} document${a.unassigned_documents === 1 ? ' has' : 's have'} no company assigned`}
            action={canWrite && <Button size="sm" variant="secondary" onClick={() => setTab('documents')}>Assign</Button>}>
            Documents without a company are left out of company analyses so figures from different companies are never mixed.
          </Notice>
        )}
        {render()}
      </div>
    );
  };

  return (
    <div>
      <WelcomePanel ws={ws} onLoaded={() => { setTab('documents'); }} onUpload={() => setTab('documents')} />
      <TabBar label="Corporate workspace sections" active={tab} onChange={(k) => setTab(k, { q: null })} className="mb-5" items={[
        { key: 'overview', label: 'Overview', icon: <LayoutDashboard /> },
        { key: 'financials', label: 'Financials', icon: <BarChart3 /> },
        { key: 'risks', label: 'Risks', icon: <ShieldAlert /> },
        { key: 'documents', label: 'Documents', icon: <FileText /> },
        { key: 'assistant', label: 'CFO assistant', icon: <MessageSquareText /> },
        { key: 'graph', label: 'Company graph', icon: <Network /> },
      ]} />
      {filters && <div className="mb-5">{filters}</div>}

      {tab === 'overview' && analysisBody(() => (
        <CorporateOverview analysis={a!} year={year} examples={examples} onEvidence={setEvidence} onAsk={ask} onTab={(t) => setTab(t)} />
      ))}
      {tab === 'financials' && analysisBody(() => <Financials analysis={a!} onEvidence={setEvidence} />)}
      {tab === 'risks' && analysisBody(() => <Risks analysis={a!} api={api} onAsk={ask} />)}
      {tab === 'documents' && (
        <WorkspaceDocuments ws={ws} metaFields={['company', 'fiscal_year', 'doc_kind']} onChanged={analysis.reload}
          intro={<Notice tone="info">Set each document’s <b>company</b> and <b>financial year</b>. Analyses group documents by company, and the year is used when a sentence doesn’t name its period.</Notice>} />
      )}
      {tab === 'assistant' && (
        <div className="space-y-3">
          <Notice tone="neutral">The CFO assistant answers only from this workspace’s documents and cites the passages it used. When the evidence is insufficient, it says so.</Notice>
          <KnowledgeWorkspace key={`${ws.id}-${params.get('q') ?? ''}`} api={api} workspaceId={ws.id} canWrite={canWrite} canDelete={ws.role === 'owner'}
            initialQuestion={params.get('q') ?? undefined} className="h-auto lg:h-[calc(100vh-21rem)] lg:min-h-[560px]"
            readOnlyNote="You have viewer access: you can ask questions and explore, but not add documents." />
        </div>
      )}
      {tab === 'graph' && <CompanyGraph wsId={ws.id} company={company} api={api} />}

      <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(null)} api={api} />
    </div>
  );
}

function CompanyGraph({ wsId, company, api }: { wsId: string; company: string | null; api: ReturnType<typeof workspaceKbApi> }) {
  const g = useAsync(() => corporateApi.graph(wsId, company), [wsId, company]);
  if (g.error && !g.data) return <Card><ErrorState message={g.error} onRetry={g.reload} /></Card>;
  return (
    <div className="space-y-3">
      <Notice tone="neutral">
        Company, reporting periods, reported and calculated metrics, business segments and risk categories, connected only where the analysis found them.
        Select a node for its figure and source sentence.
      </Notice>
      <AnalysisGraphPanel key={`${wsId}-${company}`} graph={g.data ?? null} api={api} className="h-[calc(100vh-20rem)] min-h-[520px]"
        emptyHint={g.loading ? 'Building the company graph…' : 'No figures have been extracted yet. Add documents with financial statements to build it.'} />
    </div>
  );
}
