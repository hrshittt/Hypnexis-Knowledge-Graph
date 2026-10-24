import { useEffect, useRef, useState } from 'react';
import { AudioLines, MessageSquareText, Send, Square, Trash2 } from 'lucide-react';
import VoiceMode from '../voice/VoiceMode';
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
  /** voice-to-voice: answers a spoken question and resolves with the text to read aloud */
  onVoiceAsk?: (q: string) => Promise<string | null>;
  voiceContext?: string;
}

export default function ChatPanel(p: Props) {
  const [input, setInput] = useState('');
  const [voice, setVoice] = useState(false);
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
    <section className="flex min-h-0 flex-1 flex-col bg-canvas/50">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {p.turns.length === 0 ? (
          <div className="mx-auto max-w-md pt-4 text-center">
            <MessageSquareText className="mx-auto mb-2.5 h-6 w-6 text-ink-faint" strokeWidth={1.5} />
            <h2 className="text-base font-semibold text-ink">Ask your documents</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {p.hasDocuments
                ? 'Answers quote the exact passages they used and light up the matching dots and lines in the graph.'
                : 'Upload documents (or load the samples) to build the knowledge graph first.'}
            </p>
            {p.hasDocuments && p.onVoiceAsk && (
              <button onClick={() => setVoice(true)} className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white transition-transform hover:scale-[1.02]">
                <AudioLines className="h-4 w-4" /> Talk to Paheli
              </button>
            )}
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
          {p.onVoiceAsk && (
            <button type="button" onClick={() => setVoice(true)} disabled={!p.hasDocuments} title="Voice mode: talk and hear the answer"
              aria-label="Open voice mode" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line-strong bg-white text-ink-soft transition-colors hover:border-brand-600 hover:text-brand-700 disabled:opacity-40">
              <AudioLines className="h-4 w-4" />
            </button>
          )}
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
      {p.onVoiceAsk && (
        <VoiceMode open={voice} onClose={() => setVoice(false)} ask={p.onVoiceAsk} context={p.voiceContext}
          suggestions={p.examples.map((q) => q.question)} />
      )}
    </section>
  );
}
