import { useEffect, useRef, useState } from 'react';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True once the element has scrolled into view (and stays true). Without IntersectionObserver it is true at once. */
export function useInView<T extends Element>(rootMargin = '0px 0px -60px 0px'): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, seen]);
  return [ref, seen];
}

/**
 * Fades a block in as it scrolls into view. Content is never gated on the animation: blocks already on
 * screen, reduced-motion users, browsers without IntersectionObserver and print all get it immediately.
 */
export function Reveal({ children, className = '', delay = 0, variant = 'up', as: Tag = 'div' }: {
  children: React.ReactNode; className?: string; delay?: number; variant?: 'up' | 'blur'; as?: 'div' | 'li' | 'section';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'pending' | 'shown'>('idle');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return; // above the fold: leave it alone
    setState('pending');
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setState('shown'); io.disconnect(); } }, { rootMargin: '0px 0px -40px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const anim = variant === 'blur' ? 'animate-blur-in' : 'animate-slide-up';
  return (
    <Tag ref={ref as React.Ref<never>} className={`${state === 'pending' ? 'reveal-pending' : state === 'shown' ? anim : ''} ${className}`}
      style={state === 'shown' ? { animationDelay: `${delay}ms` } : undefined}>
      {children}
    </Tag>
  );
}

/** Steps through `count` items every `ms`, pausing while `paused`. Reduced-motion users step manually. */
export function useAutoStep(count: number, ms: number, paused = false): [number, (i: number) => void] {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (paused || count < 2 || prefersReducedMotion()) return;
    const t = setTimeout(() => setI((x) => (x + 1) % count), ms);
    return () => clearTimeout(t);
  }, [i, count, ms, paused]);
  return [i, setI];
}

/**
 * Cycles through words in place. Every word is laid out in the same grid cell, so the line keeps the width of
 * the longest one and nothing below it jumps; only the active word is visible.
 */
export function RotatingWord({ words, index, className = '' }: { words: string[]; index: number; className?: string }) {
  return (
    <span className={`relative inline-grid align-bottom ${className}`}>
      {words.map((w, i) => (
        <span key={w} aria-hidden={i !== index}
          className={`col-start-1 row-start-1 whitespace-nowrap ${i === index ? 'animate-word-in' : 'invisible'}`}>
          {w}
        </span>
      ))}
    </span>
  );
}

/** Types `text` out character by character while `active`; shows the whole text at once for reduced motion. */
export function TypeText({ text, active = true, speed = 28, onDone, className = '', caret = true }: {
  text: string; active?: boolean; speed?: number; onDone?: () => void; className?: string; caret?: boolean;
}) {
  const [n, setN] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => { setN(0); }, [text]);
  useEffect(() => {
    if (!active) return;
    if (prefersReducedMotion()) { setN(text.length); done.current?.(); return; }
    if (n >= text.length) { done.current?.(); return; }
    const t = setTimeout(() => setN((x) => x + 1), speed);
    return () => clearTimeout(t);
  }, [active, n, text, speed]);
  const typing = active && n < text.length;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{text.slice(0, active ? n : 0)}</span>
      {caret && typing && <span aria-hidden className="ml-px inline-block h-[1em] w-[2px] translate-y-[2px] animate-caret bg-current" />}
    </span>
  );
}

/** A thin bar that fills over `ms`; restarts whenever `runKey` changes. Used as the timer on auto-advancing steps. */
export function StepTimer({ ms, runKey, paused, className = '' }: { ms: number; runKey: string | number; paused?: boolean; className?: string }) {
  return (
    <span className={`block h-[2px] overflow-hidden rounded-full bg-ink/10 ${className}`} aria-hidden>
      <span key={runKey} className="block h-full origin-left animate-grow-x bg-brand-600"
        style={{ ['--grow-duration' as string]: `${ms}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
    </span>
  );
}
