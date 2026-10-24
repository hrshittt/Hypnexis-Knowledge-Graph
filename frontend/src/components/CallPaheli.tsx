import { useEffect, useState } from 'react';
import { Phone, PhoneCall } from 'lucide-react';
import { callApi } from '../api/call';
import { errorMessage } from '../lib/http';
import { usePreference } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Form';
import { Modal } from './ui/Overlay';

const OPEN_EVENT = 'paheli:call';

/** Opens the Call Paheli dialog from anywhere in the signed-in app (the top bar owns the dialog). */
export const openCallPaheli = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** Top-bar phone icon: enter a number and the PAHELI voice assistant calls it. Hidden when the server has no calling setup. */
export default function CallPaheli() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = usePreference('call-paheli-phone', '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);

  useEffect(() => { callApi.status().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false)); }, []);
  useEffect(() => {
    const on = () => (enabled ? setOpen(true) : toast.info('Calling isn’t set up on this server yet.'));
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, [enabled, toast]);
  if (!enabled) return null;

  const close = () => { setOpen(false); setError(null); setPlaced(null); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.replace(/\D/g, '').length < 8) { setError('Enter your phone number with country code, e.g. +91 98765 43210.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await callApi.paheli(phone.trim());
      setPlaced(r.to_number);
      toast.success(`Paheli is calling ${r.to_number}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-ink-muted hover:bg-canvas hover:text-ink"
        aria-label="Call Paheli" title="Call Paheli">
        <Phone className="h-5 w-5" />
      </button>
      <Modal open={open} onClose={close} size="sm" title="Call Paheli"
        description="Paheli, the PAHELI voice assistant, will ring you and answer your questions about PAHELI and knowledge graphs."
        footer={placed ? <Button onClick={close}>Done</Button> : (
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit" form="call-paheli-form" loading={busy} icon={<PhoneCall className="h-4 w-4" />}>Call me</Button>
          </>
        )}>
        {placed ? (
          <div className="flex items-start gap-3 text-[13.5px] text-ink">
            <PhoneCall className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <p>Calling <span className="num font-medium">{placed}</span> now. Your phone should ring within a few seconds.</p>
          </div>
        ) : (
          <form id="call-paheli-form" onSubmit={submit} noValidate>
            <Field label="Your phone number" required error={error} hint="Include the country code. 10-digit numbers are treated as Indian (+91).">
              {({ id, describedBy, invalid }) => (
                <Input id={id} aria-describedby={describedBy} invalid={invalid} type="tel" inputMode="tel" autoComplete="tel"
                  placeholder="+91 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} data-autofocus />
              )}
            </Field>
          </form>
        )}
      </Modal>
    </>
  );
}
