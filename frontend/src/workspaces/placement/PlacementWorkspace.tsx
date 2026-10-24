import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Building2, CalendarRange, FileSpreadsheet, GraduationCap, LayoutDashboard, MessageSquareText, Network, Repeat, Settings2, Sparkles, Workflow,
} from 'lucide-react';
import { placementApi } from '../../api/platform';
import { useAsync } from '../../lib/hooks';
import { roleAtLeast } from '../../lib/workspaceTypes';
import { useToast } from '../../lib/toast';
import { errorMessage } from '../../lib/http';
import type { WorkspaceModuleProps } from '../types';
import { TabBar, useTab } from '../../components/ui/Tabs';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Checkbox, Select } from '../../components/ui/Form';
import { EmptyState, ErrorState, Notice, SkeletonCard } from '../../components/ui/Feedback';
import { WelcomePanel } from '../../components/workspace/WelcomePanel';
import AnalysisGraphPanel from '../../components/kb/AnalysisGraphPanel';
import { PlacementOverview } from './PlacementOverview';
import { YearsView } from './YearsView';
import { PipelineView } from './PipelineView';
import { PpoView } from './PpoView';
import { CompaniesView } from './CompaniesView';
import { StudentsView } from './StudentsView';
import { PlacementAssistant } from './PlacementAssistant';
import { ImportView } from './ImportView';
import { PlacementSettings } from './PlacementSettings';
import { CycleBadge, cycleLabel } from './shared';

const TABS = ['overview', 'years', 'pipeline', 'ppo', 'companies', 'students', 'graph', 'assistant', 'import', 'settings'] as const;
type Tab = typeof TABS[number];

export default function PlacementWorkspace({ ws }: WorkspaceModuleProps) {
  const [tab, setTab] = useTab<Tab>(TABS, 'overview');
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const yearParam = params.get('year');
  const overview = useAsync(() => placementApi.overview(ws.id, yearParam), [ws.id, yearParam]);
  const companies = useAsync(() => placementApi.companies(ws.id), [ws.id]);
  const [loading, setLoading] = useState(false);
  const o = overview.data;
  const canImport = roleAtLeast(ws.role, 'analyst');
  const setYear = (y: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('year', y); return n; });
  const refresh = () => { overview.reload(); companies.reload(); };
  const hasData = !!o && o.counts.records + o.counts.students > 0;

  const loadSamples = async () => {
    setLoading(true);
    try {
      await placementApi.loadSamples(ws.id);
      toast.success('Sample placement records imported.');
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const needsData = (node: React.ReactNode) => {
    if (overview.error && !o) return <Card><ErrorState message={overview.error} onRetry={overview.reload} /></Card>;
    if (!o) return <div className="grid gap-4 md:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;
    if (!hasData) {
      return (
        <Card>
          <EmptyState icon={<GraduationCap />} title="No placement records yet"
            actions={canImport && <>
              <Button icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => setTab('import')}>Import records</Button>
              <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={loading} onClick={loadSamples}>Load fictional sample data</Button>
            </>}>
            Import a student roster (the denominators) and application records (stages, offers, internships and PPOs) from CSV or Excel.
            {!canImport && ' An analyst or owner needs to import them.'}
          </EmptyState>
        </Card>
      );
    }
    return node;
  };

  return (
    <div>
      <WelcomePanel ws={ws} onLoaded={() => { refresh(); setTab('overview'); }} onUpload={() => setTab('import')} />
      <TabBar label="Placement workspace sections" active={tab} className="mb-5" onChange={(k) => setTab(k)} items={[
        { key: 'overview', label: 'Overview', icon: <LayoutDashboard /> },
        { key: 'years', label: 'Academic years', icon: <CalendarRange /> },
        { key: 'pipeline', label: 'Pipeline', icon: <Workflow /> },
        { key: 'ppo', label: 'Internships & PPOs', icon: <Repeat /> },
        { key: 'companies', label: 'Companies', icon: <Building2 /> },
        { key: 'students', label: 'Students', icon: <GraduationCap />, hidden: !o?.can_see_students },
        { key: 'graph', label: 'Graph', icon: <Network /> },
        { key: 'assistant', label: 'Assistant', icon: <MessageSquareText /> },
        { key: 'import', label: 'Import', icon: <FileSpreadsheet />, hidden: !canImport },
        { key: 'settings', label: 'Settings', icon: <Settings2 /> },
      ]} />

      {o?.sample_data && tab !== 'import' && (
        <Notice tone="warn" className="mb-4" title="Fictional sample data">
          This workspace contains the generated sample records shipped with Hypnexis. They describe no real institution, company or student.
        </Notice>
      )}

      {tab === 'overview' && needsData(o?.metrics && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-ink-muted">Academic year
              <Select compact value={o.selected_year ?? ''} onChange={(e) => setYear(e.target.value)} className="w-44">
                {o.years.map((c) => <option key={c.academic_year} value={c.academic_year}>{cycleLabel(c)}</option>)}
              </Select>
            </label>
            <CycleBadge cycle={o.metrics.cycle} />
            <span className="text-[12.5px] text-ink-muted">{o.counts.students.toLocaleString()} roster rows · {o.counts.records.toLocaleString()} application records in total</span>
          </div>
          <div className={overview.loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <PlacementOverview data={o} onTab={(t) => setTab(t as Tab)} />
          </div>
        </>
      ))}
      {tab === 'years' && needsData(<YearsView wsId={ws.id} ctcUnit={o?.config.ctc_unit ?? ''} />)}
      {tab === 'pipeline' && needsData(o && <PipelineView wsId={ws.id} years={o.years} year={o.selected_year} setYear={setYear} companies={companies.data?.companies ?? []} />)}
      {tab === 'ppo' && needsData(o && <PpoView wsId={ws.id} years={o.years} />)}
      {tab === 'companies' && needsData(
        companies.data ? <CompaniesView companies={companies.data.companies} years={companies.data.years} ongoing={companies.data.ongoing} ctcUnit={o?.config.ctc_unit ?? ''} />
          : companies.error ? <Card><ErrorState message={companies.error} onRetry={companies.reload} /></Card> : <SkeletonCard lines={6} />,
      )}
      {tab === 'students' && needsData(o && <StudentsView wsId={ws.id} canSee={o.can_see_students} years={o.years} year={o.selected_year} setYear={setYear} />)}
      {tab === 'graph' && needsData(o && <PlacementGraph wsId={ws.id} years={o.years.map((c) => c.academic_year)} canSeeStudents={o.can_see_students} />)}
      {tab === 'assistant' && <PlacementAssistant wsId={ws.id} onTab={(t) => setTab(t as Tab)} initial={params.get('q') ?? undefined} />}
      {tab === 'import' && <ImportView wsId={ws.id} canImport={canImport} onImported={refresh} />}
      {tab === 'settings' && (o
        ? <PlacementSettings wsId={ws.id} config={o.config} cycles={o.years} isOwner={ws.role === 'owner'} onSaved={refresh} />
        : <SkeletonCard lines={6} />)}
    </div>
  );
}

function PlacementGraph({ wsId, years, canSeeStudents }: { wsId: string; years: string[]; canSeeStudents: boolean }) {
  const [year, setYear] = useState('');
  const [students, setStudents] = useState(false);
  const g = useAsync(() => placementApi.graph(wsId, year || null, students), [wsId, year, students]);
  return (
    <div className="space-y-3">
      <Notice tone="neutral">
        Companies, departments and academic years, connected only where records support it: a company recruited in a year, made offers to a department, or hosted its interns.
        Colours group companies by industry. Select an edge to see the counts behind it.
      </Notice>
      {g.error && !g.data ? <Card><ErrorState message={g.error} onRetry={g.reload} /></Card> : (
        <AnalysisGraphPanel key={`${year}-${students}`} graph={g.data ?? null} className="h-[calc(100vh-22rem)] min-h-[520px]"
          emptyHint={g.loading ? 'Building the placement graph…' : 'No records for this selection.'}
          toolbar={<>
            <Select compact value={year} onChange={(e) => setYear(e.target.value)} aria-label="Academic year" className="w-40">
              <option value="">All cycles</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            {canSeeStudents && <Checkbox label="Show students" checked={students} onChange={(e) => setStudents(e.target.checked)} />}
            {g.data?.truncated && <span className="text-[12px] text-warn-ink">Showing the {g.data.scope?.student_limit} students with the most offers and internships.</span>}
          </>} />
      )}
    </div>
  );
}

