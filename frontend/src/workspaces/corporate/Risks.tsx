import { useState } from 'react';
import { ChevronDown, ChevronUp, MessageSquareText } from 'lucide-react';
import type { KbApi } from '../../api/kb';
import type { CorporateAnalysis, Risk } from '../../types/platform';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Form';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Table, Td, Th } from '../../components/ui/Table';
import { BasisBadge, CitationQuote } from '../../components/evidence/Evidence';
import { SeverityBadge } from './shared';

interface Props {
  analysis: CorporateAnalysis;
  api: KbApi;
  onAsk: (q: string) => void;
}

const SEV_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function Risks({ analysis: a, api, onAsk }: Props) {
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [method, setMethod] = useState(false);
  const keep = (r: Risk) => (category === 'all' || r.category === category) && (severity === 'all' || r.severity === severity);
  const sort = (x: Risk[]) => [...x].sort((p, q) => (SEV_RANK[p.severity] ?? 3) - (SEV_RANK[q.severity] ?? 3));
  const disclosed = sort(a.risks.disclosed.filter(keep));
  const inferred = sort(a.risks.inferred.filter(keep));

  return (
    <div className="space-y-6">
      <Notice tone="warn" title="Not a credit rating">
        Disclosed risks are sentences from the documents that use risk language. Inferred flags are threshold rules applied to the extracted figures.
        Neither is a validated score, an audit opinion or a credit rating. Severity is indicative.
      </Notice>

      <div className="flex flex-wrap items-center gap-2">
        <Select compact value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Risk category" className="w-56">
          <option value="all">All categories</option>
          {a.risks.summary.map((s) => <option key={s.category} value={s.category}>{s.label}</option>)}
        </Select>
        <Select compact value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity" className="w-40">
          <option value="all">Any severity</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </Select>
        <span className="text-[12.5px] text-ink-muted">{disclosed.length} disclosed · {inferred.length} inferred</span>
      </div>

      <section>
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Disclosed in the documents</h2>
        <p className="mb-3 text-[13px] text-ink-muted">Explicit statements by the company. Each quotes its source sentence.</p>
        {disclosed.length ? <div className="grid gap-4 lg:grid-cols-2">{disclosed.map((r, i) => <RiskCard key={i} r={r} api={api} onAsk={onAsk} />)}</div>
          : <Card><EmptyState compact title="No disclosed risks match">Try another category or severity.</EmptyState></Card>}
      </section>

      <section>
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Inferred from the figures</h2>
        <p className="mb-3 text-[13px] text-ink-muted">Rule-based flags for follow-up. Each shows the rule and the reported inputs that triggered it.</p>
        {inferred.length ? <div className="grid gap-4 lg:grid-cols-2">{inferred.map((r, i) => <RiskCard key={i} r={r} api={api} onAsk={onAsk} />)}</div>
          : <Card><EmptyState compact title="No inferred flags match">No rule was triggered for this selection.</EmptyState></Card>}
      </section>

      <Card>
        <button onClick={() => setMethod((m) => !m)} className="flex w-full items-center justify-between px-5 py-3.5 text-left" aria-expanded={method}>
          <span><span className="block text-[15px] font-semibold text-ink">Methodology and limitations</span>
            <span className="text-[13px] text-ink-muted">The rules behind inferred flags and what the analysis can miss.</span></span>
          {method ? <ChevronUp className="h-4 w-4 text-ink-muted" /> : <ChevronDown className="h-4 w-4 text-ink-muted" />}
        </button>
        {method && (
          <div className="border-t border-line">
            <Table caption="Risk rules">
              <thead><tr><Th>Rule</Th><Th>Category</Th><Th>Severity</Th><Th>Condition</Th></tr></thead>
              <tbody>
                {a.methodology.map((m) => (
                  <tr key={m.rule}>
                    <Td className="font-mono text-[12px]">{m.rule}</Td>
                    <Td>{a.risks.summary.find((s) => s.category === m.category)?.label ?? m.category.replace(/_/g, ' ')}</Td>
                    <Td><SeverityBadge severity={m.severity} /></Td>
                    <Td className="text-ink-soft">{m.condition}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <ul className="list-disc space-y-1 px-9 py-4 text-[13px] text-ink-soft">{a.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        )}
      </Card>
    </div>
  );
}

function RiskCard({ r, api, onAsk }: { r: Risk; api: KbApi; onAsk: (q: string) => void }) {
  return (
    <Card className="flex flex-col">
      <CardHeader title={r.title}
        description={<span className="flex flex-wrap items-center gap-1.5 pt-1"><Badge>{r.category_label}</Badge><BasisBadge basis={r.basis} />
          {r.period && <span className="text-[12px]">{r.period.label}</span>}</span>}
        actions={<SeverityBadge severity={r.severity} />} />
      <div className="flex-1 space-y-3 px-5 py-4">
        {r.explanation && r.explanation !== r.title && <p className="text-[13.5px] leading-relaxed text-ink-soft">{r.explanation}</p>}
        {r.condition && <p className="rounded-lg bg-canvas px-3 py-2 text-[12.5px] text-ink-soft"><b className="font-medium text-ink">Rule:</b> {r.condition}</p>}
        {r.evidence.map((c, i) => <CitationQuote key={i} c={c} api={api} />)}
        {r.inputs?.map((x, i) => (
          <div key={i} className="space-y-1">
            <div className="text-[12.5px] text-ink"><b className="font-medium">{x.label}</b> {x.period}: {x.display}</div>
            {x.citation && <CitationQuote c={x.citation} api={api} compact />}
          </div>
        ))}
        <p className="text-[12px] text-ink-muted">
          Evidence strength: <b className="font-medium text-ink-soft">{r.evidence_strength}</b>
          {' · '}severity based on {r.severity_basis === 'rule' ? 'the rule' : 'the wording of the disclosure'}
          {r.supporting_sentences_in_category ? ` · ${r.supporting_sentences_in_category} supporting sentence(s) in this category` : ''}
        </p>
      </div>
      {r.follow_ups.length > 0 && (
        <div className="border-t border-line px-5 py-3">
          <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Follow-up questions</p>
          <div className="flex flex-wrap gap-1.5">
            {r.follow_ups.map((q) => (
              <button key={q} onClick={() => onAsk(q)} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-left text-[12px] text-ink-soft hover:border-brand-200 hover:bg-brand-50">
                <MessageSquareText className="h-3 w-3 text-brand-700" /> {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
