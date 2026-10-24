import type { Cycle, Kpi } from '../../types/platform';
import { StatTile } from '../../components/ui/StatTile';
import { Badge } from '../../components/ui/Badge';

export const KPI_LABEL: Record<string, string> = {
  eligible_students: 'Eligible students',
  registered_students: 'Registered for placements',
  students_placed: 'Students placed',
  placement_rate: 'Placement rate',
  total_offers: 'Total offers',
  unique_students_with_offers: 'Unique students with offers',
  internship_offers: 'Internship offers',
  interns: 'Interns',
  ppo_offers: 'PPO offers',
  ppo_conversion_rate: 'Internship-to-PPO conversion',
  companies_participating: 'Companies participating',
  returning_companies: 'Returning companies',
  ctc_average: 'Average CTC',
  ctc_median: 'Median CTC',
  ctc_highest: 'Highest CTC',
  offers_pending_decision: 'Offers pending decision',
  students_awaiting_results: 'Students awaiting results',
  active_processes: 'Recruitment processes active',
};

export const STATUS_LABEL: Record<string, string> = {
  placed: 'Placed', offer_pending: 'Offer pending', offers_declined: 'Offers declined', in_process: 'In process',
  no_active_process: 'No active process', not_placed: 'Not placed', no_applications: 'No applications',
};

export const PPO_LABEL: Record<string, string> = {
  accepted: 'PPO accepted', offered: 'PPO offered', declined: 'PPO declined', no_offer: 'No PPO', pending: 'Pending', unknown: 'Not recorded',
};

export const INTERN_LABEL: Record<string, string> = {
  completed: 'Completed', ongoing: 'Ongoing', not_started: 'Not started', terminated: 'Terminated', unknown: 'Not recorded',
};

export function fmtKpi(k: Pick<Kpi, 'value' | 'unit'>): string {
  if (k.value === null || k.value === undefined) return '—';
  if (k.unit === '%') return `${k.value.toFixed(1)}%`;
  const n = Number.isInteger(k.value) ? k.value.toLocaleString() : k.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return k.unit ? `${n} ${k.unit}` : n;
}

export function KpiTile({ k }: { k: Kpi | undefined }) {
  if (!k) return null;
  const label = KPI_LABEL[k.key] ?? k.key;
  const ratio = k.numerator !== null && k.denominator !== null && k.unit === '%'
    ? `${k.numerator.toLocaleString()} of ${k.denominator.toLocaleString()}`
    : k.key === 'returning_companies' && k.denominator ? `of ${k.denominator} participating` : null;
  return (
    <StatTile label={label} value={fmtKpi(k)} unavailable={k.available ? null : (k.note ?? 'Not enough data to compute this.')}
      sub={ratio} definition={<>
        <p>{k.definition}</p>
        {k.numerator !== null && k.denominator !== null && <p className="mt-1.5 font-medium text-ink">Here: {k.numerator.toLocaleString()} ÷ {k.denominator.toLocaleString()}</p>}
        {k.key.startsWith('ctc_') && k.denominator !== null && <p className="mt-1.5">Based on {k.denominator} offer(s) with a CTC value.</p>}
      </>}
      footer={k.available && k.note ? <p className="text-[11.5px] leading-snug text-ink-muted">{k.note}</p> : undefined} />
  );
}

export function CycleBadge({ cycle }: { cycle: Cycle | undefined }) {
  if (!cycle) return null;
  return cycle.status === 'ongoing'
    ? <Badge tone="info" title={`Starts ${cycle.start_date}${cycle.status_source === 'default' ? ' (default)' : ''}`}>Ongoing · partial</Badge>
    : <Badge tone="outline">Completed</Badge>;
}

export const cycleLabel = (c: Cycle) => `${c.academic_year}${c.status === 'ongoing' ? ' (ongoing)' : ''}`;
