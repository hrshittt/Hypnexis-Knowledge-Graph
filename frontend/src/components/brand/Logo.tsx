import { Link } from 'react-router-dom';

/** The Hypnexis mark: three connected nodes — a tiny knowledge graph. */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#238636" />
      <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
        <path d="M10 21.5 16 10.5l6 11" />
        <path d="M10 21.5h12" opacity=".7" />
      </g>
      <g fill="#fff">
        <circle cx="16" cy="10.5" r="3" />
        <circle cx="10" cy="21.5" r="3" />
        <circle cx="22" cy="21.5" r="3" />
      </g>
    </svg>
  );
}

export function Logo({ to = '/', compact, inverted }: { to?: string; compact?: boolean; inverted?: boolean }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-lg" aria-label="Hypnexis home">
      <LogoMark />
      {!compact && (
        <span className={`text-[17px] font-semibold tracking-tight ${inverted ? 'text-white' : 'text-ink'}`}>Hypnexis</span>
      )}
    </Link>
  );
}
