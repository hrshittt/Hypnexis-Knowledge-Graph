import { Check } from 'lucide-react';
import { Logo } from '../components/brand/Logo';
import { GraphIllustration } from '../components/brand/GraphIllustration';

const POINTS = [
  'Answers cite the exact passage, page and section they come from.',
  'A knowledge graph shows how people, companies, numbers and rules connect.',
  'Type, talk, scan a page, or have Paheli call you.',
];

/** Two-column sign-in / registration frame: the promise on a dark panel on the left, a focused form on the right. */
export default function AuthLayout({ title, subtitle, children, footer }: {
  title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px]" aria-hidden />
        <div className="relative px-10 pt-8"><Logo inverted /></div>
        <div className="relative flex flex-1 flex-col justify-center px-10 xl:px-16">
          <h2 className="max-w-md animate-blur-in font-display text-[48px] leading-[1.02]">
            Every question <span className="italic text-brand-300">has connections.</span>
          </h2>
          <ul className="stagger mt-8 max-w-md space-y-3.5">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[15px] leading-relaxed text-white/75">
                <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-500"><Check className="h-2.5 w-2.5" strokeWidth={3.5} /></span>{p}
              </li>
            ))}
          </ul>
          <GraphIllustration className="mt-10 w-full max-w-[440px] animate-float-slow opacity-90" />
        </div>
        <p className="relative px-10 pb-8 text-[12.5px] text-white/50">Companies · Research · Legal &amp; Policy · Placement cells · Others</p>
      </aside>
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 lg:hidden"><Logo /></div>
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[420px] animate-slide-up">
            <h1 className="font-display text-[36px] leading-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[14.5px] text-ink-muted">{subtitle}</p>}
            <div className="mt-7">{children}</div>
            {footer && <div className="mt-6 text-center text-[13.5px] text-ink-muted">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
