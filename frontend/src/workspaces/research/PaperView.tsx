import { ArrowRight, GitCompareArrows, MessageSquareText, Users } from 'lucide-react';
import type { KbApi } from '../../api/kb';
import { researchApi } from '../../api/platform';
import { useAsync } from '../../lib/hooks';
import type { Paper, PaperField } from '../../types/platform';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge, SampleBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ErrorState, Skeleton, SkeletonCard } from '../../components/ui/Feedback';
import { CitationQuote } from '../../components/evidence/Evidence';
import { SaveButton } from '../../components/workspace/SaveButton';

export const FIELD_ORDER = ['abstract', 'research_problem', 'objectives', 'methodology', 'data', 'techniques', 'findings',
  'limitations', 'future_work', 'conclusion', 'references'] as const;

export const PAPER_QUESTIONS = [
  'Explain this paper in simple English.',
  'What problem is this paper trying to solve?',
  'What are its major contributions?',
  'Which assumptions does it make?',
  'What are its limitations?',
  'What research gaps remain?',
];

interface Props {
  wsId: string;
  docId: string;
  api: KbApi;
  onAsk: (q: string, docId: string) => void;
  onCompare: (docId: string) => void;
  onOpen: (docId: string) => void;
}

export function PaperView({ wsId, docId, api, onAsk, onCompare, onOpen }: Props) {
  const paper = useAsync(() => researchApi.paper(wsId, docId), [wsId, docId]);
  const related = useAsync(() => researchApi.related(wsId, docId), [wsId, docId]);
  const p = paper.data;

  if (paper.error && !p) return <Card><ErrorState message={paper.error} onRetry={paper.reload} /></Card>;
  if (!p) return <div className="space-y-4"><SkeletonCard lines={2} /><SkeletonCard /><SkeletonCard /></div>;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Card padded>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[19px] font-semibold leading-snug text-ink">{p.title}</h2>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-ink-soft">
                <Users className="h-4 w-4 text-ink-muted" />
                {p.authors.found ? p.authors.value.join(', ') : <span className="text-ink-muted">Authors could not be extracted</span>}
                {p.authors.found && p.authors.method && <span className="text-[12px] text-ink-muted">({p.authors.method})</span>}
              </p>
              {p.affiliations && p.affiliations.length > 0 && <p className="mt-1 text-[12.5px] text-ink-muted">{p.affiliations.join(' · ')}</p>}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Badge tone="outline">{p.year.found ? p.year.value : 'Year not found'}</Badge>
                <Badge tone="outline">{p.pages} page{p.pages === 1 ? '' : 's'}</Badge>
                <Badge tone="outline">{p.sections_found.length} sections recognised</Badge>
                {p.meta.is_sample ? <SampleBadge /> : null}
                <span className="text-[12px] text-ink-muted">{p.filename}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<MessageSquareText className="h-4 w-4" />} onClick={() => onAsk('Explain this paper in simple English.', p.doc_id)}>Ask about this paper</Button>
              <Button size="sm" variant="secondary" icon={<GitCompareArrows className="h-4 w-4" />} onClick={() => onCompare(p.doc_id)}>Compare</Button>
              <SaveButton workspaceId={wsId} kind="paper" title={p.title} payload={() => ({ paper: p })} />
            </div>
          </div>
        </Card>
        {FIELD_ORDER.filter((k) => p.fields[k]).map((k) => <FieldCard key={k} field={p.fields[k]} api={api} />)}
        <p className="text-[12px] text-ink-muted">
          Only information found in the paper is shown. Fields marked “not found” could not be extracted. Paheli never fills them in.
        </p>
      </div>
      <aside className="space-y-5">
        <Card>
          <CardHeader title="Ask about this paper" />
          <div className="space-y-1.5 p-3">
            {PAPER_QUESTIONS.map((q) => (
              <button key={q} onClick={() => onAsk(q, p.doc_id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-brand-50">
                {q} <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-700" />
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Papers addressing similar problems" description={related.data?.note} />
          <div className="p-3">
            {related.initialLoading ? <Skeleton className="h-10 w-full" />
              : !related.data?.related.length ? <p className="px-2 py-2 text-[13px] text-ink-muted">No other ready papers in this workspace yet.</p>
              : (
                <ul className="space-y-2">
                  {related.data.related.map((r) => (
                    <li key={r.doc_id}>
                      <button onClick={() => onOpen(r.doc_id)} className="w-full rounded-lg border border-line p-2.5 text-left hover:border-brand-200 hover:bg-brand-50">
                        <div className="text-[13px] font-medium leading-snug text-ink">{r.title}</div>
                        <div className="mt-1 text-[12px] text-ink-muted">Text similarity {(r.similarity * 100).toFixed(0)}%</div>
                        {r.shared_entities.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {r.shared_entities.slice(0, 5).map((e) => <span key={e.id} className="rounded bg-canvas px-1.5 py-0.5 text-[11px] text-ink-soft">{e.name}</span>)}
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </Card>
      </aside>
    </div>
  );
}

export function FieldCard({ field, api, compact }: { field: PaperField; api?: KbApi; compact?: boolean }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-2.5">
        <h3 className="text-[14px] font-semibold text-ink">{field.label}</h3>
        {field.found ? <span className="text-[11.5px] text-ink-muted">{field.method}</span> : <Badge tone="neutral">Not found in the paper</Badge>}
      </div>
      <div className={`space-y-2 px-5 ${compact ? 'py-3' : 'py-3.5'}`}>
        {!field.found && <p className="text-[13px] text-ink-muted">{field.note ?? 'This could not be extracted from the paper.'}</p>}
        {field.items.map((it, i) => it.citation
          ? <CitationQuote key={i} c={it.citation} api={api} compact={compact} />
          : <p key={i} className="rounded-lg bg-canvas px-3 py-1.5 text-[13px] text-ink-soft">{it.text}{it.page ? <span className="ml-1 text-[11.5px] text-ink-muted">· p.{it.page}</span> : null}</p>)}
      </div>
    </Card>
  );
}

export function paperSnippet(p: Paper): string | null {
  return p.fields.findings?.items[0]?.text ?? p.fields.abstract?.items[0]?.text ?? null;
}
