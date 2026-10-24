import { useCallback, useRef, useState } from 'react';
import { kbApi } from '../api/kb';
import type { Answer, StageEvent } from '../types/kb';

export interface ChatTurn {
  id: string;
  question: string;
  stages: StageEvent[];
  answer?: Answer;
  error?: string;
  pending: boolean;
}

export function useKBChat(onAnswer: (turnId: string, a: Answer) => void) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const pending = turns.some((t) => t.pending);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setTurns((prev) => [...prev, { id, question: q, stages: [], pending: true }]);
    const update = (patch: Partial<ChatTurn> | ((t: ChatTurn) => Partial<ChatTurn>)) =>
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)));
    try {
      const answer = await kbApi.queryStream(q, (s) => update((t) => ({ stages: [...t.stages, s] })), ctrl.signal);
      update({ answer, pending: false });
      onAnswer(id, answer);
    } catch (e) {
      const err = e as Error;
      update({ pending: false, error: err.name === 'AbortError' ? 'Cancelled' : err.message });
    }
  }, [onAnswer]);

  const stop = () => abortRef.current?.abort();
  const clear = () => { abortRef.current?.abort(); setTurns([]); };

  return { turns, pending, ask, stop, clear };
}
