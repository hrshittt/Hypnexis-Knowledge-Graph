import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Table({ children, className = '', caption }: { children: React.ReactNode; className?: string; caption?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-left text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className = '', align = 'left', ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th scope="col" className={`whitespace-nowrap border-b border-line bg-canvas/70 px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted ${
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''} ${className}`} {...rest}>
      {children}
    </th>
  );
}

export function Td({ children, className = '', align = 'left', ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td className={`border-b border-line px-3 py-2.5 align-top text-ink ${align === 'right' ? 'num text-right' : align === 'center' ? 'text-center' : ''} ${className}`} {...rest}>
      {children}
    </td>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex items-center justify-between gap-3 px-1 py-3 text-[13px] text-ink-muted" aria-label="Pagination">
      <span className="num">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-white text-ink-soft hover:bg-canvas disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="num px-2">Page {page} of {pages}</span>
        <button onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-white text-ink-soft hover:bg-canvas disabled:opacity-40">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
