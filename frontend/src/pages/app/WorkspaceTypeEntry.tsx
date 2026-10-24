import { useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Plus, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useDocumentTitle } from '../../lib/hooks';
import { useCreateWorkspace } from '../../lib/useCreateWorkspace';
import { ROLE_LABEL, TYPE_INFO, isWorkspaceType } from '../../lib/workspaceTypes';
import { timeAgo } from '../../lib/format';
import type { WorkspaceType } from '../../types/platform';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Form';
import { NotFound } from '../PublicPages';

const WHAT_YOU_GET: Record<WorkspaceType, string[]> = {
  corporate: [
    'Revenue, profit, cash flow, debt and margin figures, each with period, currency, source and page',
    'Disclosed risks kept separate from rule-based flags inferred from the figures',
    'A CFO assistant that answers from your reports, with citations',
    'A company knowledge graph of metrics, segments, periods and risks',
  ],
  research: [
    'Problem, objectives, method, data, findings and limitations extracted per paper, with sections',
    'Side-by-side comparison where each column quotes only its own paper',
    'Related papers by text similarity and shared concepts',
    'A concept graph and a research assistant grounded in your library',
  ],
  legal: [
    'Describe a situation and get the provisions that may apply, never presented as definitely applying',
    'Obligations, conditions, exceptions, deadlines and penalties quoted from the text',
    'Jurisdiction, issuing authority, effective date and last-verified date for each source',
    'A provision graph showing definitions, cross-references and exemptions',
  ],
  placement: [
    'CSV or Excel import with column mapping, validation, duplicate checks and a preview before anything is saved',
    'Placement rate, offers, PPO conversion and CTC, each with its definition and calculation',
    'Academic-year comparison that never mixes ongoing and completed cycles unmarked',
    'Funnel, company and student views, with student records restricted to analysts and owners',
  ],
};

export default function WorkspaceTypeEntry() {
  const { type } = useParams();
  const { workspaces } = useAuth();
  const loc = useLocation();
  const { create, creating } = useCreateWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const info = isWorkspaceType(type) ? TYPE_INFO[type] : null;
  useDocumentTitle(info?.label ?? 'Not found');
  if (!info) return <NotFound />;

  const mine = workspaces.filter((w) => w.type === info.type);
  if (mine.length === 1) return <Navigate to={`/app/w/${mine[0].id}${loc.search}`} replace />;

  return (
    <Page>
      <PageHeader icon={<info.icon />} title={info.label} description={info.tagline} />
      {mine.length > 1 && (
        <section className="mt-6">
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Your {info.short.toLowerCase()} workspaces</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((w) => (
              <Link key={w.id} to={`/app/w/${w.id}`} className="group rounded-xl border border-line bg-white p-4 transition-colors hover:border-brand-300">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[14.5px] font-semibold text-ink">{w.name}</h3>
                  {w.role && <Badge tone={w.role === 'owner' ? 'brand' : 'neutral'}>{ROLE_LABEL[w.role]}</Badge>}
                </div>
                {w.description && <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{w.description}</p>}
                <p className="mt-3 flex items-center gap-3 text-[12px] text-ink-muted">
                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {w.member_count ?? 1}</span>
                  <span>Created {timeAgo(w.created_at)}</span>
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand-700">Open <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card padded>
          <h2 className="text-[15px] font-semibold text-ink">{mine.length ? 'Create another workspace' : `Set up ${info.label}`}</h2>
          <p className="mt-1 text-[13.5px] text-ink-muted">
            A workspace has its own documents{info.type === 'placement' ? ', placement records' : ''}, knowledge graph and members. Only the people you invite can see it.
          </p>
          <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); create(info.type, name.trim() || undefined, description.trim() || undefined); }}>
            <Field label="Workspace name" hint={`Leave blank to call it “${info.label}”.`}>
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
                placeholder={info.type === 'placement' ? 'e.g. Training & Placement Cell 2025–26' : info.type === 'corporate' ? 'e.g. Board pack FY2024' : ''} />}
            </Field>
            <Field label="Description" hint="Optional. Up to 500 characters.">
              {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />}
            </Field>
            <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={creating === info.type}>Create workspace</Button>
          </form>
        </Card>
        <div className="lg:border-l lg:border-line lg:pl-8">
          <h2 className="text-[15px] font-semibold text-ink">What you get</h2>
          <ul className="mt-3 space-y-2.5">
            {WHAT_YOU_GET[info.type].map((x) => (
              <li key={x} className="flex gap-2 text-[13.5px] leading-relaxed text-ink-soft"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{x}</li>
            ))}
          </ul>
          <p className="mt-4 text-[12.5px] text-ink-muted">Designed for {info.audience.toLowerCase()}. Sample set: {info.sampleNote}</p>
        </div>
      </div>
    </Page>
  );
}
