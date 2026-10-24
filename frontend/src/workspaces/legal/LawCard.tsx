import { useState } from 'react';
import { AlertTriangle, CalendarCheck, ChevronDown, ChevronUp, CircleHelp, ExternalLink, Landmark } from 'lucide-react';
import type { KbApi } from '../../api/kb';
import type { LegalAnalysis, LegalLaw, LegalSentence } from '../../types/platform';
import { fmtDate } from '../../lib/format';
import { Card } from '../../components/ui/Card';
import { Badge, SampleBadge } from '../../components/ui/Badge';
import { Notice } from '../../components/ui/Feedback';
import { CitationQuote } from '../../components/evidence/Evidence';

const SECTIONS: { key: keyof Pick<LegalLaw, 'scope' | 'obligations' | 'conditions' | 'exceptions' | 'deadlines' | 'penalties'>; label: string; help: string }[] = [
  { key: 'scope', label: 'Applicability and scope', help: 'What the text says about who or what it covers.' },
  { key: 'obligations', label: 'Obligations', help: 'Sentences that require or prohibit something.' },
  { key: 'conditions', label: 'Conditions that trigger it', help: 'When or if the obligations apply.' },
  { key: 'exceptions', label: 'Exceptions and exemptions', help: 'Situations the text carves out.' },
  { key: 'deadlines', label: 'Deadlines', help: 'Time limits stated in the text.' },
  { key: 'penalties', label: 'Penalties', help: 'Consequences of non-compliance stated in the text.' },
];

/** Results header: what was understood, clarifications, and the standing status note. */
export function AnalysisSummary({ result }: { result: LegalAnalysis }) {
  return (
    <div className="space-y-3">
      {result.status_note && (
        <Notice tone="warn" title="Potential, not confirmed, applicability" icon={<AlertTriangle className="h-4 w-4" />}>{result.status_note}</Notice>
      )}
      <Card padded>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Facts identified in your question</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {result.facts.length ? result.facts.map((f) => <Badge key={f.key} tone="info">{f.label}</Badge>)
                : <span className="text-[13px] text-ink-muted">No specific facts recognised. Describe the activity in more detail.</span>}
            </div>
          </div>
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Jurisdiction</p>
            <p className="mt-1.5 text-[13.5px] text-ink">{result.jurisdiction ?? 'Any jurisdiction in your sources'}</p>
            <p className="text-[12px] text-ink-muted">{result.sources_considered} source{result.sources_considered === 1 ? '' : 's'} considered</p>
          </div>
        </div>
        {result.clarifications.length > 0 && (
          <div className="mt-4 rounded-lg border border-info/25 bg-info-soft px-3.5 py-2.5">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-info-ink"><CircleHelp className="h-4 w-4" /> To give a more precise answer</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-info-ink">{result.clarifications.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
      </Card>
    </div>
  );
}

export function LawCard({ law, api, defaultOpen = false }: { law: LegalLaw; api?: KbApi; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold leading-snug text-ink">{law.law}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
              <span className="flex items-center gap-1"><Landmark className="h-3.5 w-3.5" /> {law.jurisdiction ?? 'Jurisdiction not tagged'}</span>
              <span>Issued by {law.authority ?? <i>authority not recorded</i>}</span>
              {law.authorities_mentioned.length > 0 && <span>Regulator named: {law.authorities_mentioned.join(', ')}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="warn" title="Applicability depends on facts and current authoritative texts you need to confirm">Potentially applicable</Badge>
            <Badge tone="outline">Evidence: {law.evidence_strength}</Badge>
            {law.is_sample && <SampleBadge />}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px]">
          <span className="text-ink-soft">Effective: {law.effective_date ?? <span className="text-ink-muted">not recorded</span>}</span>
          <span className="flex items-center gap-1 text-ink-soft"><CalendarCheck className="h-3.5 w-3.5" />
            {law.verified_at ? `Last verified ${fmtDate(law.verified_at)}` : <span className="text-ink-muted">Not verified against the official source</span>}</span>
          {law.source_url
            ? <a href={law.source_url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 font-medium text-brand-700 hover:underline">Official source <ExternalLink className="h-3.5 w-3.5" /></a>
            : <span className="text-ink-muted">No official link recorded · source: {law.filename}</span>}
        </div>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Why it may apply</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-ink-soft">{law.why.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
        {law.provisions.length > 0 && (
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Relevant provisions</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {law.provisions.map((p) => <span key={p.ref} className="rounded-md border border-line bg-canvas px-2 py-0.5 text-[12px] text-ink-soft">{p.label} · p.{p.page}</span>)}
            </div>
          </div>
        )}
        {law.facts_to_confirm.length > 0 && (
          <div className="rounded-lg border border-warn/30 bg-warn-soft/60 px-3.5 py-3">
            <p className="text-[13px] font-semibold text-warn-ink">Facts to confirm before relying on this</p>
            <ul className="mt-2 space-y-2">
              {law.facts_to_confirm.map((f, i) => (
                <li key={i} className="text-[12.5px] text-ink-soft">
                  <span className="font-medium text-ink">{f.provision}:</span> “{f.phrase}”
                </li>
              ))}
            </ul>
          </div>
        )}
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {open ? 'Hide' : 'Show'} obligations, conditions, exceptions and penalties
        </button>
        {open && (
          <div className="space-y-4">
            {SECTIONS.map((s) => <SentenceGroup key={s.key} label={s.label} help={s.help} items={law[s.key]} api={api} />)}
            {law.limitations.length > 0 && (
              <div className="rounded-lg bg-canvas px-3.5 py-2.5">
                <p className="text-[12px] font-semibold text-ink">Limitations of this result</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-muted">{law.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function SentenceGroup({ label, help, items, api }: { label: string; help: string; items: LegalSentence[]; api?: KbApi }) {
  const [all, setAll] = useState(false);
  if (!items.length) {
    return (
      <div>
        <p className="text-[13px] font-semibold text-ink">{label}</p>
        <p className="text-[12.5px] text-ink-muted">None found in the relevant provisions.</p>
      </div>
    );
  }
  const shown = all ? items : items.slice(0, 3);
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink">{label} <span className="font-normal text-ink-muted">({items.length})</span></p>
      <p className="mb-1.5 text-[12px] text-ink-muted">{help}</p>
      <div className="space-y-2">
        {shown.map((s, i) => (
          <div key={i}>
            <p className="mb-0.5 text-[11.5px] font-medium text-ink-muted">{s.provision}</p>
            <CitationQuote c={s.citation} api={api} compact />
          </div>
        ))}
      </div>
      {items.length > 3 && (
        <button onClick={() => setAll((a) => !a)} className="mt-1.5 text-[12.5px] font-medium text-brand-700 hover:underline">
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
