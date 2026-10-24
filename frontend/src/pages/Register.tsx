import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Circle } from 'lucide-react';
import AuthLayout from '../layouts/AuthLayout';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/http';
import { useAsync, useDocumentTitle } from '../lib/hooks';
import { authApi } from '../api/platform';
import { WORKSPACE_TYPES, isWorkspaceType } from '../lib/workspaceTypes';
import type { WorkspaceType } from '../types/platform';
import { Button } from '../components/ui/Button';
import { Checkbox, Field, Input, PasswordInput } from '../components/ui/Form';
import { Notice } from '../components/ui/Feedback';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Errors = Partial<Record<'name' | 'email' | 'password' | 'confirm' | 'workspace_type' | 'accept_terms', string>>;

/** Mirrors the server's rules (backend/auth/passwords.py) for instant feedback; the server stays authoritative. */
function passwordChecks(pw: string, name: string, email: string, min: number) {
  const lower = pw.toLowerCase();
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  const fullName = name.trim().toLowerCase();
  const nameHit = fullName.length >= 4 && lower.includes(fullName);
  const checks = [
    { ok: pw.length >= min && pw.length <= 128, label: `At least ${min} characters` },
    { ok: /[a-z]/i.test(pw) && /\d/.test(pw), label: 'At least one letter and one number' },
    { ok: pw.length > 0 && !nameHit && !(local.length >= 4 && lower.includes(local)), label: 'Not your name or email address' },
  ];
  if (pw.length >= min && new Set(pw).size < 4) checks.push({ ok: false, label: 'At least 4 different characters' });
  return checks;
}

export default function Register() {
  useDocumentTitle('Create your account');
  const { register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const config = useAsync(() => authApi.config(), []);
  const preset = params.get('workspace') ?? undefined;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [wtype, setWtype] = useState<WorkspaceType | null>(isWorkspaceType(preset) ? preset : null);
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const min = config.data?.password.min_length ?? 10;
  const checks = passwordChecks(password, name, email, min);
  const closed = config.data && !config.data.registration_open;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Errors = {};
    if (!name.trim() || name.trim().length > 100) errs.name = 'Enter your full name (up to 100 characters).';
    if (!EMAIL.test(email.trim())) errs.email = 'Enter a valid email address.';
    if (!checks.every((c) => c.ok)) errs.password = 'Choose a password that meets every requirement below.';
    if (confirm !== password) errs.confirm = 'The passwords do not match.';
    if (!wtype) errs.workspace_type = 'Choose the workspace you want to start with.';
    if (!terms) errs.accept_terms = 'Accept the terms to create an account.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const p = await register({ name: name.trim(), email: email.trim(), password, workspace_type: wtype, accept_terms: terms });
      const ws = p.workspaces.find((w) => w.type === wtype) ?? p.workspaces[0];
      nav(ws ? `/app/w/${ws.id}?welcome=1` : '/app', { replace: true });
    } catch (err) {
      const ae = err as ApiError;
      setFormError(ae.message);
      if (ae.fields) setErrors(ae.fields as Errors);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create your Hypnexis account" subtitle="Set up a private workspace in under a minute."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></>}>
      {closed && <Notice tone="warn" className="mb-4">Registration is closed on this deployment. Ask your administrator for an account.</Notice>}
      {formError && <Notice tone="danger" className="mb-4">{formError}</Notice>}
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Full name" error={errors.name} required>
          {({ id, describedBy, invalid }) => (
            <Input id={id} name="name" autoComplete="name" value={name} invalid={invalid} aria-describedby={describedBy}
              onChange={(e) => setName(e.target.value)} autoFocus />
          )}
        </Field>
        <Field label="Work email" error={errors.email} required>
          {({ id, describedBy, invalid }) => (
            <Input id={id} type="email" name="email" autoComplete="email" inputMode="email" value={email} invalid={invalid}
              aria-describedby={describedBy} onChange={(e) => setEmail(e.target.value)} placeholder="you@organisation.com" />
          )}
        </Field>
        <Field label="Password" error={errors.password} required>
          {({ id, describedBy, invalid }) => (
            <>
              <PasswordInput id={id} name="new-password" autoComplete="new-password" value={password} invalid={invalid}
                aria-describedby={`${describedBy ?? ''} ${id}-rules`.trim()} onChange={(e) => setPassword(e.target.value)} />
              <ul id={`${id}-rules`} className="mt-2 space-y-1" aria-label="Password requirements">
                {checks.map((c) => (
                  <li key={c.label} className={`flex items-center gap-1.5 text-[12.5px] ${c.ok ? 'text-brand-700' : 'text-ink-muted'}`}>
                    {c.ok ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
                    {c.label}<span className="sr-only">{c.ok ? ' (met)' : ' (not met)'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Field>
        <Field label="Confirm password" error={errors.confirm} required>
          {({ id, describedBy, invalid }) => (
            <PasswordInput id={id} name="confirm-password" autoComplete="new-password" value={confirm} invalid={invalid}
              aria-describedby={describedBy} onChange={(e) => setConfirm(e.target.value)} />
          )}
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Start with<span className="ml-0.5 text-danger" aria-hidden>*</span></legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-describedby={errors.workspace_type ? 'ws-err' : undefined}>
            {WORKSPACE_TYPES.map((t) => {
              const on = wtype === t.type;
              return (
                <button key={t.type} type="button" role="radio" aria-checked={on} onClick={() => setWtype(t.type)}
                  className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                    on ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-line-strong bg-white hover:border-ink-faint'}`}>
                  <t.icon className={`mt-0.5 h-4 w-4 shrink-0 ${on ? 'text-brand-700' : 'text-ink-muted'}`} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{t.label}</span>
                    <span className="block text-[11.5px] leading-snug text-ink-muted">{t.audience}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {errors.workspace_type && <p id="ws-err" className="mt-1 text-[12.5px] text-danger-ink">{errors.workspace_type}</p>}
          <p className="mt-1.5 text-[12px] text-ink-muted">You can add the other workspaces at any time. Administrator access is assigned by your operator, not chosen here.</p>
        </fieldset>
        <div>
          <Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)}
            label={<>I accept the <Link to="/terms" target="_blank" className="font-medium text-brand-700 hover:underline">terms of use and disclaimers</Link></>} />
          {errors.accept_terms && <p className="mt-1 text-[12.5px] text-danger-ink">{errors.accept_terms}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!!closed}>Create account</Button>
      </form>
    </AuthLayout>
  );
}
