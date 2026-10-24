import { useMemo, useState } from 'react';
import { CHART, columnPath, niceTicks, seriesColor, textWidth, useWidth } from './theme';

export interface ColumnSeries {
  key: string;
  label: string;
  values: (number | null)[];
  color?: string;
}

interface Props {
  categories: string[];
  series: ColumnSeries[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  height?: number;
  /** categories drawn lighter (e.g. an ongoing, partial cycle) with a note under the tick */
  dimmed?: Record<string, string>;
  ariaLabel: string;
}

const PLOT_TOP = 12;

/** Grouped vertical columns: ≤ 24px bars, 2px gap inside a group, 4px rounded data-end, one y-axis. */
export function ColumnChart({ categories, series, format, axisFormat = format, height = 200, dimmed = {}, ariaLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const { ticks, y, left, bottom } = useMemo(() => {
    const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    const t = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals, 0), 4);
    const lo = t[0];
    const hi = t[t.length - 1];
    const l = Math.max(30, ...t.map((v) => textWidth(axisFormat(v), 11))) + 16;
    const b = Object.keys(dimmed).length ? 40 : 26;
    return { ticks: t, left: l, bottom: b, y: (v: number) => PLOT_TOP + (height - PLOT_TOP) * (1 - (v - lo) / (hi - lo || 1)) };
  }, [series, height, axisFormat, dimmed]);

  const plotW = Math.max(40, width - left - 8);
  const band = plotW / Math.max(1, categories.length);
  const n = Math.max(1, series.length);
  const barW = Math.max(4, Math.min(24, (band * 0.72 - (n - 1) * 2) / n));
  const groupW = n * barW + (n - 1) * 2;
  const base = y(0);
  const totalH = height + bottom;

  const tip = hover === null ? null : {
    x: left + band * hover + band / 2,
    rows: series.map((s, i) => ({ label: s.label, color: s.color ?? seriesColor(i), v: s.values[hover] })),
    cat: categories[hover],
  };

  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(null)}>
      <svg width={width} height={totalH} role="img" aria-label={ariaLabel} style={{ fontFamily: CHART.font, display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
            <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHART.tick} className="num">{axisFormat(t)}</text>
          </g>
        ))}
        {categories.map((c, ci) => {
          const gx = left + band * ci + (band - groupW) / 2;
          const dim = c in dimmed;
          return (
            <g key={c}>
              {hover === ci && <rect x={left + band * ci} y={PLOT_TOP} width={band} height={height - PLOT_TOP} fill={CHART.hover} />}
              {series.map((s, si) => {
                const v = s.values[ci];
                if (v === null || v === undefined) return null;
                return (
                  <path key={s.key} d={columnPath(gx + si * (barW + 2), base, y(v), barW)} fill={s.color ?? seriesColor(si)}
                    fillOpacity={dim ? 0.45 : 1} />
                );
              })}
              <text x={left + band * ci + band / 2} y={height + 16} textAnchor="middle" fontSize={11.5} fill={CHART.ink}>
                {c.length > 14 && band < 90 ? `${c.slice(0, 12)}…` : c}
              </text>
              {dim && (
                <text x={left + band * ci + band / 2} y={height + 30} textAnchor="middle" fontSize={10.5} fill={CHART.tick}>{dimmed[c]}</text>
              )}
              <rect x={left + band * ci} y={PLOT_TOP} width={band} height={height - PLOT_TOP + bottom} fill="transparent"
                tabIndex={0} role="graphics-symbol"
                aria-label={`${c}${dim ? ` (${dimmed[c]})` : ''}: ${series.map((s) => `${s.label} ${s.values[ci] === null ? 'no data' : format(s.values[ci] as number)}`).join(', ')}`}
                onPointerEnter={() => setHover(ci)} onFocus={() => setHover(ci)} onBlur={() => setHover(null)}
                style={{ outline: 'none' }} />
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="pointer-events-none absolute top-1 z-10 min-w-[140px] -translate-x-1/2 rounded-lg border border-line bg-white px-2.5 py-2 text-[12px] shadow-pop"
          style={{ left: Math.min(Math.max(tip.x, 80), width - 80) }}>
          <div className="mb-1 font-medium text-ink-muted">{tip.cat}{tip.cat in dimmed ? ` · ${dimmed[tip.cat]}` : ''}</div>
          {tip.rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2">
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="num font-semibold text-ink">{r.v === null || r.v === undefined ? '—' : format(r.v)}</span>
              <span className="truncate text-ink-muted">{r.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
