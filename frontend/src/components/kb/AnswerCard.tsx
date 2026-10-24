import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Crosshair, FileText, GitBranch, Loader2, Network,
  ShieldAlert, Sparkles, Zap,
} from 'lucide-react';
import type { Answer, Selection, StageEvent } from '../../types/kb';
import type { ChatTurn } from '../../hooks/useKBChat';

const ROUTE_LABEL: Record<string, string> = {
  thematic: 'Thematic', factual: 'Factual', multi_hop: 'Multi-hop', comparison: 'Comparison',
};
const STAGE_LABEL: Record<string, string> = {
  route_query: 'Route', retrieve_factual: 'Retrieve passages', retrieve_multi_hop: 'Traverse graph',
  retrieve_thematic: 'Rank topics', retrieve_comparison: 'Gather comparison', assess_evidence: 'Assess evidence',
  rewrite_query: 'Rewrite query', generate_answer: 'Generate', insufficient_answer: 'Insufficient evidence',
  finalize: 'Finalize',
};

interface Props {
  turn: ChatTurn;
  active: boolean;
  onSelect: (s: Selection) => void;
  onActivate: () => void;
  onAsk: (q: string) => void;
}

export default function AnswerCard({ turn, active, onSelect, onActivate, onAsk }: Props) {
  const a = turn.answer;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-2.5 text-[14px] text-white">{turn.question}</div>
      </div>
      <div className={`rounded-2xl rounded-tl-sm border bg-white px-4 py-3 shadow-sm transition-shadow ${active ? 'border-brand-500/60 ring-2 ring-brand-500/15' : 'border-slate-200'}`}>
        {turn.pending && <Stages stages={turn.stages} pending />}
        {turn.error && <div className="flex items-center gap-2 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {turn.error}</div>}
        {a && <Body a={a} stages={turn.stages} active={active} onSelect={onSelect} onActivate={onActivate} onAsk={onAsk} />}
      </div>
    </div>
  );
}

function Body({ a, stages, active, onSelect, onActivate, onAsk }: { a: Answer; stages: StageEvent[]; active: boolean } & Omit<Props, 'turn' | 'active'>) {
  const [showSources, setShowSources] = useState(false);
  const sources = new Map(a.sources.map((s) => [s.id, s]));
  const facts = new Map(a.graph_facts.map((f) => [f.id, f]));
  const cite = (id: string) => {
    const s = sources.get(id);
    if (s) return onSelect({ kind: 'source', source: s });
    const f = facts.get(id);
    if (f) onSelect({ kind: 'relation', id: f.relation_id });
  };
  // [S1] / [G2] → markdown links we render as citation chips
  const md = a.answer.replace(/\[([SG]\d+)\]/g, '[$1](#cite-$1)');
  const cited = a.sources.filter((s) => s.cited);
  const shownSources = cited.length ? cited : a.sources;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700" title={a.route_reason}>
          {ROUTE_LABEL[a.route] ?? a.route}{a.route_method === 'llm' ? ' · LLM-routed' : ''}
        </span>
        {a.sufficient ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700" title={a.sufficiency_reason}>
            <CheckCircle2 className="h-3 w-3" /> Grounded
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700" title={a.sufficiency_reason}>
            <ShieldAlert className="h-3 w-3" /> Insufficient evidence
          </span>
        )}
        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${a.mode === 'llm' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
          {a.mode === 'llm' ? <><Sparkles className="h-3 w-3" /> Gemini</> : 'Extractive'}
        </span>
        <span className="text-slate-400">{(a.latency_ms / 1000).toFixed(1)}s</span>
        {(a.highlight.nodes.length > 0 || a.highlight.communities.length > 0) && (
          <button onClick={onActivate}
            className={`ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 ${active ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600 hover:bg-brand-100'}`}>
            <Crosshair className="h-3 w-3" /> {active ? 'Shown in graph' : 'Show in graph'}
          </button>
        )}
      </div>

      {a.paths.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-2 text-[12px]">
          <GitBranch className="mr-1 h-3.5 w-3.5 text-slate-500" />
          {a.paths[0].nodes.map((n, i) => (
            <span key={n.id} className="flex items-center gap-1">
              {i > 0 && <ArrowRight className="h-3 w-3 text-slate-400" />}
              <button onClick={() => onSelect({ kind: 'entity', id: n.id })}
                className="rounded bg-white px-1.5 py-0.5 font-medium text-slate-800 ring-1 ring-slate-200 hover:ring-slate-400">{n.name}</button>
            </span>
          ))}
        </div>
      )}

      <div className="prose-custom max-w-none text-[14px] leading-relaxed text-slate-800">
        <ReactMarkdown
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith('#cite-')) {
                const id = href.slice(6);
                const isG = id.startsWith('G');
                return (
                  <button onClick={() => cite(id)} title={isG ? 'Knowledge-graph relation' : 'Source passage'}
                    className={`mx-0.5 inline-flex items-center rounded px-1 align-baseline text-[11px] font-semibold ${
                      isG ? 'bg-violet-50 text-violet-700 hover:bg-violet-100' : 'bg-brand-50 text-brand-600 hover:bg-brand-100'}`}>
                    {children}
                  </button>
                );
              }
              return <a href={href} target="_blank" rel="noreferrer" className="text-brand-600 underline">{children}</a>;
            },
          }}
        >{md}</ReactMarkdown>
      </div>

      {a.warnings.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-amber-700">
          {a.warnings.map((w, i) => <li key={i} className="flex gap-1"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />{w}</li>)}
        </ul>
      )}

      {(a.sources.length > 0 || a.graph_facts.length > 0) && (
        <div>
          <button onClick={() => setShowSources((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:text-slate-900">
            <FileText className="h-3.5 w-3.5" />
            {a.sufficient ? `${shownSources.length} source passage${shownSources.length === 1 ? '' : 's'}` : 'Closest passages'}
            {a.graph_facts.length > 0 && ` · ${a.graph_facts.length} graph fact${a.graph_facts.length === 1 ? '' : 's'}`}
            {showSources ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showSources && (
            <div className="mt-2 space-y-1.5">
              {a.graph_facts.map((f) => (
                <button key={f.id} onClick={() => onSelect({ kind: 'relation', id: f.relation_id })}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-left text-[12px] hover:border-slate-300">
                  <span className="rounded bg-violet-50 px-1 font-semibold text-violet-700">{f.id}</span>
                  <Network className="h-3 w-3 text-slate-400" />
                  <span className="truncate"><b className="font-medium">{f.subject.name}</b> — {f.predicate} → <b className="font-medium">{f.object.name}</b></span>
                </button>
              ))}
              {shownSources.map((s) => (
                <button key={s.id} onClick={() => onSelect({ kind: 'source', source: s })}
                  className="block w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-left text-[12px] hover:border-slate-300">
                  <span className="flex items-center gap-1.5">
                    <span className="rounded bg-brand-50 px-1 font-semibold text-brand-600">{s.id}</span>
                    <span className="truncate font-medium text-slate-700">{s.filename}</span>
                    <span className="shrink-0 text-slate-400">p.{s.page}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-slate-500">{s.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {a.followups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {a.followups.map((q) => (
            <button key={q} onClick={() => onAsk(q)}
              className="flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[12px] text-slate-700 hover:border-brand-500 hover:text-brand-600">
              <Zap className="h-3 w-3 text-brand-500" /> {q}
            </button>
          ))}
        </div>
      )}

      <Stages stages={stages} />
    </div>
  );
}

function Stages({ stages, pending }: { stages: StageEvent[]; pending?: boolean }) {
  const [open, setOpen] = useState(false);
  if (pending) {
    return (
      <ol className="space-y-1 text-[12px] text-slate-600">
        {stages.map((s, i) => (
          <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <span><b className="font-medium text-slate-800">{STAGE_LABEL[s.node] ?? s.node}</b> — {s.detail}</span></li>
        ))}
        <li className="flex items-center gap-2 text-brand-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> working…</li>
      </ol>
    );
  }
  if (!stages.length) return null;
  return (
    <div className="border-t border-slate-100 pt-2">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600">
        LangGraph trace ({stages.length} steps) {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <ol className="mt-1 space-y-0.5 text-[11px] text-slate-500">
          {stages.map((s, i) => <li key={i}><b className="font-medium text-slate-600">{STAGE_LABEL[s.node] ?? s.node}:</b> {s.detail}</li>)}
        </ol>
      )}
    </div>
  );
}
