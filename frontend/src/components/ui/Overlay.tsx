import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { Button } from './Button';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Escape closes, Tab stays inside, focus returns to the opener, the page behind doesn't scroll. */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab' && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const a = items[0];
        const b = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);
  return ref;
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  const width = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl';
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-ink/40" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`relative flex max-h-[92vh] w-full ${width} animate-scale-in flex-col rounded-t-2xl bg-white shadow-pop focus:outline-none sm:rounded-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-ink-muted hover:bg-canvas hover:text-ink" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  open: boolean;
  title: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  /** keeps the confirm button disabled (e.g. until a confirmation word is typed) */
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, children, confirmLabel, tone = 'danger', busy, disabled, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy} disabled={disabled} data-autofocus={!disabled || undefined}>{confirmLabel}</Button>
      </>}>
      {children && <div className="text-[13.5px] leading-relaxed text-ink-soft">{children}</div>}
    </Modal>
  );
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-xl' }: DrawerProps) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-ink/30" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`relative flex h-full w-full ${width} animate-slide-in-right flex-col bg-white shadow-pop focus:outline-none`}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold leading-snug text-ink">{title}</h2>
            {subtitle && <div className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-ink-muted hover:bg-canvas hover:text-ink" aria-label="Close panel">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

/** An (i) button that reveals an explanation — used for every metric definition. */
export function InfoTip({ label = 'Definition', children, align = 'left' }: { label?: string; children: React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const id = useId();
  return (
    <div ref={ref} className="relative inline-flex">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} aria-label={label}
        className="rounded-full p-0.5 text-ink-faint transition-colors hover:text-ink-soft">
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div id={id} role="tooltip"
          className={`absolute top-full z-50 mt-1.5 w-72 animate-scale-in rounded-lg border border-line bg-white p-3 text-left text-[12.5px] font-normal normal-case leading-relaxed tracking-normal text-ink-soft shadow-pop ${
            align === 'right' ? 'right-0' : 'left-0'}`}>
          {children}
        </div>
      )}
    </div>
  );
}

interface MenuItem {
  label: React.ReactNode;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ trigger, items, header, align = 'right', label }: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => React.ReactNode;
  items: MenuItem[]; header?: React.ReactNode; align?: 'left' | 'right'; label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div role="menu" aria-label={label}
          className={`absolute top-full z-50 mt-1.5 min-w-[220px] animate-scale-in overflow-hidden rounded-xl border border-line bg-white py-1 shadow-pop ${
            align === 'right' ? 'right-0' : 'left-0'}`}>
          {header && <div className="border-b border-line px-3.5 py-2.5">{header}</div>}
          {items.map((it, i) => (
            <button key={i} role="menuitem" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onSelect(); }}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13.5px] transition-colors disabled:opacity-40 ${
                it.danger ? 'text-danger-ink hover:bg-danger-soft' : 'text-ink hover:bg-canvas'}`}>
              {it.icon && <span className="text-ink-muted [&_svg]:h-4 [&_svg]:w-4">{it.icon}</span>}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Generic anchored popover panel (notifications etc.). */
export function Popover({ trigger, children, align = 'right', width = 'w-80' }: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode; align?: 'left' | 'right'; width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open })}
      {open && (
        <div className={`absolute top-full z-50 mt-1.5 ${width} max-w-[calc(100vw-1.5rem)] animate-scale-in overflow-hidden rounded-xl border border-line bg-white shadow-pop ${
          align === 'right' ? 'right-0' : 'left-0'}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
