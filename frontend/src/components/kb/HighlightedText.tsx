/** Renders `text` with [start, end) ranges wrapped in <mark>. Ranges may overlap or be unsorted. */
export default function HighlightedText({ text, ranges, className = '' }: { text: string; ranges: [number, number][]; className?: string }) {
  const merged: [number, number][] = [];
  [...ranges]
    .filter(([a, b]) => a >= 0 && b > a && a < text.length)
    .sort((x, y) => x[0] - y[0])
    .forEach(([a, b]) => {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, Math.min(b, text.length)]);
    });
  const parts: React.ReactNode[] = [];
  let pos = 0;
  merged.forEach(([a, b], i) => {
    if (a > pos) parts.push(text.slice(pos, a));
    parts.push(<mark key={i} className="rounded bg-amber-100 px-0.5 text-slate-900 ring-1 ring-amber-200">{text.slice(a, b)}</mark>);
    pos = b;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <p className={`whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 ${className}`}>{parts}</p>;
}
