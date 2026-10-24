import { Link } from 'react-router-dom';
import { CircleHelp, PlayCircle } from 'lucide-react';
import { useDocumentTitle } from '../../lib/hooks';
import { ROLE_HELP, ROLE_LABEL, WORKSPACE_TYPES } from '../../lib/workspaceTypes';
import type { Role } from '../../types/platform';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { openGraphExplainer } from '../../components/explain/ExplainerHost';
import { openCallPaheli } from '../../components/CallPaheli';

const SECTIONS = [
  { id: 'start', title: 'Getting started' },
  { id: 'graph', title: 'Reading a knowledge graph' },
  { id: 'voice', title: 'Voice, phone calls and OCR' },
  { id: 'workspaces', title: 'Workspaces and roles' },
  { id: 'evidence', title: 'How answers are grounded' },
  { id: 'modes', title: 'Gemini and extractive modes' },
  { id: 'placement', title: 'Placement metric definitions' },
  { id: 'legal', title: 'Legal information disclaimer' },
  { id: 'privacy', title: 'Data handling' },
  { id: 'admin', title: 'For administrators' },
];

const PLACEMENT_DEFS: [string, string][] = [
  ['Placement rate', 'Placed students in the denominator group ÷ students in that group × 100. The group is eligible students by default (configurable to registered students in Settings).'],
  ['Students placed', 'Distinct students with at least one full-time offer, PPOs included, that counts as placed under your policy (offer received, or accepted only).'],
  ['Total offers vs unique students', 'Total offers counts every full-time offer made (offered, accepted or declined), including PPOs. One student can hold several, so unique students with offers is reported separately.'],
  ['Internship-to-PPO conversion', 'Interns who received a PPO ÷ interns whose PPO outcome is known × 100. Pending and unrecorded outcomes are excluded, never counted as “no PPO”.'],
  ['Returning companies', 'Companies in a cycle that also appear in an earlier cycle in your data.'],
  ['CTC statistics', 'Average, median and highest CTC over full-time offers that have a CTC value, as entered in your source data.'],
  ['Ongoing vs completed cycles', 'A cycle is ongoing until the June after it starts unless you set its status. Ongoing totals are partial; use the equivalent-date comparison for like-for-like views.'],
  ['Unknown outcomes', 'Records without a result are reported as unknown and kept out of rejection and conversion denominators.'],
];

export default function HelpPage() {
  useDocumentTitle('Help');
  return (
    <Page>
      <PageHeader icon={<CircleHelp />} title="Help and documentation" description="How Paheli works, what its numbers mean, and where its limits are." />
      <div className="mt-8 grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-6 space-y-1 text-[13.5px]">
            {SECTIONS.map((s) => <li key={s.id}><a href={`#${s.id}`} className="block rounded-md px-2 py-1 text-ink-muted hover:bg-canvas hover:text-ink">{s.title}</a></li>)}
          </ul>
        </nav>
        <div className="divide-y divide-line text-[14.5px] leading-relaxed text-ink-soft">
          <Section id="start" title="Getting started">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Open a workspace from the sidebar, or set one up from the <Link to="/app" className="text-brand-700 underline">overview</Link>.</li>
              <li>Load the fictional sample set to explore, or add your own documents or placement records.</li>
              <li>Wait for processing to finish (progress shows on the Documents tab and in notifications), then explore the analyses, the graph and the assistant.</li>
            </ol>
            <ul className="mt-3 space-y-1">
              {WORKSPACE_TYPES.map((t) => <li key={t.type}><b className="font-medium text-ink">{t.label}:</b> {t.tagline}</li>)}
            </ul>
          </Section>
          <Section id="graph" title="Reading a knowledge graph">
            <p>A knowledge graph is a map of what your documents say is connected to what.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><b className="font-medium text-ink">Dots</b> are things Paheli found: people, companies, places, laws, numbers. Diamonds are ideas. Bigger dots are mentioned more.</li>
              <li><b className="font-medium text-ink">Lines</b> are facts that connect two things, read in the arrow’s direction. Click one to see the sentences it came from.</li>
              <li><b className="font-medium text-ink">Coloured areas</b> are topics: things that are discussed together. Dashed lines are facts that link two topics.</li>
              <li>When you ask a question, the <b className="font-medium text-ink">chain of facts</b> behind the answer lights up, so you can follow how Paheli got there.</li>
            </ul>
            <button onClick={openGraphExplainer} className="mt-3 inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
              <PlayCircle className="h-4 w-4" /> Watch the step-by-step explainer
            </button>
          </Section>
          <Section id="voice" title="Voice, phone calls and OCR">
            <ul className="list-disc space-y-1.5 pl-5">
              <li><b className="font-medium text-ink">Voice mode.</b> Press the sound-wave button next to any assistant’s send button, ask out loud and hear the answer. Paheli listens again when it finishes; press the red button to end. Speech is recognised by your browser (Chrome, Edge or Safari) and answers come only from that workspace’s documents.</li>
              <li><b className="font-medium text-ink">Phone calls.</b> Press the phone icon in the top bar, enter your number with its country code, and Paheli’s voice assistant calls you to talk about Paheli and knowledge graphs.{' '}
                <button onClick={openCallPaheli} className="font-medium text-brand-700 hover:underline">Call me now</button></li>
              <li><b className="font-medium text-ink">OCR.</b> <Link to="/app/ocr" className="text-brand-700 underline">Scan & OCR</Link> reads photos and scanned PDFs in your browser. Check and correct the text, then add it to a workspace. Every document panel also has a “Scan (OCR)” button.</li>
            </ul>
          </Section>
          <Section id="workspaces" title="Workspaces and roles">
            <p>Each workspace has its own documents, knowledge graph, analyses and members. Members of one workspace can’t see another’s data, and search only covers workspaces you belong to.</p>
            <ul className="mt-2 space-y-1">{(['owner', 'analyst', 'viewer'] as Role[]).map((r) => <li key={r}><b className="font-medium text-ink">{ROLE_LABEL[r]}:</b> {ROLE_HELP[r]}</li>)}</ul>
            <p className="mt-2">The shared demo corpus is visible to everyone; by default only administrators can change it.</p>
          </Section>
          <Section id="evidence" title="How answers are grounded">
            <ul className="list-disc space-y-1 pl-5">
              <li>Questions are routed (factual, multi-hop, thematic or comparison) and answered from retrieved passages and graph facts. Citations like [S1] open the passage; [G1] opens the graph relation.</li>
              <li>When the evidence is insufficient, the answer says so instead of guessing.</li>
              <li>Financial figures are marked <b>Reported</b> (stated in a document) or <b>Calculated</b> (computed by Paheli, with formula and cited inputs). Different currencies are never combined.</li>
              <li>Risks are either <b>Disclosed</b> (quoted from the documents) or <b>Inferred</b> (rule-based flags from the figures). Neither is a credit rating.</li>
              <li>Research fields that can’t be found in a paper are marked “not found”. They are never filled in.</li>
            </ul>
          </Section>
          <Section id="modes" title="Gemini and extractive modes">
            <p>With a Gemini API key configured on the server, Paheli uses it for entity extraction, topic summaries and fluent answers. Without one it runs in extractive mode: rule-based extraction and answers that quote the source passages directly. The current mode shows in every knowledge graph header. The financial, research, legal and placement analyses are rule-based in both modes.</p>
          </Section>
          <Section id="placement" title="Placement metric definitions">
            <dl className="space-y-2.5">{PLACEMENT_DEFS.map(([t, d]) => <div key={t}><dt className="font-medium text-ink">{t}</dt><dd>{d}</dd></div>)}</dl>
          </Section>
          <Section id="legal" title="Legal information disclaimer">
            <p>The Legal &amp; Policy workspace provides legal information and research assistance based only on the sources in that workspace. It is not legal advice and does not guarantee compliance. Every law is shown as <b>potentially</b> applicable, with the facts you would still need to confirm. Effective dates and links appear only when someone has recorded them; check current, authoritative texts with a qualified professional.</p>
          </Section>
          <Section id="privacy" title="Data handling">
            <ul className="list-disc space-y-1 pl-5">
              <li>Passwords are hashed with scrypt. Sessions use HttpOnly cookies with CSRF protection and expire automatically.</li>
              <li>Uploaded files are validated by type and size on the server, stored per workspace and never executed.</li>
              <li>Placement imports never store names, contact details or sensitive characteristics, even if mapped. Students are identified only by your institution’s ID, and student-level views need the analyst or owner role.</li>
              <li>Activity history and saved analyses are private to you.</li>
            </ul>
          </Section>
          <Section id="admin" title="For administrators">
            <ul className="space-y-2">
              {[
                ['Make someone an administrator', 'python -m backend.auth.cli make-admin user@example.com'],
                ['Reset a password', 'python -m backend.auth.cli reset-password user@example.com'],
                ['Disable an account', 'python -m backend.auth.cli disable user@example.com'],
                ['Seed the shared demo corpus', 'python -m backend.kb.cli load-samples'],
              ].map(([l, c]) => (
                <li key={l}><p className="font-medium text-ink">{l}</p><code className="mt-1 block overflow-x-auto whitespace-nowrap rounded-md bg-ink px-3 py-1.5 font-mono text-[12px] text-white">{c}</code></li>
              ))}
            </ul>
            <p className="mt-3">Environment settings such as <code className="rounded bg-canvas px-1">HYPNEXIS_ADMIN_EMAILS</code>, <code className="rounded bg-canvas px-1">KB_SHARED_WRITE</code> and <code className="rounded bg-canvas px-1">HYPNEXIS_REGISTRATION</code> are documented in the README.</p>
          </Section>
        </div>
      </div>
    </Page>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="scroll-mt-6 py-7 first:pt-0" id={id}>
      <h2 className="mb-2.5 text-[18px] font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </section>
  );
}
