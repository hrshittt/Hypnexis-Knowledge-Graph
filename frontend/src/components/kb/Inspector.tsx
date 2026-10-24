import { useEffect, useState } from 'react';
import { ArrowRight, FileText, Loader2, Network, Sparkles, X } from 'lucide-react';
import { kbApi } from '../../api/kb';
import type { ChunkDetail, EntityDetail, GraphPayload, RelationDetail, Selection } from '../../types/kb';
import { colorForIndex } from '../../lib/graphColors';
import HighlightedText from './HighlightedText';

interface Props {
  selection: Selection;
  graph: GraphPayload | null;
  onSelect: (s: Selection) => void;
  onHighlightNodes: (ids: string[]) => void;
  onClose: () => void;
}

export default function Inspector({ selection, graph, onSelect, onHighlightNodes, onClose }: Props) {
  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [relation, setRelation] = useState<RelationDetail | null>(null);
  const [chunk, setChunk] = useState<ChunkDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntity(null); setRelation(null); setChunk(null); setError(null);
    if (!selection || selection.kind === 'topic') return;
    let alive = true;
    setLoading(true);
    const p =
      selection.kind === 'entity' ? kbApi.entity(selection.id).then((d) => alive && setEntity(d))
      : selection.kind === 'relation' ? kbApi.relation(selection.id).then((d) => alive && setRelation(d))
      : kbApi.chunk(selection.source.chunk_id).then((d) => alive && setChunk(d));
    p.catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [selection]);

  if (!selection) return null;
  const topicColor = (id?: string | null) => {
    const t = graph?.topics.find((x) => x.id === id);
    return t ? colorForIndex(t.color_index) : '#94a3b8';
  };

  return (
    <aside className="absolute right-3 top-14 bottom-3 z-20 flex w-[380px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {selection.kind === 'entity' ? 'Entity' : selection.kind === 'relation' ? 'Relationship'
            : selection.kind === 'source' ? `Source passage ${selection.source.id}` : 'Topic community'}
        </span>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close inspector">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {loading && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {entity && (
          <>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{entity.name}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{entity.type}</span>
                {entity.topic && (
                  <button onClick={() => onSelect({ kind: 'topic', id: entity.topic!.id })}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-white" style={{ background: topicColor(entity.topic.id) }}>
                    {entity.topic.label}
                  </button>
                )}
                <span className="text-slate-500">{entity.mention_count} passages · {entity.documents.length} docs</span>
              </div>
              {entity.description && <p className="mt-2 text-sm text-slate-600">{entity.description}</p>}
              {entity.aliases.length > 1 && (
                <p className="mt-1 text-xs text-slate-500">Also: {entity.aliases.filter((a) => a !== entity.name).join(', ')}</p>
              )}
            </div>
            <Section title={`Relationships (${entity.relations.length})`} icon={<Network className="h-3.5 w-3.5" />}>
              <ul className="space-y-1">
                {entity.relations.map((r) => (
                  <li key={r.id + r.direction}>
                    <button onClick={() => onSelect({ kind: 'relation', id: r.id })}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] hover:bg-slate-50">
                      {r.direction === 'in' && <span className="font-medium text-slate-800">{r.other.name}</span>}
                      {r.direction === 'in' && <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />}
                      <span className="rounded bg-brand-50 px-1.5 text-brand-600">{r.predicate}</span>
                      {r.direction === 'out' && <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />}
                      {r.direction === 'out' && <span className="font-medium text-slate-800">{r.other.name}</span>}
                      <span className="ml-auto text-[11px] text-slate-400">×{r.evidence_count}</span>
                    </button>
                  </li>
                ))}
                {!entity.relations.length && <li className="text-sm text-slate-500">Mentioned in the documents, no extracted relations.</li>}
              </ul>
            </Section>
            <Section title="Source passages" icon={<FileText className="h-3.5 w-3.5" />}>
              {entity.passages.map((p) => (
                <Passage key={p.chunk_id} filename={p.filename} page={p.page}>
                  <HighlightedText text={p.text} ranges={p.highlights} />
                </Passage>
              ))}
            </Section>
          </>
        )}

        {relation && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[15px]">
              <button onClick={() => onSelect({ kind: 'entity', id: relation.subject.id })} className="font-semibold text-slate-900 hover:underline">
                {relation.subject.name}
              </button>
              <span className="rounded bg-brand-50 px-2 py-0.5 text-sm text-brand-600">{relation.predicate}</span>
              <ArrowRight className="h-4 w-4 text-slate-400" />
              <button onClick={() => onSelect({ kind: 'entity', id: relation.object.id })} className="font-semibold text-slate-900 hover:underline">
                {relation.object.name}
              </button>
            </div>
            <Section title={`Evidence (${relation.evidence.length})`} icon={<FileText className="h-3.5 w-3.5" />}>
              {relation.evidence.map((e, i) => (
                <Passage key={i} filename={e.filename} page={e.page} badge={e.method === 'llm' ? 'Gemini-extracted' : 'rule-extracted'}>
                  <HighlightedText text={e.text} ranges={e.highlights} />
                </Passage>
              ))}
            </Section>
          </>
        )}

        {selection.kind === 'source' && (
          <>
            <Passage filename={selection.source.filename} page={selection.source.page}
              badge={selection.source.rerank != null ? `relevance ${(selection.source.rerank * 100).toFixed(0)}%` : undefined}>
              <HighlightedText text={selection.source.text} ranges={selection.source.highlights} />
            </Passage>
            {chunk && chunk.entity_ids.length > 0 && (
              <button onClick={() => onHighlightNodes(chunk.entity_ids)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                <Network className="h-4 w-4" /> Highlight the {chunk.entity_ids.length} entities in this passage
              </button>
            )}
          </>
        )}

        {selection.kind === 'topic' && <TopicView id={selection.id} graph={graph} onSelect={onSelect} />}
      </div>
    </aside>
  );
}

function TopicView({ id, graph, onSelect }: { id: string; graph: GraphPayload | null; onSelect: (s: Selection) => void }) {
  const topic = graph?.topics.find((t) => t.id === id);
  const [open, setOpen] = useState<ChunkDetail | null>(null);
  if (!topic) return <p className="text-sm text-slate-500">Topic no longer exists (the graph was rebuilt).</p>;
  const docs = graph!.documents.filter((d) => topic.doc_ids.includes(d.doc_id));
  const links = graph!.topic_links.filter((l) => l.source === id || l.target === id);
  const parts = topic.summary.split(/(\[\d+\])/g);
  return (
    <>
      <div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: colorForIndex(topic.color_index) }} />
          <h3 className="text-lg font-semibold text-slate-900">{topic.label}</h3>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-500">
          <span>{topic.size} entities</span>·
          <span className="flex items-center gap-1">{topic.method === 'llm' && <Sparkles className="h-3 w-3" />}
            {topic.method === 'llm' ? 'Gemini summary' : 'Extractive summary'}</span>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-slate-700">
        {parts.map((p, i) => {
          const m = p.match(/^\[(\d+)\]$/);
          if (!m) return <span key={i}>{p}</span>;
          const cid = topic.evidence_chunk_ids[Number(m[1]) - 1];
          return (
            <button key={i} onClick={() => cid && kbApi.chunk(cid).then(setOpen)}
              className="mx-0.5 rounded bg-brand-50 px-1 text-[11px] font-semibold text-brand-600 hover:bg-brand-100">{m[1]}</button>
          );
        })}
      </p>
      {open && (
        <Passage filename={open.filename} page={open.page}>
          <HighlightedText text={open.text} ranges={[]} />
        </Passage>
      )}
      <Section title="Key entities">
        <div className="flex flex-wrap gap-1.5">
          {topic.top_entities.map((e) => (
            <button key={e.id} onClick={() => onSelect({ kind: 'entity', id: e.id })}
              className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-700 hover:border-slate-400">{e.name}</button>
          ))}
        </div>
      </Section>
      {topic.keywords.length > 0 && <Section title="Keywords"><p className="text-sm text-slate-600">{topic.keywords.join(' · ')}</p></Section>}
      <Section title="Documents"><ul className="text-sm text-slate-600">{docs.map((d) => <li key={d.doc_id}>• {d.filename}</li>)}</ul></Section>
      {links.length > 0 && (
        <Section title="Connected topics">
          <ul className="space-y-2">
            {links.map((l) => {
              const other = graph!.topics.find((t) => t.id === (l.source === id ? l.target : l.source));
              return (
                <li key={l.source + l.target} className="text-[13px]">
                  <button onClick={() => other && onSelect({ kind: 'topic', id: other.id })} className="font-medium text-slate-800 hover:underline">
                    {other?.label}
                  </button>
                  {l.bridges.slice(0, 2).map((b) => (
                    <button key={b.relation_id} onClick={() => onSelect({ kind: 'relation', id: b.relation_id })}
                      className="block text-left text-xs text-slate-500 hover:text-slate-800">
                      via {b.subject.name} — {b.predicate} → {b.object.name}
                    </button>
                  ))}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{icon}{title}</h4>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Passage({ filename, page, badge, children }: { filename: string; page: number; badge?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="flex min-w-0 items-center gap-1 font-medium text-slate-600"><FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">{filename}</span><span className="shrink-0 text-slate-400">· p.{page}</span></span>
        {badge && <span className="shrink-0 rounded bg-white px-1.5 text-slate-500 ring-1 ring-slate-200">{badge}</span>}
      </div>
      {children}
    </div>
  );
}
