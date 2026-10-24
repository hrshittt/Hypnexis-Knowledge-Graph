import { useEffect, useState } from 'react';
import { FileText, Quote, TextSearch } from 'lucide-react';
import type { KbApi } from '../../api/kb';
import type { ChunkDetail, Citation } from '../../types/kb';
import HighlightedText from '../kb/HighlightedText';
import { Modal } from '../ui/Overlay';
import { Spinner } from '../ui/Feedback';

/** Where a quoted sentence comes from: file · page · section. */
export function SourceLine({ c, className = '' }: { c: Pick<Citation, 'filename' | 'page' | 'section'>; className?: string }) {
  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px] text-ink-muted ${className}`}>
      <FileText className="h-3 w-3 shrink-0" />
      <span className="truncate font-medium text-ink-soft">{c.filename}</span>
      <span>· p.{c.page}</span>
      {c.section && <span className="truncate">· {c.section}</span>}
    </span>
  );
}

/**
 * A verbatim source sentence with its location. With `api`, the reader can open the full
 * passage from that knowledge base with the sentence highlighted.
 */
export function CitationQuote({ c, api, compact }: { c: Citation; api?: KbApi; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-lg border border-line bg-canvas/60 ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}>
      <p className="flex gap-1.5 text-[13px] leading-relaxed text-ink-soft">
        <Quote className="mt-1 h-3 w-3 shrink-0 text-ink-faint" />
        <span>{c.sentence}</span>
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 pl-[18px]">
        <SourceLine c={c} />
        {api && c.chunk_id && (
          <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-[11.5px] font-medium text-brand-700 hover:underline">
            <TextSearch className="h-3 w-3" /> View passage
          </button>
        )}
      </div>
      {api && open && <PassageModal api={api} citation={c} onClose={() => setOpen(false)} />}
    </div>
  );
}

function PassageModal({ api, citation, onClose }: { api: KbApi; citation: Citation; onClose: () => void }) {
  const [chunk, setChunk] = useState<ChunkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.chunk(citation.chunk_id).then((c) => alive && setChunk(c)).catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [api, citation.chunk_id]);
  return (
    <Modal open onClose={onClose} title="Source passage" description={<SourceLine c={citation} />} size="lg">
      {error && <p className="text-[13px] text-danger-ink">{error}</p>}
      {!chunk && !error && <Spinner label="Loading passage…" />}
      {chunk && <HighlightedText text={chunk.text} ranges={[citation.highlight]} className="text-[13.5px]" />}
    </Modal>
  );
}

/** "Reported" vs "Calculated" vs "Disclosed" vs "Inferred" — always visible next to a figure or finding. */
export function BasisBadge({ basis }: { basis: string }) {
  const map: Record<string, [string, string, string]> = {
    reported: ['Reported', 'bg-brand-50 text-brand-700', 'Taken verbatim from a source document.'],
    calculated: ['Calculated', 'bg-info-soft text-info-ink', 'Computed by Hypnexis from reported figures; the formula and inputs are shown.'],
    disclosed: ['Disclosed', 'bg-brand-50 text-brand-700', 'Stated in the documents.'],
    inferred: ['Inferred', 'bg-warn-soft text-warn-ink', 'A rule-based flag derived from the figures, not a statement in the documents.'],
    estimated: ['Estimated', 'bg-warn-soft text-warn-ink', 'An estimate — treat with caution.'],
  };
  const [label, cls, title] = map[basis] ?? [basis, 'bg-ink/[0.06] text-ink-soft', ''];
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`} title={title}>{label}</span>;
}
