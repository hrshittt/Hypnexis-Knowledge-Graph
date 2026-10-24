interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'section' | 'div' | 'article';
  padded?: boolean;
}

export function Card({ as: Tag = 'section', padded = false, className = '', children, ...rest }: CardProps) {
  return (
    <Tag className={`rounded-xl border border-line bg-white shadow-card ${padded ? 'p-5' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, description, icon, actions, className = '' }: CardHeaderProps) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5 ${className}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-ink-muted">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-6 text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{description}</p>}
        </div>
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
