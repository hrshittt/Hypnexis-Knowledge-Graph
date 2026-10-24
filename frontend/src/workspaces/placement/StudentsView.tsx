import { useState } from 'react';
import { Lock, TriangleAlert } from 'lucide-react';
import { placementApi } from '../../api/platform';
import { useAsync, useDebounced } from '../../lib/hooks';
import type { Cycle } from '../../types/platform';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Checkbox, SearchInput, Select } from '../../components/ui/Form';
import { EmptyState, ErrorState, Notice, Skeleton } from '../../components/ui/Feedback';
import { Pagination, Table, Td, Th } from '../../components/ui/Table';
import { INTERN_LABEL, PPO_LABEL, STATUS_LABEL, cycleLabel } from './shared';

const STATUS_TONE: Record<string, 'brand' | 'info' | 'warn' | 'neutral' | 'danger'> = {
  placed: 'brand', offer_pending: 'info', in_process: 'info', offers_declined: 'neutral', no_active_process: 'warn',
  not_placed: 'neutral', no_applications: 'warn',
};

export function StudentsView({ wsId, canSee, years, year, setYear }: {
  wsId: string; canSee: boolean; years: Cycle[]; year: string | null; setYear: (y: string) => void;
}) {
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [attention, setAttention] = useState(false);
  const [page, setPage] = useState(1);
  const dq = useDebounced(q, 300);
  const res = useAsync(() => placementApi.students(wsId, { year, q: dq, department: department || undefined, status: status || undefined, attention, page, page_size: 25 }),
    [wsId, year, dq, department, status, attention, page], canSee);
  const d = res.data;

  if (!canSee) {
    return (
      <Card>
        <EmptyState icon={<Lock />} title="Student-level records are restricted">
          Only workspace members with the analyst or owner role can see individual student records. Aggregate metrics are on the other tabs.
        </EmptyState>
      </Card>
    );
  }
  const reset = (f: () => void) => { f(); setPage(1); };

  return (
    <div className="space-y-4">
      <Notice tone="neutral" icon={<Lock className="h-4 w-4" />}>
        Students are identified only by your institution’s ID. Names, contact details and sensitive characteristics are never imported,
        and these records must not be used to rank students. Only analysts and owners can see this page.
      </Notice>
      <div className="flex flex-wrap items-center gap-2">
        <Select compact value={year ?? ''} onChange={(e) => reset(() => setYear(e.target.value))} aria-label="Academic year" className="w-44">
          {years.map((c) => <option key={c.academic_year} value={c.academic_year}>{cycleLabel(c)}</option>)}
        </Select>
        <SearchInput value={q} onChange={(v) => reset(() => setQ(v))} placeholder="Search student ID" compact className="w-52" />
        <Select compact value={department} onChange={(e) => reset(() => setDepartment(e.target.value))} aria-label="Department" className="w-48">
          <option value="">All departments</option>
          {d?.departments.map((x) => <option key={x} value={x}>{x}</option>)}
        </Select>
        <Select compact value={status} onChange={(e) => reset(() => setStatus(e.target.value))} aria-label="Status" className="w-48">
          <option value="">Any status</option>
          {d?.statuses.map((x) => <option key={x} value={x}>{STATUS_LABEL[x] ?? x}</option>)}
        </Select>
        <Checkbox label="Needs intervention" checked={attention} onChange={(e) => reset(() => setAttention(e.target.checked))} />
      </div>
      <Card>
        <CardHeader title="Students" description={d ? `${d.total.toLocaleString()} student${d.total === 1 ? '' : 's'} in ${d.academic_year ?? 'this cycle'}` : undefined} />
        {res.error && !d ? <ErrorState message={res.error} onRetry={res.reload} />
          : !d ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
          : !d.rows.length ? <EmptyState compact title="No students match">Change the filters, or import a roster for this cycle.</EmptyState>
          : (
            <div className={res.loading ? 'opacity-60' : ''}>
              <Table caption="Student placement status">
                <thead><tr>
                  <Th>Student ID</Th><Th>Department</Th><Th className="hidden md:table-cell" align="right">Graduation</Th>
                  <Th className="hidden lg:table-cell">Eligible</Th><Th className="hidden lg:table-cell">Registered</Th>
                  <Th align="right">Applications</Th><Th align="right">Offers</Th><Th className="hidden xl:table-cell">Furthest stage</Th>
                  <Th className="hidden xl:table-cell">Internship</Th><Th className="hidden xl:table-cell">PPO</Th><Th>Status</Th>
                </tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.student_id}>
                      <Td className="font-mono text-[12.5px]">{r.student_id}{!r.in_roster && <span className="ml-1.5 font-sans text-[11px] text-warn-ink" title="Has records but isn't in the roster for this cycle">not in roster</span>}</Td>
                      <Td>{r.department ?? '—'}</Td>
                      <Td className="hidden md:table-cell" align="right">{r.graduation_year ?? '—'}</Td>
                      <Td className="hidden lg:table-cell">{r.eligible === null ? '—' : r.eligible ? 'Yes' : 'No'}</Td>
                      <Td className="hidden lg:table-cell">{r.registered === null ? '—' : r.registered ? 'Yes' : 'No'}</Td>
                      <Td align="right">{r.applications}</Td>
                      <Td align="right">{r.offers}</Td>
                      <Td className="hidden xl:table-cell">{r.furthest_stage ?? '—'}</Td>
                      <Td className="hidden xl:table-cell">{r.internship_status ? INTERN_LABEL[r.internship_status] ?? r.internship_status : '—'}</Td>
                      <Td className="hidden xl:table-cell">{r.ppo_status ? PPO_LABEL[r.ppo_status] ?? r.ppo_status : '—'}</Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                          {r.needs_attention && <TriangleAlert className="h-3.5 w-3.5 text-warn" aria-label="Needs intervention: in the placement group with no active process" />}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="px-4"><Pagination page={d.page} pageSize={d.page_size} total={d.total} onPage={setPage} /></div>
            </div>
          )}
      </Card>
      <p className="text-[12px] text-ink-muted">“Needs intervention” = in the placement group of an ongoing cycle with no applications or no active process. It is a prompt for coordinators, not a judgement about the student.</p>
    </div>
  );
}
