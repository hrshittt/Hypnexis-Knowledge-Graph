import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from '../layouts/AuthLayout';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/http';
import { useAsync, useDocumentTitle } from '../lib/hooks';
import { authApi } from '../api/platform';
import { safeNext } from '../routes/guards';
import { Button } from '../components/ui/Button';
import { Checkbox, Field, Input, PasswordInput } from '../components/ui/Form';
import { Notice } from '../components/ui/Feedback';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function Login() {
  useDocumentTitle('Sign in');
  const { login, bootError } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get('next'));
  const config = useAsync(() => authApi.config(), []);
  const days = config.data?.remember_days ?? 30;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!EMAIL.test(email.trim())) errs.email = 'Enter the email address you registered with.';
    if (!password) errs.password = 'Enter your password.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await login(email.trim(), password, remember);
      nav(next, { replace: true });
    } catch (err) {
      const ae = err as ApiError;
      setFormError(ae.message);
      if (ae.fields) setErrors(ae.fields);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in to Paheli" subtitle="Welcome back. Pick up where you left off."
      footer={<>New to Paheli? <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-brand-700 hover:underline">Create an account</Link></>}>
      {params.get('expired') && !formError && (
        <Notice tone="warn" className="mb-4">Your session expired. Sign in again to continue.</Notice>
      )}
      {bootError && <Notice tone="danger" className="mb-4" title="The API is not reachable">{bootError}</Notice>}
      {formError && <Notice tone="danger" className="mb-4">{formError}</Notice>}
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Email" error={errors.email}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} type="email" name="email" autoComplete="email" inputMode="email" value={email} invalid={invalid}
              aria-describedby={describedBy} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="you@organisation.com" />
          )}
        </Field>
        <Field label="Password" error={errors.password}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput id={id} name="password" autoComplete="current-password" value={password} invalid={invalid}
              aria-describedby={describedBy} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <div className="flex items-start justify-between gap-3">
          <Checkbox label="Keep me signed in" description={`Stay signed in on this device for up to ${days} days.`}
            checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <Link to="/forgot-password" className="shrink-0 text-[13px] font-medium text-brand-700 hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}
