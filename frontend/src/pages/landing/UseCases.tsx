import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpenText, Building2, Check, FileText, GraduationCap, Scale, Shapes, type LucideIcon } from 'lucide-react';
import { StepTimer, TypeText, useAutoStep, useInView } from '../../components/motion/Motion';

interface UseCase {
  key: string;
  label: string;
  icon: LucideIcon;
  title: string;
  body: string;
  points: string[];
  question: string;
  answer: string;
  source: string;
  sample: boolean;
}

/** Answers quote the bundled fictional sample documents; the Others example is labelled as an illustration. */
const CASES: UseCase[] = [
  {
    key: 'corporate', label: 'Companies', icon: Building2,
    title: 'Read annual reports and board packs in minutes',
    body: 'Revenue, profit, cash flow and debt, each with the period, currency and page it came from. Risks a report discloses are kept apart from the flags Paheli infers from the numbers.',
    points: ['Financial figures with their source', 'Disclosed and inferred risks', 'A CFO assistant for follow-up questions'],
    question: 'Why did net profit decline in fiscal 2024?',
    answer: 'Net profit fell to $31.2 million from $42.9 million. The CEO said higher depreciation and financing costs from the storage build-out reduced profitability.',
    source: 'meridian_grid_financial_review_2024.txt · p.1', sample: true,
  },
  {
    key: 'research', label: 'Research', icon: BookOpenText,
    title: 'Understand papers, and how they connect',
    body: 'Problem, method, data, findings and limitations for every paper, each linked to its section. Compare two papers side by side, where each column quotes only its own paper.',
    points: ['Paper summaries by section', 'Side-by-side comparison', 'A concept graph across your library'],
    question: 'What are the limitations of the coal retirement study?',
    answer: 'The post-closure window covers only twelve months, admission records miss cases treated outside hospitals, and the comparison towns may differ from Port Calder.',
    source: 'coal_retirement_asthma_study.txt · Limitations', sample: true,
  },
  {
    key: 'legal', label: 'Legal & policy', icon: Scale,
    title: 'Find the rules that may apply to you',
    body: 'Describe your situation and see the provisions that may apply, with obligations, deadlines, exceptions and penalties quoted from the text. Information, never legal advice.',
    points: ['Applicability research', 'Obligations and deadlines', 'A graph of cross-references'],
    question: 'What must a business do after a personal data breach?',
    answer: 'If the breach is likely to cause harm, notify the Authority within 72 hours and inform the affected individuals without undue delay.',
    source: 'coastal_consumer_data_protection_act.txt · Section 7', sample: true,
  },
  {
    key: 'placement', label: 'Placement cells', icon: GraduationCap,
    title: 'Know your placement numbers without the spreadsheet work',
    body: 'Import your CSV or Excel records once. Placement rate, offers, PPO conversion and company history follow, each with its definition and calculation.',
    points: ['Year-on-year comparison', 'Recruitment funnel', 'Internship-to-PPO conversion'],
    question: 'Which company hired the most students in 2024–25?',
    answer: 'Harborline Logistics, with 16 accepted offers. Aurora Robotics and Coastline Telecom follow with 11 each.',
    source: 'sample_applications.csv · 2024–25', sample: true,
  },
  {
    key: 'others', label: 'Others', icon: Shapes,
    title: 'Hospitals, schools, government offices, NGOs: any team with documents',
    body: 'Upload circulars, policies and reports, or photograph a paper page and let OCR read it. Paheli builds the graph and answers with sources. Dedicated workspaces for more industries are on the way.',
    points: ['OCR for scans and photos', 'Voice chat and phone calls', 'Works with any subject'],
    question: 'What does this scanned brief say the Clean Horizon Act requires?',
    answer: 'Utilities must retire coal plants by 2025. The Act also created the Storage Incentive Program, which offers rebates for grid batteries.',
    source: 'coastal_energy_policy_brief, scanned · p.1', sample: false,
  },
];

const MS = 8000;
const CTA: Record<string, string> = {
  corporate: 'Start a company workspace', research: 'Start a research workspace', legal: 'Start a legal workspace',
  placement: 'Start a placement workspace', others: 'See what works for your team',
};

export default function UseCases({ signedIn }: { signedIn: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [hover, setHover] = useState(false);
  const [i, setI] = useAutoStep(CASES.length, MS, hover || !inView);
  const c = CASES[i];
  const to = c.key === 'others' ? (signedIn ? '/app/others' : '/register?workspace=others') : signedIn ? `/app/${c.key}` : `/register?workspace=${c.key}`;

  return (
    <div ref={ref} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 border-b border-line" role="tablist" aria-label="Use cases">
          {CASES.map((x, k) => {
            const on = k === i;
            return (
              <button key={x.key} role="tab" aria-selected={on} onClick={() => setI(k)}
                className={`relative flex items-center gap-2 px-3.5 pb-3 pt-1 text-[14.5px] font-medium transition-colors ${on ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}>
                <x.icon className={`h-4 w-4 ${on ? 'text-brand-700' : ''}`} /> {x.label}
                {on && <StepTimer className="absolute inset-x-0 -bottom-px" ms={MS} runKey={i} paused={hover || !inView} />}
              </button>
            );
          })}
        </div>
      </div>

      <div key={c.key} className="grid gap-10 pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16" role="tabpanel">
        <div className="animate-slide-up">
          <h3 className="font-display text-[34px] leading-[1.05] text-ink sm:text-[40px]">{c.title}</h3>
          <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-ink-muted">{c.body}</p>
          <ul className="mt-6 space-y-2.5">
            {c.points.map((p, k) => (
              <li key={p} className="flex animate-slide-up items-center gap-2.5 text-[15px] text-ink" style={{ animationDelay: `${120 + k * 80}ms` }}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>{p}
              </li>
            ))}
          </ul>
          <Link to={to} className="group mt-8 inline-flex items-center gap-1.5 text-[15px] font-medium text-brand-700">
            <span className="link-draw">{CTA[c.key]}</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
        <div className="animate-slide-up self-center [animation-delay:120ms]">
          <div className="rounded-2xl bg-canvas p-5 sm:p-7">
            <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-sm bg-ink px-4 py-2.5 text-[14px] leading-snug text-white">
              <TypeText text={c.question} speed={22} />
            </p>
            <div className="mt-4 flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-bold text-brand-700 ring-1 ring-line">P</span>
              <div className="min-w-0">
                <p className="animate-blur-in text-[15px] leading-relaxed text-ink [animation-delay:1.4s]">{c.answer}</p>
                <p className="mt-3 flex animate-fade-in flex-wrap items-center gap-2 text-[12px] [animation-delay:1.9s]">
                  <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-medium text-brand-800 ring-1 ring-line">
                    <FileText className="h-3.5 w-3.5" /> {c.source}
                  </span>
                  <span className="text-ink-muted">{c.sample ? 'Fictional sample data' : 'Illustration'}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
