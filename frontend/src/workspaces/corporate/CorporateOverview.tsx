import { ArrowRight, FileText, MessageSquareText, ShieldAlert } from 'lucide-react';
import type { CorporateAnalysis, FigurePoint } from '../../types/platform';
import type { ExampleQuestion } from '../../types/kb';
import { fmtPct } from '../../lib/format';
import { Card, CardHeader } from '../../components/ui/Card';
import { StatTile } from '../../components/ui/StatTile';
import { SampleBadge } from '../../components/ui/Badge';
import { Table, Td, Th } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/Feedback';
import { BasisBadge } from '../../components/evidence/Evidence';
import { SeverityBadge, derivedFor, periodLabel, pointFor, type Evidence } from './shared';

interface Props {
  analysis: CorporateAnalysis;
  year: number | null;
  examples: ExampleQuestion[];
  onEvidence: (e: Evidence) => void;
  onAsk: (q: string) => void;
  onTab: (t: 'financials' | 'risks' | 'documents') => void;
}

export function CorporateOverview({ analysis: a, year, examples, onEvidence, onAsk, onTab }: Props) {
  const prevYear = year !== null ? [...a.periods].filter((p) => p < year).pop() ?? null : null;

  const tile = (metric: string, label: string, opts: { sub?: React.ReactNode; delta?: React.ComponentProps<typeof StatTile>['delta']; definition?: string } = {}) => {
    const p: FigurePoint | undefined = pointFor(a, metric, year);
    return (
      <StatTile key={metric} label={label}
        value={p?.display}
        unavailable={p ? null : `No ${label.toLowerCase()} figure for ${year ?? 'this period'} was found in the documents.`}
        badge={p ? <BasisBadge basis="reported" /> : undefined}
        sub={opts.sub} delta={opts.delta} definition={opts.definition}
        footer={p && (
          <button onClick={() => onEvidence({ kind: 'figure', point: p })} className="flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline">
            <FileText className="h-3 w-3" /> {p.citation.filename} · p.{p.citation.page}
          </button>
        )} />
    );
  };

  const growth = derivedFor(a, 'revenue_growth', year);
  const margin = (key: string) => derivedFor(a, key, year);
  const fcf = derivedFor(a, 'free_cash_flow_calc', year);
  const netDebt = derivedFor(a, 'net_debt_calc', year);
  const calcSub = (d: ReturnType<typeof derivedFor>, text: string) => d && (
    <button onClick={() => onEvidence({ kind: 'derived', metric: d })} className="text-left hover:underline">
      {text}: <b className="font-medium text-ink-soft">{d.display}</b> <span className="text-info-ink">(calculated)</span>
    </button>
  );

  return (
    <div className="space-y-6">
      <section aria-label={`Financial summary ${year ?? ''}`} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tile('revenue', 'Revenue', {
          delta: growth ? { value: growth.value, label: `vs ${prevYear !== null ? periodLabel(a, prevYear) : 'prior year'} (calculated)`, goodWhenUp: true } : null,
          definition: 'Total revenue as stated in the documents for the selected financial year. Growth is calculated only between years that use the same revenue label.',
        })}
        {tile('net_profit', 'Net profit', { sub: calcSub(margin('net_margin_calc'), 'Net margin') })}
        {tile('ebitda', 'EBITDA', { sub: calcSub(margin('ebitda_margin_calc'), 'EBITDA margin'), definition: 'EBITDA as reported. Adjusted and unadjusted EBITDA are not treated as the same measure; the label used in the document is shown in the evidence.' })}
        {tile('operating_cash_flow', 'Operating cash flow', { sub: calcSub(fcf, 'Free cash flow') })}
        {tile('cash', 'Cash and cash equivalents')}
        {tile('total_debt', 'Total debt', { sub: calcSub(netDebt, 'Net debt') })}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Risk overview" icon={<ShieldAlert className="h-4 w-4" />}
            description="Disclosed risks come from the documents; inferred flags come from rules applied to the figures."
            actions={<button onClick={() => onTab('risks')} className="text-[13px] font-medium text-brand-700 hover:underline">All risks</button>} />
          {!a.risks.summary.length ? (
            <EmptyState compact title="No risks identified">No risk language was found and no rule was triggered by the extracted figures.</EmptyState>
          ) : (
            <Table caption="Risk overview by category">
              <thead><tr><Th>Category</Th><Th align="right">Disclosed</Th><Th align="right">Inferred</Th><Th>Highest severity</Th></tr></thead>
              <tbody>
                {a.risks.summary.map((r) => (
                  <tr key={r.category}>
                    <Td className="font-medium">{r.label}</Td>
                    <Td align="right">{r.disclosed}</Td>
                    <Td align="right">{r.inferred}</Td>
                    <Td><SeverityBadge severity={r.max_severity} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="px-5 py-3 text-[11.5px] text-ink-muted">Severity is indicative (wording or rule based). It is not a credit rating.</p>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Recent disclosures" icon={<FileText className="h-4 w-4" />}
              actions={<button onClick={() => onTab('documents')} className="text-[13px] font-medium text-brand-700 hover:underline">Manage</button>} />
            <ul className="divide-y divide-line">
              {a.documents.map((d) => (
                <li key={d.doc_id} className="flex items-start gap-3 px-5 py-2.5">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-ink">{d.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
                      <span>{d.meta.doc_kind ?? 'Document'}</span>·<span>{d.meta.fiscal_year ?? 'Year not set'}</span>
                      {d.meta.is_sample ? <SampleBadge /> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="CFO analysis assistant" icon={<MessageSquareText className="h-4 w-4" />}
              description="Answers come only from this company’s documents, with citations." />
            <div className="space-y-1.5 p-4">
              {(examples.length ? examples.map((e) => e.question) : [
                'What are the biggest financial risks facing this company?',
                'Why did profitability decline this year?',
                'How has operating cash flow changed?',
              ]).slice(0, 5).map((q) => (
                <button key={q} onClick={() => onAsk(q)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left text-[13px] text-ink hover:border-brand-200 hover:bg-brand-50">
                  {q} <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-700" />
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
      {a.derived.some((d) => d.metric === 'liabilities_to_assets' && d.period.year === year) && (
        <p className="text-[12px] text-ink-muted">
          Liabilities to assets for {year}: {fmtPct(derivedFor(a, 'liabilities_to_assets', year)?.value)} (calculated). More ratios are on the Financials tab.
        </p>
      )}
    </div>
  );
}
