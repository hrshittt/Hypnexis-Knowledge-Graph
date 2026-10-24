import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { placementApi } from '../../api/platform';
import { useAsync } from '../../lib/hooks';
import { fmtPct, fmtNumber } from '../../lib/format';
import type { YearRow } from '../../types/platform';
import { Card, CardHeader } from '../../components/ui/Card';
import { ErrorState, Notice, SkeletonCard } from '../../components/ui/Feedback';
import { Table, Td, Th } from '../../components/ui/Table';
import { ChartFrame } from '../../components/charts/ChartFrame';
import { ColumnChart } from '../../components/charts/ColumnChart';
import { SERIES } from '../../components/charts/theme';

export function YearsView({ wsId, ctcUnit }: { wsId: string; ctcUnit: string }) {
  const years = useAsync(() => placementApi.years(wsId), [wsId]);
  const asOf = useAsync(() => placementApi.asOf(wsId), [wsId]);
  const d = years.data;
  if (years.error && !d) return <Card><ErrorState message={years.error} onRetry={years.reload} /></Card>;
  if (!d) return <div className="grid gap-4 lg:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>;

  const cats = d.years.map((y) => y.academic_year);
  const dimmed = Object.fromEntries(d.years.filter((y) => y.cycle.status === 'ongoing').map((y) => [y.academic_year, 'ongoing · partial']));
  const col = (k: keyof YearRow) => d.years.map((y) => (y[k] as number | null) ?? null);
  const table = (cols: [string, keyof YearRow, (v: number) => string][]) => ({
    columns: ['Academic year', ...cols.map((c) => c[0])],
    rows: d.years.map((y) => [`${y.academic_year}${y.cycle.status === 'ongoing' ? ' (ongoing)' : ''}`, ...cols.map(([, k, f]) => (y[k] === null ? null : f(y[k] as number)))]),
  });
  const n = (v: number) => fmtNumber(v);
  const completed = d.years.filter((y) => y.cycle.status === 'completed').map((y) => y.academic_year);

  return (
    <div className="space-y-6">
      {d.note && <Notice tone="info" title="Ongoing cycles are partial">{d.note}</Notice>}
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartFrame title="Placement rate" subtitle="Placed ÷ denominator group (see Settings for the policy)"
          table={table([['Placement rate', 'placement_rate', (v) => fmtPct(v)], ['Students placed', 'students_placed', n], ['Eligible students', 'eligible_students', n]])}>
          <ColumnChart categories={cats} series={[{ key: 'r', label: 'Placement rate', values: col('placement_rate'), color: SERIES[0] }]}
            format={(v) => fmtPct(v)} axisFormat={(v) => `${v}%`} dimmed={dimmed} ariaLabel="Placement rate by academic year" />
        </ChartFrame>
        <ChartFrame title="Offers and unique students" subtitle="One student can hold several offers"
          legend={[{ label: 'Total offers', color: SERIES[0] }, { label: 'Unique students with offers', color: SERIES[1] }]}
          table={table([['Total offers', 'total_offers', n], ['Unique students with offers', 'unique_students_with_offers', n]])}>
          <ColumnChart categories={cats} dimmed={dimmed} format={n} ariaLabel="Offers and unique students by academic year"
            series={[{ key: 'o', label: 'Total offers', values: col('total_offers'), color: SERIES[0] },
              { key: 'u', label: 'Unique students with offers', values: col('unique_students_with_offers'), color: SERIES[1] }]} />
        </ChartFrame>
        <ChartFrame title="Internship-to-PPO conversion" subtitle="Interns with a PPO ÷ interns whose outcome is known"
          table={table([['Conversion', 'ppo_conversion_rate', (v) => fmtPct(v)], ['PPO offers', 'ppo_offers', n], ['Internship offers', 'internship_offers', n]])}>
          <ColumnChart categories={cats} series={[{ key: 'p', label: 'PPO conversion', values: col('ppo_conversion_rate'), color: SERIES[0] }]}
            format={(v) => fmtPct(v)} axisFormat={(v) => `${v}%`} dimmed={dimmed} ariaLabel="PPO conversion by academic year" />
        </ChartFrame>
        <ChartFrame title="Company participation" subtitle="Returning = also recruited in an earlier cycle"
          legend={[{ label: 'Companies participating', color: SERIES[0] }, { label: 'Returning companies', color: SERIES[1] }]}
          table={table([['Participating', 'companies_participating', n], ['Returning', 'returning_companies', n]])}>
          <ColumnChart categories={cats} dimmed={dimmed} format={n} ariaLabel="Companies participating and returning by academic year"
            series={[{ key: 'c', label: 'Companies participating', values: col('companies_participating'), color: SERIES[0] },
              { key: 'r', label: 'Returning companies', values: col('returning_companies'), color: SERIES[1] }]} />
        </ChartFrame>
      </div>

      {d.years.some((y) => y.ctc_average !== null) && (
        <ChartFrame title="Salary trend" subtitle={`Average and median CTC of full-time offers with a CTC value${ctcUnit ? ` (${ctcUnit})` : ''}`}
          legend={[{ label: 'Average CTC', color: SERIES[0] }, { label: 'Median CTC', color: SERIES[1] }]}
          table={table([['Average CTC', 'ctc_average', (v) => v.toFixed(2)], ['Median CTC', 'ctc_median', (v) => v.toFixed(2)]])}>
          <ColumnChart categories={cats} dimmed={dimmed} format={(v) => `${v.toFixed(2)}${ctcUnit ? ` ${ctcUnit}` : ''}`} axisFormat={(v) => `${v}`}
            ariaLabel="CTC by academic year" height={180}
            series={[{ key: 'a', label: 'Average CTC', values: col('ctc_average'), color: SERIES[0] }, { key: 'm', label: 'Median CTC', values: col('ctc_median'), color: SERIES[1] }]} />
        </ChartFrame>
      )}

      <Card>
        <CardHeader title="Equivalent-date comparison" description={asOf.data?.available && asOf.data.current
          ? `${asOf.data.current} is ${asOf.data.days_into_cycle} days in. Each earlier cycle is cut off the same number of days after its start.`
          : 'Compares the ongoing cycle with earlier cycles at the same point.'} />
        {asOf.error ? <ErrorState message={asOf.error} onRetry={asOf.reload} />
          : !asOf.data ? <div className="p-5"><SkeletonCard lines={2} /></div>
          : !asOf.data.available ? <p className="px-5 py-4 text-[13px] text-ink-muted">{asOf.data.note}</p>
          : (
            <>
              <Table caption="Offers by the same point of each cycle">
                <thead><tr><Th>Academic year</Th><Th>Cut-off date</Th><Th align="right">Offers by cut-off</Th><Th align="right">Students placed by cut-off</Th><Th align="right">Undated offers</Th></tr></thead>
                <tbody>
                  {asOf.data.rows!.map((r) => (
                    <tr key={r.academic_year} className={r.is_current ? 'bg-brand-50/50' : ''}>
                      <Td className="font-medium">{r.academic_year}{r.is_current ? ' (current)' : ''}</Td>
                      <Td>{r.cutoff}</Td>
                      <Td align="right">{r.offers_by_cutoff}</Td>
                      <Td align="right">{r.students_placed_by_cutoff}</Td>
                      <Td align="right">{r.undated_offers}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="px-5 py-3 text-[12px] text-ink-muted">{asOf.data.note}</p>
            </>
          )}
      </Card>

      <Card>
        <CardHeader title="Department trends" description="Placement rate by department across completed cycles. Ongoing cycles are excluded." />
        {!d.department_trends.length || completed.length < 1 ? <p className="px-5 py-4 text-[13px] text-ink-muted">Needs at least one completed cycle with a roster.</p> : (
          <Table caption="Department placement rates by completed cycle">
            <thead><tr><Th>Department</Th>{completed.map((y) => <Th key={y} align="right">{y}</Th>)}<Th align="right">Change</Th></tr></thead>
            <tbody>
              {d.department_trends.map((t) => (
                <tr key={t.department}>
                  <Td className="font-medium">{t.department}</Td>
                  {completed.map((y) => <Td key={y} align="right">{fmtPct(t.rates[y] ?? null)}</Td>)}
                  <Td align="right"><Change v={t.change} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Change({ v }: { v: number | null }) {
  if (v === null) return <span className="text-ink-faint">—</span>;
  const Icon = v > 0 ? ArrowUpRight : v < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${v > 0 ? 'text-brand-700' : v < 0 ? 'text-danger-ink' : 'text-ink-muted'}`}>
      <Icon className="h-3.5 w-3.5" />{v > 0 ? '+' : ''}{v.toFixed(1)} pts
    </span>
  );
}
