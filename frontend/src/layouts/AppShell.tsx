import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, ChevronRight, CircleHelp, FileText, History, LayoutDashboard, Loader2, LogOut, Menu as MenuIcon, PanelLeftClose,
  PanelLeftOpen, Plus, ScanText, Search, Settings, Waypoints, X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { usePreference } from '../lib/hooks';
import { OTHERS_INFO, TYPE_INFO, WORKSPACE_TYPES } from '../lib/workspaceTypes';
import { initials, timeAgo } from '../lib/format';
import { platformApi } from '../api/platform';
import type { Activity, ProcessingJob, WorkspaceType } from '../types/platform';
import { Logo, LogoMark } from '../components/brand/Logo';
import { Menu, Popover } from '../components/ui/Overlay';
import { PageLoader, Spinner } from '../components/ui/Feedback';
import { useToast } from '../lib/toast';
import CallPaheli from '../components/CallPaheli';
import ExplainerHost from '../components/explain/ExplainerHost';

interface NavItem { to: string; label: string; icon: React.ComponentType<{ className?: string }>; end?: boolean; type?: WorkspaceType; tag?: string }

const PRIMARY: NavItem[] = [{ to: '/app', label: 'Overview', icon: LayoutDashboard, end: true }];
const WORKSPACES: NavItem[] = [
  ...WORKSPACE_TYPES.map((t) => ({ to: `/app/${t.type}`, label: t.type === 'legal' ? 'Legal & Policy' : t.label, icon: t.icon, type: t.type })),
  { to: '/app/others', label: OTHERS_INFO.label, icon: OTHERS_INFO.icon },
];
const TOOLS: NavItem[] = [
  { to: '/app/graph', label: 'Knowledge Graph', icon: Waypoints },
  { to: '/app/documents', label: 'Documents', icon: FileText },
  { to: '/app/ocr', label: 'Scan & OCR', icon: ScanText, tag: 'New' },
  { to: '/app/search', label: 'Search', icon: Search },
  { to: '/app/activity', label: 'Recent Activity', icon: History },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

export default function AppShell() {
  const [collapsed, setCollapsed] = usePreference('sidebar-collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <a href="#main" className="sr-only z-[90] rounded-md bg-white px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <aside className={`hidden shrink-0 border-r border-line bg-canvas/70 transition-[width] duration-300 ease-out lg:flex lg:flex-col ${collapsed ? 'w-[68px]' : 'w-[248px]'}`}>
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink/40" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-[272px] animate-slide-in-left flex-col bg-white shadow-pop" aria-label="Navigation">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3.5 rounded-md p-1 text-ink-muted hover:bg-canvas" aria-label="Close navigation">
              <X className="h-5 w-5" />
            </button>
            <Sidebar collapsed={false} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
        <ExplainerHost />
      </div>
    </div>
  );
}

function useActiveWorkspaceType(): WorkspaceType | null {
  const loc = useLocation();
  const { workspaces } = useAuth();
  const m = loc.pathname.match(/^\/app\/w\/([^/]+)/);
  if (m) return workspaces.find((w) => w.id === m[1])?.type ?? null;
  const t = loc.pathname.match(/^\/app\/(corporate|research|legal|placement)\b/);
  return (t?.[1] as WorkspaceType) ?? null;
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  const { workspaces } = useAuth();
  const activeType = useActiveWorkspaceType();
  const count = (t: WorkspaceType) => workspaces.filter((w) => w.type === t).length;

  const link = (it: NavItem) => {
    const typed = it.type !== undefined;
    return (
      <NavLink key={it.to} to={it.to} end={it.end} title={collapsed ? it.label : undefined}
        className={({ isActive }) => {
          const on = typed ? activeType === it.type : isActive;
          return `group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] transition-all duration-200 ${
            on ? 'bg-white font-medium text-ink shadow-card ring-1 ring-line' : 'text-ink-soft hover:bg-ink/[0.04] hover:text-ink'} ${collapsed ? 'justify-center' : ''}`;
        }}>
        {({ isActive }) => {
          const on = typed ? activeType === it.type : isActive;
          return (
            <>
              <it.icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${on ? 'text-brand-700' : 'text-ink-muted group-hover:text-ink-soft'}`} />
              {!collapsed && <span className="min-w-0 flex-1 truncate">{it.label}</span>}
              {!collapsed && it.tag && <span className="rounded-full bg-spark-soft px-1.5 text-[10px] font-semibold uppercase tracking-wide text-warn-ink">{it.tag}</span>}
              {!collapsed && typed && (count(it.type!) === 0
                ? <Plus className="h-3.5 w-3.5 text-ink-faint" aria-label="Not set up yet" />
                : count(it.type!) > 1 ? <span className="num text-[11px] text-ink-muted">{count(it.type!)}</span> : null)}
            </>
          );
        }}
      </NavLink>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`flex h-14 shrink-0 items-center ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
        {collapsed ? <Link to="/app" aria-label="Paheli overview"><LogoMark /></Link> : <Logo to="/app" />}
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
        <div className="space-y-0.5">{PRIMARY.map(link)}</div>
        <div>
          {!collapsed && <div className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Workspaces</div>}
          <div className="space-y-0.5">{WORKSPACES.map(link)}</div>
        </div>
        <div>
          {!collapsed && <div className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Platform</div>}
          <div className="space-y-0.5">{TOOLS.map(link)}</div>
        </div>
      </nav>
      {onToggle && (
        <div className="border-t border-line p-3">
          <button onClick={onToggle} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-ink/[0.04] hover:text-ink ${collapsed ? 'justify-center' : ''}`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <><PanelLeftClose className="h-[18px] w-[18px]" /> Collapse</>}
          </button>
        </div>
      )}
    </div>
  );
}

const SECTION: Record<string, string> = {
  graph: 'Knowledge Graph', documents: 'Documents', search: 'Search', activity: 'Recent Activity', saved: 'Saved analysis',
  settings: 'Settings', help: 'Help & documentation', others: 'Others', ocr: 'Scan & OCR',
};

function Breadcrumbs() {
  const loc = useLocation();
  const { workspaces } = useAuth();
  const parts = loc.pathname.replace(/^\/app\/?/, '').split('/').filter(Boolean);
  const crumbs: { label: string; to?: string }[] = [];
  if (!parts.length) crumbs.push({ label: 'Overview' });
  else if (parts[0] === 'w') {
    const ws = workspaces.find((w) => w.id === parts[1]);
    if (ws) {
      crumbs.push({ label: TYPE_INFO[ws.type].label, to: `/app/${ws.type}` });
      crumbs.push({ label: ws.name });
    } else crumbs.push({ label: 'Workspace' });
  } else if (parts[0] in TYPE_INFO) crumbs.push({ label: TYPE_INFO[parts[0] as WorkspaceType].label });
  else if (parts[0] === 'saved') crumbs.push({ label: 'Recent Activity', to: '/app/activity?tab=saved' }, { label: 'Saved analysis' });
  else crumbs.push({ label: SECTION[parts[0]] ?? parts[0] });
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[13.5px]">
        <li className="hidden sm:block"><Link to="/app" className="text-ink-muted hover:text-ink">Paheli</Link></li>
        {crumbs.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-ink-faint ${i === 0 ? 'hidden sm:block' : ''}`} />
            {c.to ? <Link to={c.to} className="truncate text-ink-muted hover:text-ink">{c.label}</Link>
              : <span className="truncate font-medium text-ink" aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white/90 px-3 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="rounded-lg p-2 text-ink-muted hover:bg-canvas lg:hidden" aria-label="Open navigation">
        <MenuIcon className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1"><Breadcrumbs /></div>
      <form role="search" className="hidden w-[300px] md:block"
        onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) { nav(`/app/search?q=${encodeURIComponent(q.trim())}`); setQ(''); } }}>
        <label className="relative block">
          <span className="sr-only">Search all your workspaces</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents, entities, companies…"
            className="h-9 w-full rounded-lg border border-line bg-canvas pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/15" />
        </label>
      </form>
      <Link to="/app/search" className="rounded-lg p-2 text-ink-muted hover:bg-canvas md:hidden" aria-label="Search"><Search className="h-5 w-5" /></Link>
      <CallPaheli />
      <Notifications />
      <Link to="/app/help" className="hidden rounded-lg p-2 text-ink-muted hover:bg-canvas hover:text-ink sm:block" aria-label="Help and documentation" title="Help & documentation">
        <CircleHelp className="h-5 w-5" />
      </Link>
      {user && (
        <Menu label="Account" items={[
          { label: 'Settings', icon: <Settings />, onSelect: () => nav('/app/settings') },
          { label: 'Help & documentation', icon: <CircleHelp />, onSelect: () => nav('/app/help') },
          { label: 'Sign out', icon: <LogOut />, danger: true, onSelect: async () => { await logout(); toast.info('You have been signed out.'); nav('/'); } },
        ]} header={<div className="min-w-0"><div className="truncate text-[13.5px] font-semibold text-ink">{user.name}</div>
          <div className="truncate text-[12px] text-ink-muted">{user.email}</div>
          {user.role === 'admin' && <div className="mt-1 text-[11px] font-medium text-brand-700">Administrator</div>}</div>}
          trigger={(p) => (
            <button {...p} className="flex items-center gap-2 rounded-full p-0.5 hover:ring-2 hover:ring-line" aria-label="Account menu">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-[12px] font-semibold text-white">{initials(user.name)}</span>
            </button>
          )} />
      )}
    </header>
  );
}

function Notifications() {
  const [jobs, setJobs] = useState<ProcessingJob[] | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    platformApi.overview().then((o) => setJobs(o.processing)).catch((e) => setError(e.message));
    platformApi.activity(undefined, 6).then(setActs).catch(() => {});
  };
  return (
    <Popover width="w-[340px]" trigger={(p) => (
      <button {...p} onClick={() => { if (!p['aria-expanded']) load(); p.onClick(); }}
        className="relative rounded-lg p-2 text-ink-muted hover:bg-canvas hover:text-ink" aria-label="Notifications">
        <Bell className="h-5 w-5" />
      </button>
    )}>
      {(close) => (
        <div>
          <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-ink">Notifications</div>
          <div className="max-h-[420px] overflow-y-auto">
            {error && <p className="px-4 py-3 text-[12.5px] text-danger-ink">{error}</p>}
            {jobs === null && !error && <div className="px-4 py-4"><Spinner label="Loading…" /></div>}
            {jobs && jobs.length > 0 && (
              <div className="border-b border-line px-4 py-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Processing now</div>
                {jobs.map((j) => (
                  <Link key={j.id} to={`/app/w/${j.workspace_id}?tab=documents`} onClick={close} className="block py-1 text-[12.5px] text-ink hover:underline">
                    <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin text-brand-600" />
                    {j.workspace_name}: {j.done.length}/{j.doc_ids.length} documents · {j.stage}
                  </Link>
                ))}
              </div>
            )}
            {jobs && (
              <div className="px-4 py-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Recent activity</div>
                {acts.length === 0 && <p className="text-[12.5px] text-ink-muted">Nothing yet. Activity from your workspaces appears here.</p>}
                <ul className="space-y-2">
                  {acts.map((a) => (
                    <li key={a.activity_id} className="text-[12.5px]">
                      <div className="line-clamp-2 text-ink">{a.summary}</div>
                      <div className="text-[11.5px] text-ink-muted">{a.workspace_name ?? 'Account'} · {timeAgo(a.created_at)}</div>
                    </li>
                  ))}
                </ul>
                <Link to="/app/activity" onClick={close} className="mt-2 inline-block text-[12.5px] font-medium text-brand-700 hover:underline">View all activity</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </Popover>
  );
}
