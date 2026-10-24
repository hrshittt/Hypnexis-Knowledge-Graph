import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight, Menu as MenuIcon, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Logo } from '../components/brand/Logo';
import { ButtonLink } from '../components/ui/Button';
import { OTHERS_INFO, WORKSPACE_TYPES } from '../lib/workspaceTypes';
import ExplainerHost from '../components/explain/ExplainerHost';

const NAV = [
  { to: '/#how', label: 'How it works' },
  { to: '/#explained', label: 'Knowledge graphs' },
  { to: '/#use-cases', label: 'Use cases' },
  { to: '/#features', label: 'Features' },
  { to: '/demo', label: 'Live demo' },
];

/** Scrolls to #hash targets (react-router doesn't) and to the top on page changes. */
function useScrollToHash() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }), 30);
      return () => clearTimeout(t);
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
}

export default function PublicLayout() {
  useScrollToHash();
  const { status } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => setOpen(false), [loc.pathname, loc.hash]);

  const signedIn = status === 'authenticated';

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className={`sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-300 ${
        scrolled ? 'border-b border-line bg-white/85 backdrop-blur-md' : 'border-b border-transparent bg-transparent'}`}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <Logo />
          <nav className="hidden items-center gap-7 lg:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="link-draw py-1 text-[14.5px] text-ink-soft transition-colors hover:text-ink">{n.label}</Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            {signedIn ? (
              <ButtonLink to="/app" className="group">Open Paheli <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost">Sign in</ButtonLink>
                <ButtonLink to="/register" className="group">Get started <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></ButtonLink>
              </>
            )}
          </div>
          <button className="rounded-lg p-2 text-ink-soft hover:bg-canvas lg:hidden" onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <div className="animate-slide-up border-t border-line bg-white px-4 pb-5 lg:hidden">
            <nav className="flex flex-col py-2" aria-label="Main">
              {NAV.map((n) => <Link key={n.to} to={n.to} className="border-b border-line py-3 text-[16px] text-ink last:border-b-0">{n.label}</Link>)}
            </nav>
            <div className="mt-2 flex gap-2">
              {signedIn ? <ButtonLink to="/app" className="flex-1">Open Paheli</ButtonLink> : (
                <>
                  <ButtonLink to="/login" variant="secondary" className="flex-1">Sign in</ButtonLink>
                  <ButtonLink to="/register" className="flex-1">Get started</ButtonLink>
                </>
              )}
            </div>
          </div>
        )}
      </header>
      <main id="main" className="flex-1"><Outlet /></main>
      <Footer />
      <ExplainerHost />
    </div>
  );
}

function Footer() {
  const col = 'text-[12.5px] font-semibold uppercase tracking-[0.14em] text-ink';
  const link = 'link-draw text-ink-muted transition-colors hover:text-ink';
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr] lg:px-8">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-ink-muted">
            Paheli turns documents into a knowledge graph you can ask questions, with the source for every answer.
          </p>
          <p className="mt-4 font-display text-[22px] italic text-ink">Every question has connections.</p>
        </div>
        <div>
          <h3 className={col}>Use cases</h3>
          <ul className="mt-4 space-y-2.5 text-[14px]">
            {WORKSPACE_TYPES.map((t) => <li key={t.type}><Link to="/#use-cases" className={link}>{t.label}</Link></li>)}
            <li><Link to="/#use-cases" className={link}>{OTHERS_INFO.label}</Link></li>
          </ul>
        </div>
        <div>
          <h3 className={col}>Product</h3>
          <ul className="mt-4 space-y-2.5 text-[14px]">
            <li><Link to="/#how" className={link}>How it works</Link></li>
            <li><Link to="/#explained" className={link}>Knowledge graphs, explained</Link></li>
            <li><Link to="/#features" className={link}>Features</Link></li>
            <li><Link to="/demo" className={link}>Live demo</Link></li>
          </ul>
        </div>
        <div>
          <h3 className={col}>Company</h3>
          <ul className="mt-4 space-y-2.5 text-[14px]">
            <li><Link to="/#trust" className={link}>Security</Link></li>
            <li><Link to="/terms" className={link}>Terms & disclaimers</Link></li>
            <li><Link to="/login" className={link}>Sign in</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-[12.5px] text-ink-muted sm:px-6 lg:px-8">
          <span>© {new Date().getFullYear()} Paheli</span>
          <span>Legal information is research assistance, not legal advice.</span>
        </div>
      </div>
    </footer>
  );
}
