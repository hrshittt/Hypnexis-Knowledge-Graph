import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import type { KbApi } from '../../api/kb';
import type { CorporateAnalysis, DerivedMetric, FigurePoint } from '../../types/platform';
import { Drawer } from '../../components/ui/Overlay';
import { KeyValue } from '../../components/ui/Card';
import { Notice } from '../../components/ui/Feedback';
import { BasisBadge, CitationQuote } from '../../components/evidence/Evidence';

export const KPI_METRICS = ['revenue', 'net_profit', 'ebitda', 'operating_profit', 'operating_cash_flow', 'cash', 'total_debt', 'total_assets', 'total_liabilities', 'capex'] as const;

export const pointFor = (a: CorporateAnalysis, metric: string, year: number | null) =>
  year === null ? undefined : a.metrics[metric]?.points.find((p) => p.period.year === year);

export const derivedFor = (a: CorporateAnalysis, metric: string, year: number | null) =>
  year === null ? undefined : a.derived.find((d) => d.metric === metric && d.period.year === year);

export function periodLabel(a: CorporateAnalysis, year: number): string {
  for (const s of Object.values(a.metrics)) {
    const p = s.points.find((x) => x.period.year === year);
    if (p) return p.period.label;
  }
  return String(year);
}

/** Severity uses the reserved status colours, always with an icon and a word. */
export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  if (severity === 'high') return <span className="inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-[11.5px] font-medium text-danger-ink"><AlertOctagon className="h-3 w-3" /> High</span>;
  if (severity === 'medium') return <span className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[11.5px] font-medium text-warn-ink"><AlertTriangle className="h-3 w-3" /> Medium</span>;
  if (severity === 'low') return <span className="inline-flex items-center gap-1 rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-[11.5px] font-medium text-ink-soft"><Info className="h-3 w-3" /> Low</span>;
  return <span className="text-[12px] text-ink-faint">—</span>;
}

export type Evidence = { kind: 'figure'; point: FigurePoint } | { kind: 'derived'; metric: DerivedMetric };

/** Everything known about one figure: where it was written, how it was read, conflicts, or the formula. */
export function EvidenceDrawer({ evidence, onClose, api }: { evidence: Evidence | null; onClose: () => void; api: KbApi }) {
  if (!evidence) return null;
  if (evidence.kind === 'derived') {
    const d = evidence.metric;
    return (
      <Drawer open onClose={onClose} title={`${d.label} · ${d.period.label}`} subtitle={<span className="flex items-center gap-2"><BasisBadge basis="calculated" /> {d.display}</span>}>
        <div className="space-y-5">
          <div className="rounded-lg bg-info-soft px-3 py-2.5 text-[13px] text-info-ink"><b className="font-semibold">Formula:</b> {d.formula}</div>
          <div>
            <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Inputs</h3>
            <div className="space-y-3">
              {d.inputs.map((x, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[13px] text-ink"><b className="font-medium">{x.label}</b> {x.period}: {x.display} <BasisBadge basis={x.basis} /></div>
                  {x.citation && <CitationQuote c={x.citation} api={api} />}
                </div>
              ))}
            </div>
          </div>
          <p className="text-[12.5px] text-ink-muted">Calculated by Hypnexis only from inputs that share a currency and period. It is not a figure stated in the documents.</p>
        </div>
      </Drawer>
    );
  }
  const p = evidence.point;
  return (
    <Drawer open onClose={onClose} title={`${p.metric_label} · ${p.period.label}`} subtitle={<span className="flex items-center gap-2"><BasisBadge basis="reported" /> {p.display}</span>}>
      <div className="space-y-5">
        {p.conflict && (
          <Notice tone="danger" title="The documents disagree">
            Different values were found for the same metric, period and currency. Hypnexis shows each one and does not pick or average them.
          </Notice>
        )}
        <dl className="grid grid-cols-2 gap-4">
          <KeyValue label="As written">{p.as_written}</KeyValue>
          <KeyValue label="Label in the document">{p.reported_label}</KeyValue>
          <KeyValue label="Currency">{p.currency ?? 'Not stated'}</KeyValue>
          <KeyValue label="Units">Millions of {p.currency ?? 'the stated currency'}</KeyValue>
          <KeyValue label="Period">{p.period.label}</KeyValue>
          <KeyValue label="Period taken from">{p.period.source ?? '—'}</KeyValue>
          <KeyValue label="Extraction">{p.method === 'table' ? 'Table row' : 'Sentence'}</KeyValue>
          <KeyValue label="Sources">{p.sources.length}</KeyValue>
        </dl>
        <div>
          <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Source</h3>
          <div className="space-y-2">{(p.sources.length ? p.sources : [p.citation]).map((c, i) => <CitationQuote key={i} c={c} api={api} />)}</div>
        </div>
        {p.variants.length > 0 && (
          <div>
            <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Other values found</h3>
            <div className="space-y-2">
              {p.variants.map((v, i) => (
                <div key={i} className="space-y-1">
                  <div className="text-[13px] font-medium text-ink">{v.display}</div>
                  <CitationQuote c={v.citation} api={api} compact />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
