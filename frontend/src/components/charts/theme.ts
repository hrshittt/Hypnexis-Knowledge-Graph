import { useEffect, useRef, useState } from 'react';

/**
 * Categorical series slots, assigned in this fixed order and never cycled. Validated with the
 * dataviz palette checker on white: lightness band, chroma floor, adjacent CVD ΔE ≥ 24, normal-vision
 * ΔE ≥ 25, every slot ≥ 3:1 contrast. Charts carry at most four series; more folds into a table.
 */
export const SERIES = ['#238636', '#2a78d6', '#eb6834', '#6250d6'] as const;

/** De-emphasis / "not an outcome" fills (pending, not recorded, context bars). */
export const DEEMPH = '#C5CEC6';
export const DEEMPH_LIGHT = '#E3E8E3';

export const CHART = {
  grid: '#EDF1ED',      // hairline gridlines, one step off the white surface
  axis: '#CFD8D0',      // baseline
  tick: '#647067',      // muted ink (5.2:1 on white)
  ink: '#17211B',
  hover: 'rgba(23, 33, 27, 0.04)',
  font: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
};

export const seriesColor = (i: number) => SERIES[Math.min(i, SERIES.length - 1)];

function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * 10 ** exp;
}

/** Clean axis ticks that always include zero when the data spans it. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    if (max === 0) return [0, 1];
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, count - 1), true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Rounded data-end (4px), square at the baseline. Works for bars below zero too. */
export function columnPath(x: number, yBase: number, yEnd: number, w: number, r = 4): string {
  const h = Math.abs(yEnd - yBase);
  const rr = Math.min(r, h, w / 2);
  if (h < 0.5) return '';
  if (yEnd < yBase) {
    return `M${x},${yBase}V${yEnd + rr}Q${x},${yEnd} ${x + rr},${yEnd}H${x + w - rr}Q${x + w},${yEnd} ${x + w},${yEnd + rr}V${yBase}Z`;
  }
  return `M${x},${yBase}V${yEnd - rr}Q${x},${yEnd} ${x + rr},${yEnd}H${x + w - rr}Q${x + w},${yEnd} ${x + w},${yEnd - rr}V${yBase}Z`;
}

/** Width of an element, kept in sync with ResizeObserver. */
export function useWidth<T extends HTMLElement>(initial = 600): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Rough text width for label-fit decisions (Inter at the given size). */
export const textWidth = (s: string, size = 11) => s.length * size * 0.64;
