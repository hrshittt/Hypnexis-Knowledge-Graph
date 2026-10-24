import { useState } from 'react';
import { placementApi } from '../../api/platform';
import { useAsync } from '../../lib/hooks';
import { fmtPct } from '../../lib/format';
import type { Cycle, PpoRow } from '../../types/platform';
import { Card, CardHeader } from '../../components/ui/Card';
import { Segmented, Select } from '../../components/ui/Form';
import { ErrorState, Notice, SkeletonCard } from '../../components/ui/Feedback';
import { Table, Td, Th } from '../../components/ui/Table';
import { ChartFrame } from '../../components/charts/ChartFrame';
import { ColumnChart } from '../../components/charts/ColumnChart';
import { StackedBar } from '../../components/charts/Bars';
import { DEEMPH, DEEMPH_LIGHT, SERIES } from '../../components/charts/theme';

type By = 'company' | 'department' | 'year';

export function PpoView({ wsId, years }: { wsId: string; years: Cycle[] }) {
  const [by, setBy] = useState<By>('company');
  const [year, setYear] = useState('');
  const q = useAsync(() => placementApi.ppo(wsId, by, by === 'year' ? null : year || null), [wsId, by, year]);
  const d = q.data;
  if (q.error && !d) return <Card><ErrorState message={q.error} onRetry={q.reload} /></Card>;
  if (!d) return <div className="grid gap-4 lg:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>;

  const ongoing = new Set(years.filter((c) => c.status === 'ongoing').map((c) => c.academic_year));
  const byYear = d.by_year;
  const scope = year ? byYear.filter((r) => r.year === year) : byYear;
  const sum = (k: keyof PpoRow) => scope.reduce((s, r) => s + ((r[k] as number) ?? 0), 0);
  const known = sum('known');
  const received = sum('ppo_offered');

  return (
    <div className="space-y-6">
      <Notice tone="info" title="How conversion is calculated">
        {d.definition} “No PPO” is a known outcome; “pending” and “not recorded” are excluded, so interns are never counted as failures because their outcome is missing.
      </Notice>
      <div className="grid gap-5 xl:grid-cols-2">
        <ChartFrame title="Conversion by academic year" subtitle="Ongoing cycles are partial: most PPO decisions come after internships end"
          table={{ columns: ['Year', 'Interns', 'Started', 'Completed', 'PPOs offered', 'Accepted', 'Declined', 'No PPO', 'Pending', 'Not recorded', 'Conversion'],
            rows: byYear.map((r) => [r.year!, r.interns, r.started, r.completed, r.ppo_offered, r.ppo_accepted, r.ppo_declined, r.no_ppo, r.pending, r.unknown, fmtPct(r.conversion_rate)]) }}>
          <ColumnChart categories={byYear.map((r) => r.year!)} format={(v) => fmtPct(v)} axisFormat={(v) => `${v}%`} ariaLabel="PPO conversion by year"
            dimmed={Object.fromEntries([...ongoing].map((y) => [y, 'ongoing · partial']))}
            series={[{ key: 'c', label: 'Conversion', values: byYear.map((r) => r.conversion_rate), color: SERIES[0] }]} />
        </ChartFrame>
        <Card padded>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-[14px] font-semibold text-ink">Internship outcomes</h3>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">{year || 'All cycles'} · {sum('interns').toLocaleString()} interns · {known.toLocaleString()} with a known PPO outcome</p>
            </div>
            <Select compact value={year} onChange={(e) => setYear(e.target.value)} aria-label="Academic year" className="w-40">
              <option value="">All cycles</option>
              {years.map((c) => <option key={c.academic_year} value={c.academic_year}>{c.academic_year}</option>)}
            </Select>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Started', sum('started')], ['Completed', sum('completed')], ['PPOs offered', received], ['Conversion', known ? `${((100 * received) / known).toFixed(1)}%` : '—']].map(([l, v]) => (
              <div key={l as string}><div className="text-[12px] text-ink-muted">{l}</div><div className="text-[20px] font-semibold text-ink">{typeof v === 'number' ? v.toLocaleString() : v}</div></div>
            ))}
          </div>
          <div className="mt-5">
            <StackedBar ariaLabel="Internship outcome breakdown" segments={[
              { key: 'accepted', label: 'PPO accepted', value: sum('ppo_accepted'), color: SERIES[0] },
              { key: 'offered', label: 'PPO offered, awaiting decision', value: received - sum('ppo_accepted') - sum('ppo_declined'), color: SERIES[1] },
              { key: 'declined', label: 'PPO declined', value: sum('ppo_declined'), color: SERIES[2] },
              { key: 'no', label: 'No PPO', value: sum('no_ppo'), color: SERIES[3] },
              { key: 'pending', label: 'Decision pending', value: sum('pending'), color: DEEMPH, onColor: '#17211B' },
              { key: 'unknown', label: 'Not recorded', value: sum('unknown'), color: DEEMPH_LIGHT, onColor: '#17211B' },
            ]} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Conversion breakdown"
          description={by === 'year' ? 'Every cycle in the data.' : `${year || 'All cycles'} · groups with few known outcomes can swing a lot.`}
          actions={<>
            <Segmented label="Group by" value={by} onChange={setBy} size="sm"
              options={[{ value: 'company', label: 'Company' }, { value: 'department', label: 'Department' }, { value: 'year', label: 'Year' }]} />
          </>} />
        <Table caption={`PPO conversion by ${by}`}>
          <thead><tr>
            <Th>{by === 'company' ? 'Company' : by === 'department' ? 'Department' : 'Year'}</Th>
            <Th align="right">Interns</Th><Th align="right">Completed</Th><Th align="right">PPOs offered</Th><Th align="right">Accepted</Th>
            <Th align="right">Declined</Th><Th align="right">No PPO</Th><Th align="right">Pending</Th><Th align="right">Not recorded</Th><Th align="right">Conversion</Th>
          </tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.company ?? r.department ?? r.year}>
                <Td className="font-medium">{r.company ?? r.department ?? r.year}{r.known > 0 && r.known < 3 && <span className="ml-1.5 text-[11px] font-normal text-warn-ink">small sample</span>}</Td>
                <Td align="right">{r.interns}</Td><Td align="right">{r.completed}</Td><Td align="right">{r.ppo_offered}</Td><Td align="right">{r.ppo_accepted}</Td>
                <Td align="right">{r.ppo_declined}</Td><Td align="right">{r.no_ppo}</Td><Td align="right">{r.pending}</Td><Td align="right">{r.unknown}</Td>
                <Td align="right" className="font-medium">{fmtPct(r.conversion_rate)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
