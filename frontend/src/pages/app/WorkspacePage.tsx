import { Suspense, lazy } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Settings2, Users } from 'lucide-react';
import { workspacesApi } from '../../api/platform';
import { useAuth } from '../../lib/auth';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { ROLE_HELP, ROLE_LABEL, TYPE_INFO } from '../../lib/workspaceTypes';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Form';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { Card } from '../../components/ui/Card';

const CorporateWorkspace = lazy(() => import('../../workspaces/corporate/CorporateWorkspace'));
const ResearchWorkspace = lazy(() => import('../../workspaces/research/ResearchWorkspace'));
const LegalWorkspace = lazy(() => import('../../workspaces/legal/LegalWorkspace'));
const PlacementWorkspace = lazy(() => import('../../workspaces/placement/PlacementWorkspace'));

export default function WorkspacePage() {
  const { workspaceId = '' } = useParams();
  const { workspaces } = useAuth();
  const nav = useNavigate();
  const q = useAsync(() => workspacesApi.get(workspaceId), [workspaceId]);
  const ws = q.data && q.data.id === workspaceId ? q.data : undefined;
  useDocumentTitle(ws?.name ?? 'Workspace');

  if (q.error && !ws) {
    const notFound = q.error.toLowerCase().includes('not found');
    return (
      <Page>
        <Card>{notFound
          ? <EmptyState title="Workspace not found" actions={<ButtonLink to="/app">Back to overview</ButtonLink>}>
              It doesn’t exist, or you are not a member. Ask its owner to add you.
            </EmptyState>
          : <ErrorState message={q.error} onRetry={q.reload} />}
        </Card>
      </Page>
    );
  }
  if (!ws) return <PageLoader label="Opening workspace…" />;

  const info = TYPE_INFO[ws.type];
  const siblings = workspaces.filter((w) => w.type === ws.type);
  const module = { ws, reloadWs: q.reload };

  return (
    <Page wide>
      <PageHeader icon={<info.icon />} title={ws.name}
        description={ws.description || info.tagline}
        meta={<>
          <Badge tone="brand">{info.label}</Badge>
          {ws.role && <Badge tone="outline" title={ROLE_HELP[ws.role]}>Your role: {ROLE_LABEL[ws.role]}</Badge>}
          <Link to={`/app/settings?tab=workspaces&ws=${ws.id}`} className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink">
            <Users className="h-3.5 w-3.5" /> {ws.member_count ?? 1} member{ws.member_count === 1 ? '' : 's'}
          </Link>
        </>}
        actions={<>
          {siblings.length > 1 && (
            <Select compact value={ws.id} aria-label="Switch workspace" className="w-56" onChange={(e) => nav(`/app/w/${e.target.value}`)}>
              {siblings.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          )}
          <ButtonLink to={`/app/settings?tab=workspaces&ws=${ws.id}`} variant="secondary" size="sm" icon={<Settings2 className="h-4 w-4" />}>Manage</ButtonLink>
        </>} />
      <div className="mt-5">
        <Suspense fallback={<PageLoader />}>
          {ws.type === 'corporate' && <CorporateWorkspace {...module} />}
          {ws.type === 'research' && <ResearchWorkspace {...module} />}
          {ws.type === 'legal' && <LegalWorkspace {...module} />}
          {ws.type === 'placement' && <PlacementWorkspace {...module} />}
        </Suspense>
      </div>
    </Page>
  );
}
