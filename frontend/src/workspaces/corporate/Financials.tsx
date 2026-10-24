import { AlertTriangle } from 'lucide-react';
import type { CorporateAnalysis } from '../../types/platform';
import { fmtMillions, fmtPct } from '../../lib/format';
import { Card, CardHeader } from '../../components/ui/Card';
import { Notice } from '../../components/ui/Feedback';
import { Table, Td, Th } from '../../components/ui/Table';
import { ChartEmpty, ChartFrame } from '../../components/charts/ChartFrame';
import { ColumnChart, type ColumnSeries } from '../../components/charts/ColumnChart';
import { SERIES } from '../../components/charts/theme';
import { BasisBadge, SourceLine } from '../../components/evidence/Evidence';
import { derivedFor, periodLabel, pointFor, type Evidence } from './shared';

interface Props {
  analysis: CorporateAnalysis;
  onEvidence: (e: Evidence) => void;
}

export function Financials({ analysis: a, onEvidence }: Props) {
  const years = [...a.periods].sort((x, y) => x - y);
  const labels = years.map((y) => periodLabel(a, y));
  const currency = a.currencies.length === 1 ? a.currencies[0] : null;
  const money = (v: number) => fmtMillions(v, currency);
  const moneyAxis = (v: number) => fmtMillions(v, currency, true);

  const reported = (metric: string, label: string, color: string): ColumnSeries => ({
    key: metric, label, color, values: years.map((y) => pointFor(a, metric, y)?.value ?? null),
  });
  const calculated = (metric: string, label: string, color: string): ColumnSeries => ({
    key: metric, label: `${label} (calculated)`, color, values: years.map((y) => derivedFor(a, metric, y)?.value ?? null),
  });
  const hasData = (s: ColumnSeries[]) => s.some((x) => x.values.some((v) => v !== null));
  const tableOf = (s: ColumnSeries[], fmt: (v: number) => string) => ({
    columns: ['Period', ...s.map((x) => x.label)],
    rows: labels.map((l, i) => [l, ...s.map((x) => (x.values[i] === null ? null : fmt(x.values[i] as number)))]),
  });

  const charts: { title: string; subtitle: string; series: ColumnSeries[]; fmt: (v: number) => string; axis: (v: number) => string }[] = [
    { title: 'Revenue and profit', subtitle: `Reported, ${currency ?? 'mixed currencies'} millions`, fmt: money, axis: moneyAxis,
      series: [reported('revenue', 'Revenue', SERIES[0]), reported('ebitda', 'EBITDA', SERIES[1]), reported('operating_profit', 'Operating profit', SERIES[2]), reported('net_profit', 'Net profit', SERIES[3])] },
    { title: 'Margin trends', subtitle: 'Calculated from reported figures of the same period', fmt: (v) => fmtPct(v), axis: (v) => `${v}%`,
      series: [calculated('ebitda_margin_calc', 'EBITDA margin', SERIES[0]), calculated('operating_margin_calc', 'Operating margin', SERIES[1]), calculated('net_margin_calc', 'Net margin', SERIES[2])] },
    { title: 'Debt versus cash', subtitle: `Reported, ${currency ?? 'mixed currencies'} millions`, fmt: money, axis: moneyAxis,
      series: [reported('total_debt', 'Total debt', SERIES[0]), reported('cash', 'Cash and cash equivalents', SERIES[1])] },
    { title: 'Cash flow', subtitle: 'Operating cash flow and capital expenditure as reported; free cash flow calculated', fmt: money, axis: moneyAxis,
      series: [reported('operating_cash_flow', 'Operating cash flow', SERIES[0]), reported('capex', 'Capital expenditure', SERIES[1]), calculated('free_cash_flow_calc', 'Free cash flow', SERIES[2])] },
  ];

  const metricKeys = Object.keys(a.metrics);
  const derivedKeys = [...new Set(a.derived.map((d) => d.metric))];

  return (
    <div className="space-y-6">
      <Notice tone="info">
        Amounts are in millions of their own currency{currency ? ` (${currency})` : ''}, as written in the documents. Currencies are never combined.
        Every figure is marked <b>Reported</b> (stated in a document) or <b>Calculated</b> (computed by Paheli, with formula); select any value to see its source.
      </Notice>
      {a.currencies.length > 1 && (
        <Notice tone="warn" title="Several currencies">These documents report in {a.currencies.join(', ')}. Charts plot each figure in its own currency; compare with care.</Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {charts.map((c) => {
          const s = c.series.filter((x) => x.values.some((v) => v !== null));
          return (
            <ChartFrame key={c.title} title={c.title} subtitle={c.subtitle} table={tableOf(c.series, c.fmt)}
              legend={s.map((x) => ({ label: x.label, color: x.color! }))}>
              {hasData(s) ? <ColumnChart categories={labels} series={s} format={c.fmt} axisFormat={c.axis} ariaLabel={c.title} />
                : <ChartEmpty>None of these figures were found in the documents.</ChartEmpty>}
            </ChartFrame>
          );
        })}
      </div>

      <Card>
        <CardHeader title="Reported figures" description="Select a value to see the sentence it came from." />
        <Table caption="Reported financial figures by period">
          <thead><tr><Th>Metric</Th>{labels.map((l) => <Th key={l} align="right">{l}</Th>)}</tr></thead>
          <tbody>
            {metricKeys.map((k) => (
              <tr key={k}>
                <Td className="font-medium">{a.metrics[k].label}</Td>
                {years.map((y) => {
                  const p = pointFor(a, k, y);
                  return (
                    <Td key={y} align="right">
                      {p ? (
                        <button onClick={() => onEvidence({ kind: 'figure', point: p })} className="inline-flex items-center gap-1.5 rounded px-1 hover:bg-brand-50">
                          {p.conflict && <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-label="Conflicting values" />}
                          <span className="text-ink underline decoration-line-strong underline-offset-2">{p.display}</span>
                        </button>
                      ) : <span className="text-ink-faint">Not found</span>}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {derivedKeys.length > 0 && (
        <Card>
          <CardHeader title="Calculated figures and ratios" description="Computed only from inputs with the same currency and period. Select a value for its inputs and sources." />
          <Table caption="Calculated financial metrics">
            <thead><tr><Th>Metric</Th><Th className="hidden md:table-cell">Formula</Th>{labels.map((l) => <Th key={l} align="right">{l}</Th>)}</tr></thead>
            <tbody>
              {derivedKeys.map((k) => {
                const any = a.derived.find((d) => d.metric === k)!;
                return (
                  <tr key={k}>
                    <Td className="font-medium">{any.label}</Td>
                    <Td className="hidden text-[12px] text-ink-muted md:table-cell">{any.formula}</Td>
                    {years.map((y) => {
                      const d = derivedFor(a, k, y);
                      return (
                        <Td key={y} align="right">
                          {d ? <button onClick={() => onEvidence({ kind: 'derived', metric: d })} className="rounded px-1 text-ink underline decoration-line-strong underline-offset-2 hover:bg-info-soft">{d.display}</button>
                            : <span className="text-ink-faint">—</span>}
                        </Td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {a.segments.length > 0 && (
        <Card>
          <CardHeader title="Business segments" description="Segment figures are kept separate from company totals." />
          <Table caption="Segment figures">
            <thead><tr><Th>Segment</Th><Th>Metric</Th><Th>Period</Th><Th align="right">Value</Th><Th className="hidden md:table-cell">Source</Th></tr></thead>
            <tbody>
              {a.segments.map((s, i) => (
                <tr key={i}>
                  <Td className="font-medium capitalize">{s.segment}</Td>
                  <Td>{s.metric_label}</Td>
                  <Td>{s.period.label}</Td>
                  <Td align="right"><button className="underline decoration-line-strong underline-offset-2" onClick={() => onEvidence({ kind: 'figure', point: s })}>{s.display}</button></Td>
                  <Td className="hidden md:table-cell"><SourceLine c={s.citation} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card padded>
        <h2 className="text-[14px] font-semibold text-ink">How these figures were produced</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-soft">
          {a.limitations.map((l) => <li key={l}>{l}</li>)}
          {a.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">Legend: <BasisBadge basis="reported" /> <BasisBadge basis="calculated" /></div>
      </Card>
    </div>
  );
}
