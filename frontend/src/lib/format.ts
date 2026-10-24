// Display formatting. Timestamps from the API are epoch seconds.

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtDate = (ts: number | null | undefined) => (ts ? dateFmt.format(new Date(ts * 1000)) : '—');
export const fmtDateTime = (ts: number | null | undefined) => (ts ? dateTimeFmt.format(new Date(ts * 1000)) : '—');

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return '—';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return fmtDate(ts);
}

export function fmtNumber(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 1,284 · 12.9K · 4.2M — for axis ticks and stat tiles. */
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '')}K`;
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '—' : `${v.toFixed(digits)}%`;

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };

/** Amounts from the financial analyser are in millions of their own currency. */
export function fmtMillions(v: number | null | undefined, currency: string | null | undefined, short = false): string {
  if (v === null || v === undefined) return '—';
  const sym = currency ? SYMBOL[currency] ?? `${currency} ` : '';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (short) return a >= 1000 ? `${sign}${sym}${(a / 1000).toFixed(1).replace(/\.0$/, '')}B` : `${sign}${sym}${compact(a)}M`;
  return a >= 1000 ? `${sign}${sym}${(a / 1000).toFixed(2)} billion` : `${sign}${sym}${a.toFixed(1)} million`;
}

export const fmtBytes = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
