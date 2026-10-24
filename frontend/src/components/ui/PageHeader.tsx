interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, icon, actions, meta, className = '' }: PageHeaderProps) {
  return (
    <header className={`flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 [&_svg]:h-5 [&_svg]:w-5">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-[14px] leading-relaxed text-ink-muted">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Consistent page container used by every app page. */
export function Page({ children, className = '', wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full ${wide ? 'max-w-[1600px]' : 'max-w-7xl'} animate-fade-in px-4 py-6 sm:px-6 lg:px-8 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, actions, className = '' }: { children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`}>
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {actions}
    </div>
  );
}
