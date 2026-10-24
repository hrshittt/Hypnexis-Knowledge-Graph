import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Database, Filter, FileText, MessageSquareText, Sparkles } from 'lucide-react';
import type { KbApi } from '../../api/kb';
import { platformApi } from '../../api/platform';
import { useKnowledgeBase } from '../../hooks/useKnowledgeBase';
import { useKBChat } from '../../hooks/useKBChat';
import { useMediaQuery } from '../../lib/hooks';
import { colorForIndex } from '../../lib/graphColors';
import type { Answer, ExampleQuestion, GraphPayload, GraphStoreInfo, Selection } from '../../types/kb';
import DocumentPanel from './DocumentPanel';
import ChatPanel from './ChatPanel';
import GraphView, { type HighlightSets } from './GraphView';
import TopicLegend from './TopicLegend';
import Inspector from './Inspector';

const toSets = (h: Answer['highlight']): HighlightSets => ({
  nodes: new Set(h.nodes), edges: new Set(h.edges), pathEdges: new Set(h.path_edges), communities: new Set(h.communities),
  documents: new Set(h.documents ?? []),
});

const spotlight = (parts: Partial<HighlightSets>): HighlightSets => ({
  nodes: new Set(), edges: new Set(), pathEdges: new Set(), communities: new Set(), documents: new Set(), ...parts,
});

type LeftTab = 'ask' | 'explore' | 'documents';

interface Props {
  /** memoised client for this knowledge base; remount (key) the component when it changes */
  api: KbApi;
  canWrite: boolean;
  canDelete: boolean;
  readOnlyNote?: string;
  /** workspace id for activity entries; null for the shared demo corpus */
  workspaceId: string | null;
  initialQuestion?: string;
  initialDocScope?: string[];
  /** record topic views in the signed-in user's activity (off for the public demo) */
  recordActivity?: boolean;
  className?: string;
}

/**
 * The interactive knowledge base — documents, grounded Q&A, the topic-augmented graph and the
 * inspector — for the shared demo corpus or any workspace. Selection, highlighting and answer
 * behaviour are the original application's.
 */
export default function KnowledgeWorkspace({
  api, canWrite, canDelete, readOnlyNote, workspaceId, initialQuestion, initialDocScope, recordActivity = true, className = '',
}: Props) {
  const kb = useKnowledgeBase(api);
  const [selection, setSelection] = useState<Selection>(null);
  const [highlight, setHighlight] = useState<HighlightSets | null>(null);
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [examples, setExamples] = useState<ExampleQuestion[]>([]);
  const [tab, setTab] = useState<LeftTab>('ask');
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [topicFilter, setTopicFilter] = useState<Set<string>>(new Set());
  const [docScope, setDocScope] = useState<string[]>(initialDocScope ?? []);
  const answers = useRef(new Map<string, Answer>()).current;
  const viewedTopics = useRef(new Set<string>());
  const wide = useMediaQuery('(min-width: 1280px)');

  const showAnswer = useCallback((turnId: string, a: Answer) => {
    answers.set(turnId, a);
    setActiveTurn(turnId);
    const h = a.highlight;
    setHighlight(h.nodes.length || h.edges.length || h.communities.length || h.documents?.length ? toSets(h) : null);
    setSelection(null);
    setFocusToken((t) => t + 1);
  }, [answers]);

  const chat = useKBChat(showAnswer, api, docScope);

  useEffect(() => { api.examples().then(setExamples).catch(() => setExamples([])); }, [api]);

  // Start on the documents tab when the knowledge base is empty and the user can add to it.
  const firstStatus = useRef(true);
  useEffect(() => {
    if (!kb.status || !firstStatus.current) return;
    firstStatus.current = false;
    if (kb.status.stats.documents === 0 && canWrite && !initialQuestion) setTab('documents');
  }, [kb.status, canWrite, initialQuestion]);

  const asked = useRef(false);
  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      chat.ask(initialQuestion);
    }
  }, [initialQuestion, chat]);

  const recordTopic = (id: string) => {
    const t = kb.graph?.topics.find((x) => x.id === id);
    if (!t || !recordActivity || viewedTopics.current.has(id)) return;
    viewedTopics.current.add(id);
    platformApi.recordView('topic_view', t.label, workspaceId, { topic_id: id, scope: workspaceId ? 'workspace' : 'shared' }).catch(() => {});
  };

  // Clicking something outside the current answer's highlight spotlights its neighbourhood instead.
  const select = (s: Selection) => {
    setSelection(s);
    const g = kb.graph;
    if (s?.kind === 'topic') {
      recordTopic(s.id);
      setHighlight(spotlight({ communities: new Set([s.id]) }));
      setActiveTurn(null);
      setFocusToken((t) => t + 1);
    } else if (s?.kind === 'entity' && g && !highlight?.nodes.has(s.id)) {
      const edges = g.edges.filter((e) => e.source === s.id || e.target === s.id);
      setHighlight(spotlight({
        nodes: new Set([s.id, ...edges.map((e) => (e.source === s.id ? e.target : e.source))]),
        edges: new Set(edges.map((e) => e.id)),
      }));
      setActiveTurn(null);
    } else if (s?.kind === 'relation' && g && !highlight?.edges.has(s.id)) {
      const e = g.edges.find((x) => x.id === s.id);
      if (e) {
        setHighlight(spotlight({ nodes: new Set([e.source, e.target]), edges: new Set([e.id]) }));
        setActiveTurn(null);
        setFocusToken((t) => t + 1);
      }
    } else if (s?.kind === 'document' && g) {
      const ents = (g.doc_links ?? []).filter((l) => l.doc_id === s.id).map((l) => l.entity_id);
      setHighlight(spotlight({ nodes: new Set(ents), documents: new Set([s.id]) }));
      setActiveTurn(null);
      setFocusToken((t) => t + 1);
    }
  };

  const activate = (turnId: string) => {
    const a = answers.get(turnId);
    if (a) showAnswer(turnId, a);
  };

  const highlightNodes = (ids: string[]) => {
    setHighlight(spotlight({ nodes: new Set(ids) }));
    setActiveTurn(null);
    setFocusToken((t) => t + 1);
  };

  const graph = useMemo(() => filterGraph(kb.graph, hiddenTypes, topicFilter), [kb.graph, hiddenTypes, topicFilter]);
  const stats = kb.status?.stats;
  const llm = kb.status?.llm;
  const hasDocs = (stats?.documents ?? 0) > 0;
  const filtersOn = hiddenTypes.size + topicFilter.size > 0;

  const inspector = selection && (
    <Inspector selection={selection} graph={kb.graph} onSelect={select} onHighlightNodes={highlightNodes}
      onClose={() => setSelection(null)} api={api} variant={wide ? 'panel' : 'overlay'} />
  );

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-card lg:flex-row ${className}`}>
      <aside className="flex h-[62vh] min-h-0 shrink-0 flex-col border-b border-line lg:h-auto lg:w-[420px] lg:border-b-0 lg:border-r 2xl:w-[460px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-[11.5px] text-ink-muted">
          {stats ? (
            <span className="num">
              <b className="font-semibold text-ink">{stats.documents}</b> docs · <b className="font-semibold text-ink">{stats.entities}</b> entities ·{' '}
              <b className="font-semibold text-ink">{stats.relations}</b> relations · <b className="font-semibold text-ink">{stats.topics}</b> topics
            </span>
          ) : <span>Connecting…</span>}
          {llm && (
            <span title={llm.active ? `Gemini (${llm.model}) for extraction, topic summaries and answers`
              : llm.configured ? `Gemini configured but paused: ${llm.last_error ?? ''}`
              : 'No GEMINI_API_KEY: rule-based extraction and extractive, quote-only answers'}
              className={`ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                llm.active ? 'bg-violet-50 text-violet-700' : 'bg-warn-soft text-warn-ink'}`}>
              <Sparkles className="h-3 w-3" /> {llm.active ? 'Gemini mode' : 'Extractive mode'}
            </span>
          )}
          {kb.status?.graph_store && <GraphStoreBadge info={kb.status.graph_store} />}
        </div>
        {kb.error && (
          <div className="flex items-start gap-2 border-b border-danger/20 bg-danger-soft px-4 py-2 text-[12.5px] text-danger-ink" role="alert">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words">{kb.error}</span>
          </div>
        )}
        {kb.status?.warnings?.map((w) => (
          <div key={w} className="border-b border-warn/30 bg-warn-soft px-4 py-1 text-[12px] text-warn-ink">{w}</div>
        ))}
        <div className="flex border-b border-line px-2" role="tablist" aria-label="Knowledge base panels">
          {([['ask', 'Ask', MessageSquareText], ['explore', filtersOn ? 'Explore •' : 'Explore', Filter], ['documents', 'Documents', FileText]] as const).map(([k, label, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
                tab === k ? 'border-brand-600 text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {tab === 'ask' && (
            <>
              {docScope.length > 0 && (
                <div className="flex items-center justify-between gap-2 border-b border-line bg-brand-50 px-4 py-1.5 text-[12px] text-brand-800">
                  <span>Answers limited to {docScope.length} selected document{docScope.length === 1 ? '' : 's'}</span>
                  <button className="font-medium underline-offset-2 hover:underline" onClick={() => setDocScope([])}>Use all documents</button>
                </div>
              )}
              <ChatPanel
                turns={chat.turns}
                pending={chat.pending}
                activeTurn={activeTurn}
                examples={examples}
                hasDocuments={hasDocs}
                onAsk={(q) => chat.ask(q)}
                onStop={chat.stop}
                onClear={() => { chat.clear(); setHighlight(null); setActiveTurn(null); }}
                onSelect={select}
                onActivate={activate}
              />
            </>
          )}
          {tab === 'explore' && (
            <ExplorePanel graph={kb.graph} hiddenTypes={hiddenTypes} setHiddenTypes={setHiddenTypes}
              topicFilter={topicFilter} setTopicFilter={setTopicFilter}
              documents={kb.documents.filter((d) => d.status === 'ready')} docScope={docScope} setDocScope={setDocScope}
              onTopic={(id) => select({ kind: 'topic', id })} />
          )}
          {tab === 'documents' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DocumentPanel
                open
                collapsible={false}
                onToggle={() => {}}
                documents={kb.documents}
                runningJobs={kb.runningJobs}
                lastUpload={kb.lastUpload}
                busy={kb.busy}
                canUpload={canWrite}
                canDelete={canDelete}
                readOnlyNote={readOnlyNote}
                uploadLimits={kb.status?.upload}
                onUpload={kb.upload}
                onLoadSamples={kb.loadSamples}
                onDelete={async (id) => { await kb.remove(id); setSelection(null); setHighlight(null); }}
                onRetry={kb.retry}
                onReset={async () => { await kb.reset(); chat.clear(); setSelection(null); setHighlight(null); }}
                onDismissResults={kb.clearUploadResults}
              />
            </div>
          )}
        </div>
      </aside>

      <div className="relative flex min-h-[460px] min-w-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <GraphView
            graph={graph}
            highlight={highlight}
            selection={selection}
            focusToken={focusToken}
            onSelect={select}
            onClearHighlight={() => { setHighlight(null); setActiveTurn(null); }}
            emptyHint={filtersOn && kb.graph?.nodes.length
              ? 'Every node is hidden by the current filters. Open Explore to change them.'
              : kb.runningJobs.length ? 'Extracting entities and relations…'
              : canWrite ? 'Upload PDF/TXT files or load the sample documents to build it.'
              : 'No documents have been added to this knowledge base yet.'}
          />
          {graph && (
            <TopicLegend topics={graph.topics} activeIds={highlight?.communities ?? new Set()}
              onSelect={(id) => select({ kind: 'topic', id })} />
          )}
          {!wide && inspector}
        </div>
        {wide && selection && <div className="w-[360px] shrink-0 border-l border-line">{inspector}</div>}
      </div>
    </div>
  );
}

/** Which store holds the knowledge graph — never implies Neo4j when the local fallback is in use. */
function GraphStoreBadge({ info }: { info: GraphStoreInfo }) {
  const neo4j = info.backend === 'neo4j';
  const label = neo4j ? (info.connected ? 'Graph: Neo4j' : 'Graph: Neo4j (disconnected)') : 'Graph: SQLite (local)';
  const title = neo4j
    ? `Neo4j at ${info.uri} · database ${info.database} · namespace ${info.namespace} · graph queries run as Cypher`
      + (info.error ? `\n${info.error}` : '')
    : `Local SQLite graph + NetworkX traversal (fallback). ${info.fallback_reason ?? ''}`;
  const tone = neo4j && info.connected ? 'bg-emerald-50 text-emerald-700'
    : neo4j ? 'bg-danger-soft text-danger-ink' : 'bg-warn-soft text-warn-ink';
  return (
    <span title={title} className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${tone}`}>
      <Database className="h-3 w-3" /> {label}
    </span>
  );
}

function filterGraph(g: GraphPayload | null, hiddenTypes: Set<string>, topics: Set<string>): GraphPayload | null {
  if (!g || (!hiddenTypes.size && !topics.size)) return g;
  const nodes = g.nodes.filter((n) => !hiddenTypes.has(n.type) && (!topics.size || (!!n.community && topics.has(n.community))));
  const ids = new Set(nodes.map((n) => n.id));
  return {
    ...g,
    nodes,
    edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    topics: topics.size ? g.topics.filter((t) => topics.has(t.id)) : g.topics,
  };
}

interface ExploreProps {
  graph: GraphPayload | null;
  hiddenTypes: Set<string>;
  setHiddenTypes: (s: Set<string>) => void;
  topicFilter: Set<string>;
  setTopicFilter: (s: Set<string>) => void;
  documents: { doc_id: string; filename: string; title: string | null }[];
  docScope: string[];
  setDocScope: (ids: string[]) => void;
  onTopic: (id: string) => void;
}

function ExplorePanel({ graph, hiddenTypes, setHiddenTypes, topicFilter, setTopicFilter, documents, docScope, setDocScope, onTopic }: ExploreProps) {
  const types = useMemo(() => {
    const m = new Map<string, number>();
    graph?.nodes.forEach((n) => m.set(n.type, (m.get(n.type) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);
  const toggle = (set: Set<string>, v: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    apply(next);
  };
  if (!graph || !graph.nodes.length) {
    return <p className="px-4 py-6 text-[13px] text-ink-muted">Filters appear once the knowledge graph has entities.</p>;
  }
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Node types</h3>
          {hiddenTypes.size > 0 && <button className="text-[12px] font-medium text-brand-700 hover:underline" onClick={() => setHiddenTypes(new Set())}>Show all</button>}
        </div>
        <ul className="space-y-0.5">
          {types.map(([t, n]) => (
            <li key={t}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-[13px] hover:bg-canvas">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!hiddenTypes.has(t)}
                  onChange={() => toggle(hiddenTypes, t, setHiddenTypes)} />
                <span className="flex-1 text-ink">{t}</span>
                <span className="num text-[12px] text-ink-muted">{n}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      {graph.topics.length > 0 && (
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Topics</h3>
            {topicFilter.size > 0 && <button className="text-[12px] font-medium text-brand-700 hover:underline" onClick={() => setTopicFilter(new Set())}>All topics</button>}
          </div>
          <p className="mb-1.5 text-[12px] text-ink-muted">Tick topics to show only their entities. Click a name to inspect it.</p>
          <ul className="space-y-0.5">
            {graph.topics.map((t) => (
              <li key={t.id} className="flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-canvas">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={topicFilter.has(t.id)} aria-label={`Show only ${t.label}`}
                  onChange={() => toggle(topicFilter, t.id, setTopicFilter)} />
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorForIndex(t.color_index) }} />
                <button className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline" onClick={() => onTopic(t.id)}>{t.label}</button>
                <span className="num text-[12px] text-ink-muted">{t.size}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {documents.length > 0 && (
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Limit answers to</h3>
            {docScope.length > 0 && <button className="text-[12px] font-medium text-brand-700 hover:underline" onClick={() => setDocScope([])}>All documents</button>}
          </div>
          <ul className="space-y-0.5">
            {documents.map((d) => (
              <li key={d.doc_id}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1 text-[13px] hover:bg-canvas">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={docScope.includes(d.doc_id)}
                    onChange={() => setDocScope(docScope.includes(d.doc_id) ? docScope.filter((x) => x !== d.doc_id) : [...docScope, d.doc_id])} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{d.title || d.filename}</span>
                    {d.title && <span className="block truncate text-[11.5px] text-ink-muted">{d.filename}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-lg bg-canvas px-3 py-2.5 text-[12px] leading-relaxed text-ink-muted">
        Click a node for its relationships and source passages, an edge for the sentences that support it.
        Use “Fit to view” in the graph toolbar to reset the view.
      </section>
    </div>
  );
}
