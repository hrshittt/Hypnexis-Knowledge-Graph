import { useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { DEEMPH, SERIES, textWidth, useWidth } from './theme';

export interface BarRow {
  key: string;
  label: string;
  value: number | null;
  /** shown after the value, e.g. "8 of 33" */
  detail?: string;
  emphasis?: boolean;
}

/**
 * Horizontal single-series bars (one colour for every bar: the categories are nominal),
 * value at the bar tip, 4px rounded data-end, square at the baseline.
 */
export function BarList({ rows, format, max, ariaLabel, onSelect, color = SERIES[0] }: {
  rows: BarRow[]; format: (v: number) => string; max?: number; ariaLabel: string; onSelect?: (key: string) => void; color?: string;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="space-y-1.5" aria-label={ariaLabel}>
      {rows.map((r) => {
        const pct = r.value === null ? 0 : Math.max(0, (r.value / top) * 100);
        const Inner = onSelect ? 'button' : 'div';
        return (
          <li key={r.key}>
            <Inner {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(r.key) } : {})}
              className={`grid w-full grid-cols-[minmax(90px,34%)_1fr] items-center gap-3 rounded-md px-1 py-0.5 text-left ${onSelect ? 'hover:bg-canvas' : ''}`}
              title={r.value === null ? `${r.label}: no data` : `${r.label}: ${format(r.value)}${r.detail ? ` (${r.detail})` : ''}`}>
              <span className={`truncate text-[12.5px] ${r.emphasis ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{r.label}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="relative h-3.5 min-w-0 flex-1">
                  {r.value !== null && (
                    <span className="absolute inset-y-0 left-0 rounded-r" style={{ width: `${pct}%`, background: color, minWidth: r.value > 0 ? 2 : 0 }} />
                  )}
                </span>
                <span className="num w-[86px] shrink-0 text-right text-[12px] text-ink">
                  {r.value === null ? <span className="text-ink-faint">—</span> : format(r.value)}
                  {r.detail && <span className="block text-[10.5px] leading-3 text-ink-muted">{r.detail}</span>}
                </span>
              </span>
            </Inner>
          </li>
        );
      })}
    </ul>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  /** label colour inside the fill (white on saturated fills, ink on light ones) */
  onColor?: string;
}

/** One 100% stacked bar with a 2px surface gap between segments and a legend that carries the numbers. */
export function StackedBar({ segments, ariaLabel, total: totalOverride }: { segments: Segment[]; ariaLabel: string; total?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const total = totalOverride ?? segments.reduce((s, x) => s + x.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  const gap = 2;
  const usable = Math.max(0, width - gap * Math.max(0, visible.length - 1));
  const pctOf = (v: number) => (total ? (100 * v) / total : 0);
  return (
    <div>
      <div ref={ref} className="flex h-6 w-full overflow-hidden rounded" role="img" aria-label={ariaLabel} style={{ gap }}>
        {total === 0 && <div className="h-full w-full rounded" style={{ background: DEEMPH }} />}
        {visible.map((s) => {
          const w = (usable * s.value) / (total || 1);
          const text = `${Math.round(pctOf(s.value))}%`;
          return (
            <div key={s.key} className="flex h-full shrink-0 items-center justify-center text-[11px] font-semibold transition-opacity"
              style={{ width: w, background: s.color, color: s.onColor ?? '#fff', opacity: hover && hover !== s.key ? 0.55 : 1 }}
              onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}
              title={`${s.label}: ${s.value.toLocaleString()} (${pctOf(s.value).toFixed(1)}%)`}>
              {w > textWidth(text, 11) + 12 ? text : ''}
            </div>
          );
        })}
      </div>
      <ul className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {segments.map((s) => (
          <li key={s.key} className={`flex items-center gap-1.5 text-[12px] ${hover === s.key ? 'text-ink' : 'text-ink-soft'}`}
            onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="truncate">{s.label}</span>
            <span className="num ml-auto font-medium text-ink">{s.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
  tracked: boolean;
  conversion: number | null;
  note?: string;
  flag?: string;
}

/** Recruitment funnel: one ordered series, bar per stage scaled to the first stage, conversion between stages. */
export function FunnelChart({ steps, ariaLabel }: { steps: FunnelStep[]; ariaLabel: string }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="space-y-0.5" aria-label={ariaLabel}>
      {steps.map((s, i) => (
        <li key={s.key}>
          <div className="grid grid-cols-[minmax(110px,30%)_1fr] items-center gap-3 py-1">
            <div className="min-w-0">
              <div className={`truncate text-[12.5px] ${s.tracked ? 'text-ink' : 'text-ink-faint'}`}>{s.label}</div>
              {s.flag && <div className="text-[10.5px] font-medium text-warn-ink">{s.flag}</div>}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative h-5 flex-1">
                {s.tracked ? (
                  <div className="absolute inset-y-0 left-0 rounded-r" style={{ width: `${(100 * s.value) / top}%`, background: SERIES[0], minWidth: s.value ? 2 : 0 }} />
                ) : (
                  <div className="absolute inset-y-0 left-0 flex items-center text-[11px] text-ink-faint">not in the imported data</div>
                )}
              </div>
              <span className="num w-[70px] shrink-0 text-right text-[12.5px] font-medium text-ink">{s.tracked ? s.value.toLocaleString() : '—'}</span>
            </div>
          </div>
          {i < steps.length - 1 && s.conversion !== null && (
            <div className="grid grid-cols-[minmax(110px,30%)_1fr] gap-3">
              <span aria-hidden />
              <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                <ArrowDown className="h-3 w-3" /> {s.conversion.toFixed(1)}% continue{s.note ? ` · ${s.note}` : ''}
              </span>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
