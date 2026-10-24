import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowRight, AudioLines, Calculator, Loader2, MessageSquareText, Send, Sigma } from 'lucide-react';
import { placementApi } from '../../api/platform';
import { errorMessage } from '../../lib/http';
import type { PlacementAnswer } from '../../types/platform';
import { Card } from '../../components/ui/Card';
import { Notice } from '../../components/ui/Feedback';
import { Table, Td, Th } from '../../components/ui/Table';
import { SaveButton } from '../../components/workspace/SaveButton';
import VoiceMode from '../../components/voice/VoiceMode';

const STARTERS = [
  'Compare PPO conversion rates across the last three completed academic years.',
  'Which companies had the highest internship-to-PPO conversion rates?',
  'How many students are currently waiting for interview results?',
  'Which recruitment stages have the largest drop-off?',
  'Which companies returned this year?',
  'Compare current placement progress with the equivalent date last year.',
  'Which departments have the largest number of unplaced eligible students?',
  'How many offers were made, and how many unique students received them?',
];

interface Turn { id: number; question: string; answer?: PlacementAnswer; error?: string }

export function PlacementAssistant({ wsId, onTab, initial }: { wsId: string; onTab: (tab: string) => void; initial?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(false);
  const next = useRef(1);
  const bottom = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  /** Resolves with the answer text (for voice mode), or null when nothing was answered. */
  const ask = async (q: string): Promise<string | null> => {
    const question = q.trim();
    if (!question || busy) return null;
    const id = next.current++;
    setTurns((t) => [...t, { id, question }]);
    setInput('');
    setBusy(true);
    try {
      const answer = await placementApi.ask(wsId, question);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer } : x)));
      return answer.answer;
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: errorMessage(e) } : x)));
      return null;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (initial && !asked.current) { asked.current = true; ask(initial); } });
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="flex min-h-[560px] flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {!turns.length && (
            <div className="mx-auto max-w-lg py-6 text-center">
              <MessageSquareText className="mx-auto mb-2.5 h-6 w-6 text-ink-faint" strokeWidth={1.5} />
              <h2 className="text-[15px] font-semibold text-ink">Ask about your placement records</h2>
              <p className="mt-1 text-[13.5px] text-ink-muted">
                Every number is calculated from your imported records, with its definition and calculation. Questions outside the supported analyses get a list of what can be answered.
              </p>
            </div>
          )}
          {turns.map((t) => (
            <div key={t.id} className="space-y-2">
              <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-ink px-4 py-2.5 text-[14px] text-white">{t.question}</div></div>
              <div className="rounded-2xl rounded-tl-sm border border-line bg-white px-4 py-3 shadow-card">
                {!t.answer && !t.error && <span className="flex items-center gap-2 text-[13px] text-ink-muted"><Loader2 className="h-4 w-4 animate-spin text-brand-600" /> Calculating from your records…</span>}
                {t.error && <p className="text-[13px] text-danger-ink">{t.error}</p>}
                {t.answer && <AnswerBody a={t.answer} wsId={wsId} onTab={onTab} onAsk={ask} />}
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex gap-2 border-t border-line p-3">
          <label htmlFor="pl-q" className="sr-only">Question</label>
          <input id="pl-q" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. Which companies returned this year?" maxLength={1000}
            className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-canvas px-3.5 text-[14px] focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/15" />
          <button type="button" onClick={() => setVoice(true)} title="Voice mode: talk and hear the answer" aria-label="Open voice mode"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line-strong bg-white text-ink-soft transition-colors hover:border-brand-600 hover:text-brand-700">
            <AudioLines className="h-4 w-4" />
          </button>
          <button type="submit" disabled={!input.trim() || busy} className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40" aria-label="Ask">
            <Send className="h-4 w-4" />
          </button>
        </form>
        <VoiceMode open={voice} onClose={() => setVoice(false)} ask={ask} context="your placement records" suggestions={STARTERS} />
      </Card>
      <aside>
        <Card>
          <div className="border-b border-line px-5 py-3 text-[14px] font-semibold text-ink">Try asking</div>
          <div className="space-y-1 p-3">
            {STARTERS.map((q) => (
              <button key={q} onClick={() => ask(q)} disabled={busy} className="flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-brand-50 disabled:opacity-50">
                {q} <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700" />
              </button>
            ))}
          </div>
        </Card>
      </aside>
    </div>
  );
}

export function AnswerBody({ a, wsId, onTab, onAsk }: { a: PlacementAnswer; wsId?: string; onTab?: (tab: string) => void; onAsk?: (q: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[14.5px] font-semibold text-ink">{a.title}</h3>
        {wsId && a.intent !== 'unsupported' && a.intent !== 'no_data' && (
          <SaveButton workspaceId={wsId} kind="placement" title={a.title} payload={() => ({ answer: a })} />
        )}
      </div>
      <div className="prose-custom text-[13.5px] leading-relaxed text-ink-soft"><ReactMarkdown>{a.answer}</ReactMarkdown></div>
      {a.table && (
        <div className="rounded-lg border border-line [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-[12.5px] [&_th]:px-2 [&_th]:text-[10.5px]">
          <Table caption={a.title}>
            <thead><tr>{a.table.columns.map((c, i) => <Th key={i} align={i ? 'right' : 'left'}>{c}</Th>)}</tr></thead>
            <tbody>{a.table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <Td key={j} align={j ? 'right' : 'left'} className={j ? '' : 'whitespace-nowrap font-medium'}>{v ?? '—'}</Td>)}</tr>)}</tbody>
          </Table>
        </div>
      )}
      {a.calculation && (
        <p className="flex items-start gap-1.5 rounded-lg bg-info-soft px-3 py-2 text-[12.5px] text-info-ink"><Calculator className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><b className="font-semibold">Calculation:</b> {a.calculation}</span></p>
      )}
      {a.definitions.length > 0 && (
        <dl className="space-y-1 rounded-lg bg-canvas px-3 py-2 text-[12.5px]">
          {a.definitions.map((d) => (
            <div key={d.term} className="flex gap-1.5"><Sigma className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" /><dt className="font-semibold text-ink">{d.term}:</dt><dd className="text-ink-soft">{d.definition}</dd></div>
          ))}
        </dl>
      )}
      {a.notes.length > 0 && <Notice tone="warn">{a.notes.map((n) => <p key={n}>{n}</p>)}</Notice>}
      {a.supported && onAsk && (
        <div className="flex flex-wrap gap-1.5">
          {a.supported.map((q) => <button key={q} onClick={() => onAsk(q)} className="rounded-full border border-line px-2.5 py-1 text-left text-[12px] text-ink-soft hover:border-brand-200 hover:bg-brand-50">{q}</button>)}
        </div>
      )}
      {a.links.length > 0 && onTab && (
        <div className="flex flex-wrap gap-2">
          {a.links.map((l) => (
            <button key={l.tab + l.label} onClick={() => onTab(l.tab)} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline">
              {l.label} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
