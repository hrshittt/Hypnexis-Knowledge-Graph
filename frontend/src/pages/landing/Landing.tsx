import { Suspense, lazy, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, AudioLines, BadgeCheck, FileText, KeyRound, Lock, MessageSquareText, PhoneCall, ScanText, ShieldCheck, Upload,
  UsersRound, Waypoints,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useDocumentTitle } from '../../lib/hooks';
import { ButtonLink } from '../../components/ui/Button';
import { Reveal, RotatingWord, useAutoStep, useInView } from '../../components/motion/Motion';
import GraphExplainer from '../../components/explain/GraphExplainer';
import HeroGraph, { HERO_EXAMPLES } from './HeroGraph';
import UseCases from './UseCases';

const LiveGraphPreview = lazy(() => import('./LiveGraphPreview'));

const DEMO_QUESTION = 'How is the Clean Horizon Act connected to childhood asthma?';

function Eyebrow({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return <p className={`text-[13px] font-semibold uppercase tracking-[0.14em] ${dark ? 'text-brand-300' : 'text-brand-700'}`}>{children}</p>;
}

function H2({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`font-display text-[38px] leading-[1.04] tracking-[-0.005em] sm:text-[50px] ${className}`}>{children}</h2>;
}

export default function Landing() {
  useDocumentTitle('');
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  const [heroHover, setHeroHover] = useState(false);
  const [ex, setEx] = useAutoStep(HERO_EXAMPLES.length, 7000, heroHover);

  return (
    <>
      {/* ── Hero: what Paheli is, in one line ───────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 dot-grid [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_70%)]" aria-hidden />
        <div className="mx-auto grid max-w-7xl items-center gap-x-10 gap-y-16 px-4 pb-24 pt-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:px-8 lg:pb-28 lg:pt-20">
          <div>
            <p className="inline-flex animate-fade-in items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-[13px] text-ink-soft">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-brand-500" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-600" />
              </span>
              The AI knowledge graph for your documents
            </p>
            <h1 className="mt-6 font-display text-[50px] leading-[0.98] tracking-[-0.01em] text-ink sm:text-[64px] lg:text-[78px]">
              <span className="block animate-blur-in">Ask your</span>
              <span className="block text-brand-700">
                <RotatingWord words={HERO_EXAMPLES.map((e) => e.word)} index={ex} className="italic" />
              </span>
              <span className="block animate-blur-in [animation-delay:120ms]">anything.</span>
            </h1>
            <p className="mt-7 max-w-xl animate-slide-up text-[17.5px] leading-relaxed text-ink-soft [animation-delay:200ms]">
              Paheli reads your documents, connects every person, company, number and rule into a knowledge graph,
              and answers your questions in plain language, with the exact page each answer came from.
            </p>
            <div className="mt-9 flex animate-slide-up flex-wrap gap-3 [animation-delay:300ms]">
              <ButtonLink to={signedIn ? '/app' : '/register'} size="lg" className="group">
                {signedIn ? 'Open Paheli' : 'Get started free'} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </ButtonLink>
              <ButtonLink to="/#explained" size="lg" variant="secondary">What’s a knowledge graph?</ButtonLink>
            </div>
            <FlowStrip />
          </div>
          <div className="animate-fade-in [animation-delay:250ms]" onMouseEnter={() => setHeroHover(true)} onMouseLeave={() => setHeroHover(false)}>
            <HeroGraph index={ex} />
            <div className="mt-12 flex justify-center gap-1.5 sm:mt-10" role="tablist" aria-label="Example questions">
              {HERO_EXAMPLES.map((e, i) => (
                <button key={e.word} role="tab" aria-selected={i === ex} aria-label={`Example: ${e.word}`} onClick={() => setEx(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === ex ? 'w-6 bg-ink' : 'w-1.5 bg-ink/20 hover:bg-ink/40'}`} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <Marquee />

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how" className="scroll-mt-20 py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-3xl">
            <Eyebrow>How it works</Eyebrow>
            <H2 className="mt-3 text-ink">From a pile of files to answers you can check, in three steps.</H2>
          </Reveal>
          <HowSteps />
        </div>
      </section>

      {/* ── Knowledge graphs, explained for everyone ─────────────────────── */}
      <section id="explained" className="scroll-mt-16 bg-canvas py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-3xl">
            <Eyebrow>Knowledge graphs, explained</Eyebrow>
            <H2 className="mt-3 text-ink">A map of what is connected to what, <span className="italic text-brand-700">and why.</span></H2>
            <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-ink-muted">
              Never heard the term? This short walkthrough uses four real sentences from our sample documents to show
              how Paheli turns text into a map, and how the map answers questions no single document can.
            </p>
          </Reveal>
          <Reveal className="mt-14"><GraphExplainer /></Reveal>
          <Reveal className="mt-10">
            <Link to={`/demo?q=${encodeURIComponent(DEMO_QUESTION)}`} className="group inline-flex items-center gap-1.5 text-[15px] font-medium text-brand-700">
              <span className="link-draw">Ask this question in the live demo</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ── Use cases ────────────────────────────────────────────────────── */}
      <section id="use-cases" className="scroll-mt-20 py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-3xl">
            <Eyebrow>Who it’s for</Eyebrow>
            <H2 className="mt-3 text-ink">One platform for every team that works from documents.</H2>
          </Reveal>
          <Reveal className="mt-12"><UseCases signedIn={signedIn} /></Reveal>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="scroll-mt-20 border-t border-line py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-3xl">
            <Eyebrow>Features</Eyebrow>
            <H2 className="mt-3 text-ink">Type it, say it, scan it. <span className="italic text-brand-700">Paheli answers.</span></H2>
          </Reveal>
          <Features />
        </div>
      </section>

      {/* ── Live graph ───────────────────────────────────────────────────── */}
      <section id="graph" className="scroll-mt-20 pb-24 lg:pb-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <Eyebrow>Live demo</Eyebrow>
              <H2 className="mt-3 text-ink">See a real graph, built from sample documents.</H2>
              <p className="mt-4 text-[16px] leading-relaxed text-ink-muted">
                Drag it, zoom it, click a dot. Coloured areas are topics Paheli discovered in the text. Everything here
                is fictional sample data.
              </p>
            </div>
            <ButtonLink to="/demo" variant="secondary" className="group">Open the interactive demo <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></ButtonLink>
          </Reveal>
          <Reveal className="mt-10">
            <div className="h-[480px] overflow-hidden rounded-2xl bg-canvas">
              <Suspense fallback={<div className="skeleton-shimmer h-full w-full" />}>
                <LiveGraphPreview />
              </Suspense>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Trust ────────────────────────────────────────────────────────── */}
      <section id="trust" className="scroll-mt-16 bg-ink py-24 text-white lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-3xl">
            <Eyebrow dark>Evidence and security</Eyebrow>
            <H2 className="mt-3">Built for work where you have to <span className="italic text-brand-300">show your sources.</span></H2>
          </Reveal>
          <div className="mt-14 grid gap-14 lg:grid-cols-2">
            <TrustList title="Every answer shows its work" items={[
              ['Sources, pages and sections', 'Citations open the exact passage, with the supporting sentence highlighted.'],
              ['Says “I don’t know”', 'When your documents don’t contain the answer, Paheli says so instead of guessing.'],
              ['Reported versus calculated', 'Figures say whether a document stated them or Paheli computed them, and how.'],
              ['Potential, never assumed', 'Laws are listed as potentially applicable, with the facts you would still need to confirm.'],
            ]} />
            <TrustList title="Private by default" items={[
              ['Isolated workspaces', 'Each workspace has its own documents and graph. Non-members can’t even see it exists.'],
              ['Roles that mean something', 'Owner, analyst and viewer permissions are checked by the server, not just hidden in the interface.'],
              ['OCR in your browser', 'Scanned pages are read on your own device; only the text you choose to add is uploaded.'],
              ['Data minimisation', 'Student names, contact details and sensitive characteristics are never imported.'],
            ]} icons={[Lock, ShieldCheck, ScanText, KeyRound]} />
          </div>
        </div>
      </section>

      {/* ── Final call to action ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-28 lg:py-36">
        <div className="pointer-events-none absolute inset-0 -z-10 dot-grid [mask-image:radial-gradient(ellipse_at_center,black,transparent_65%)]" aria-hidden />
        <Reveal className="mx-auto max-w-4xl px-4 text-center sm:px-6" variant="blur">
          <h2 className="font-display text-[46px] leading-[1] text-ink sm:text-[72px]">
            Every question <span className="italic text-brand-700">has connections.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-ink-muted">
            Load the sample documents to explore, then bring your own. Paheli is ready when you are.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink to={signedIn ? '/app' : '/register'} size="lg" className="group">
              {signedIn ? 'Open Paheli' : 'Create your free account'} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </ButtonLink>
            <ButtonLink to="/demo" size="lg" variant="secondary">Try the live demo</ButtonLink>
          </div>
          <p className="mt-6 inline-flex items-center gap-2 text-[13.5px] text-ink-muted">
            <PhoneCall className="h-4 w-4 text-brand-700" /> Prefer to talk? Sign in, tap the phone icon, and Paheli will call you.
          </p>
        </Reveal>
      </section>
    </>
  );
}

/** Upload → connect → ask, with a dashed connector that flows left to right. */
function FlowStrip() {
  const steps = [
    { icon: Upload, label: 'Documents' },
    { icon: Waypoints, label: 'Knowledge graph' },
    { icon: MessageSquareText, label: 'Cited answers' },
  ];
  return (
    <ol className="mt-12 flex animate-slide-up flex-wrap items-center gap-x-2 gap-y-3 text-[13px] text-ink-soft sm:gap-x-3 sm:text-[13.5px] [animation-delay:420ms]" aria-label="How Paheli works">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2 sm:gap-3">
          {i > 0 && (
            <svg viewBox="0 0 40 8" preserveAspectRatio="none" className="h-2 w-5 text-ink-faint sm:w-10" aria-hidden>
              <line x1="0" y1="4" x2="34" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" className="animate-dash-flow" />
              <polygon points="40,4 33,0.5 33,7.5" fill="currentColor" />
            </svg>
          )}
          <span className="flex items-center gap-2">
            <s.icon className="hidden h-4 w-4 text-brand-700 sm:block" /> {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Marquee() {
  const items = ['Annual reports', 'Board packs', 'Research papers', 'Laws & regulations', 'Policy briefs', 'Placement spreadsheets',
    'Circulars & notices', 'Contracts', 'Scanned pages', 'Meeting minutes', 'Grant agreements', 'Handbooks'];
  return (
    <div className="border-y border-line bg-white py-5" aria-label="Documents Paheli works with">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <span className="hidden shrink-0 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-ink-muted sm:block">Works with</span>
        <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
          <ul className="flex w-max animate-marquee gap-10 hover:[animation-play-state:paused]">
            {[...items, ...items].map((t, i) => (
              <li key={i} aria-hidden={i >= items.length} className="flex shrink-0 items-center gap-2 text-[15px] text-ink-soft">
                <FileText className="h-4 w-4 text-ink-faint" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function HowSteps() {
  const [ref, seen] = useInView<HTMLOListElement>();
  const steps = [
    { title: 'Add your documents', body: 'Upload PDFs, text files or spreadsheets. Photographed or scanned pages are read with OCR right in your browser.' },
    { title: 'Paheli connects the dots', body: 'It finds the people, companies, numbers, places and rules in every sentence and links them into one knowledge graph.' },
    { title: 'Ask in plain language', body: 'Type, talk, or have Paheli call you. Every answer comes with the sentence, file and page it came from.' },
  ];
  return (
    <ol ref={ref} className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
      {steps.map((s, i) => (
        <li key={s.title} className="relative pt-8">
          <span className="absolute inset-x-0 top-0 h-px bg-line" aria-hidden />
          <span className="absolute left-0 top-0 h-px w-full origin-left bg-brand-600 transition-transform duration-1000 ease-out"
            style={{ transform: seen ? 'scaleX(1)' : 'scaleX(0)', transitionDelay: `${i * 350}ms` }} aria-hidden />
          <span className="font-display text-[56px] leading-none text-brand-700">{String(i + 1).padStart(2, '0')}</span>
          <h3 className="mt-5 text-[19px] font-semibold tracking-tight text-ink">{s.title}</h3>
          <p className="mt-2 text-[15.5px] leading-relaxed text-ink-muted">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

function Features() {
  const items = [
    { icon: BadgeCheck, title: 'Answers with receipts', body: 'Every answer cites the sentence, file and page it used. When the documents don’t say, Paheli tells you instead of guessing.' },
    { icon: Waypoints, title: 'A graph anyone can read', body: 'See how people, companies, numbers and rules connect. Plain-language labels and a built-in guide explain what you are looking at.' },
    { icon: AudioLines, title: 'Voice-to-voice assistant', body: 'Talk to Paheli and hear the answer read back. It listens again when it finishes, so the conversation keeps going hands-free.', tag: 'New' },
    { icon: PhoneCall, title: 'Paheli calls you', body: 'Enter your phone number and Paheli rings you for a conversation about knowledge graphs and the platform.', tag: 'New' },
    { icon: ScanText, title: 'OCR for scans and photos', body: 'Turn a photographed page or a scanned PDF into text in your browser, check it, and add it to your graph.', tag: 'New' },
    { icon: UsersRound, title: 'Private team workspaces', body: 'Separate spaces for each team and dataset, with owner, analyst and viewer roles enforced on the server.' },
  ];
  return (
    <div className="mt-16 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f, i) => (
        <Reveal key={f.title} delay={(i % 3) * 90} className="group border-t border-line pt-6">
          <div className="flex items-center gap-3">
            <f.icon className="h-6 w-6 text-brand-700 transition-transform duration-300 group-hover:-translate-y-0.5" strokeWidth={1.6} />
            {f.tag && <span className="rounded-full bg-spark-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warn-ink">{f.tag}</span>}
          </div>
          <h3 className="mt-4 text-[18px] font-semibold tracking-tight text-ink">{f.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{f.body}</p>
        </Reveal>
      ))}
    </div>
  );
}

function TrustList({ title, items, icons }: { title: string; items: [string, string][]; icons?: React.ComponentType<{ className?: string }>[] }) {
  return (
    <Reveal>
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/60">{title}</h3>
      <ul className="mt-6 divide-y divide-white/10 border-y border-white/10">
        {items.map(([t, b], i) => {
          const Icon = icons?.[i] ?? BadgeCheck;
          return (
            <li key={t} className="flex gap-4 py-5">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-300" />
              <div>
                <p className="text-[16px] font-semibold">{t}</p>
                <p className="mt-1 text-[14.5px] leading-relaxed text-white/65">{b}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Reveal>
  );
}
