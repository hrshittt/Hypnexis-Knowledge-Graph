import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Waypoints } from 'lucide-react';
import { kbApi, workspaceKbApi } from '../../api/kb';
import { corporateApi, legalApi, placementApi } from '../../api/platform';
import { useAuth } from '../../lib/auth';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { TYPE_INFO, roleAtLeast } from '../../lib/workspaceTypes';
import type { Workspace } from '../../types/platform';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { Segmented, Select } from '../../components/ui/Form';
import { Card } from '../../components/ui/Card';
import { ErrorState, Notice } from '../../components/ui/Feedback';
import KnowledgeWorkspace from '../../components/kb/KnowledgeWorkspace';
import AnalysisGraphPanel from '../../components/kb/AnalysisGraphPanel';

const ANALYSIS_LABEL: Record<string, string> = { corporate: 'Company graph', legal: 'Provision graph', placement: 'Placement graph' };

export default function KnowledgeGraphPage() {
  useDocumentTitle('Knowledge Graph');
  const { workspaces, session } = useAuth();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') ?? 'shared';
  const ws = workspaces.find((w) => w.id === scope);
  const hasEntityGraph = !ws || ws.type !== 'placement';
  const hasAnalysis = !!ws && ws.type in ANALYSIS_LABEL;
  const view = ws?.type === 'placement' ? 'analysis' : params.get('view') === 'analysis' && hasAnalysis ? 'analysis' : 'entities';
  const set = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v === null) n.delete(k); else n.set(k, v); return n; });

  const sharedWrite = !!session?.permissions?.shared_kb_write;
  const api = useMemo(() => (ws ? workspaceKbApi(ws.id) : kbApi), [ws]);

  return (
    <Page wide>
      <PageHeader icon={<Waypoints />} title="Knowledge Graph"
        description="Explore entities, relationships and topic communities, ask grounded questions, and inspect the evidence behind every connection."
        actions={<>
          <Select compact value={ws ? ws.id : 'shared'} aria-label="Knowledge base" className="w-64" onChange={(e) => setParams(e.target.value === 'shared' ? {} : { scope: e.target.value })}>
            <option value="shared">Shared demo corpus</option>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} · {TYPE_INFO[w.type].short}</option>)}
          </Select>
          {hasAnalysis && hasEntityGraph && (
            <Segmented label="Graph type" value={view} onChange={(v) => set('view', v === 'analysis' ? 'analysis' : null)}
              options={[{ value: 'entities', label: 'Entity graph' }, { value: 'analysis', label: ANALYSIS_LABEL[ws!.type] }]} />
          )}
        </>} />
      <div className="mt-5">
        {!ws && (
          <Notice tone="neutral" className="mb-3">
            The shared demo corpus is the original Hypnexis knowledge graph, built from the fictional sample documents and visible to everyone.
            {sharedWrite ? ' Your account can change it.' : ' It is read-only for your account; use a workspace for your own documents.'}
          </Notice>
        )}
        {ws && view === 'entities' && (
          <Notice tone="neutral" className="mb-3">
            {ws.name}: the entity graph built from this workspace’s documents. Only its members can see it. <Link to={`/app/w/${ws.id}`} className="font-medium text-brand-700 hover:underline">Open the workspace</Link>
          </Notice>
        )}
        {view === 'entities'
          ? <KnowledgeWorkspace key={`${api.base}-${params.get('q') ?? ''}`} api={api} workspaceId={ws?.id ?? null} initialQuestion={params.get('q') ?? undefined}
              canWrite={ws ? roleAtLeast(ws.role, 'analyst') : sharedWrite} canDelete={ws ? ws.role === 'owner' : sharedWrite}
              readOnlyNote={ws ? 'You have viewer access to this workspace.' : 'Only administrators can change the shared demo graph. Upload your own documents in one of your workspaces.'}
              className="h-auto lg:h-[calc(100vh-15rem)] lg:min-h-[560px]" />
          : <WorkspaceAnalysisGraph ws={ws!} />}
      </div>
    </Page>
  );
}

function WorkspaceAnalysisGraph({ ws }: { ws: Workspace }) {
  const api = useMemo(() => workspaceKbApi(ws.id), [ws.id]);
  // Corporate graphs are scoped to one company so figures from different companies never share a node.
  const g = useAsync(async () => {
    if (ws.type === 'corporate') {
      const company = (await corporateApi.analysis(ws.id)).companies[0] ?? null;
      return { company, graph: await corporateApi.graph(ws.id, company) };
    }
    return { company: null, graph: await (ws.type === 'legal' ? legalApi.graph(ws.id) : placementApi.graph(ws.id)) };
  }, [ws.id, ws.type]);
  if (g.error && !g.data) return <Card><ErrorState message={g.error} onRetry={g.reload} /></Card>;
  return (
    <>
      {ws.type === 'corporate' && g.data && (
        <Notice tone="neutral" className="mb-3">
          {g.data.company ? `Showing ${g.data.company}.` : 'No company is assigned to these documents yet.'}{' '}
          Choose another company on the workspace’s <Link to={`/app/w/${ws.id}?tab=graph`} className="font-medium text-brand-700 hover:underline">Company graph</Link> tab.
        </Notice>
      )}
      <AnalysisGraphPanel key={ws.id} graph={g.data?.graph ?? null} api={ws.type === 'placement' ? undefined : api} className="h-[calc(100vh-17rem)] min-h-[520px]"
        emptyHint={g.loading ? 'Building the graph…' : 'Nothing to show yet. Add data to this workspace first.'} />
    </>
  );
}
