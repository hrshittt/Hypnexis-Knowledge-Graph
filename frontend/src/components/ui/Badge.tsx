type Tone = 'neutral' | 'brand' | 'warn' | 'danger' | 'info' | 'outline' | 'dark';

const TONE: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-ink-soft',
  brand: 'bg-brand-50 text-brand-700',
  warn: 'bg-warn-soft text-warn-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-info-soft text-info-ink',
  outline: 'border border-line-strong bg-white text-ink-soft',
  dark: 'bg-ink text-white',
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: React.ReactNode;
}

export function Badge({ tone = 'neutral', icon, className = '', children, ...rest }: BadgeProps) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium leading-4 ${TONE[tone]} ${className}`} {...rest}>
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Marks clearly-labelled fictional demo content wherever it appears. */
export function SampleBadge({ className = '' }: { className?: string }) {
  return <Badge tone="warn" className={className} title="Fictional sample data shipped with Paheli for demonstration">Sample data</Badge>;
}

export type { Tone as BadgeTone };
