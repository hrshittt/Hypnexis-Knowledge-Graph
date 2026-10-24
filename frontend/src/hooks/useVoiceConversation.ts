import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice-to-voice conversation in the browser: Web Speech recognition turns speech into a question, `ask` answers
 * it, speech synthesis reads the answer back, and listening resumes. A microphone analyser drives the visual level.
 * Chrome, Edge and Safari support recognition; elsewhere `supported` is false and the UI offers typing instead.
 */

export type VoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
type RecognitionCtor = new () => Recognition;

const Ctor: RecognitionCtor | undefined = typeof window === 'undefined' ? undefined
  : (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

export const voiceSupported = !!Ctor && typeof window !== 'undefined' && 'speechSynthesis' in window;

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in the browser’s address bar, then try again.',
  'service-not-allowed': 'Speech recognition is not available in this browser profile.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection.',
};

/** Reads like speech: no markdown, list markers, citation tags ([S1], [G2]), arrows, URLs or the answer-mode footnote. */
export function speakable(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((l) => l && !/^_?extractive answer/i.test(l) && !/no llm configured/i.test(l))
    .join('. ')
    .replace(/\[(?:[A-Za-z]{1,2})?\d+(?:[,\s]+(?:[A-Za-z]{1,2})?\d+)*\]/g, '')
    .replace(/\s*(?:→|->)\s*/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>|]+/g, '')
    .replace(/:\s*\./g, ':')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Chrome stops long utterances after ~15 s, so speak sentence-sized chunks one after another. */
function chunks(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 220 && cur) { out.push(cur.trim()); cur = ''; }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function useVoiceConversation(ask: (question: string) => Promise<string | null>, lang = 'en-IN') {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const level = useRef(0); // 0–1, read by the orb every frame
  const rec = useRef<Recognition | null>(null);
  const active = useRef(false); // conversation running (not ended by the user)
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const askRef = useRef(ask);
  askRef.current = ask;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const stopMeter = () => {
    const a = audio.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    a.stream.getTracks().forEach((t) => t.stop());
    a.ctx.close().catch(() => {});
    audio.current = null;
    level.current = 0;
  };

  const startMeter = async () => {
    if (audio.current || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        level.current = level.current * 0.7 + Math.min(1, rms * 4) * 0.3;
        if (audio.current) audio.current.raf = requestAnimationFrame(tick);
      };
      audio.current = { ctx, stream, raf: requestAnimationFrame(tick) };
    } catch {
      /* the level meter is decoration; recognition reports permission problems itself */
    }
  };

  const speak = useCallback((text: string) => new Promise<void>((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (mutedRef.current || !text) { resolve(); return; }
    const voices = synth.getVoices();
    const voice = voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.split('-')[0]) && /female|google|natural/i.test(v.name))
      ?? voices.find((v) => v.lang.startsWith(lang.split('-')[0]));
    const parts = chunks(text);
    let settled = false;
    const done = () => { if (!settled) { settled = true; clearInterval(poll); resolve(); } };
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = 1.02;
      if (i === parts.length - 1) { u.onend = done; u.onerror = done; }
      synth.speak(u);
    });
    // Some browsers drop the end event when speech is cancelled; stop waiting once nothing is queued.
    const poll = setInterval(() => { if (!synth.speaking && !synth.pending) done(); }, 400);
  }), [lang]);

  const listen = useCallback(() => {
    if (!Ctor) return;
    rec.current?.abort();
    const r = new Ctor();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setTranscript((finalText + interim).trim());
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      active.current = false;
      setError(ERRORS[e.error] ?? `Speech recognition stopped (${e.error}).`);
      setStatus('error');
      stopMeter();
    };
    r.onend = async () => {
      rec.current = null;
      if (!active.current) return;
      const q = finalText.trim();
      if (!q) { listen(); return; } // silence: keep listening
      setStatus('thinking');
      let reply: string | null = null;
      try {
        reply = await askRef.current(q);
      } catch (err) {
        reply = null;
        setError((err as Error).message);
      }
      if (!active.current) return;
      const text = reply ? speakable(reply) : 'Sorry, I could not find an answer to that in your documents.';
      setAnswer(text);
      setStatus('speaking');
      await speak(text);
      if (active.current) { setTranscript(''); listen(); }
    };
    rec.current = r;
    setStatus('listening');
    try { r.start(); } catch { /* already started */ }
  }, [lang, speak]);

  const start = useCallback(() => {
    if (!voiceSupported) return;
    setError(null);
    setTranscript('');
    active.current = true;
    startMeter();
    window.speechSynthesis.getVoices(); // warm the voice list
    listen();
  }, [listen]);

  const stop = useCallback(() => {
    active.current = false;
    rec.current?.abort();
    rec.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    stopMeter();
    setStatus('idle');
  }, []);

  /** Skip the rest of the spoken answer and listen again. */
  const interrupt = useCallback(() => {
    window.speechSynthesis.cancel();
  }, []);

  /** Typed fallback (or a tapped suggestion): answers and speaks without the microphone. */
  const askText = useCallback(async (q: string) => {
    const question = q.trim();
    if (!question) return;
    rec.current?.abort();
    setError(null);
    setTranscript(question);
    setStatus('thinking');
    const reply = await askRef.current(question).catch(() => null);
    const text = reply ? speakable(reply) : 'Sorry, I could not find an answer to that in your documents.';
    setAnswer(text);
    setStatus('speaking');
    await speak(text);
    setStatus(active.current ? 'listening' : 'idle');
    if (active.current) listen();
  }, [listen, speak]);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => { if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); }, [muted]);

  return { status, transcript, answer, error, level, muted, setMuted, start, stop, interrupt, askText, supported: voiceSupported };
}
