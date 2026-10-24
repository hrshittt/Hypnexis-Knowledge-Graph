import { CheckCircle2 } from 'lucide-react';
import { Logo } from '../components/brand/Logo';
import { GraphIllustration } from '../components/brand/GraphIllustration';

const POINTS = [
  'Answers cite the exact passage, page and section they come from.',
  'Interactive knowledge graphs connect entities, topics and evidence.',
  'Separate, access-controlled workspaces for each team and dataset.',
];

/** Two-column sign-in / registration frame: brand and value on the left, a focused form card on the right. */
export default function AuthLayout({ title, subtitle, children, footer }: {
  title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-brand-50/60 lg:flex lg:flex-col">
        <div className="px-10 pt-8"><Logo /></div>
        <div className="flex flex-1 flex-col justify-center px-10 xl:px-16">
          <h2 className="max-w-md text-[28px] font-semibold leading-tight tracking-tight text-ink">
            Turn complex information into connected intelligence.
          </h2>
          <ul className="mt-6 max-w-md space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[14.5px] leading-relaxed text-ink-soft">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />{p}
              </li>
            ))}
          </ul>
          <GraphIllustration className="mt-8 w-full max-w-[460px] animate-fade-in" />
        </div>
        <p className="px-10 pb-8 text-[12.5px] text-ink-muted">Corporate · Research · Legal &amp; Policy · Placement</p>
      </aside>
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 lg:hidden"><Logo /></div>
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[420px] animate-slide-up">
            <h1 className="text-[24px] font-semibold tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[14px] text-ink-muted">{subtitle}</p>}
            <div className="mt-6">{children}</div>
            {footer && <div className="mt-6 text-center text-[13.5px] text-ink-muted">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
