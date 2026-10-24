import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { CircleHelp, Eraser, FileText, Maximize2, PlayCircle, Search, Tag, Waypoints, X } from 'lucide-react';
import { usePreference } from '../../lib/hooks';
import { openGraphExplainer } from '../explain/ExplainerHost';
import type { GraphEdge, GraphNode, GraphPayload, Selection } from '../../types/kb';
import {
  DOC_COLOR, DOC_HL, HL_EDGE, NO_COMMUNITY, PATH_COLOR, PATH_PARTICLE, colorForIndex, convexHull, rgba,
} from '../../lib/graphColors';

export interface HighlightSets {
  nodes: Set<string>;
  edges: Set<string>;
  pathEdges: Set<string>;
  communities: Set<string>;
  /** source documents (doc_ids) behind the current answer; absent for analysis graphs */
  documents?: Set<string>;
}

type N = NodeObject<GraphNode>;
type L = LinkObject<GraphNode, GraphEdge>;

const docNodeId = (docId: string) => `doc:${docId}`;
const docIdOf = (nodeId: string) => nodeId.slice(4);

interface Props {
  graph: GraphPayload | null;
  highlight: HighlightSets | null;
  selection: Selection;
  focusToken: number;
  onSelect: (s: Selection) => void;
  onClearHighlight: () => void;
  emptyHint?: React.ReactNode;
  /** zoom level above which every edge label is drawn (hovered/highlighted edges always are) */
  edgeLabelMinScale?: number;
  /** open the plain-language guide automatically for first-time viewers (off for small previews) */
  autoGuide?: boolean;
}

const nodeRadius = (n: GraphNode) => Math.min(13, 3.5 + Math.sqrt(n.degree + 0.5 * n.mentions) * 1.6);
const endId = (e: unknown) => (typeof e === 'object' && e !== null ? (e as N).id as string : (e as string));

export default function GraphView({ graph, highlight, selection, focusToken, onSelect, onClearHighlight, emptyHint, edgeLabelMinScale = 2.4, autoGuide = true }: Props) {
  const fgRef = useRef<ForceGraphMethods<N, L>>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 500 });
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showDocs, setShowDocs] = useState(true);
  const [query, setQuery] = useState('');
  // The plain-language guide opens by itself the first time someone sees a graph.
  const [guideSeen, setGuideSeen] = usePreference('graph-guide-seen', false);
  const [guide, setGuide] = useState(autoGuide && !guideSeen);
  const closeGuide = () => { setGuide(false); setGuideSeen(true); };
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const fitted = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(200, Math.floor(width)), h: Math.max(200, Math.floor(height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const topicIndex = useMemo(() => {
    const m = new Map<string, { color: string; label: string }>();
    graph?.topics.forEach((t) => m.set(t.id, { color: colorForIndex(t.color_index), label: t.label }));
    return m;
  }, [graph]);

  // Rebuild graph data only when the payload changes; keep previous positions so the layout doesn't jump.
  const data = useMemo(() => {
    if (!graph) return { nodes: [] as N[], links: [] as L[] };
    const nodes: N[] = graph.nodes.map((n) => {
      const p = positions.current.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : { ...n };
    });
    const pairCount = new Map<string, number>();
    const pairKey = (e: GraphEdge) => [e.source, e.target].sort().join('|');
    graph.edges.forEach((e) => pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1));
    const seen = new Map<string, number>();
    const links: L[] = graph.edges.map((e) => {
      const k = pairKey(e);
      const n = pairCount.get(k) ?? 1;
      const i = seen.get(k) ?? 0;
      seen.set(k, i + 1);
      // spread parallel edges; flip sign for reversed direction so curves don't overlap
      const sign = e.source < e.target ? 1 : -1;
      return { ...e, curvature: n > 1 ? sign * (i - (n - 1) / 2) * 0.6 : 0 };
    });
    if (showDocs) {
      // source documents as nodes, linked to the entities they mention (provenance)
      const shown = new Set(graph.nodes.map((n) => n.id));
      const docLinks = (graph.doc_links ?? []).filter((l) => shown.has(l.entity_id));
      for (const d of graph.documents) {
        const id = docNodeId(d.doc_id);
        const p = positions.current.get(id);
        const n = docLinks.filter((l) => l.doc_id === d.doc_id).length;
        if (!n) continue; // only documents that mention a shown entity (analysis graphs have no links)
        nodes.push({ id, name: d.title || d.filename, type: 'Document', community: null, degree: n, mentions: 0,
          doc_count: 0, kind: 'document', ...(p ?? {}) });
      }
      for (const l of docLinks) {
        links.push({ id: `dl:${l.doc_id}:${l.entity_id}`, source: docNodeId(l.doc_id), target: l.entity_id,
          predicate: 'mentions', evidence_count: l.mentions, doc_count: 1, cross_topic: false, kind: 'doc', curvature: 0 });
      }
    }
    return { nodes, links };
  }, [graph, showDocs]);

  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id as string, n])), [data]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    // d3's default link strength, computed over entity relations only; document links barely pull,
    // so documents settle near what they mention without reshaping the topic clusters
    const deg = new Map<string, number>();
    for (const l of data.links) {
      if (l.kind === 'doc') continue;
      for (const end of [endId(l.source), endId(l.target)]) deg.set(end, (deg.get(end) ?? 0) + 1);
    }
    fg.d3Force('charge')?.strength?.(-150);
    fg.d3Force('link')?.distance?.((l: L) => (l.kind === 'doc' ? 110 : 60));
    fg.d3Force('link')?.strength?.((l: L) => (l.kind === 'doc' ? 0.02
      : 1 / Math.max(1, Math.min(deg.get(endId(l.source)) ?? 1, deg.get(endId(l.target)) ?? 1))));
  }, [data]);

  const fitHighlight = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const inFocus = (n: N) => !!highlight && (highlight.nodes.has(n.id as string)
      || (n.kind === 'document' && !!highlight.documents?.has(docIdOf(n.id as string))));
    if (highlight && highlight.nodes.size > 0 && highlight.nodes.size <= 2 && !highlight.documents?.size) {
      const pts = Array.from(highlight.nodes).map((id) => nodeById.get(id)).filter((n): n is N => n?.x !== undefined);
      if (pts.length) {
        fg.centerAt(pts.reduce((s, n) => s + (n.x ?? 0), 0) / pts.length, pts.reduce((s, n) => s + (n.y ?? 0), 0) / pts.length, 600);
        fg.zoom(2.2, 600);
      }
    } else if (highlight && (highlight.nodes.size > 0 || !!highlight.documents?.size)) {
      fg.zoomToFit(700, 80, inFocus);
    } else if (highlight && highlight.communities.size > 0) {
      fg.zoomToFit(700, 60, (n) => !!n.community && highlight.communities.has(n.community));
    } else {
      fg.zoomToFit(600, 50);
    }
  }, [highlight, nodeById]);

  useEffect(() => {
    if (focusToken === 0) return;
    const t = setTimeout(fitHighlight, 350);
    return () => clearTimeout(t);
  }, [focusToken, fitHighlight]);

  useEffect(() => {
    if (selection?.kind !== 'entity') return;
    const n = nodeById.get(selection.id);
    const fg = fgRef.current;
    if (!fg || n?.x === undefined || n.y === undefined) return;
    fg.centerAt(n.x, n.y, 500);
    const k = fg.zoom();
    if (k < 1.2 || k > 4) fg.zoom(2, 500);
  }, [selection, nodeById]);

  const selectedNode = selection?.kind === 'entity' ? selection.id : null;
  const selectedEdge = selection?.kind === 'relation' ? selection.id : null;
  const selectedDoc = selection?.kind === 'document' ? selection.id : null;

  const drawDocument = useCallback((node: N, ctx: CanvasRenderingContext2D, scale: number) => {
    const id = node.id as string;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const docId = docIdOf(id);
    const hl = highlight?.documents?.has(docId) ?? false;
    const selected = selectedDoc === docId;
    const w = 7;
    const h = 9;
    ctx.save();
    ctx.globalAlpha = !highlight ? 0.9 : hl ? 1 : 0.15;
    ctx.beginPath();
    ctx.rect(x - w, y - h, w * 2, h * 2);
    ctx.fillStyle = hl ? DOC_HL : '#ffffff';
    ctx.fill();
    ctx.lineWidth = (hl || selected ? 2.4 : 1.3) / scale;
    ctx.strokeStyle = hl || selected ? PATH_COLOR : DOC_COLOR;
    ctx.stroke();
    ctx.beginPath(); // text lines, so it reads as a page
    for (const dy of [-4, -1, 2, 5]) {
      ctx.moveTo(x - w + 3, y + dy);
      ctx.lineTo(x + w - 3, y + dy);
    }
    ctx.lineWidth = 0.9 / scale;
    ctx.strokeStyle = hl ? PATH_COLOR : DOC_COLOR;
    ctx.stroke();
    if (hl || selected || hoverNode === id || (showLabels && !highlight && scale > 1.1)) {
      const label = node.name.length > 32 ? `${node.name.slice(0, 31)}…` : node.name;
      const fs = (hl || selected ? 12 : 10.5) / scale;
      ctx.font = `${hl || selected ? 600 : 500} ${fs}px Inter, ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3.5 / scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(label, x, y + h + 2 / scale);
      ctx.fillStyle = '#475569';
      ctx.fillText(label, x, y + h + 2 / scale);
    }
    ctx.restore();
  }, [highlight, hoverNode, selectedDoc, showLabels]);

  const drawNode = useCallback((node: N, ctx: CanvasRenderingContext2D, scale: number) => {
    if (node.x === undefined || node.y === undefined) return;
    positions.current.set(node.id as string, { x: node.x, y: node.y });
    if (node.kind === 'document') {
      drawDocument(node, ctx, scale);
      return;
    }
    const id = node.id as string;
    const r = nodeRadius(node);
    const color = node.community ? topicIndex.get(node.community)?.color ?? NO_COMMUNITY : NO_COMMUNITY;
    const isHl = highlight?.nodes.has(id) ?? false;
    const inComm = !!node.community && (highlight?.communities.has(node.community) ?? false);
    const alpha = !highlight ? 1 : isHl ? 1 : inComm ? 0.35 : 0.1;
    const selected = id === selectedNode;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    if (node.type === 'Concept') {
      ctx.moveTo(node.x, node.y - r * 1.15);
      ctx.lineTo(node.x + r * 1.15, node.y);
      ctx.lineTo(node.x, node.y + r * 1.15);
      ctx.lineTo(node.x - r * 1.15, node.y);
      ctx.closePath();
    } else {
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.2 / scale;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    if (isHl && highlight) {
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = PATH_PARTICLE;
      ctx.stroke();
    }
    if (selected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 3.5 / scale, 0, 2 * Math.PI);
      ctx.lineWidth = 2.5 / scale;
      ctx.strokeStyle = PATH_COLOR;
      ctx.stroke();
    }
    const showLabel = selected || isHl || hoverNode === id ||
      (showLabels && (!highlight || inComm) && (scale > 1.35 || (node.degree >= 4 && scale > 0.75)));
    if (showLabel) {
      const fs = (isHl || selected ? 12.5 : 11) / scale;
      ctx.font = `${isHl || selected ? 600 : 500} ${fs}px Inter, ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3.5 / scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(node.name, node.x, node.y + r + 2 / scale);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(node.name, node.x, node.y + r + 2 / scale);
    }
    ctx.restore();
  }, [drawDocument, highlight, hoverNode, selectedNode, showLabels, topicIndex]);

  const paintPointer = useCallback((node: N, color: string, ctx: CanvasRenderingContext2D) => {
    if (node.x === undefined || node.y === undefined) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, nodeRadius(node) + 2.5, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const edgeState = useCallback((l: L) => {
    const id = l.id as string;
    if (l.kind === 'doc') {
      // a document → entity link is shown when it is evidence for the current answer, or on focus
      const src = endId(l.source);
      const doc = docIdOf(src);
      const cited = (highlight?.documents?.has(doc) ?? false) && (highlight?.nodes.has(endId(l.target)) ?? false);
      return { path: false, hl: cited, hover: id === hoverLink || hoverNode === src || selectedDoc === doc };
    }
    return {
      path: highlight?.pathEdges.has(id) ?? false,
      hl: (highlight?.edges.has(id) ?? false) || id === selectedEdge,
      hover: id === hoverLink,
    };
  }, [highlight, selectedEdge, selectedDoc, hoverLink, hoverNode]);

  const linkColor = useCallback((l: L) => {
    const s = edgeState(l);
    if (l.kind === 'doc') return s.hl ? 'rgba(217,119,6,0.85)' : 'rgba(100,116,139,0.55)';
    if (s.path) return PATH_COLOR;
    if (s.hl || s.hover) return HL_EDGE;
    return highlight ? 'rgba(148,163,184,0.14)' : 'rgba(100,116,139,0.42)';
  }, [edgeState, highlight]);

  const linkWidth = useCallback((l: L) => {
    const s = edgeState(l);
    if (l.kind === 'doc') return s.hl ? 1.6 : 1;
    if (s.path) return 3.4;
    if (s.hl || s.hover) return 2.2;
    return 0.6 + 0.35 * Math.min(l.evidence_count ?? 1, 4);
  }, [edgeState]);

  const drawLinkLabel = useCallback((l: L, ctx: CanvasRenderingContext2D, scale: number) => {
    if (l.kind === 'doc') return;
    const s = edgeState(l);
    if (!(s.path || s.hl || s.hover || (showLabels && !highlight && scale > edgeLabelMinScale))) return;
    const a = l.source as N;
    const b = l.target as N;
    if (typeof a !== 'object' || typeof b !== 'object' || a.x === undefined || b.x === undefined) return;
    // quadratic Bézier midpoint for curved (parallel) edges, straight midpoint otherwise
    const cp = (l as { __controlPoints?: number[] }).__controlPoints;
    const x = cp ? 0.25 * a.x + 0.5 * cp[0] + 0.25 * b.x : (a.x + b.x) / 2;
    const y = cp ? 0.25 * (a.y ?? 0) + 0.5 * cp[1] + 0.25 * (b.y ?? 0) : ((a.y ?? 0) + (b.y ?? 0)) / 2;
    const fs = 10 / scale;
    ctx.save();
    ctx.font = `${s.path ? 600 : 500} ${fs}px Inter, ui-sans-serif, system-ui, sans-serif`;
    const w = ctx.measureText(l.predicate).width;
    ctx.fillStyle = s.path ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.92)';
    const pad = 2.5 / scale;
    ctx.fillRect(x - w / 2 - pad, y - fs / 2 - pad, w + 2 * pad, fs + 2 * pad);
    ctx.fillStyle = s.path ? '#ffffff' : '#334155';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.predicate, x, y);
    ctx.restore();
  }, [edgeState, showLabels, highlight, edgeLabelMinScale]);

  const drawHulls = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const groups = new Map<string, { x: number; y: number }[]>();
    for (const n of data.nodes) {
      if (!n.community || n.x === undefined || n.y === undefined) continue;
      const g = groups.get(n.community) ?? [];
      g.push({ x: n.x, y: n.y });
      groups.set(n.community, g);
    }
    groups.forEach((pts, cid) => {
      const t = topicIndex.get(cid);
      if (!t) return;
      const active = highlight?.communities.has(cid) ?? false;
      const alpha = !highlight ? 0.08 : active ? 0.15 : 0.03;
      const pad = 18;
      ctx.save();
      ctx.fillStyle = rgba(t.color, alpha);
      ctx.strokeStyle = rgba(t.color, alpha);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = pad * 2;
      const hull = convexHull(pts);
      ctx.beginPath();
      hull.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      if (hull.length === 1) ctx.lineTo(hull[0].x + 0.01, hull[0].y);
      ctx.closePath();
      ctx.stroke();
      if (hull.length >= 3) ctx.fill();
      if (scale < 3.5) {
        const minY = Math.min(...pts.map((p) => p.y));
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        ctx.font = `700 ${12.5 / scale}px Inter, ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = rgba(t.color, !highlight || active ? 0.95 : 0.3);
        ctx.fillText(t.label, cx, minY - pad - 2 / scale);
      }
      ctx.restore();
    });
  }, [data, highlight, topicIndex]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return data.nodes.filter((n) => n.kind !== 'document' && n.name.toLowerCase().includes(q)).slice(0, 7);
  }, [query, data]);

  const empty = !graph || graph.nodes.length === 0;

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_1px_1px,#e2e8f0_1px,transparent_0)] [background-size:22px_22px]">
      {!empty && (
        <ForceGraph2D<GraphNode, GraphEdge>
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          nodeId="id"
          nodeLabel={(n) => (n.kind === 'document'
            ? `${n.name} — a source document that mentions ${n.degree} of the things shown. Click for details.`
            : `${n.name} — ${n.type.toLowerCase()}, connected to ${n.degree} other thing${n.degree === 1 ? '' : 's'}. Click for details.`)}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintPointer}
          linkVisibility={(l) => l.kind !== 'doc' || edgeState(l).hl || edgeState(l).hover}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkCurvature="curvature"
          linkLineDash={(l) => (l.kind === 'doc' ? [2, 3] : l.cross_topic && !edgeState(l).path ? [4, 3] : null)}
          linkDirectionalArrowLength={(l) => (l.kind === 'doc' ? 0 : 4)}
          linkDirectionalArrowRelPos={0.92}
          linkDirectionalParticles={(l) => (edgeState(l).path ? 3 : 0)}
          linkDirectionalParticleWidth={3.5}
          linkDirectionalParticleColor={() => PATH_PARTICLE}
          linkDirectionalParticleSpeed={0.006}
          linkCanvasObjectMode={() => 'after'}
          linkCanvasObject={drawLinkLabel}
          linkLabel={(l) => {
            const a = nodeById.get(endId(l.source));
            const b = nodeById.get(endId(l.target));
            if (l.kind === 'doc') return `${a?.name ?? ''} mentions ${b?.name ?? ''} ${l.evidence_count === 1 ? 'once' : `${l.evidence_count} times`}.`;
            return `${a?.name ?? ''} → ${l.predicate} → ${b?.name ?? ''} · found in ${l.evidence_count} sentence${l.evidence_count === 1 ? '' : 's'}. Click to read them.`;
          }}
          linkHoverPrecision={6}
          onRenderFramePre={drawHulls}
          onNodeClick={(n) => onSelect(n.kind === 'document' ? { kind: 'document', id: docIdOf(n.id as string) }
            : { kind: 'entity', id: n.id as string })}
          onLinkClick={(l) => onSelect(l.kind === 'doc' ? { kind: 'document', id: docIdOf(endId(l.source)) }
            : { kind: 'relation', id: l.id as string })}
          onNodeHover={(n) => setHoverNode(n ? (n.id as string) : null)}
          onLinkHover={(l) => setHoverLink(l ? (l.id as string) : null)}
          onBackgroundClick={() => onSelect(null)}
          cooldownTicks={160}
          d3VelocityDecay={0.32}
          onEngineStop={() => {
            if (!fitted.current) {
              fitted.current = true;
              fgRef.current?.zoomToFit(500, 50);
            }
          }}
          minZoom={0.2}
          maxZoom={8}
        />
      )}

      {empty && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <Waypoints className="mx-auto mb-3 h-8 w-8 text-ink-faint" strokeWidth={1.4} />
            <h3 className="text-base font-semibold text-ink">No knowledge graph yet</h3>
            <div className="mt-1 text-sm text-ink-muted">{emptyHint}</div>
          </div>
        </div>
      )}

      {!empty && (
        <>
          <div className="absolute left-3 top-3 z-10 w-64">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-sm">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches[0]) {
                    onSelect({ kind: 'entity', id: matches[0].id as string });
                    setQuery('');
                  }
                }}
                placeholder="Find an entity…"
                className="w-full bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
                aria-label="Find an entity in the graph"
              />
            </div>
            {matches.length > 0 && (
              <div className="mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md">
                {matches.map((n) => (
                  <button
                    key={n.id as string}
                    onClick={() => { onSelect({ kind: 'entity', id: n.id as string }); setQuery(''); }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="truncate text-slate-800">{n.name}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-slate-400">{n.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
            <span className="hidden rounded-md bg-white/90 px-2 py-1 text-[11px] text-slate-500 ring-1 ring-slate-200 sm:inline">
              {graph!.nodes.length} nodes · {graph!.edges.length} edges · {graph!.topics.length} topics
              {' · '}{graph!.documents.length} docs
              {graph!.truncated ? ' (top-ranked shown)' : ''}
            </span>
            <IconButton title="How to read this graph" active={guide && !selection} onClick={() => (guide ? closeGuide() : setGuide(true))}>
              <CircleHelp className="h-4 w-4" />
            </IconButton>
            <IconButton title="Toggle labels" active={showLabels} onClick={() => setShowLabels((v) => !v)}>
              <Tag className="h-4 w-4" />
            </IconButton>
            {(graph!.doc_links?.length ?? 0) > 0 && (
              <IconButton title="Show source documents" active={showDocs} onClick={() => setShowDocs((v) => !v)}>
                <FileText className="h-4 w-4" />
              </IconButton>
            )}
            <IconButton title="Fit to view" onClick={fitHighlight}>
              <Maximize2 className="h-4 w-4" />
            </IconButton>
            {highlight && (
              <IconButton title="Clear answer highlight" onClick={onClearHighlight}>
                <Eraser className="h-4 w-4" />
              </IconButton>
            )}
          </div>
          {guide && !selection && <GraphGuide onClose={closeGuide} />}
        </>
      )}
    </div>
  );
}

/** "How to read this graph" in plain words, for people who have never seen one. */
function GraphGuide({ onClose }: { onClose: () => void }) {
  const rows: [React.ReactNode, string, string][] = [
    [<span key="d" className="block h-3.5 w-3.5 rounded-full bg-brand-600 ring-2 ring-white" />, 'A dot is a thing', 'A person, company, place, law or number Paheli found. Bigger dots are mentioned more.'],
    [<span key="c" className="block h-3 w-3 rotate-45 bg-[#2a78d6]" />, 'A diamond is an idea', 'A concept or theme rather than a named thing.'],
    [<svg key="l" viewBox="0 0 28 10" className="h-3 w-7"><line x1="1" y1="5" x2="20" y2="5" stroke="#64748b" strokeWidth="2" /><polygon points="27,5 19,1 19,9" fill="#64748b" /></svg>,
      'A line is a fact', 'Read it in the arrow’s direction, e.g. “Meridian Grid → closed → Harbor Coal Plant”. Click it to see the sentence.'],
    [<span key="t" className="block h-3.5 w-6 rounded-full bg-brand-600/20" />, 'A coloured area is a topic', 'Things that are discussed together. Click a topic name to focus on it.'],
    [<svg key="p" viewBox="0 0 14 18" className="h-4 w-3"><rect x="1" y="1" width="12" height="16" fill="#fff" stroke="#64748b" strokeWidth="1.3" /><path d="M4 6h6M4 9h6M4 12h6" stroke="#64748b" strokeWidth="0.9" /></svg>,
      'A page is a source document', 'The file the facts came from. Its dotted lines point to the things it mentions.'],
    [<svg key="x" viewBox="0 0 28 10" className="h-3 w-7"><line x1="1" y1="5" x2="27" y2="5" stroke="#64748b" strokeWidth="2" strokeDasharray="4 3" /></svg>,
      'A dashed line links two topics', 'A fact that bridges different subjects.'],
    [<svg key="p" viewBox="0 0 28 10" className="h-3 w-7"><line x1="1" y1="5" x2="27" y2="5" stroke="#0f172a" strokeWidth="3" /><circle cx="18" cy="5" r="3" fill="#f59e0b" /></svg>,
      'A moving path is an answer', 'After you ask a question, the chain of facts behind the answer lights up.'],
  ];
  return (
    <div className="absolute right-3 top-14 z-20 w-[340px] max-w-[calc(100%-1.5rem)] animate-scale-in rounded-xl border border-line bg-white/95 p-4 shadow-pop backdrop-blur" role="dialog" aria-label="How to read this graph">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">How to read this graph</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">It’s a map of what your documents say is connected to what.</p>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-ink-muted hover:bg-canvas hover:text-ink" aria-label="Close the guide"><X className="h-4 w-4" /></button>
      </div>
      <ul className="mt-3 space-y-2.5">
        {rows.map(([icon, title, body]) => (
          <li key={title} className="flex gap-3">
            <span className="mt-1 flex w-7 shrink-0 justify-center">{icon}</span>
            <span className="min-w-0 text-[12.5px] leading-snug text-ink-muted"><b className="font-semibold text-ink">{title}.</b> {body}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink-muted">Scroll to zoom, drag to move, click anything for details.</p>
      <button onClick={() => { onClose(); openGraphExplainer(); }} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline">
        <PlayCircle className="h-4 w-4" /> Watch the step-by-step explainer
      </button>
    </div>
  );
}

function IconButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md border shadow-sm transition-colors ${
        active ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}
