import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { InfoTip } from './Overlay';

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  /** shown when the value can't be computed from the data */
  unavailable?: string | null;
  sub?: React.ReactNode;
  delta?: { value: number; label: string; goodWhenUp?: boolean; unit?: string } | null;
  definition?: React.ReactNode;
  footer?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function StatTile({ label, value, unavailable, sub, delta, definition, footer, badge, className = '' }: StatTileProps) {
  return (
    <div className={`flex min-w-0 flex-col border-l-2 border-line py-1 pl-4 transition-colors hover:border-brand-600 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[12.5px] font-medium text-ink-muted">{label}</span>
          {definition && <InfoTip label={`How “${label}” is defined`}>{definition}</InfoTip>}
        </div>
        {badge}
      </div>
      {unavailable ? (
        <div className="mt-2">
          <div className="text-[15px] font-medium text-ink-faint">Not available</div>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">{unavailable}</p>
        </div>
      ) : (
        <div className="mt-1.5 text-[24px] font-semibold leading-tight tracking-tight text-ink">{value}</div>
      )}
      {sub && !unavailable && <div className="mt-0.5 text-[12px] leading-snug text-ink-muted">{sub}</div>}
      {delta && !unavailable && <Delta {...delta} />}
      {footer && <div className="mt-auto pt-2.5">{footer}</div>}
    </div>
  );
}

function Delta({ value, label, goodWhenUp = true, unit = '%' }: { value: number; label: string; goodWhenUp?: boolean; unit?: string }) {
  const up = value > 0;
  const flat = value === 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="mt-1 flex items-center gap-1 text-[12px]">
      <span className={`inline-flex items-center gap-0.5 font-medium ${good === null ? 'text-ink-muted' : good ? 'text-brand-700' : 'text-danger-ink'}`}>
        <Icon className="h-3.5 w-3.5" />
        {up ? '+' : ''}{value.toFixed(1)}{unit}
      </span>
      <span className="text-ink-muted">{label}</span>
    </div>
  );
}
