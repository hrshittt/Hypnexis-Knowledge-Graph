import { useMemo, useState } from 'react';
import { CHART, niceTicks, seriesColor, textWidth, useWidth } from './theme';

export interface LineSeries {
  key: string;
  label: string;
  values: (number | null)[];
  color?: string;
}

interface Props {
  categories: string[];
  series: LineSeries[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  height?: number;
  /** categories whose points are hollow (partial data), with a note under the tick */
  partial?: Record<string, string>;
  yMin?: number;
  yMax?: number;
  ariaLabel: string;
}

const TOP = 14;

/** Multi-series line chart: 2px lines, ≥ 8px markers with a surface ring, crosshair tooltip, end labels. */
export function LineChart({ categories, series, format, axisFormat = format, height = 200, partial = {}, yMin, yMax, ariaLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ticks = useMemo(() => niceTicks(yMin ?? Math.min(0, ...vals), yMax ?? Math.max(...vals, 1), 4),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vals.join(','), yMin, yMax]);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const left = Math.max(30, ...ticks.map((t) => textWidth(axisFormat(t), 11))) + 16;
  const endLabelW = series.length <= 4 ? Math.min(120, Math.max(...series.map((s) => textWidth(s.label, 11.5))) + 18) : 8;
  const right = endLabelW;
  const bottom = Object.keys(partial).length ? 40 : 26;
  const plotW = Math.max(40, width - left - right);
  const step = categories.length > 1 ? plotW / (categories.length - 1) : 0;
  const x = (i: number) => left + (categories.length > 1 ? i * step : plotW / 2);
  const y = (v: number) => TOP + (height - TOP) * (1 - (v - lo) / (hi - lo || 1));

  // End labels only when they don't collide; otherwise the legend + tooltip carry identity.
  const ends = series.map((s, i) => {
    const last = [...s.values.keys()].reverse().find((k) => s.values[k] !== null);
    return last === undefined ? null : { i, y: y(s.values[last] as number), x: x(last), label: s.label };
  }).filter((e): e is { i: number; y: number; x: number; label: string } => e !== null);
  const sorted = [...ends].sort((a, b) => a.y - b.y);
  const collide = sorted.some((e, k) => k > 0 && e.y - sorted[k - 1].y < 13);
  const showEnds = series.length <= 4 && !collide;

  const pick = (clientX: number, rect: DOMRect) => {
    if (!categories.length) return;
    const px = clientX - rect.left;
    const i = categories.length > 1 ? Math.round((px - left) / step) : 0;
    setHover(Math.max(0, Math.min(categories.length - 1, i)));
  };

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height + bottom} role="img" aria-label={ariaLabel} style={{ fontFamily: CHART.font, display: 'block' }}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setHover(null)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((h) => Math.min(categories.length - 1, (h ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? categories.length) - 1));
        }}
        onBlur={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke={t === lo ? CHART.axis : CHART.grid} strokeWidth={1} />
            <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHART.tick} className="num">{axisFormat(t)}</text>
          </g>
        ))}
        {categories.map((c, i) => (
          <g key={c}>
            <text x={x(i)} y={height + 16} textAnchor="middle" fontSize={11.5} fill={CHART.ink}>{c}</text>
            {c in partial && <text x={x(i)} y={height + 30} textAnchor="middle" fontSize={10.5} fill={CHART.tick}>{partial[c]}</text>}
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={height} stroke={CHART.axis} strokeWidth={1} />}
        {series.map((s, si) => {
          const color = s.color ?? seriesColor(si);
          const segs: string[] = [];
          let cur = '';
          s.values.forEach((v, i) => {
            if (v === null) { if (cur) segs.push(cur); cur = ''; return; }
            cur += `${cur ? 'L' : 'M'}${x(i)},${y(v)}`;
          });
          if (cur) segs.push(cur);
          return (
            <g key={s.key}>
              {segs.map((d, k) => <path key={k} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
              {s.values.map((v, i) => v === null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4}
                  fill={categories[i] in partial ? '#fff' : color} stroke={categories[i] in partial ? color : '#fff'} strokeWidth={2} />
              ))}
            </g>
          );
        })}
        {showEnds && ends.map((e) => (
          <g key={e.i}>
            <line x1={e.x + 8} x2={e.x + 14} y1={e.y} y2={e.y} stroke={series[e.i].color ?? seriesColor(e.i)} strokeWidth={2} />
            <text x={e.x + 17} y={e.y} dy="0.32em" fontSize={11.5} fill={CHART.ink}>{e.label}</text>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-1 z-10 min-w-[150px] -translate-x-1/2 rounded-lg border border-line bg-white px-2.5 py-2 text-[12px] shadow-pop"
          style={{ left: Math.min(Math.max(x(hover), 85), width - 85) }}>
          <div className="mb-1 font-medium text-ink-muted">{categories[hover]}{categories[hover] in partial ? ` · ${partial[categories[hover]]}` : ''}</div>
          {series.map((s, si) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color ?? seriesColor(si) }} />
              <span className="num font-semibold text-ink">{s.values[hover] === null ? '—' : format(s.values[hover] as number)}</span>
              <span className="truncate text-ink-muted">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
