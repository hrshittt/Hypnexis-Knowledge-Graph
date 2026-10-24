import { forwardRef, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, PhoneOff, Send, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { useVoiceConversation, type VoiceStatus } from '../../hooks/useVoiceConversation';

interface Props {
  open: boolean;
  onClose: () => void;
  /** answers one question; resolves with the text to read aloud (null when there is no answer) */
  ask: (question: string) => Promise<string | null>;
  /** what the assistant answers from, shown under the title */
  context?: string;
  suggestions?: string[];
}

const STATUS_TEXT: Record<VoiceStatus, string> = {
  idle: 'Tap the microphone to start talking',
  listening: 'Listening…',
  thinking: 'Finding the answer in your documents…',
  speaking: 'Speaking…',
  error: 'Voice stopped',
};

/** Full-screen voice-to-voice conversation: speak a question, hear Paheli's answer, keep talking. */
export default function VoiceMode({ open, onClose, ask, context, suggestions = [] }: Props) {
  if (!open) return null;
  return createPortal(<VoicePanel onClose={onClose} ask={ask} context={context} suggestions={suggestions} />, document.body);
}

function VoicePanel({ onClose, ask, context, suggestions }: Omit<Props, 'open'> & { suggestions: string[] }) {
  const v = useVoiceConversation(ask);
  const [typed, setTyped] = useState('');
  const orb = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Start listening as soon as the panel opens (the click that opened it counts as the user gesture).
  useEffect(() => {
    if (v.supported) v.start();
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { v.stop(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [v, onClose]);

  // Drive the orb from the microphone level without re-rendering React on every frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = orb.current;
      if (el) {
        const l = v.status === 'listening' ? v.level.current : 0;
        el.style.setProperty('--lvl', l.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v.status, v.level]);

  const end = () => { v.stop(); onClose(); };
  const listening = v.status === 'listening';

  return (
    <div className="fixed inset-0 z-[90] flex animate-fade-in flex-col bg-ink text-white" role="dialog" aria-modal="true" aria-label="Voice conversation with Paheli">
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px]" aria-hidden />
      <header className="relative flex items-center justify-between px-5 py-4 sm:px-8">
        <div>
          <p className="text-[15px] font-semibold">Voice mode</p>
          {context && <p className="text-[12.5px] text-white/55">Answering from {context}</p>}
        </div>
        <button ref={closeRef} onClick={end} className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close voice mode">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
        <Orb ref={orb} status={v.status} />
        <p className="mt-10 text-[13px] font-medium uppercase tracking-[0.16em] text-white/55" aria-live="polite">{STATUS_TEXT[v.status]}</p>
        <div className="mt-4 min-h-[64px] max-w-2xl">
          {v.transcript && <p className="font-display text-[26px] leading-snug text-white sm:text-[32px]">“{v.transcript}”</p>}
        </div>
        {v.answer && (v.status === 'speaking' || v.status === 'listening' || v.status === 'idle') && (
          <p key={v.answer} className="mt-4 line-clamp-5 max-w-2xl animate-blur-in text-[15px] leading-relaxed text-white/75">{v.answer}</p>
        )}
        {v.error && <p className="mt-4 max-w-lg rounded-lg bg-danger/20 px-4 py-2.5 text-[13.5px] text-white" role="alert">{v.error}</p>}
        {!v.supported && (
          <p className="mt-4 max-w-lg text-[14px] text-white/70">
            Speech recognition isn’t available in this browser. Use Chrome, Edge or Safari to talk, or type your question below and Paheli will read the answer aloud.
          </p>
        )}
        {suggestions.length > 0 && !v.transcript && (
          <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
            {suggestions.slice(0, 3).map((s) => (
              <button key={s} onClick={() => v.askText(s)} className="rounded-full border border-white/15 px-3.5 py-1.5 text-[13px] text-white/80 transition-colors hover:border-white/40 hover:text-white">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <footer className="relative px-5 pb-8 pt-4 sm:px-8">
        <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { v.askText(typed); setTyped(''); } }} className="mx-auto mb-6 flex max-w-md gap-2">
          <label htmlFor="voice-typed" className="sr-only">Type a question instead</label>
          <input id="voice-typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type a question…"
            className="h-10 min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 text-[14px] text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none" />
          <button type="submit" disabled={!typed.trim()} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-40" aria-label="Ask">
            <Send className="h-4 w-4" />
          </button>
        </form>
        <div className="flex items-center justify-center gap-4">
          <RoundButton label={v.muted ? 'Turn spoken answers on' : 'Mute spoken answers'} onClick={() => v.setMuted(!v.muted)}>
            {v.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </RoundButton>
          {v.supported && (
            <button onClick={() => (listening || v.status === 'thinking' || v.status === 'speaking' ? v.stop() : v.start())}
              aria-label={listening ? 'Stop listening' : 'Start talking'}
              className={`flex h-16 w-16 items-center justify-center rounded-full transition-all duration-300 ${
                listening ? 'bg-white text-ink shadow-[0_0_0_8px_rgba(255,255,255,0.12)]' : 'bg-brand-600 text-white hover:bg-brand-500'}`}>
              {listening || v.status === 'thinking' || v.status === 'speaking' ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </button>
          )}
          {v.status === 'speaking' ? (
            <RoundButton label="Skip the rest of the answer" onClick={v.interrupt}><SkipForward className="h-5 w-5" /></RoundButton>
          ) : (
            <RoundButton label="End conversation" onClick={end} danger><PhoneOff className="h-5 w-5" /></RoundButton>
          )}
        </div>
        <p className="mt-5 text-center text-[12px] text-white/40">Speech is recognised by your browser. Answers come only from your documents.</p>
      </footer>
    </div>
  );
}

function RoundButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${danger ? 'bg-danger/90 text-white hover:bg-danger' : 'bg-white/10 text-white hover:bg-white/20'}`}>
      {children}
    </button>
  );
}

/** The animated orb: swells with your voice while listening, swirls while thinking, breathes while speaking. */
const Orb = forwardRef<HTMLDivElement, { status: VoiceStatus }>(function Orb({ status }, ref) {
  const swirl = status === 'thinking';
  const speaking = status === 'speaking';
  return (
    <div ref={ref} className="relative flex h-56 w-56 items-center justify-center sm:h-64 sm:w-64" style={{ ['--lvl' as string]: 0 }} aria-hidden>
      {(status === 'listening' || speaking) && (
        <>
          <span className="absolute inset-6 animate-ping-soft rounded-full border border-brand-300/40" />
          <span className="absolute inset-6 animate-ping-soft rounded-full border border-brand-300/30 [animation-delay:1.2s]" />
        </>
      )}
      <span className="absolute inset-4 rounded-full bg-brand-500/20 blur-2xl transition-transform duration-150"
        style={{ transform: 'scale(calc(1 + var(--lvl) * 0.6))' }} />
      <span className={`absolute inset-10 rounded-full transition-transform duration-150 ${speaking ? 'animate-breathe' : ''}`}
        style={{ transform: speaking ? undefined : 'scale(calc(1 + var(--lvl) * 0.35))' }}>
        <span className={`absolute inset-0 rounded-full ${swirl ? 'animate-spin-slow [animation-duration:2.4s]' : 'animate-spin-slow'}`}
          style={{ background: swirl
            ? 'conic-gradient(from 0deg, #F2A93B, #4AA65C, #2a78d6, #F2A93B)'
            : 'conic-gradient(from 0deg, #176B2C, #4AA65C, #AAD7B0, #2E9444, #176B2C)' }} />
        <span className="absolute inset-[3px] rounded-full bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.55),rgba(20,26,22,0.15)_45%,rgba(20,26,22,0.55))]" />
      </span>
    </div>
  );
});
