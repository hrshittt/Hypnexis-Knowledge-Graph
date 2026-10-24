import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Pause, Play, RotateCcw } from 'lucide-react';
import { StepTimer, TypeText, prefersReducedMotion, useInView } from '../motion/Motion';

/**
 * "What is a knowledge graph?" for someone who has never heard the term. A six-step animated story built from
 * four real sentences in the bundled (fictional) sample documents, so the same question works in the live demo.
 */

type Pt = { x: number; y: number };
type NodeKey = 'act' | 'plant' | 'meridian' | 'pollution' | 'asthma' | 'town';

const TOPICS = {
  energy: { label: 'Energy & policy', color: '#238636' },
  health: { label: 'Health', color: '#2a78d6' },
} as const;

// `above` puts the name over the dot where a fact label would otherwise run into it.
const NODES: Record<NodeKey, Pt & { label: string; kind: string; r: number; topic: keyof typeof TOPICS; above?: boolean }> = {
  act: { x: 96, y: 92, r: 13, label: 'Clean Horizon Act', kind: 'law', topic: 'energy', above: true },
  plant: { x: 250, y: 168, r: 16, label: 'Harbor Coal Plant', kind: 'place', topic: 'energy' },
  meridian: { x: 112, y: 270, r: 11, label: 'Meridian Grid', kind: 'company', topic: 'energy' },
  pollution: { x: 404, y: 100, r: 15, label: 'Fine particulate pollution', kind: 'idea', topic: 'health', above: true },
  asthma: { x: 470, y: 262, r: 13, label: 'Childhood asthma', kind: 'health issue', topic: 'health' },
  town: { x: 300, y: 300, r: 10, label: 'Port Calder', kind: 'place', topic: 'health' },
};
const ORDER: NodeKey[] = ['act', 'plant', 'meridian', 'pollution', 'town', 'asthma'];

const EDGES: { id: string; from: NodeKey; to: NodeKey; label: string }[] = [
  { id: 'e1', from: 'act', to: 'plant', label: 'required closure of' },
  { id: 'e2', from: 'meridian', to: 'plant', label: 'closed' },
  { id: 'e3', from: 'plant', to: 'pollution', label: 'contributed to' },
  { id: 'e4', from: 'pollution', to: 'asthma', label: 'linked to' },
  { id: 'e5', from: 'pollution', to: 'town', label: 'found in' },
];
const PATH = ['e1', 'e3', 'e4'];

const DOCS = { report: 'Meridian Grid annual report', study: 'Port Calder health study' };
const SENTENCES: { doc: keyof typeof DOCS; parts: [string, NodeKey?][] }[] = [
  { doc: 'report', parts: [['The '], ['Clean Horizon Act', 'act'], [' required the closure of the '], ['Harbor Coal Plant', 'plant'], ['.']] },
  { doc: 'report', parts: [['Meridian Grid', 'meridian'], [' closed the '], ['Harbor Coal Plant', 'plant'], [' in March 2023.']] },
  { doc: 'study', parts: [['Emissions from the '], ['Harbor Coal Plant', 'plant'], [' contributed to '], ['fine particulate pollution', 'pollution'], [' in '], ['Port Calder', 'town'], ['.']] },
  { doc: 'study', parts: [['Fine particulate pollution', 'pollution'], [' is linked to '], ['childhood asthma', 'asthma'], [' in coastal towns.']] },
];

const STEPS = [
  { title: 'It starts with sentences', body: 'Paheli reads every sentence in your documents. Here are four sentences from two different files.', ms: 5500 },
  { title: 'It spots the things', body: 'People, companies, places, laws and ideas become dots. A bigger dot means the thing is mentioned more often.', ms: 5000 },
  { title: 'It joins them with facts', body: 'Each line is one fact taken from one sentence, such as “Meridian Grid closed Harbor Coal Plant”. The arrow shows which way the fact reads.', ms: 6000 },
  { title: 'Related things form topics', body: 'Things that are talked about together are grouped into coloured areas called topics, so the big themes stand out at a glance.', ms: 5000 },
  { title: 'Ask, and it follows the lines', body: 'No single file says how the law and asthma are connected. Paheli walks from fact to fact across both files to work it out.', ms: 9500 },
  { title: 'Every answer keeps its receipts', body: 'Click any line in a real graph to see the exact sentence it came from, with the file name. Nothing is invented.', ms: 6500 },
];

const QUESTION = 'How is the Clean Horizon Act connected to childhood asthma?';
const ANSWER = 'The Act required the Harbor Coal Plant to close. That plant’s emissions added to fine particulate pollution, which is linked to childhood asthma.';

function segment(a: Pt & { r: number }, b: Pt & { r: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const ux = dx / d;
  const uy = dy / d;
  const x1 = a.x + ux * (a.r + 4);
  const y1 = a.y + uy * (a.r + 4);
  const x2 = b.x - ux * (b.r + 6);
  const y2 = b.y - uy * (b.r + 6);
  return { x1, y1, x2, y2, ux, uy, len: Math.hypot(x2 - x1, y2 - y1), mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}

function arrowHead(x: number, y: number, ux: number, uy: number, size = 8) {
  const bx = x - ux * size;
  const by = y - uy * size;
  const px = -uy * size * 0.5;
  const py = ux * size * 0.5;
  return `${x},${y} ${bx + px},${by + py} ${bx - px},${by - py}`;
}

interface Props {
  /** 'split' puts the steps beside the picture (landing page); 'stacked' fits a dialog */
  variant?: 'split' | 'stacked';
  className?: string;
}

export default function GraphExplainer({ variant = 'split', className = '' }: Props) {
  const [ref, inView] = useInView<HTMLDivElement>('0px 0px -120px 0px');
  const [step, setStep] = useState(0);
  const [hover, setHover] = useState(false);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [run, setRun] = useState(0); // restarts the step timer and the per-step animations

  const paused = !playing || hover || !inView;
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => { setStep((s) => (s + 1) % STEPS.length); setRun((r) => r + 1); }, STEPS[step].ms);
    return () => clearTimeout(t);
  }, [step, paused, run]);

  const go = (i: number) => { setStep((i + STEPS.length) % STEPS.length); setRun((r) => r + 1); };

  const stage = <Stage step={step} run={run} active={inView} />;
  const caption = <Caption step={step} run={run} />;

  if (variant === 'stacked') {
    const s = STEPS[step];
    return (
      <div ref={ref} className={className} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <div className="relative overflow-hidden rounded-xl border border-line bg-white">
          <div className="dot-grid">{stage}</div>
          <div className="min-h-[104px] border-t border-line px-4 py-3">{caption}</div>
        </div>
        <div className="mt-4 flex items-start gap-4">
          <span className="font-display text-[34px] leading-none text-brand-700">{String(step + 1).padStart(2, '0')}</span>
          <div className="min-w-0 flex-1" aria-live="polite">
            <h3 className="text-[16px] font-semibold text-ink">{s.title}</h3>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{s.body}</p>
          </div>
        </div>
        <StepTimer className="mt-4" ms={s.ms} runKey={`${step}-${run}`} paused={paused} />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-1.5" role="tablist" aria-label="Explainer steps">
            {STEPS.map((x, i) => (
              <button key={x.title} role="tab" aria-selected={i === step} aria-label={`Step ${i + 1}: ${x.title}`} onClick={() => go(i)}
                className={`h-2 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-brand-600' : 'w-2 bg-ink/15 hover:bg-ink/30'}`} />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <PlayToggle playing={playing} onToggle={() => setPlaying((p) => !p)} />
            <NavButton label="Previous step" onClick={() => go(step - 1)}><ChevronLeft className="h-4 w-4" /></NavButton>
            <NavButton label="Next step" onClick={() => go(step + 1)}><ChevronRight className="h-4 w-4" /></NavButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={`grid items-start gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] ${className}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <ol className="order-2 lg:order-1" aria-label="How a knowledge graph is built">
        {STEPS.map((s, i) => {
          const on = i === step;
          return (
            <li key={s.title} className="border-t border-line first:border-t-0">
              <button onClick={() => go(i)} aria-current={on ? 'step' : undefined}
                className="group flex w-full items-start gap-4 py-4 text-left">
                <span className={`font-display text-[26px] leading-none transition-colors duration-300 ${on ? 'text-brand-700' : 'text-ink-faint group-hover:text-ink-muted'}`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[16px] font-semibold transition-colors ${on ? 'text-ink' : 'text-ink-muted group-hover:text-ink'}`}>{s.title}</span>
                  <span className={`grid transition-[grid-template-rows,opacity] duration-500 ${on ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                    <span className="overflow-hidden">
                      <span className="block pt-1.5 text-[14.5px] leading-relaxed text-ink-muted">{s.body}</span>
                      {on && <StepTimer className="mt-3" ms={s.ms} runKey={`${step}-${run}`} paused={paused} />}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        <li className="flex items-center gap-2 border-t border-line pt-4">
          <PlayToggle playing={playing} onToggle={() => setPlaying((p) => !p)} withLabel />
          <button onClick={() => go(0)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-canvas hover:text-ink">
            <RotateCcw className="h-3.5 w-3.5" /> Start over
          </button>
        </li>
      </ol>
      <div className="order-1 lg:sticky lg:top-24 lg:order-2">
        <div className="dot-grid relative overflow-hidden rounded-2xl">{stage}</div>
        <div className="min-h-[112px] border-t border-line pt-4">{caption}</div>
      </div>
    </div>
  );
}

function PlayToggle({ playing, onToggle, withLabel }: { playing: boolean; onToggle: () => void; withLabel?: boolean }) {
  return (
    <button onClick={onToggle} aria-label={playing ? 'Pause the explainer' : 'Play the explainer'}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-canvas hover:text-ink">
      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      {withLabel && (playing ? 'Pause' : 'Play')}
    </button>
  );
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-canvas hover:text-ink">{children}</button>
  );
}

/** The picture. Everything is always mounted; each step only changes what is visible, so transitions run both ways. */
function Stage({ step, run, active }: { step: number; run: number; active: boolean }) {
  const showNodes = step >= 1;
  const showEdges = step >= 2;
  const showTopics = step >= 3;
  const asking = step === 4;
  const receipt = step === 5;
  const pathPts = ['act', 'plant', 'pollution', 'asthma'].map((k) => NODES[k as NodeKey]);
  const pathD = pathPts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

  return (
    <div className="relative flex min-h-[340px] items-center sm:min-h-0">
      <svg viewBox="0 0 560 360" className="block h-auto w-full" aria-hidden focusable="false">
        {/* topic areas */}
        {(['energy', 'health'] as const).map((t) => {
          const pts = ORDER.filter((k) => NODES[k].topic === t).map((k) => NODES[k]);
          const top = Math.min(...pts.map((p) => p.y));
          const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
          return (
            <g key={t} style={{ opacity: showTopics ? 1 : 0, transition: 'opacity 700ms ease' }}>
              <g opacity={asking || receipt ? 0.08 : 0.13}>
                <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={TOPICS[t].color} stroke={TOPICS[t].color}
                  strokeWidth={64} strokeLinejoin="round" />
              </g>
              <text x={cx} y={top - 54} textAnchor="middle" fontSize="12.5" fontWeight="700" fill={TOPICS[t].color} letterSpacing="0.04em">
                {TOPICS[t].label.toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* facts (edges) */}
        {EDGES.map((e, i) => {
          const s = segment(NODES[e.from], NODES[e.to]);
          const onPath = asking && PATH.includes(e.id);
          const isReceipt = receipt && e.id === 'e3';
          const dim = (asking && !onPath) || (receipt && !isReceipt);
          const color = onPath || isReceipt ? '#176B2C' : '#8B968E';
          return (
            <g key={e.id} style={{ opacity: dim ? 0.25 : 1, transition: 'opacity 500ms ease' }}>
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color} strokeWidth={onPath || isReceipt ? 3 : 1.6} strokeLinecap="round"
                strokeDasharray={s.len} strokeDashoffset={showEdges ? 0 : s.len}
                style={{ transition: `stroke-dashoffset 800ms cubic-bezier(0.22,1,0.36,1) ${showEdges && step === 2 ? i * 260 : 0}ms, stroke 400ms, stroke-width 400ms` }} />
              <polygon points={arrowHead(s.x2 + s.ux * 5, s.y2 + s.uy * 5, s.ux, s.uy)} fill={color}
                style={{ opacity: showEdges ? 1 : 0, transition: `opacity 300ms ease ${showEdges && step === 2 ? i * 260 + 650 : 0}ms, fill 400ms` }} />
              <text x={s.mx} y={s.my - 7} textAnchor="middle" fontSize="11" fontWeight={onPath || isReceipt ? 700 : 500}
                fill={onPath || isReceipt ? '#0E401C' : '#5F6B63'} stroke="#fff" strokeWidth="4" paintOrder="stroke"
                style={{ opacity: showEdges ? 1 : 0, transition: `opacity 400ms ease ${showEdges && step === 2 ? i * 260 + 500 : 0}ms` }}>
                {e.label}
              </text>
            </g>
          );
        })}

        {/* the answer path, drawn hop by hop, with a dot travelling along it */}
        {asking && active && (
          <g key={`path-${run}`}>
            {PATH.map((id, i) => {
              const e = EDGES.find((x) => x.id === id)!;
              const s = segment(NODES[e.from], NODES[e.to]);
              return (
                <line key={id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#F2A93B" strokeWidth={6} strokeLinecap="round" strokeOpacity={0.45}
                  strokeDasharray={s.len} strokeDashoffset={s.len}
                  style={{ animation: `drawLine 0.7s cubic-bezier(0.22,1,0.36,1) ${0.5 + i * 0.8}s forwards` }} />
              );
            })}
            <circle r="5" fill="#F2A93B" stroke="#fff" strokeWidth="2">
              <animateMotion dur="3s" begin="0.4s" repeatCount="indefinite" path={pathD} />
            </circle>
          </g>
        )}

        {/* things (nodes) */}
        {ORDER.map((k, i) => {
          const n = NODES[k];
          const onPath = asking && ['act', 'plant', 'pollution', 'asthma'].includes(k);
          const inReceipt = receipt && (k === 'plant' || k === 'pollution');
          const dim = (asking && !onPath) || (receipt && !inReceipt);
          const fill = showTopics ? TOPICS[n.topic].color : '#141A16';
          return (
            <g key={k} style={{ opacity: showNodes ? (dim ? 0.3 : 1) : 0, transition: `opacity 500ms ease ${showNodes && step === 1 ? i * 180 : 0}ms` }}>
              <g style={{ transformBox: 'fill-box', transformOrigin: 'center', transform: showNodes ? 'scale(1)' : 'scale(0.2)',
                transition: `transform 600ms cubic-bezier(0.34,1.56,0.64,1) ${showNodes && step === 1 ? i * 180 : 0}ms` }}>
                {(onPath || inReceipt) && <circle cx={n.x} cy={n.y} r={n.r + 7} fill="none" stroke="#F2A93B" strokeWidth="2.5" strokeOpacity="0.7" />}
                <circle cx={n.x} cy={n.y} r={n.r} stroke="#fff" strokeWidth="2.5" style={{ fill, transition: 'fill 700ms ease' }} />
              </g>
              <text x={n.x} y={n.above ? n.y - n.r - 9 : n.y + n.r + 16} textAnchor="middle" fontSize="12.5" fontWeight="600" fill="#141A16"
                stroke="#fff" strokeWidth="4.5" paintOrder="stroke">{n.label}</text>
              {step === 1 && (
                <text x={n.x} y={n.above ? n.y - n.r - 24 : n.y + n.r + 30} textAnchor="middle" fontSize="10.5" fill="#5F6B63" stroke="#fff" strokeWidth="4" paintOrder="stroke">
                  {n.kind}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* step 1: the raw sentences, with the things in them marked */}
      <div className={`absolute inset-0 flex flex-col justify-center gap-2.5 overflow-y-auto bg-white/85 px-4 py-4 backdrop-blur-[1px] transition-opacity duration-500 sm:px-8 ${step === 0 ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        {SENTENCES.map((s, i) => (
          <div key={i} className={step === 0 ? 'animate-slide-up' : ''} style={{ animationDelay: `${i * 220}ms` }}>
            <p className="text-[13.5px] leading-snug text-ink sm:text-[15px]">
              {s.parts.map(([t, k], j) => (k
                ? <mark key={j} className="rounded bg-spark-soft px-0.5 font-medium text-ink">{t}</mark>
                : <span key={j}>{t}</span>))}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-ink-muted"><FileText className="h-3 w-3" /> {DOCS[s.doc]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Caption({ step, run }: { step: number; run: number }) {
  if (step === 0) {
    return <p className="text-[13.5px] text-ink-muted"><mark className="rounded bg-spark-soft px-1 text-ink">Highlighted</mark> words are the things Paheli will turn into dots.</p>;
  }
  if (step === 1) {
    return (
      <Legend items={[
        [<span key="d" className="inline-block h-3 w-3 rounded-full bg-ink" />, 'A dot is one thing — a person, company, place, law or idea.'],
        [<span key="b" className="inline-block h-4 w-4 rounded-full bg-ink" />, 'Bigger dots are mentioned more often.'],
      ]} />
    );
  }
  if (step === 2) {
    return (
      <Legend items={[
        [<svg key="l" viewBox="0 0 28 10" className="h-3 w-7"><line x1="1" y1="5" x2="20" y2="5" stroke="#8B968E" strokeWidth="2" /><polygon points="27,5 19,1 19,9" fill="#8B968E" /></svg>,
          'A line is one fact from one sentence. Read it in the arrow’s direction: “Meridian Grid → closed → Harbor Coal Plant”.'],
      ]} />
    );
  }
  if (step === 3) {
    return (
      <Legend items={Object.values(TOPICS).map((t) => [
        <span key={t.label} className="inline-block h-3 w-3 rounded-full" style={{ background: t.color }} />,
        `${t.label}: a topic, a group of things discussed together.`,
      ] as [React.ReactNode, string])} />
    );
  }
  if (step === 4) {
    return (
      <div className="space-y-2" key={`qa-${run}`}>
        <p className="ml-auto w-fit max-w-[92%] rounded-2xl rounded-tr-sm bg-ink px-3.5 py-2 text-[13px] text-white">
          <TypeText text={QUESTION} speed={22} />
        </p>
        <p className="animate-blur-in text-[13.5px] leading-relaxed text-ink [animation-delay:2.6s]">
          {ANSWER}{' '}
          <span className="whitespace-nowrap">
            <Cite>{DOCS.report}</Cite> <Cite>{DOCS.study}</Cite>
          </span>
        </p>
      </div>
    );
  }
  return (
    <div className="animate-slide-up" key={`receipt-${run}`}>
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">Source of the highlighted line</p>
      <blockquote className="mt-1.5 border-l-2 border-spark pl-3 text-[14px] leading-relaxed text-ink">
        “Emissions from the <b className="font-semibold">Harbor Coal Plant</b> contributed to <b className="font-semibold">fine particulate pollution</b> in Port Calder.”
      </blockquote>
      <p className="mt-1.5 flex items-center gap-1 text-[12px] text-ink-muted"><FileText className="h-3.5 w-3.5" /> port_calder_health_study.txt · Findings</p>
    </div>
  );
}

function Legend({ items }: { items: [React.ReactNode, string][] }) {
  return (
    <ul className="space-y-1.5">
      {items.map(([icon, text], i) => (
        <li key={i} className="flex animate-slide-up items-center gap-3 text-[13.5px] text-ink-soft" style={{ animationDelay: `${i * 120}ms` }}>
          <span className="flex w-7 shrink-0 justify-center">{icon}</span>{text}
        </li>
      ))}
    </ul>
  );
}

function Cite({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 align-middle text-[11px] font-medium text-brand-800"><FileText className="h-3 w-3" />{children}</span>;
}
