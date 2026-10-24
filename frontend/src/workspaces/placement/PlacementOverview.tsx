import { Database, Settings2 } from 'lucide-react';
import type { PlacementOverview as Data } from '../../types/platform';
import { fmtPct } from '../../lib/format';
import { Card, CardHeader, KeyValue } from '../../components/ui/Card';
import { Notice } from '../../components/ui/Feedback';
import { Table, Td, Th } from '../../components/ui/Table';
import { ChartFrame } from '../../components/charts/ChartFrame';
import { BarList } from '../../components/charts/Bars';
import { KpiTile } from './shared';

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Placement outcomes', keys: ['eligible_students', 'registered_students', 'students_placed', 'placement_rate'] },
  { title: 'Offers', keys: ['total_offers', 'unique_students_with_offers', 'offers_pending_decision', 'ctc_average', 'ctc_median', 'ctc_highest'] },
  { title: 'Internships and PPOs', keys: ['internship_offers', 'interns', 'ppo_offers', 'ppo_conversion_rate'] },
  { title: 'Recruiters and activity', keys: ['companies_participating', 'returning_companies', 'active_processes', 'students_awaiting_results'] },
];

export function PlacementOverview({ data, onTab }: { data: Data; onTab: (t: string) => void }) {
  const m = data.metrics!;
  const policy = m.policy;
  const depts = data.departments.filter((d) => d.group > 0 || d.offers > 0);
  return (
    <div className="space-y-6">
      {m.cycle.status === 'ongoing' && (
        <Notice tone="info" title={`${m.cycle.academic_year} is still in progress`}>
          Totals for this cycle are partial. Don’t compare them directly with completed cycles. The Academic years tab has an equivalent-date comparison.
        </Notice>
      )}
      {GROUPS.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">{g.title}</h2>
          <div className={`grid gap-3 sm:grid-cols-2 ${g.keys.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3 2xl:grid-cols-6'}`}>
            {g.keys.map((k) => <KpiTile key={k} k={m.kpis[k]} />)}
          </div>
        </section>
      ))}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ChartFrame title="Placement rate by department" subtitle={`Placed ÷ ${policy.denominator} students in each department · ${m.cycle.academic_year}`}
          table={{ columns: ['Department', 'Roster', policy.denominator === 'registered' ? 'Registered' : 'Eligible', 'Placed', 'Unplaced', 'In process', 'Offers', 'Placement rate'],
            rows: depts.map((d) => [d.department, d.roster, d.group, d.placed, d.unplaced, d.in_process, d.offers, fmtPct(d.placement_rate)]) }}
          footnote="Unplaced students who are still in a recruitment process are counted separately so ongoing cycles aren’t read as failures.">
          {depts.length ? (
            <BarList ariaLabel="Placement rate by department" format={(v) => fmtPct(v)} max={100}
              rows={depts.map((d) => ({ key: d.department, label: d.department, value: d.placement_rate, detail: `${d.placed} of ${d.group}` }))} />
          ) : <p className="text-[13px] text-ink-muted">Import a student roster to compute department placement rates.</p>}
        </ChartFrame>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Unplaced students by department" description="In the denominator group, without a qualifying offer." />
            <Table caption="Unplaced students by department">
              <thead><tr><Th>Department</Th><Th align="right">Unplaced</Th><Th align="right">Still in process</Th></tr></thead>
              <tbody>
                {[...depts].sort((a, b) => b.unplaced - a.unplaced).slice(0, 8).map((d) => (
                  <tr key={d.department}><Td>{d.department}</Td><Td align="right">{d.unplaced}</Td><Td align="right">{d.in_process}</Td></tr>
                ))}
              </tbody>
            </Table>
            {data.can_see_students && (
              <button onClick={() => onTab('students')} className="px-5 py-3 text-[13px] font-medium text-brand-700 hover:underline">See students who need attention</button>
            )}
          </Card>
          <Card>
            <CardHeader title="Data quality and policy" icon={<Database className="h-4 w-4" />}
              actions={data.role === 'owner' && <button onClick={() => onTab('settings')} className="flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline"><Settings2 className="h-3.5 w-3.5" /> Settings</button>} />
            <dl className="grid grid-cols-2 gap-4 px-5 py-4">
              <KeyValue label="Records this cycle">{m.data_quality.records.toLocaleString()}</KeyValue>
              <KeyValue label="Roster students">{m.data_quality.roster_students.toLocaleString()}</KeyValue>
              <KeyValue label="Unknown outcomes">{m.data_quality.unknown_outcomes.toLocaleString()} <span className="text-ink-muted">(never counted as failures)</span></KeyValue>
              <KeyValue label="Students not in roster">{m.data_quality.students_not_in_roster ?? '—'}</KeyValue>
              <KeyValue label="Offers with a date">{m.data_quality.dated_offers} of {m.data_quality.offers}</KeyValue>
              <KeyValue label="Denominator">{policy.denominator === 'registered' ? 'Registered students' : 'Eligible students'}</KeyValue>
              <KeyValue label="Counts as placed">{policy.placed_definition === 'offer_accepted' ? 'Accepted offers only' : 'Offer received (accepted or awaiting decision)'}</KeyValue>
              <KeyValue label="PPOs count as placement">{policy.count_ppo_as_placement ? 'Yes' : 'No'}</KeyValue>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
