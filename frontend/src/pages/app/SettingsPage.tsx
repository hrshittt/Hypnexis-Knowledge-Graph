import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, LogOut, Plus, Settings, ShieldCheck, Trash2, UserPlus, UserRound, Users } from 'lucide-react';
import { authApi, workspacesApi } from '../../api/platform';
import { useAuth } from '../../lib/auth';
import { errorMessage, ApiError } from '../../lib/http';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { ROLE_HELP, ROLE_LABEL, TYPE_INFO, WORKSPACE_TYPES } from '../../lib/workspaceTypes';
import type { Role, Workspace, WorkspaceType } from '../../types/platform';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Field, Input, PasswordInput, Select, Textarea } from '../../components/ui/Form';
import { ErrorState, Notice, Skeleton } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Overlay';
import { TabBar, useTab } from '../../components/ui/Tabs';
import { Table, Td, Th } from '../../components/ui/Table';

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const [tab, setTab] = useTab(['profile', 'security', 'workspaces'] as const, 'profile');
  return (
    <Page>
      <PageHeader icon={<Settings />} title="Settings" description="Your profile, security and the workspaces you belong to." />
      <TabBar label="Settings sections" active={tab} onChange={(k) => setTab(k, { ws: null })} className="mb-6 mt-5" items={[
        { key: 'profile', label: 'Profile', icon: <UserRound /> },
        { key: 'security', label: 'Security', icon: <ShieldCheck /> },
        { key: 'workspaces', label: 'Workspaces & members', icon: <Users /> },
      ]} />
      {tab === 'profile' && <Profile />}
      {tab === 'security' && <Security />}
      {tab === 'workspaces' && <Workspaces />}
    </Page>
  );
}

function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [primary, setPrimary] = useState<WorkspaceType | ''>(user?.primary_workspace_type ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Enter your name.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await authApi.updateProfile({ name: name.trim(), ...(primary ? { primary_workspace_type: primary } : {}) });
      setUser(r.user);
      toast.success('Profile saved.');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Profile" />
      <form onSubmit={save} className="space-y-4 px-5 py-4">
        <Field label="Full name" error={error}>{({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} value={name} maxLength={100} autoComplete="name" onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email" hint="Contact your administrator to change the email on your account.">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={user?.email ?? ''} disabled />}</Field>
        <Field label="Primary workspace" hint="Used to personalise your overview.">
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={primary} onChange={(e) => setPrimary(e.target.value as WorkspaceType)}>
              <option value="" disabled>Choose…</option>
              {WORKSPACE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </Select>
          )}
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-ink-muted">Account role: {user?.role === 'admin' ? 'Administrator' : 'Member'} · created {fmtDateTime(user?.created_at)}</span>
          <Button type="submit" loading={busy}>Save profile</Button>
        </div>
      </form>
    </Card>
  );
}

function Security() {
  const { session, user, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!current) errs.current_password = 'Enter your current password.';
    if (next.length < 10 || !/[a-z]/i.test(next) || !/\d/.test(next)) errs.new_password = 'Use at least 10 characters with a letter and a number.';
    if (confirm !== next) errs.confirm = 'The passwords do not match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await authApi.changePassword(current, next);
      toast.success('Password changed. Your other sessions were signed out.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      const ae = err as ApiError;
      setErrors(ae.fields ?? { new_password: ae.message });
    } finally { setBusy(false); }
  };

  const revoke = async () => {
    setRevoking(true);
    try {
      const r = await authApi.revokeOtherSessions();
      toast.success(r.revoked ? `Signed out ${r.revoked} other session${r.revoked === 1 ? '' : 's'}.` : 'No other sessions were active.');
    } catch (err) { toast.error(errorMessage(err)); } finally { setRevoking(false); }
  };

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Change password" icon={<KeyRound className="h-4 w-4" />} description="Changing your password signs out every other session." />
        <form onSubmit={change} className="space-y-4 px-5 py-4" noValidate>
          <input type="text" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
          <Field label="Current password" error={errors.current_password}>{({ id, describedBy, invalid }) => <PasswordInput id={id} aria-describedby={describedBy} invalid={invalid} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
          <Field label="New password" error={errors.new_password} hint="At least 10 characters, a letter and a number, not your name or email.">{({ id, describedBy, invalid }) => <PasswordInput id={id} aria-describedby={describedBy} invalid={invalid} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
          <Field label="Confirm new password" error={errors.confirm}>{({ id, describedBy, invalid }) => <PasswordInput id={id} aria-describedby={describedBy} invalid={invalid} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
          <div className="flex justify-end"><Button type="submit" loading={busy}>Change password</Button></div>
        </form>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="This session" icon={<ShieldCheck className="h-4 w-4" />} />
          <div className="space-y-2 px-5 py-4 text-[13.5px] text-ink-soft">
            <p>Signed in as <b className="font-medium text-ink">{user?.email}</b>.</p>
            <p>Expires {fmtDateTime(session?.session.expires_at)}{session?.session.remember ? ' (kept signed in on this device)' : ' or when you close the browser'}.</p>
            <p className="text-[12.5px] text-ink-muted">Sessions use secure HttpOnly cookies; every change is protected with a per-session security token.</p>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
            <Button variant="secondary" size="sm" loading={revoking} onClick={revoke}>Sign out other sessions</Button>
            <Button variant="ghost" size="sm" icon={<LogOut className="h-4 w-4" />} onClick={async () => { await logout(); nav('/'); }}>Sign out</Button>
          </div>
        </Card>
        <Notice tone="neutral" title="Forgotten passwords">
          There is no email-based reset on this deployment. An administrator can reset a password with <code className="rounded bg-white px-1 text-[12px]">python -m backend.auth.cli reset-password</code>.
        </Notice>
      </div>
    </div>
  );
}

function Workspaces() {
  const { workspaces, refreshWorkspaces } = useAuth();
  const [params, setParams] = useSearchParams();
  const selected = workspaces.find((w) => w.id === params.get('ws')) ?? workspaces[0];
  if (!workspaces.length) {
    return (
      <Card padded>
        <p className="text-[14px] text-ink">You aren’t a member of any workspace yet.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {WORKSPACE_TYPES.map((t) => <Link key={t.type} to={`/app/${t.type}`} className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink hover:bg-canvas">Set up {t.label}</Link>)}
        </div>
      </Card>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader title="Your workspaces" />
        <ul className="p-2">
          {workspaces.map((w) => {
            const info = TYPE_INFO[w.type];
            return (
              <li key={w.id}>
                <button onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('ws', w.id); return n; })}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${selected?.id === w.id ? 'bg-brand-50' : 'hover:bg-canvas'}`}>
                  <info.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
                  <span className="min-w-0"><span className="block truncate text-[13.5px] font-medium text-ink">{w.name}</span>
                    <span className="text-[12px] text-ink-muted">{info.short} · {w.role ? ROLE_LABEL[w.role] : ''}</span></span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-line p-3">
          <Link to="/app" className="flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline"><Plus className="h-3.5 w-3.5" /> Create a workspace from the overview</Link>
        </div>
      </Card>
      {selected && <WorkspaceSettings key={selected.id} ws={selected} onChanged={refreshWorkspaces} />}
    </div>
  );
}

function WorkspaceSettings({ ws, onChanged }: { ws: Workspace; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const { user } = useAuth();
  const nav = useNavigate();
  const isOwner = ws.role === 'owner';
  const members = useAsync(() => workspacesApi.members(ws.id), [ws.id]);
  const [name, setName] = useState(ws.name);
  const [description, setDescription] = useState(ws.description);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { setName(ws.name); setDescription(ws.description); }, [ws]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={ws.name} description={`${TYPE_INFO[ws.type].label} · your role: ${ws.role ? ROLE_LABEL[ws.role] : '—'}`}
          actions={<Link to={`/app/w/${ws.id}`} className="text-[13px] font-medium text-brand-700 hover:underline">Open workspace</Link>} />
        <form className="space-y-4 px-5 py-4" onSubmit={(e) => {
          e.preventDefault();
          run('save', async () => { await workspacesApi.update(ws.id, { name: name.trim(), description }); await onChanged(); toast.success('Workspace updated.'); });
        }}>
          <Field label="Name">{({ id }) => <Input id={id} value={name} maxLength={80} disabled={!isOwner} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Description">{({ id }) => <Textarea id={id} rows={2} value={description} maxLength={500} disabled={!isOwner} onChange={(e) => setDescription(e.target.value)} />}</Field>
          {isOwner ? <div className="flex justify-end"><Button type="submit" loading={busy === 'save'} disabled={!name.trim()}>Save changes</Button></div>
            : <p className="text-[12.5px] text-ink-muted">Only owners can rename this workspace.</p>}
        </form>
      </Card>

      <Card>
        <CardHeader title="Members" icon={<Users className="h-4 w-4" />} description="Access is enforced by the server for every request." />
        {members.error ? <ErrorState message={members.error} onRetry={members.reload} />
          : !members.data ? <div className="p-5"><Skeleton className="h-6 w-full" /></div>
          : (
            <Table caption="Workspace members">
              <thead><tr><Th>Member</Th><Th>Role</Th><Th align="right"><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {members.data.members.map((m) => (
                  <tr key={m.id}>
                    <Td><div className="font-medium text-ink">{m.name}{m.id === user?.id && <span className="ml-1.5 text-[12px] font-normal text-ink-muted">(you)</span>}</div><div className="text-[12px] text-ink-muted">{m.email}</div></Td>
                    <Td>
                      {isOwner ? (
                        <Select compact value={m.role} className="w-32" aria-label={`Role for ${m.name}`} disabled={busy === `role-${m.id}`}
                          onChange={(e) => run(`role-${m.id}`, async () => { await workspacesApi.setRole(ws.id, m.id, e.target.value as Role); await members.reload(); if (m.id === user?.id) await onChanged(); toast.success('Role updated.'); })}>
                          {(['owner', 'analyst', 'viewer'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </Select>
                      ) : <Badge tone={m.role === 'owner' ? 'brand' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>}
                    </Td>
                    <Td align="right">
                      {(isOwner || m.id === user?.id) && (
                        <IconButton label={m.id === user?.id ? 'Leave workspace' : `Remove ${m.name}`} size="sm" onClick={() => setRemoving({ id: m.id, name: m.name })}>
                          {m.id === user?.id ? <LogOut className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </IconButton>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        {isOwner && (
          <form className="flex flex-wrap items-end gap-2 border-t border-line px-5 py-4" onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            run('add', async () => { await workspacesApi.addMember(ws.id, email.trim(), role); setEmail(''); await members.reload(); toast.success('Member added.'); });
          }}>
            <label className="min-w-[220px] flex-1 text-[13px] font-medium text-ink">Add an existing account by email
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@organisation.com" className="mt-1" />
            </label>
            <label className="text-[13px] font-medium text-ink">Role
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="mt-1 w-36">
                {(['viewer', 'analyst', 'owner'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
            </label>
            <Button type="submit" icon={<UserPlus className="h-4 w-4" />} loading={busy === 'add'} disabled={!email.trim()}>Add member</Button>
          </form>
        )}
        <div className="border-t border-line px-5 py-3">
          <ul className="space-y-1 text-[12.5px] text-ink-muted">
            {(['owner', 'analyst', 'viewer'] as Role[]).map((r) => <li key={r}><b className="font-medium text-ink-soft">{ROLE_LABEL[r]}:</b> {ROLE_HELP[r]}</li>)}
          </ul>
        </div>
      </Card>

      <ConfirmDialog open={!!removing} title={removing?.id === user?.id ? 'Leave this workspace?' : `Remove ${removing?.name}?`}
        confirmLabel={removing?.id === user?.id ? 'Leave workspace' : 'Remove member'} busy={busy === 'remove'}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run('remove', async () => {
          const self = removing?.id === user?.id;
          await workspacesApi.removeMember(ws.id, removing!.id);
          setRemoving(null);
          await onChanged();
          if (self) { toast.info('You left the workspace.'); nav('/app/settings?tab=workspaces'); } else { await members.reload(); toast.success('Member removed.'); }
        })}>
        {removing?.id === user?.id ? 'You will lose access to its documents, analyses and records until an owner adds you again.'
          : 'They will immediately lose access to this workspace. Their account is not deleted.'}
      </ConfirmDialog>
    </div>
  );
}
