import { useEffect, useRef, useState } from 'react';
import { MessageSquareText, Send, Square, Trash2 } from 'lucide-react';
import type { ExampleQuestion, Selection } from '../../types/kb';
import type { ChatTurn } from '../../hooks/useKBChat';
import AnswerCard from './AnswerCard';

const CATEGORY_LABEL: Record<string, string> = {
  thematic: 'Topic discovery', factual: 'Factual', multi_hop: 'Multi-hop', comparison: 'Comparison',
  insufficient_evidence: 'Insufficient evidence',
};

interface Props {
  turns: ChatTurn[];
  pending: boolean;
  activeTurn: string | null;
  examples: ExampleQuestion[];
  hasDocuments: boolean;
  onAsk: (q: string) => void;
  onStop: () => void;
  onClear: () => void;
  onSelect: (s: Selection) => void;
  onActivate: (turnId: string) => void;
}

export default function ChatPanel(p: Props) {
  const [input, setInput] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [p.turns]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || p.pending) return;
    p.onAsk(input);
    setInput('');
  };

  const grouped = p.examples.reduce<Record<string, ExampleQuestion[]>>((acc, q) => {
    (acc[q.category] ??= []).push(q);
    return acc;
  }, {});

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-slate-50/60">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {p.turns.length === 0 ? (
          <div className="mx-auto max-w-md pt-4 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <MessageSquareText className="h-5 w-5 text-brand-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-800">Ask your documents</h2>
            <p className="mt-1 text-sm text-slate-500">
              {p.hasDocuments
                ? 'Answers cite exact passages and light up the supporting entities, relations and topic communities in the graph.'
                : 'Upload documents (or load the samples) to build the knowledge graph first.'}
            </p>
            {p.hasDocuments && Object.keys(grouped).length > 0 && (
              <div className="mt-5 space-y-3 text-left">
                {Object.entries(grouped).map(([cat, qs]) => (
                  <div key={cat}>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{CATEGORY_LABEL[cat] ?? cat}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {qs.map((q) => (
                        <button key={q.question} onClick={() => p.onAsk(q.question)} title={q.expect}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-left text-[12.5px] text-slate-700 shadow-sm hover:border-brand-500 hover:text-brand-600">
                          {q.question}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          p.turns.map((t) => (
            <AnswerCard key={t.id} turn={t} active={p.activeTurn === t.id} onSelect={p.onSelect}
              onActivate={() => p.onActivate(t.id)} onAsk={p.onAsk} />
          ))
        )}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="border-t border-slate-200 bg-white px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={p.hasDocuments ? 'Ask about themes, facts or connections…' : 'Upload documents first…'}
            rows={1}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-800 placeholder-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            aria-label="Question"
          />
          {p.pending ? (
            <button type="button" onClick={p.onStop} title="Stop" className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-red-500 hover:bg-red-50">
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} title="Ask" className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        {p.turns.length > 0 && (
          <button type="button" onClick={p.onClear} className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600">
            <Trash2 className="h-3 w-3" /> Clear conversation
          </button>
        )}
      </form>
    </section>
  );
}
