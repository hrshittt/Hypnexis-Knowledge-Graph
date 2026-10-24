import { useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';

export interface ChartTable {
  columns: string[];
  rows: (string | number | null)[][];
}

export interface LegendItem {
  label: string;
  color: string;
  kind?: 'bar' | 'line';
}

interface ChartFrameProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  legend?: LegendItem[];
  table: ChartTable;
  footnote?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Chart container: title, legend (for ≥ 2 series), the chart, and its accessible table twin. */
export function ChartFrame({ title, subtitle, legend, table, footnote, actions, children, className = '' }: ChartFrameProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <figure className={`flex min-w-0 flex-col rounded-xl border border-line bg-white p-4 shadow-card ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <figcaption className="min-w-0">
          <div className="text-[14px] font-semibold text-ink">{title}</div>
          {subtitle && <div className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{subtitle}</div>}
        </figcaption>
        <div className="flex items-center gap-1.5">
          {actions}
          <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Chart or table view">
            <button type="button" onClick={() => setView('chart')} aria-pressed={view === 'chart'} title="Chart view"
              className={`rounded p-1 ${view === 'chart' ? 'bg-canvas text-ink' : 'text-ink-faint hover:text-ink'}`}>
              <BarChart3 className="h-3.5 w-3.5" /><span className="sr-only">Chart view</span>
            </button>
            <button type="button" onClick={() => setView('table')} aria-pressed={view === 'table'} title="Table view"
              className={`rounded p-1 ${view === 'table' ? 'bg-canvas text-ink' : 'text-ink-faint hover:text-ink'}`}>
              <Table2 className="h-3.5 w-3.5" /><span className="sr-only">Table view</span>
            </button>
          </div>
        </div>
      </div>
      {legend && legend.length >= 2 && view === 'chart' && (
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5 text-[12px] text-ink-soft">
              {l.kind === 'line'
                ? <span className="h-0.5 w-3.5 rounded-full" style={{ background: l.color }} />
                : <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />}
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 min-w-0">
        {view === 'chart' ? children : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr>{table.columns.map((c, i) => (
                  <th key={i} scope="col" className={`border-b border-line px-2 py-1.5 font-semibold text-ink-muted ${i ? 'text-right' : ''}`}>{c}</th>
                ))}</tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>{r.map((v, j) => (
                    <td key={j} className={`border-b border-line px-2 py-1.5 ${j ? 'num text-right' : 'text-ink'}`}>{v ?? '—'}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {footnote && <p className="mt-2.5 text-[11.5px] leading-snug text-ink-muted">{footnote}</p>}
    </figure>
  );
}

export function ChartEmpty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-40 items-center justify-center rounded-lg bg-canvas px-4 text-center text-[13px] text-ink-muted">{children}</div>;
}
