import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface TabItem<K extends string = string> {
  key: K;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  hidden?: boolean;
}

/** The active tab lives in the URL (?tab=) so it survives reloads and can be linked to. */
export function useTab<K extends string>(keys: readonly K[], fallback: K, param = 'tab'): [K, (k: K, extra?: Record<string, string | null>) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(param) as K | null;
  const active = raw && keys.includes(raw) ? raw : fallback;
  const set = (k: K, extra?: Record<string, string | null>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (k === fallback) next.delete(param);
      else next.set(param, k);
      next.delete('welcome'); // moving on from the first-run panel ends onboarding (one URL update, no race)
      for (const [ek, ev] of Object.entries(extra ?? {})) {
        if (ev === null) next.delete(ek);
        else next.set(ek, ev);
      }
      return next;
    });
  };
  return [active, set];
}

interface TabBarProps<K extends string> {
  items: TabItem<K>[];
  active: K;
  onChange: (k: K) => void;
  label: string;
  className?: string;
}

export function TabBar<K extends string>({ items, active, onChange, label, className = '' }: TabBarProps<K>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const visible = items.filter((t) => !t.hidden);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + visible.length) % visible.length;
    refs.current[n]?.focus();
    onChange(visible[n].key);
  };
  return (
    <div className={`-mb-px flex gap-0.5 overflow-x-auto border-b border-line ${className}`} role="tablist" aria-label={label}>
      {visible.map((t, i) => {
        const on = t.key === active;
        return (
          <button key={t.key} ref={(el) => { refs.current[i] = el; }} role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.key)} onKeyDown={(e) => onKey(e, i)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[13.5px] font-medium transition-colors ${
              on ? 'border-brand-600 text-ink' : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink'}`}>
            {t.icon && <span className={`[&_svg]:h-4 [&_svg]:w-4 ${on ? 'text-brand-600' : ''}`}>{t.icon}</span>}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}
