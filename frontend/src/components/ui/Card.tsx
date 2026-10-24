interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'section' | 'div' | 'article';
  padded?: boolean;
}

/** A quiet panel: one hairline border, no shadow. Use it for tables, charts and forms, not as page decoration. */
export function Card({ as: Tag = 'section', padded = false, className = '', children, ...rest }: CardProps) {
  return (
    <Tag className={`rounded-xl border border-line bg-white ${padded ? 'p-5' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** accepted for compatibility; panel headings stay text-only to keep the interface calm */
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, description, actions, className = '' }: CardHeaderProps) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 px-5 pb-2 pt-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-6 tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

/** Small label + value pair used in detail panels. */
export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] text-ink">{children}</dd>
    </div>
  );
}
