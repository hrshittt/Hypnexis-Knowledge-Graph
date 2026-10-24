import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Menu as MenuIcon, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Logo } from '../components/brand/Logo';
import { ButtonLink } from '../components/ui/Button';
import { WORKSPACE_TYPES } from '../lib/workspaceTypes';

const NAV = [
  { to: '/#product', label: 'Product' },
  { to: '/#solutions', label: 'Solutions' },
  { to: '/#evidence', label: 'Research' },
  { to: '/#about', label: 'About' },
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
      <header className={`sticky top-0 z-40 border-b bg-white/90 backdrop-blur transition-colors ${scrolled ? 'border-line' : 'border-transparent'}`}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="rounded-lg px-3 py-2 text-[14px] text-ink-soft transition-colors hover:bg-canvas hover:text-ink">{n.label}</Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {signedIn ? (
              <ButtonLink to="/app">Open Hypnexis</ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost">Sign in</ButtonLink>
                <ButtonLink to="/register">Get started</ButtonLink>
              </>
            )}
          </div>
          <button className="rounded-lg p-2 text-ink-soft hover:bg-canvas md:hidden" onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <div className="animate-fade-in border-t border-line bg-white px-4 pb-4 md:hidden">
            <nav className="flex flex-col py-2" aria-label="Main">
              {NAV.map((n) => <Link key={n.to} to={n.to} className="rounded-lg px-2 py-2.5 text-[15px] text-ink">{n.label}</Link>)}
            </nav>
            <div className="flex gap-2">
              {signedIn ? <ButtonLink to="/app" className="flex-1">Open Hypnexis</ButtonLink> : (
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
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-[13.5px] leading-relaxed text-ink-muted">
            Evidence-backed answers and interactive knowledge graphs for corporate, research, legal and placement teams.
          </p>
        </div>
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink">Solutions</h3>
          <ul className="mt-3 space-y-2 text-[13.5px]">
            {WORKSPACE_TYPES.map((t) => <li key={t.type}><Link to="/#solutions" className="text-ink-muted hover:text-ink">{t.label}</Link></li>)}
          </ul>
        </div>
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink">Product</h3>
          <ul className="mt-3 space-y-2 text-[13.5px]">
            <li><Link to="/#how" className="text-ink-muted hover:text-ink">How it works</Link></li>
            <li><Link to="/#product" className="text-ink-muted hover:text-ink">Capabilities</Link></li>
            <li><Link to="/demo" className="text-ink-muted hover:text-ink">Live demo graph</Link></li>
            <li><Link to="/#security" className="text-ink-muted hover:text-ink">Security</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink">Company</h3>
          <ul className="mt-3 space-y-2 text-[13.5px]">
            <li><Link to="/#about" className="text-ink-muted hover:text-ink">About</Link></li>
            <li><Link to="/terms" className="text-ink-muted hover:text-ink">Terms & disclaimers</Link></li>
            <li><Link to="/login" className="text-ink-muted hover:text-ink">Sign in</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[12.5px] text-ink-muted sm:px-6 lg:px-8">
          <span>© {new Date().getFullYear()} Hypnexis</span>
          <span>Legal information is research assistance, not legal advice.</span>
        </div>
      </div>
    </footer>
  );
}
