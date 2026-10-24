interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** accepted for compatibility; page titles stay text-only */
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, meta, className = '' }: PageHeaderProps) {
  return (
    <header className={`flex flex-wrap items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-[14.5px] leading-relaxed text-ink-muted">{description}</p>}
        {meta && <div className="mt-2.5 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Consistent page container used by every app page. */
export function Page({ children, className = '', wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full ${wide ? 'max-w-[1600px]' : 'max-w-7xl'} animate-page-in px-4 py-7 sm:px-6 lg:px-10 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, actions, className = '' }: { children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`}>
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">{children}</h2>
      {actions}
    </div>
  );
}
