import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bookmark, Trash2 } from 'lucide-react';
import { workspaceKbApi } from '../../api/kb';
import { platformApi } from '../../api/platform';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/http';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import type { CorporateAnalysis, LegalAnalysis, Paper, PlacementAnswer } from '../../types/platform';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState, ErrorState, Notice, PageLoader } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Overlay';
import { Table, Td, Th } from '../../components/ui/Table';
import { AnalysisSummary, LawCard } from '../../workspaces/legal/LawCard';
import { AnswerBody } from '../../workspaces/placement/PlacementAssistant';
import { FIELD_ORDER, FieldCard } from '../../workspaces/research/PaperView';
import { SeverityBadge, periodLabel, pointFor } from '../../workspaces/corporate/shared';
import { SAVED_KIND } from './ActivityPage';

export default function SavedAnalysisPage() {
  const { analysisId = '' } = useParams();
  const { workspaces } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const q = useAsync(() => platformApi.getSaved(analysisId), [analysisId]);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = q.data;
  useDocumentTitle(s?.title ?? 'Saved analysis');
  const ws = workspaces.find((w) => w.id === s?.workspace_id);
  const api = useMemo(() => (s?.workspace_id ? workspaceKbApi(s.workspace_id) : undefined), [s?.workspace_id]);

  if (q.error && !s) {
    return <Page><Card>{q.error.toLowerCase().includes('not found')
      ? <EmptyState title="Saved analysis not found" actions={<ButtonLink to="/app/activity?tab=saved">All saved analyses</ButtonLink>}>It may have been deleted.</EmptyState>
      : <ErrorState message={q.error} onRetry={q.reload} />}</Card></Page>;
  }
  if (!s) return <PageLoader />;

  const remove = async () => {
    setBusy(true);
    try {
      await platformApi.deleteSaved(s.analysis_id);
      toast.success('Saved analysis deleted.');
      nav('/app/activity?tab=saved');
    } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  };
  const p = s.payload;

  return (
    <Page>
      <PageHeader icon={<Bookmark />} title={s.title}
        meta={<><Badge tone="brand">{SAVED_KIND[s.kind] ?? s.kind}</Badge><span className="text-[12.5px] text-ink-muted">{ws ? ws.name : s.workspace_id ? 'Workspace' : 'Personal'} · saved {fmtDateTime(s.created_at)}</span></>}
        actions={<>
          {ws && <ButtonLink to={`/app/w/${ws.id}`} variant="secondary" size="sm">Open workspace</ButtonLink>}
          <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(true)}>Delete</Button>
        </>} />
      <Notice tone="neutral" className="mt-5">This is a snapshot from {fmtDateTime(s.created_at)}. The documents or records may have changed since; open the workspace for the live analysis.</Notice>
      <div className="mt-5 space-y-4">
        {s.kind === 'legal' && p.result ? (() => {
          const r = p.result as LegalAnalysis;
          return (
            <>
              <Card padded><p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Question</p><p className="mt-1 text-[15px] text-ink">{r.question}</p></Card>
              <AnalysisSummary result={r} />
              {r.laws.map((l) => <LawCard key={l.doc_id} law={l} api={api} />)}
              <Notice tone="neutral">{r.disclaimer}</Notice>
            </>
          );
        })() : s.kind === 'placement' && p.answer ? (
          <Card padded><AnswerBody a={p.answer as PlacementAnswer} onTab={ws ? (t) => nav(`/app/w/${ws.id}?tab=${t}`) : undefined} /></Card>
        ) : s.kind === 'paper' && p.paper ? (() => {
          const paper = p.paper as Paper;
          return (
            <>
              <Card padded>
                <h2 className="text-[18px] font-semibold text-ink">{paper.title}</h2>
                <p className="mt-1 text-[13.5px] text-ink-soft">{paper.authors.found ? paper.authors.value.join(', ') : 'Authors not found'} · {paper.year.found ? paper.year.value : 'year not found'} · {paper.filename}</p>
                {ws && <Link to={`/app/w/${ws.id}?tab=paper&paper=${paper.doc_id}`} className="mt-2 inline-block text-[13px] font-medium text-brand-700 hover:underline">Open the live paper analysis</Link>}
              </Card>
              {FIELD_ORDER.filter((k) => paper.fields[k]).map((k) => <FieldCard key={k} field={paper.fields[k]} api={api} compact />)}
            </>
          );
        })() : s.kind === 'corporate' && p.analysis ? (
          <CorporateSnapshot a={p.analysis as CorporateAnalysis} year={(p.year as number | null) ?? null} company={(p.company as string | null) ?? null} />
        ) : (
          <Card padded><pre className="overflow-x-auto whitespace-pre-wrap text-[12px] text-ink-soft">{JSON.stringify(p, null, 2).slice(0, 20000)}</pre></Card>
        )}
      </div>
      <ConfirmDialog open={deleting} title="Delete this saved analysis?" confirmLabel="Delete" busy={busy} onConfirm={remove} onCancel={() => setDeleting(false)}>
        The snapshot will be removed. The underlying documents and data are not affected.
      </ConfirmDialog>
    </Page>
  );
}

function CorporateSnapshot({ a, year, company }: { a: CorporateAnalysis; year: number | null; company: string | null }) {
  const years = [...a.periods].sort((x, y) => x - y);
  return (
    <>
      <Card>
        <CardHeader title={`${company ?? 'Company'} · reported figures`} description={year ? `Selected year: ${periodLabel(a, year)}` : undefined} />
        <Table caption="Reported figures">
          <thead><tr><Th>Metric</Th>{years.map((y) => <Th key={y} align="right">{periodLabel(a, y)}</Th>)}</tr></thead>
          <tbody>
            {Object.keys(a.metrics).map((k) => (
              <tr key={k}><Td className="font-medium">{a.metrics[k].label}</Td>{years.map((y) => <Td key={y} align="right">{pointFor(a, k, y)?.display ?? '—'}</Td>)}</tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="Risk summary" description="Disclosed risks and rule-based inferred flags at the time of saving. Not a credit rating." />
        <Table caption="Risk summary">
          <thead><tr><Th>Category</Th><Th align="right">Disclosed</Th><Th align="right">Inferred</Th><Th>Highest severity</Th></tr></thead>
          <tbody>{a.risks.summary.map((r) => <tr key={r.category}><Td>{r.label}</Td><Td align="right">{r.disclosed}</Td><Td align="right">{r.inferred}</Td><Td><SeverityBadge severity={r.max_severity} /></Td></tr>)}</tbody>
        </Table>
      </Card>
    </>
  );
}
