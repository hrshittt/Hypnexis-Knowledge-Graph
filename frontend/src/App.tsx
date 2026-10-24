import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Sparkles, Waypoints } from 'lucide-react';
import { kbApi } from './api/kb';
import { useKnowledgeBase } from './hooks/useKnowledgeBase';
import { useKBChat } from './hooks/useKBChat';
import type { Answer, ExampleQuestion, Selection } from './types/kb';
import DocumentPanel from './components/kb/DocumentPanel';
import ChatPanel from './components/kb/ChatPanel';
import GraphView, { type HighlightSets } from './components/kb/GraphView';
import TopicLegend from './components/kb/TopicLegend';
import Inspector from './components/kb/Inspector';

const toSets = (h: Answer['highlight']): HighlightSets => ({
  nodes: new Set(h.nodes), edges: new Set(h.edges), pathEdges: new Set(h.path_edges), communities: new Set(h.communities),
});

export default function App() {
  const kb = useKnowledgeBase();
  const [selection, setSelection] = useState<Selection>(null);
  const [highlight, setHighlight] = useState<HighlightSets | null>(null);
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [examples, setExamples] = useState<ExampleQuestion[]>([]);
  const [docsOpen, setDocsOpen] = useState(true);
  const answers = useRef(new Map<string, Answer>()).current;

  const showAnswer = useCallback((turnId: string, a: Answer) => {
    answers.set(turnId, a);
    setActiveTurn(turnId);
    const h = a.highlight;
    setHighlight(h.nodes.length || h.edges.length || h.communities.length ? toSets(h) : null);
    setSelection(null);
    setFocusToken((t) => t + 1);
  }, [answers]);

  const chat = useKBChat(showAnswer);

  useEffect(() => { kbApi.examples().then(setExamples).catch(() => setExamples([])); }, []);

  // Clicking something outside the current answer's highlight spotlights its neighbourhood instead.
  const select = (s: Selection) => {
    setSelection(s);
    const g = kb.graph;
    if (s?.kind === 'topic') {
      setHighlight({ nodes: new Set(), edges: new Set(), pathEdges: new Set(), communities: new Set([s.id]) });
      setActiveTurn(null);
      setFocusToken((t) => t + 1);
    } else if (s?.kind === 'entity' && g && !highlight?.nodes.has(s.id)) {
      const edges = g.edges.filter((e) => e.source === s.id || e.target === s.id);
      setHighlight({
        nodes: new Set([s.id, ...edges.map((e) => (e.source === s.id ? e.target : e.source))]),
        edges: new Set(edges.map((e) => e.id)), pathEdges: new Set(), communities: new Set(),
      });
      setActiveTurn(null);
    } else if (s?.kind === 'relation' && g && !highlight?.edges.has(s.id)) {
      const e = g.edges.find((x) => x.id === s.id);
      if (e) {
        setHighlight({ nodes: new Set([e.source, e.target]), edges: new Set([e.id]), pathEdges: new Set(), communities: new Set() });
        setActiveTurn(null);
        setFocusToken((t) => t + 1);
      }
    }
  };

  const activate = (turnId: string) => {
    const a = answers.get(turnId);
    if (a) showAnswer(turnId, a);
  };

  const highlightNodes = (ids: string[]) => {
    setHighlight({ nodes: new Set(ids), edges: new Set(), pathEdges: new Set(), communities: new Set() });
    setActiveTurn(null);
    setFocusToken((t) => t + 1);
  };

  const stats = kb.status?.stats;
  const llm = kb.status?.llm;
  const hasDocs = (stats?.documents ?? 0) > 0;

  return (
    <div className="flex h-screen flex-col bg-slate-50 font-sans text-slate-900">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-indigo-600 text-white shadow">
            <Waypoints className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-tight">Knowledge Graph Builder</h1>
            <p className="truncate text-[11px] text-slate-500">Topic-augmented interactive knowledge base</p>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto text-[11px]">
          {stats && (
            <div className="hidden items-center gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600 ring-1 ring-slate-200 md:flex">
              <Stat n={stats.documents} label="docs" /><Stat n={stats.entities} label="entities" />
              <Stat n={stats.relations} label="relations" /><Stat n={stats.topics} label="topics" />
            </div>
          )}
          {llm && (
            <span title={llm.active ? `Gemini (${llm.model}) for extraction, topic summaries and answers`
              : llm.configured ? `Gemini configured but paused: ${llm.last_error ?? ''}`
              : 'No GEMINI_API_KEY: rule-based extraction and extractive, quote-only answers'}
              className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-medium ${
                llm.active ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-700'}`}>
              <Sparkles className="h-3 w-3" /> {llm.active ? 'Gemini mode' : 'Extractive mode'}
            </span>
          )}
        </div>
      </header>

      {kb.error && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5 text-[13px] text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {kb.error}
        </div>
      )}
      {kb.status?.warnings?.map((w) => (
        <div key={w} className="border-b border-amber-200 bg-amber-50 px-4 py-1 text-[12px] text-amber-800">{w}</div>
      ))}

      <main className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(380px,40%)_1fr] lg:grid-rows-1">
        <div className="flex min-h-0 flex-col border-b border-slate-200 lg:border-b-0 lg:border-r">
          <DocumentPanel
            open={docsOpen}
            onToggle={() => setDocsOpen((o) => !o)}
            documents={kb.documents}
            runningJobs={kb.runningJobs}
            lastUpload={kb.lastUpload}
            busy={kb.busy}
            onUpload={kb.upload}
            onLoadSamples={kb.loadSamples}
            onDelete={async (id) => { await kb.remove(id); setSelection(null); setHighlight(null); }}
            onRetry={kb.retry}
            onReset={async () => { await kb.reset(); chat.clear(); setSelection(null); setHighlight(null); }}
            onDismissResults={kb.clearUploadResults}
          />
          <ChatPanel
            turns={chat.turns}
            pending={chat.pending}
            activeTurn={activeTurn}
            examples={examples}
            hasDocuments={hasDocs}
            onAsk={(q) => { if (chat.turns.length === 0) setDocsOpen(false); chat.ask(q); }}
            onStop={chat.stop}
            onClear={() => { chat.clear(); setHighlight(null); setActiveTurn(null); }}
            onSelect={select}
            onActivate={activate}
          />
        </div>

        <div className="relative min-h-0">
          <GraphView
            graph={kb.graph}
            highlight={highlight}
            selection={selection}
            focusToken={focusToken}
            onSelect={select}
            onClearHighlight={() => { setHighlight(null); setActiveTurn(null); }}
            emptyHint={kb.runningJobs.length ? 'Extracting entities and relations…' : 'Upload PDF/TXT files or load the sample documents to build it.'}
          />
          {kb.graph && (
            <TopicLegend topics={kb.graph.topics} activeIds={highlight?.communities ?? new Set()}
              onSelect={(id) => select({ kind: 'topic', id })} />
          )}
          <Inspector selection={selection} graph={kb.graph} onSelect={select} onHighlightNodes={highlightNodes}
            onClose={() => setSelection(null)} />
        </div>
      </main>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return <span><b className="font-semibold text-slate-900">{n}</b> {label}</span>;
}
