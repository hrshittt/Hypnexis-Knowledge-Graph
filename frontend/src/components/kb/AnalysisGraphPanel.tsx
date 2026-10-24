import { useMemo, useState } from 'react';
import { ArrowRight, Network, X } from 'lucide-react';
import type { KbApi } from '../../api/kb';
import type { Citation, GraphEdge, GraphNode, Selection } from '../../types/kb';
import type { AnalysisGraph } from '../../types/platform';
import { colorForIndex } from '../../lib/graphColors';
import { useMediaQuery } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import GraphView, { type HighlightSets } from './GraphView';
import TopicLegend from './TopicLegend';
import { BasisBadge, CitationQuote } from '../evidence/Evidence';

interface Props {
  graph: AnalysisGraph | null;
  /** knowledge base to open source passages from */
  api?: KbApi;
  emptyHint: React.ReactNode;
  toolbar?: React.ReactNode;
  className?: string;
}

/**
 * Renders an analysis graph (company, legal-provision or placement graph) with the same graph view as
 * the knowledge graph. Every node and edge here was built from extracted figures, provisions or imported
 * records; the inspector shows the facts behind it.
 */
export default function AnalysisGraphPanel({ graph, api, emptyHint, toolbar, className = '' }: Props) {
  const [selection, setSelection] = useState<Selection>(null);
  const [highlight, setHighlight] = useState<HighlightSets | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const wide = useMediaQuery('(min-width: 1280px)');

  const types = useMemo(() => {
    const m = new Map<string, number>();
    graph?.nodes.forEach((n) => m.set(n.type, (m.get(n.type) ?? 0) + 1));
    return [...m.entries()];
  }, [graph]);

  const view = useMemo(() => {
    if (!graph) return graph;
    // placement graphs count records as "mentions" (hundreds); damp them so node sizes stay comparable
    const nodes = graph.nodes.filter((n) => !hidden.has(n.type)).map((n) => ({ ...n, mentions: Math.round(Math.sqrt(n.mentions)) }));
    const ids = new Set(nodes.map((n) => n.id));
    return { ...graph, nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [graph, hidden]);

  const select = (s: Selection) => {
    setSelection(s);
    if (!graph || !s) return;
    if (s.kind === 'entity') {
      const edges = graph.edges.filter((e) => e.source === s.id || e.target === s.id);
      setHighlight({ nodes: new Set([s.id, ...edges.map((e) => (e.source === s.id ? e.target : e.source))]),
        edges: new Set(edges.map((e) => e.id)), pathEdges: new Set(), communities: new Set() });
    } else if (s.kind === 'relation') {
      const e = graph.edges.find((x) => x.id === s.id);
      if (e) setHighlight({ nodes: new Set([e.source, e.target]), edges: new Set([e.id]), pathEdges: new Set(), communities: new Set() });
      setFocusToken((t) => t + 1);
    } else if (s.kind === 'topic') {
      setHighlight({ nodes: new Set(), edges: new Set(), pathEdges: new Set(), communities: new Set([s.id]) });
      setFocusToken((t) => t + 1);
    }
  };

  const inspector = selection && graph && (
    <PayloadInspector graph={graph} selection={selection} onSelect={select} onClose={() => setSelection(null)} api={api}
      variant={wide ? 'panel' : 'overlay'} />
  );

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-card ${className}`}>
      {(types.length > 1 || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          {toolbar}
          {types.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Node types">
              <span className="text-[12px] text-ink-muted">Show:</span>
              {types.map(([t, n]) => {
                const on = !hidden.has(t);
                return (
                  <button key={t} type="button" aria-pressed={on}
                    onClick={() => { const next = new Set(hidden); if (on) next.add(t); else next.delete(t); setHidden(next); }}
                    className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${
                      on ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-line bg-white text-ink-faint line-through'}`}>
                    {t} <span className="num text-ink-muted">{n}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className="relative flex min-h-[480px] flex-1">
        <div className="relative min-w-0 flex-1">
          <GraphView graph={view} highlight={highlight} selection={selection} focusToken={focusToken} onSelect={select}
            onClearHighlight={() => setHighlight(null)} emptyHint={emptyHint}
            edgeLabelMinScale={view && view.edges.length > 40 ? Infinity : 2.4} />
          {view && view.topics.length > 0 && (
            <TopicLegend topics={view.topics} activeIds={highlight?.communities ?? new Set()} onSelect={(id) => select({ kind: 'topic', id })} />
          )}
          {!wide && inspector}
        </div>
        {wide && selection && <div className="w-[360px] shrink-0 border-l border-line">{inspector}</div>}
      </div>
    </div>
  );
}

interface InspectorProps {
  graph: AnalysisGraph;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onClose: () => void;
  api?: KbApi;
  variant: 'panel' | 'overlay';
}

function PayloadInspector({ graph, selection, onSelect, onClose, api, variant }: InspectorProps) {
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const node = selection?.kind === 'entity' ? byId.get(selection.id) : undefined;
  const edge = selection?.kind === 'relation' ? graph.edges.find((e) => e.id === selection.id) : undefined;
  const topic = selection?.kind === 'topic' ? graph.topics.find((t) => t.id === selection.id) : undefined;

  return (
    <aside aria-label="Graph inspector" className={variant === 'panel'
      ? 'flex h-full w-full animate-fade-in flex-col overflow-hidden bg-white'
      : 'absolute right-3 top-14 bottom-3 z-20 flex w-[360px] max-w-[calc(100%-1.5rem)] animate-slide-in-right flex-col overflow-hidden rounded-xl border border-line bg-white shadow-pop'}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">
          {node ? node.type : edge ? 'Relationship' : 'Group'}
        </span>
        <button onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-canvas hover:text-ink" aria-label="Close inspector">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {node && <NodeView node={node} graph={graph} byId={byId} onSelect={onSelect} api={api} />}
        {edge && <EdgeView edge={edge} byId={byId} onSelect={onSelect} api={api} />}
        {topic && (
          <>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: colorForIndex(topic.color_index) }} />
              <h3 className="text-[16px] font-semibold text-ink">{topic.label}</h3>
            </div>
            {topic.summary && <p className="text-[13px] text-ink-soft">{topic.summary}</p>}
            <div className="flex flex-wrap gap-1.5">
              {topic.top_entities.map((e) => (
                <button key={e.id} onClick={() => onSelect({ kind: 'entity', id: e.id })}
                  className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-soft hover:border-ink-faint">{e.name}</button>
              ))}
            </div>
          </>
        )}
        {!node && !edge && !topic && <p className="text-[13px] text-ink-muted">This item is no longer in the graph.</p>}
      </div>
    </aside>
  );
}

function NodeView({ node, graph, byId, onSelect, api }: {
  node: GraphNode; graph: AnalysisGraph; byId: Map<string, GraphNode>; onSelect: (s: Selection) => void; api?: KbApi;
}) {
  const edges = graph.edges.filter((e) => e.source === node.id || e.target === node.id);
  const d = (node.detail ?? {}) as Record<string, unknown>;
  const citation = d.citation as Citation | undefined;
  const inputs = d.inputs as { label: string; period: string; display: string; citation?: Citation }[] | undefined;
  const figures = d.figures as { period: string; value: string; citation?: Citation }[] | undefined;
  const rest = Object.entries(d).filter(([k, v]) => !['citation', 'inputs', 'figures', 'value', 'basis', 'formula', 'period', 'conflict'].includes(k)
    && v !== null && v !== undefined && v !== 0 && v !== '' && !(Array.isArray(v) && !v.length));
  return (
    <>
      <div>
        <h3 className="text-[16px] font-semibold leading-snug text-ink">{node.name}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {typeof d.basis === 'string' && <BasisBadge basis={d.basis} />}
          {d.conflict === true && <span className="rounded-md bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger-ink">Conflicting values in the sources</span>}
          <span className="text-[12px] text-ink-muted">{edges.length} connection{edges.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      {typeof d.formula === 'string' && (
        <div className="rounded-lg bg-info-soft px-3 py-2 text-[12.5px] text-info-ink"><b className="font-semibold">Formula:</b> {d.formula}</div>
      )}
      {rest.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {rest.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{titleCase(k)}</dt>
              <dd className="break-words text-[13px] text-ink">{Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {citation && (
        <Section title="Source">
          <CitationQuote c={citation} api={api} />
        </Section>
      )}
      {inputs && inputs.length > 0 && (
        <Section title="Inputs">
          {inputs.map((x, i) => (
            <div key={i} className="space-y-1">
              <div className="text-[12.5px] text-ink"><b className="font-medium">{x.label}</b> {x.period}: {x.display}</div>
              {x.citation && <CitationQuote c={x.citation} api={api} compact />}
            </div>
          ))}
        </Section>
      )}
      {figures && figures.length > 0 && (
        <Section title="Figures">
          {figures.map((f, i) => (
            <div key={i} className="space-y-1">
              <div className="text-[12.5px] text-ink">{f.period}: <b className="font-medium">{f.value}</b></div>
              {f.citation && <CitationQuote c={f.citation} api={api} compact />}
            </div>
          ))}
        </Section>
      )}
      <Section title={`Connections (${edges.length})`} icon={<Network className="h-3.5 w-3.5" />}>
        <ul className="space-y-0.5">
          {edges.slice(0, 60).map((e) => {
            const out = e.source === node.id;
            const other = byId.get(out ? e.target : e.source);
            return (
              <li key={e.id}>
                <button onClick={() => onSelect({ kind: 'relation', id: e.id })}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-canvas">
                  {!out && <span className="truncate font-medium text-ink">{other?.name}</span>}
                  {!out && <ArrowRight className="h-3 w-3 shrink-0 text-ink-faint" />}
                  <span className="shrink-0 rounded bg-brand-50 px-1.5 text-brand-700">{e.predicate}</span>
                  {out && <ArrowRight className="h-3 w-3 shrink-0 text-ink-faint" />}
                  {out && <span className="truncate font-medium text-ink">{other?.name}</span>}
                </button>
              </li>
            );
          })}
          {edges.length > 60 && <li className="px-2 text-[12px] text-ink-muted">…and {edges.length - 60} more</li>}
        </ul>
      </Section>
    </>
  );
}

function EdgeView({ edge, byId, onSelect, api }: { edge: GraphEdge; byId: Map<string, GraphNode>; onSelect: (s: Selection) => void; api?: KbApi }) {
  const a = byId.get(edge.source);
  const b = byId.get(edge.target);
  const detail = Object.entries(edge.detail ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <button onClick={() => onSelect({ kind: 'entity', id: edge.source })} className="font-semibold text-ink hover:underline">{a?.name}</button>
        <span className="rounded bg-brand-50 px-2 py-0.5 text-[12.5px] text-brand-700">{edge.predicate}</span>
        <ArrowRight className="h-4 w-4 text-ink-faint" />
        <button onClick={() => onSelect({ kind: 'entity', id: edge.target })} className="font-semibold text-ink hover:underline">{b?.name}</button>
      </div>
      <p className="text-[12.5px] text-ink-muted">
        {edge.methods === 'records' ? 'Built from the imported placement records.'
          : edge.methods === 'analysis' ? 'Built from the financial analysis of your documents.'
          : edge.methods === 'text' ? 'Found in the text of the source document.' : 'Derived from your data.'}
      </p>
      {detail.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {detail.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{titleCase(k)}</dt>
              <dd className="num text-[13px] text-ink">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {(edge.evidence?.length ?? 0) > 0 && (
        <Section title="Why this connection exists">
          {edge.evidence!.map((c, i) => <CitationQuote key={i} c={c} api={api} />)}
        </Section>
      )}
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{icon}{title}</h4>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
