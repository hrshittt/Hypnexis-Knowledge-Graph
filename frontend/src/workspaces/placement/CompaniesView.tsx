import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Repeat, X } from 'lucide-react';
import type { CompanyProfile } from '../../types/platform';
import { fmtPct } from '../../lib/format';
import { Card, CardHeader, KeyValue } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select, SearchInput } from '../../components/ui/Form';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Drawer } from '../../components/ui/Overlay';
import { Table, Td, Th } from '../../components/ui/Table';
import { ChartFrame } from '../../components/charts/ChartFrame';
import { ColumnChart } from '../../components/charts/ColumnChart';
import { SERIES } from '../../components/charts/theme';

export function CompaniesView({ companies, years, ongoing, ctcUnit }: { companies: CompanyProfile[]; years: string[]; ongoing: string[]; ctcUnit: string }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<CompanyProfile | null>(null);
  const list = useMemo(() => companies.filter((c) =>
    (!query || `${c.company} ${c.industry ?? ''} ${c.roles.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    && (filter === 'all' || (filter === 'returning' ? c.returning : filter === 'active' ? c.status === 'hiring in progress' : c.status === filter))), [companies, query, filter]);
  const chosen = picked.map((k) => companies.find((c) => c.company_norm === k)).filter((c): c is CompanyProfile => !!c);
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= 3 ? p : [...p, k]));
  const unit = ctcUnit ? ` ${ctcUnit}` : '';

  if (!companies.length) return <Card><EmptyState compact title="No companies yet">Import application records to see company profiles.</EmptyState></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search companies, industries, roles" className="w-72" />
        <Select compact value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter companies" className="w-56">
          <option value="all">All companies</option>
          <option value="returning">Returning companies</option>
          <option value="active">Hiring in progress</option>
          <option value="process complete">Process complete this cycle</option>
          <option value="not in the current cycle">Not in the current cycle</option>
        </Select>
        <span className="text-[12.5px] text-ink-muted">Tick up to three companies to compare.</span>
      </div>

      {chosen.length >= 2 && (
        <Card>
          <CardHeader title="Company comparison" actions={<Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={() => setPicked([])}>Clear</Button>} />
          <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Table caption="Company comparison">
              <thead><tr><Th>Measure</Th>{chosen.map((c) => <Th key={c.company_norm} align="right">{c.company}</Th>)}</tr></thead>
              <tbody>
                {([
                  ['Recruitment years', (c: CompanyProfile) => c.years.length],
                  ['Offers (all cycles)', (c: CompanyProfile) => c.offers],
                  ['Interns', (c: CompanyProfile) => c.interns],
                  ['PPO conversion', (c: CompanyProfile) => fmtPct(c.ppo_conversion_rate)],
                  ['Selection rate (full-time)', (c: CompanyProfile) => fmtPct(c.selection_rate)],
                  ['Average CTC', (c: CompanyProfile) => (c.ctc_average === null ? '—' : `${c.ctc_average}${unit}`)],
                  ['Highest CTC', (c: CompanyProfile) => (c.ctc_highest === null ? '—' : `${c.ctc_highest}${unit}`)],
                  ['Current status', (c: CompanyProfile) => c.status],
                ] as const).map(([label, f]) => (
                  <tr key={label}><Td className="font-medium">{label}</Td>{chosen.map((c) => <Td key={c.company_norm} align="right">{f(c)}</Td>)}</tr>
                ))}
              </tbody>
            </Table>
            <ChartFrame title="Offers by academic year" legend={chosen.map((c, i) => ({ label: c.company, color: SERIES[i] }))}
              table={{ columns: ['Year', ...chosen.map((c) => c.company)], rows: years.map((y) => [y, ...chosen.map((c) => c.offers_by_year[y] ?? 0)]) }}>
              <ColumnChart categories={years} format={(v) => String(v)} ariaLabel="Offers by year for selected companies"
                dimmed={Object.fromEntries(ongoing.map((y) => [y, 'ongoing · partial']))}
                series={chosen.map((c, i) => ({ key: c.company_norm, label: c.company, color: SERIES[i], values: years.map((y) => c.offers_by_year[y] ?? 0) }))} />
            </ChartFrame>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Company intelligence" description={`${list.length} of ${companies.length} companies · offers count full-time offers including PPOs`} />
        <Table caption="Company profiles">
          <thead><tr>
            <Th><span className="sr-only">Compare</span></Th><Th>Company</Th><Th className="hidden lg:table-cell">Recruitment years</Th>
            <Th align="right">Offers</Th><Th align="right" className="hidden md:table-cell">Change</Th><Th align="right" className="hidden md:table-cell">PPO conversion</Th>
            <Th align="right" className="hidden xl:table-cell">Avg CTC</Th><Th>Status</Th>
          </tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.company_norm} className="hover:bg-canvas/60">
                <Td><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={picked.includes(c.company_norm)} onChange={() => toggle(c.company_norm)}
                  disabled={!picked.includes(c.company_norm) && picked.length >= 3} aria-label={`Compare ${c.company}`} /></Td>
                <Td>
                  <button onClick={() => setOpen(c)} className="text-left font-medium text-ink hover:underline">{c.company}</button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
                    {c.industry ?? 'Industry not recorded'}{c.returning && <Badge tone="brand" icon={<Repeat className="h-3 w-3" />}>Returning</Badge>}
                  </div>
                </Td>
                <Td className="hidden lg:table-cell"><div className="flex flex-wrap gap-1">{c.years.map((y) => <span key={y} className="rounded bg-canvas px-1.5 py-0.5 text-[11.5px] text-ink-soft">{y}</span>)}</div></Td>
                <Td align="right">{c.offers}</Td>
                <Td align="right" className="hidden md:table-cell"><OfferChange v={c.offers_change} /></Td>
                <Td align="right" className="hidden md:table-cell">{fmtPct(c.ppo_conversion_rate)}</Td>
                <Td align="right" className="hidden xl:table-cell">{c.ctc_average === null ? '—' : `${c.ctc_average}${unit}`}</Td>
                <Td><Badge tone={c.status === 'hiring in progress' ? 'info' : 'neutral'}>{c.status}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="px-5 py-3 text-[11.5px] text-ink-muted">Change compares offers in the latest cycle with the one before it; a partial ongoing cycle will usually show fewer offers.</p>
      </Card>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.company ?? ''} subtitle={open?.industry ?? 'Industry not recorded'}>
        {open && (
          <div className="space-y-5">
            {open.returning && <Notice tone="success">Returning recruiter: active in {open.years.length} cycles ({open.years.join(', ')}).</Notice>}
            <dl className="grid grid-cols-2 gap-4">
              <KeyValue label="Applications">{open.applications}</KeyValue>
              <KeyValue label="Full-time offers">{open.offers}</KeyValue>
              <KeyValue label="Internship offers">{open.internship_offers}</KeyValue>
              <KeyValue label="Interns">{open.interns}</KeyValue>
              <KeyValue label="PPOs offered">{open.ppo_offered} of {open.ppo_known} known outcomes</KeyValue>
              <KeyValue label="PPO conversion">{fmtPct(open.ppo_conversion_rate)}</KeyValue>
              <KeyValue label="Selection rate">{fmtPct(open.selection_rate)}</KeyValue>
              <KeyValue label="Open processes">{open.open_processes}</KeyValue>
              <KeyValue label="Average CTC">{open.ctc_average === null ? 'No CTC data' : `${open.ctc_average}${unit}`}</KeyValue>
              <KeyValue label="Highest CTC">{open.ctc_highest === null ? 'No CTC data' : `${open.ctc_highest}${unit}`}</KeyValue>
            </dl>
            <div><h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Roles offered</h3><p className="mt-1 text-[13px] text-ink">{open.roles.join(', ') || 'Not recorded'}</p></div>
            <div><h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Departments targeted</h3><p className="mt-1 text-[13px] text-ink">{open.departments.join(', ') || 'Not recorded'}</p></div>
            <div>
              <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Offers by academic year</h3>
              <Table caption="Offers by academic year">
                <thead><tr><Th>Year</Th><Th align="right">Offers</Th></tr></thead>
                <tbody>{years.map((y) => <tr key={y}><Td>{y}{ongoing.includes(y) ? ' (ongoing)' : ''}</Td><Td align="right">{open.offers_by_year[y] ?? (open.years.includes(y) ? 0 : '—')}</Td></tr>)}</tbody>
              </Table>
            </div>
            <p className="text-[12px] text-ink-muted">All figures come from your imported records. Paheli doesn’t add outside data about companies.</p>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function OfferChange({ v }: { v: number | null }) {
  if (v === null) return <span className="text-ink-faint">—</span>;
  if (v === 0) return <span className="text-ink-muted">0</span>;
  return v > 0
    ? <span className="inline-flex items-center gap-0.5 text-brand-700"><ArrowUpRight className="h-3.5 w-3.5" />+{v}</span>
    : <span className="inline-flex items-center gap-0.5 text-danger-ink"><ArrowDownRight className="h-3.5 w-3.5" />{v}</span>;
}
