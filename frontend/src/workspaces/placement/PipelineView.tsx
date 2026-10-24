import { useState } from 'react';
import { placementApi } from '../../api/platform';
import { useAsync } from '../../lib/hooks';
import { fmtPct } from '../../lib/format';
import type { CompanyProfile, Cycle } from '../../types/platform';
import { Card, CardHeader } from '../../components/ui/Card';
import { Segmented, Select } from '../../components/ui/Form';
import { EmptyState, ErrorState, Notice, SkeletonCard } from '../../components/ui/Feedback';
import { Table, Td, Th } from '../../components/ui/Table';
import { ChartFrame } from '../../components/charts/ChartFrame';
import { FunnelChart } from '../../components/charts/Bars';
import { cycleLabel } from './shared';

export function PipelineView({ wsId, years, year, setYear, companies }: {
  wsId: string; years: Cycle[]; year: string | null; setYear: (y: string) => void; companies: CompanyProfile[];
}) {
  const [type, setType] = useState<'full_time' | 'internship'>('full_time');
  const [company, setCompany] = useState('');
  const f = useAsync(() => placementApi.funnel(wsId, year, type, company || null), [wsId, year, type, company]);
  const d = f.data;
  const label = (key?: string | null) => d?.stages.find((s) => s.key === key)?.label;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select compact value={year ?? ''} onChange={(e) => setYear(e.target.value)} aria-label="Academic year" className="w-44">
          {years.map((c) => <option key={c.academic_year} value={c.academic_year}>{cycleLabel(c)}</option>)}
        </Select>
        <Segmented label="Opportunity type" value={type} onChange={setType} options={[{ value: 'full_time', label: 'Full-time' }, { value: 'internship', label: 'Internships' }]} />
        <Select compact value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company" className="w-56">
          <option value="">All companies</option>
          {companies.map((c) => <option key={c.company_norm} value={c.company_norm}>{c.company}</option>)}
        </Select>
      </div>
      {f.error && !d ? <Card><ErrorState message={f.error} onRetry={f.reload} /></Card>
        : !d ? <SkeletonCard lines={6} />
        : !d.applications ? <Card><EmptyState compact title="No applications for this selection">Try another cycle, type or company.</EmptyState></Card>
        : (
          <div className={`space-y-5 ${f.loading ? 'opacity-60' : ''}`}>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <ChartFrame title="Recruitment funnel" subtitle={`${d.applications.toLocaleString()} applications by the furthest stage reached · ${d.academic_year}`}
                table={{ columns: ['Stage', 'Reached', 'Progressed', 'Rejected', 'Withdrawn', 'Pending', 'Unknown', 'Continue rate', 'Rejection rate'],
                  rows: d.stages.map((s) => [s.label, s.tracked ? s.reached : null, s.progressed, s.rejected, s.withdrawn, s.pending, s.unknown, fmtPct(s.conversion_to_next), fmtPct(s.rejection_rate)]) }}
                footnote={d.note}>
                <FunnelChart ariaLabel="Recruitment funnel" steps={d.stages.map((s) => ({
                  key: s.key, label: s.label, value: s.reached, tracked: s.tracked, conversion: s.conversion_to_next,
                  note: s.rejected || s.withdrawn ? `${s.rejected} rejected, ${s.withdrawn} withdrew here` : undefined,
                  flag: s.key === d.largest_drop_off ? 'Largest drop-off' : s.key === d.highest_rejection_rate ? 'Highest rejection rate' : undefined,
                }))} />
              </ChartFrame>
              <div className="space-y-4">
                <Card padded>
                  <p className="text-[12.5px] font-medium text-ink-muted">Largest drop-off</p>
                  <p className="mt-1 text-[18px] font-semibold text-ink">{label(d.largest_drop_off) ?? 'None'}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-muted">Most applications rejected or withdrawn at this stage.</p>
                </Card>
                <Card padded>
                  <p className="text-[12.5px] font-medium text-ink-muted">Highest rejection rate</p>
                  <p className="mt-1 text-[18px] font-semibold text-ink">{label(d.highest_rejection_rate) ?? 'None'}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-muted">Rejected ÷ applications that reached the stage, excluding unknown outcomes.</p>
                </Card>
                {d.stage_durations && !d.stage_durations.available && <Notice tone="neutral" title="Time spent in each stage">{d.stage_durations.note}</Notice>}
                {(d.without_stage ?? 0) > 0 && <Notice tone="warn">{d.without_stage} application(s) have no stage recorded and are not in the funnel.</Notice>}
              </div>
            </div>
            <Card>
              <CardHeader title="Stage details" description="Pending and unknown outcomes are shown separately and never counted as rejections." />
              <Table caption="Recruitment stage details">
                <thead><tr><Th>Stage</Th><Th align="right">Reached</Th><Th align="right">Progressed</Th><Th align="right">Rejected</Th><Th align="right">Withdrew</Th><Th align="right">Pending</Th><Th align="right">Unknown</Th><Th align="right">Continue rate</Th><Th align="right">Rejection rate</Th></tr></thead>
                <tbody>
                  {d.stages.map((s) => (
                    <tr key={s.key} className={s.tracked ? '' : 'text-ink-faint'}>
                      <Td className="font-medium">{s.label}{!s.tracked && <span className="ml-1 text-[11.5px] font-normal">(not in data)</span>}</Td>
                      <Td align="right">{s.tracked ? s.reached : '—'}</Td><Td align="right">{s.progressed}</Td><Td align="right">{s.rejected}</Td>
                      <Td align="right">{s.withdrawn}</Td><Td align="right">{s.pending}</Td><Td align="right">{s.unknown}</Td>
                      <Td align="right">{fmtPct(s.conversion_to_next)}</Td><Td align="right">{fmtPct(s.rejection_rate)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>
        )}
    </div>
  );
}
