import { Link } from 'react-router-dom';

/** The Paheli mark: a "P" drawn as a tiny knowledge graph — four facts joined into one shape. */
export function LogoMark({ className = 'h-8 w-8', animated = false, inverted = false }: { className?: string; animated?: boolean; inverted?: boolean }) {
  const bg = inverted ? '#fff' : '#141A16';
  const fg = inverted ? '#141A16' : '#fff';
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill={bg} />
      <g stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M11 24V8.5" />
        <path d="M11 8.5c6.5-.6 10.5 1.4 10.5 4.6S17.6 18 11 17.2" />
      </g>
      <circle cx="11" cy="24" r="2.6" fill={fg} />
      <circle cx="11" cy="8.5" r="2.6" fill={fg} />
      <circle cx="11" cy="17.2" r="2.6" fill={fg} />
      <circle cx="21.5" cy="13" r="3" fill="#4AA65C" className={animated ? 'origin-center animate-breathe [transform-box:fill-box]' : undefined} />
    </svg>
  );
}

export function Logo({ to = '/', compact, inverted }: { to?: string; compact?: boolean; inverted?: boolean }) {
  return (
    <Link to={to} className="group flex items-center gap-2.5 rounded-lg" aria-label="Paheli home">
      <LogoMark animated inverted={inverted} />
      {!compact && (
        <span className={`text-[19px] font-semibold tracking-[-0.02em] ${inverted ? 'text-white' : 'text-ink'}`}>Paheli</span>
      )}
    </Link>
  );
}
