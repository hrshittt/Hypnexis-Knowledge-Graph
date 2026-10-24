import { FileText } from 'lucide-react';
import { TypeText } from '../../components/motion/Motion';

/**
 * The hero picture: a small knowledge graph that lights up a different evidence path for each example question.
 * Questions and answers quote the bundled fictional sample data, so they are true to what the demo returns.
 */

export interface HeroExample {
  word: string;
  question: string;
  answer: string;
  source: string;
  path: number[];
  labels: string[];
}

export const HERO_EXAMPLES: HeroExample[] = [
  {
    word: 'annual reports',
    question: 'Why did Meridian Grid’s net profit fall in 2024?',
    answer: 'Net profit fell to $31.2 million from $42.9 million. The CEO points to higher depreciation and financing costs from the storage build-out.',
    source: 'Financial review 2024 · p.1',
    path: [6, 0, 3], labels: ['Meridian Grid', 'Net profit FY2024', 'Financing costs'],
  },
  {
    word: 'research papers',
    question: 'What are the limits of the coal retirement study?',
    answer: 'It has only twelve months of data after the closure, and hospital records miss asthma cases treated elsewhere.',
    source: 'Coal retirement study · Limitations',
    path: [1, 0, 4], labels: ['Coal retirement study', 'Limitations', 'Hospital records'],
  },
  {
    word: 'laws & policies',
    question: 'What must we do after a personal data breach?',
    answer: 'If harm is likely, notify the Authority within 72 hours and tell the people affected without undue delay.',
    source: 'Data Protection Act 2022 · Section 7',
    path: [2, 0, 5], labels: ['Data Protection Act', 'Breach notification', '72-hour deadline'],
  },
  {
    word: 'placement records',
    question: 'Which company hired the most students in 2024–25?',
    answer: 'Harborline Logistics, with 16 accepted offers. Aurora Robotics and Coastline Telecom follow with 11 each.',
    source: 'Placement records · 2024–25',
    path: [4, 0, 1], labels: ['2024–25 batch', 'Accepted offers', 'Harborline Logistics'],
  },
  {
    word: 'scanned documents',
    question: 'What does this scanned brief say the Clean Horizon Act requires?',
    answer: 'Utilities must retire coal plants by 2025. The Act also created a rebate programme for grid batteries.',
    source: 'Policy brief, scanned with OCR · p.1',
    path: [5, 0, 2], labels: ['Scanned policy brief', 'Clean Horizon Act', 'Coal plants'],
  },
];

// x, y, r, tone (0 green, 1 blue, 2 orange, 3 violet, 4 neutral). Nodes 0–6 carry the example paths and stay in the
// upper part of the picture; the lower-left corner holds only decoration because the answer card sits over it.
const NODES: [number, number, number, number][] = [
  [270, 165, 17, 0], [150, 92, 11, 1], [352, 58, 12, 0], [446, 150, 11, 2], [410, 252, 12, 3], [262, 250, 11, 1],
  [112, 205, 12, 0], [50, 120, 6, 4], [210, 28, 7, 4], [486, 52, 7, 1], [496, 250, 6, 4], [150, 330, 6, 4],
  [350, 340, 7, 0], [40, 290, 5, 4], [480, 350, 5, 3], [96, 30, 5, 0],
];
const EDGES: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [1, 7], [1, 8], [2, 8], [2, 9], [3, 9], [3, 10], [4, 10], [4, 12],
  [5, 11], [5, 12], [6, 13], [6, 7], [1, 2], [3, 4], [5, 6], [11, 13], [10, 14], [12, 14], [7, 15], [8, 15],
];
const TONE = ['#238636', '#2a78d6', '#eb6834', '#6250d6', '#B4BEB6'];

export default function HeroGraph({ index }: { index: number }) {
  const ex = HERO_EXAMPLES[index];
  const onPath = new Set(ex.path);
  const pathEdges = new Set(ex.path.slice(1).map((n, i) => [ex.path[i], n].sort((a, b) => a - b).join('-')));

  return (
    <div className="relative mx-auto w-full max-w-[600px]">
      <div className="absolute inset-0 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(35,134,54,0.12),transparent)] blur-2xl" aria-hidden />
      <svg viewBox="0 0 520 430" className="block h-auto w-full animate-float-slow" aria-hidden focusable="false">
        {EDGES.map(([a, b]) => {
          const key = [a, b].sort((x, y) => x - y).join('-');
          const hot = pathEdges.has(key);
          const [x1, y1] = NODES[a];
          const [x2, y2] = NODES[b];
          return (
            <g key={key}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#C9D2CB" strokeWidth={1.2} />
              {hot && (
                <line key={`${key}-${index}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#176B2C" strokeWidth={2.6} strokeLinecap="round"
                  strokeDasharray="6 6" className="animate-dash-flow" />
              )}
            </g>
          );
        })}
        {NODES.map(([x, y, r, t], i) => {
          const hot = onPath.has(i);
          const label = hot ? ex.labels[ex.path.indexOf(i)] : null;
          const above = y > 200;
          return (
            <g key={i}>
              {hot && (
                <circle key={`ring-${index}`} cx={x} cy={y} r={r + 4} fill="none" stroke="#F2A93B" strokeWidth="2"
                  className="origin-center animate-ping-soft [transform-box:fill-box]" />
              )}
              <circle cx={x} cy={y} r={hot ? r + 2 : r} stroke="#fff" strokeWidth="2.5"
                style={{ fill: hot ? '#141A16' : TONE[t], transition: 'fill 500ms ease, r 500ms ease' }} />
              {label && (
                <text key={`l-${index}`} x={x} y={above ? y - r - 10 : y + r + 18} textAnchor="middle" fontSize="13" fontWeight="600" fill="#141A16"
                  stroke="#fff" strokeWidth="5" paintOrder="stroke" className="animate-fade-in">{label}</text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Phones: the card sits under the graph. Larger screens: it overlaps the graph's empty lower-left corner. */}
      <div key={index} className="relative mt-2 min-h-[190px] w-full animate-slide-up rounded-2xl border border-line bg-white/95 p-4 shadow-pop backdrop-blur sm:absolute sm:-left-6 sm:bottom-0 sm:mt-0 sm:min-h-0 sm:w-[380px] sm:translate-y-4">
        <p className="ml-auto w-fit max-w-[95%] rounded-2xl rounded-tr-sm bg-ink px-3.5 py-2 text-[13px] leading-snug text-white">
          <TypeText text={ex.question} speed={24} />
        </p>
        <p className="mt-3 animate-blur-in text-[13.5px] leading-relaxed text-ink [animation-delay:1.5s]">{ex.answer}</p>
        <p className="mt-2.5 flex animate-fade-in items-center gap-1.5 text-[11.5px] font-medium text-brand-800 [animation-delay:2s]">
          <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5"><FileText className="h-3 w-3" /> {ex.source}</span>
          <span className="text-ink-muted">· fictional sample data</span>
        </p>
      </div>
    </div>
  );
}
