import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, BookMarked, CheckCircle2, FileSearch2, FileText, GitBranch, KeyRound, Layers, Lock,
  MessageSquareText, Network, ScanSearch, ShieldCheck, Sparkles, UsersRound,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useDocumentTitle } from '../../lib/hooks';
import { WORKSPACE_TYPES } from '../../lib/workspaceTypes';
import { ButtonLink } from '../../components/ui/Button';
import { GraphIllustration } from '../../components/brand/GraphIllustration';

const LiveGraphPreview = lazy(() => import('./LiveGraphPreview'));

/**
 * Fades a block in as it scrolls into view. Content is never gated on the animation: blocks already on
 * screen, reduced-motion users, browsers without IntersectionObserver and print all get it immediately.
 */
function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'pending' | 'shown'>('idle');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // above the fold: leave it alone
    setState('pending');
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setState('shown'); io.disconnect(); } }, { rootMargin: '0px 0px -40px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`${state === 'pending' ? 'reveal-pending' : state === 'shown' ? 'animate-slide-up' : ''} ${className}`}
      style={state === 'shown' ? { animationDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-semibold uppercase tracking-wider text-brand-700">{children}</p>;
}

export default function Landing() {
  useDocumentTitle('');
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  const solutionLink = (type: string) => (signedIn ? `/app/${type}` : `/register?workspace=${type}`);

  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-brand-50/70 to-white">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:px-8 lg:pb-24 lg:pt-20">
          <div className="animate-slide-up">
            <Eyebrow>Knowledge graph intelligence platform</Eyebrow>
            <h1 className="mt-3 max-w-xl text-[38px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[46px]">
              Turn complex information into connected intelligence.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
              Explore financial performance, research, regulations, and placement outcomes through evidence-backed
              answers and interactive knowledge graphs.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to={signedIn ? '/app' : '/register'} size="lg">
                {signedIn ? 'Open Hypnexis' : 'Get started'} <ArrowRight className="h-4 w-4" />
              </ButtonLink>
              <ButtonLink to="/demo" size="lg" variant="secondary">Explore the platform</ButtonLink>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-ink-soft">
              {['Cited answers', 'Interactive graphs', 'Role-based workspaces'].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-brand-600" />{t}</li>
              ))}
            </ul>
          </div>
          <div className="animate-fade-in [animation-delay:150ms]">
            <ProductPreview />
          </div>
        </div>
      </section>

      {/* ── Solutions ──────────────────────────────────────────────────── */}
      <section id="solutions" className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-2xl">
            <Eyebrow>Solutions</Eyebrow>
            <h2 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight text-ink">Four purpose-built workspaces, one evidence standard</h2>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-muted">
              Each workspace has its own documents, knowledge graph and members, with analysis designed for the
              questions its audience actually asks.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {WORKSPACE_TYPES.map((t, i) => (
              <Reveal key={t.type} delay={i * 70}>
                <Link to={solutionLink(t.type)}
                  className="group flex h-full flex-col rounded-xl border border-line bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-pop">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><t.icon className="h-5 w-5" /></span>
                  <h3 className="mt-4 text-[16px] font-semibold text-ink">{t.label}</h3>
                  <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-ink-muted">{t.tagline}</p>
                  <p className="mt-4 text-[12.5px] text-ink-muted">For {t.audience.toLowerCase()}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-medium text-brand-700">
                    {signedIn ? 'Open workspace' : 'Start here'} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section id="how" className="scroll-mt-20 border-y border-line bg-canvas py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-2xl">
            <Eyebrow>How Hypnexis works</Eyebrow>
            <h2 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight text-ink">From documents to answers you can verify</h2>
          </Reveal>
          <ol className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: FileText, title: 'Add your sources', body: 'Upload PDF, TXT or Markdown documents. Placement teams import CSV or Excel records with a guided column mapping.' },
              { icon: Network, title: 'Extract and connect', body: 'Entities, relationships and topic communities form a knowledge graph. Financial figures, paper structure and legal provisions are extracted with their sources.' },
              { icon: MessageSquareText, title: 'Ask in plain language', body: 'Questions are routed to the right retrieval strategy: passages, graph paths, topics or comparisons.' },
              { icon: BadgeCheck, title: 'Check the evidence', body: 'Every answer cites passages with file and page, and highlights the supporting path in the graph.' },
            ].map((s, i) => (
              <Reveal key={s.title} delay={i * 70}>
                <li className="h-full rounded-xl border border-line bg-white p-5">
                  <div className="flex items-center gap-3">
                    <span className="num flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-[13px] font-semibold text-white">{i + 1}</span>
                    <s.icon className="h-5 w-5 text-brand-700" />
                  </div>
                  <h3 className="mt-4 text-[15.5px] font-semibold text-ink">{s.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">{s.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Capabilities ───────────────────────────────────────────────── */}
      <section id="product" className="scroll-mt-20 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-2xl">
            <Eyebrow>Platform capabilities</Eyebrow>
            <h2 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight text-ink">Built for serious analysis, not chat</h2>
          </Reveal>
          <div className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Network, title: 'Interactive knowledge graphs', body: 'Zoom, search and filter entities and topics. Inspect any node or relationship down to the sentence that supports it.' },
              { icon: GitBranch, title: 'Grounded, cited answers', body: 'Answers quote source passages and graph facts. When the evidence is insufficient, Hypnexis says so instead of guessing.' },
              { icon: Layers, title: 'Financial analysis with provenance', body: 'Revenue, profit, cash flow and debt figures with period, currency, source and page. Reported and calculated values are kept apart.' },
              { icon: BookMarked, title: 'Research paper intelligence', body: 'Problem, method, data, findings and limitations, each linked to its section. Compare two papers side by side.' },
              { icon: ScanSearch, title: 'Legal applicability research', body: 'Find provisions that may apply to a situation, with obligations, conditions, exceptions and the facts still to confirm.' },
              { icon: UsersRound, title: 'Placement analytics', body: 'Placement rates, PPO conversion, recruitment funnels and company histories, each metric with its definition.' },
            ].map((c, i) => (
              <Reveal key={c.title} delay={(i % 3) * 70}>
                <div className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-brand-700 shadow-card"><c.icon className="h-5 w-5" /></span>
                  <div>
                    <h3 className="text-[15.5px] font-semibold text-ink">{c.title}</h3>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{c.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Live graph preview ─────────────────────────────────────────── */}
      <section id="graph" className="scroll-mt-20 border-y border-line bg-canvas py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <Eyebrow>Knowledge graph</Eyebrow>
              <h2 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight text-ink">See how everything connects</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-muted">
                This is the live shared demo graph, built from fictional sample documents by the same pipeline your
                workspaces use. Coloured regions are topic communities discovered in the text.
              </p>
            </div>
            <ButtonLink to="/demo" variant="secondary">Open the interactive demo <ArrowRight className="h-4 w-4" /></ButtonLink>
          </Reveal>
          <Reveal className="mt-8">
            <div className="h-[460px] overflow-hidden rounded-2xl border border-line bg-white shadow-card">
              <Suspense fallback={<div className="h-full w-full animate-pulse bg-canvas" />}>
                <LiveGraphPreview />
              </Suspense>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Evidence & traceability ────────────────────────────────────── */}
      <section id="evidence" className="scroll-mt-20 py-20">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <Reveal>
            <Eyebrow>Evidence and traceability</Eyebrow>
            <h2 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight text-ink">Every conclusion shows its work</h2>
            <ul className="mt-6 space-y-4">
              {[
                ['Sources, pages and sections', 'Citations open the exact passage, with the supporting sentence highlighted.'],
                ['Reported versus calculated', 'Financial figures say whether they were stated in a document or computed, and how.'],
                ['Disclosed versus inferred', 'Risks stated in a report are kept apart from rule-based flags derived from the numbers.'],
                ['Potential, never assumed, applicability', 'Laws are listed as potentially applicable, with the facts that would still need confirming.'],
                ['Unknown is not failure', 'Placement outcomes that weren’t recorded are reported as unknown and kept out of conversion rates.'],
              ].map(([t, b]) => (
                <li key={t} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                  <div><p className="text-[15px] font-semibold text-ink">{t}</p><p className="mt-0.5 text-[14px] leading-relaxed text-ink-muted">{b}</p></div>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={100}>
            <EvidenceCardPreview />
          </Reveal>
        </div>
      </section>

      {/* ── Security ───────────────────────────────────────────────────── */}
      <section id="security" className="scroll-mt-20 border-y border-line bg-ink py-20 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-2xl">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-brand-300">Security and responsible data handling</p>
            <h2 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight">Private by default, enforced on the server</h2>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Lock, title: 'Isolated workspaces', body: 'Each workspace has its own document store and graph. Non-members can’t see that a workspace exists.' },
              { icon: KeyRound, title: 'Secure sessions', body: 'scrypt password hashing, HttpOnly session cookies and CSRF protection on every change.' },
              { icon: ShieldCheck, title: 'Roles that mean something', body: 'Owner, analyst and viewer permissions are checked by the API, not just hidden in the interface.' },
              { icon: FileSearch2, title: 'Data minimisation', body: 'Student names, contact details and sensitive characteristics are never imported. Uploaded files are never executed.' },
            ].map((s, i) => (
              <Reveal key={s.title} delay={i * 70}>
                <div className="h-full rounded-xl border border-white/10 bg-white/[0.04] p-5">
                  <s.icon className="h-5 w-5 text-brand-300" />
                  <h3 className="mt-3 text-[15.5px] font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-white/70">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── About ──────────────────────────────────────────────────────── */}
      <section id="about" className="scroll-mt-20 py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1fr] lg:px-8">
          <Reveal>
            <Eyebrow>About Hypnexis</Eyebrow>
            <h2 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight text-ink">Connected intelligence you can defend</h2>
          </Reveal>
          <Reveal delay={80} className="space-y-4 text-[15px] leading-relaxed text-ink-soft">
            <p>
              Hypnexis brings a knowledge graph, hybrid retrieval and transparent analysis together in one workspace. It
              is designed for people who must explain where an answer came from: finance teams preparing a board pack,
              students working through a literature review, compliance teams mapping obligations, and placement offices
              reporting outcomes.
            </p>
            <p>
              It works with or without a large language model. With a Gemini API key it writes fluent summaries and
              answers. Without one it uses rule-based extraction and quotes the source directly. In both modes every
              answer is tied to evidence.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="px-4 pb-20 sm:px-6 lg:px-8">
        <Reveal className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 overflow-hidden rounded-2xl bg-brand-700 px-8 py-12 text-white sm:flex-row sm:items-center lg:px-12">
          <div className="max-w-xl">
            <h2 className="text-[26px] font-semibold leading-tight tracking-tight">Start with the workspace that fits your work</h2>
            <p className="mt-2 text-[15px] text-white/80">Load the fictional sample data to explore, then bring your own documents.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to={signedIn ? '/app' : '/register'} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-white px-5 text-[15px] font-medium text-brand-800 shadow-sm hover:bg-brand-50">
              {signedIn ? 'Open Hypnexis' : 'Create an account'} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/demo" className="inline-flex h-11 items-center rounded-lg border border-white/40 px-5 text-[15px] font-medium text-white hover:bg-white/10">Try the demo</Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}

/** A composed product view built from the app's own visual language, showing a real example from the sample corpus. */
function ProductPreview() {
  return (
    <figure>
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-pop">
        <div className="flex items-center gap-2 border-b border-line bg-canvas px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ink/15" /><span className="h-2.5 w-2.5 rounded-full bg-ink/15" /><span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
          <span className="ml-2 text-[12px] text-ink-muted">Knowledge Graph · Shared demo corpus</span>
        </div>
        <div className="grid sm:grid-cols-[1.05fr_1fr]">
          <div className="space-y-3 border-b border-line p-4 sm:border-b-0 sm:border-r">
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-sm bg-ink px-3.5 py-2 text-[13px] text-white">
              How is the Clean Horizon Act connected to childhood asthma?
            </div>
            <div className="space-y-2.5 rounded-2xl rounded-tl-sm border border-line p-3.5">
              <div className="flex flex-wrap gap-1.5 text-[11px] font-medium">
                <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-ink-soft">Multi-hop</span>
                <span className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-brand-700"><CheckCircle2 className="h-3 w-3" /> Grounded</span>
              </div>
              <div className="flex flex-wrap items-center gap-1 rounded-lg bg-canvas px-2 py-1.5 text-[11.5px]">
                {['Clean Horizon Act', 'Harbor Coal Plant', 'fine particulate pollution', 'childhood asthma'].map((n, i) => (
                  <span key={n} className="flex items-center gap-1">
                    {i > 0 && <ArrowRight className="h-3 w-3 text-ink-faint" />}
                    <span className="rounded bg-white px-1.5 py-0.5 font-medium text-ink ring-1 ring-line">{n}</span>
                  </span>
                ))}
              </div>
              <p className="text-[13px] leading-relaxed text-ink-soft">
                The Clean Horizon Act requires utilities to retire coal plants by{' '}
                <span className="whitespace-nowrap">2025<Cite n="S1" />.</span> Emissions from the Harbor Coal Plant contributed
                to fine particulate pollution, which is linked to childhood <span className="whitespace-nowrap">asthma<Cite n="S2" />.</span>
              </p>
              <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted"><FileText className="h-3 w-3" /> 2 source passages · 3 graph facts</div>
            </div>
          </div>
          <div className="relative min-h-[260px] bg-[radial-gradient(circle_at_1px_1px,#e2e8f0_1px,transparent_0)] [background-size:22px_22px]">
            <GraphIllustration className="absolute inset-0 h-full w-full p-3" />
            <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-100">
              <Sparkles className="h-3 w-3" /> Evidence path
            </span>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-[12.5px] text-ink-muted">
        Example question and cited answer from the bundled fictional sample documents.
      </figcaption>
    </figure>
  );
}

function Cite({ n }: { n: string }) {
  return <span className="ml-1 inline-flex rounded bg-brand-50 px-1 align-baseline text-[10.5px] font-semibold text-brand-700">{n}</span>;
}

function EvidenceCardPreview() {
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-white p-5 shadow-pop">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Net profit · FY2024</span>
        <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">Reported</span>
      </div>
      <p className="text-[13px] text-ink-muted">Each figure is shown with the sentence it came from:</p>
      <div className="rounded-lg border border-line bg-canvas/60 px-3 py-2.5">
        <p className="text-[13px] leading-relaxed text-ink-soft">“Net profit declined to $31.2 million in fiscal 2024 from $42.9 million…”</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-muted"><FileText className="h-3 w-3" />
          <span className="font-medium text-ink-soft">meridian_grid_financial_review_2024.txt</span> · p.1 · Financial Highlights</p>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-info-soft px-3 py-2 text-[12.5px] text-info-ink">
        <span><b className="font-semibold">Calculated:</b> Net margin = Net profit ÷ Revenue × 100</span>
        <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium">Inputs cited</span>
      </div>
      <p className="text-[11.5px] text-ink-muted">Illustration using the fictional Meridian Grid sample report.</p>
    </div>
  );
}
