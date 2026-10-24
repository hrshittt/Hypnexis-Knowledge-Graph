import { useEffect, useState } from 'react';
import { kbApi } from '../../api/kb';
import type { GraphPayload } from '../../types/kb';
import GraphView from '../../components/kb/GraphView';
import TopicLegend from '../../components/kb/TopicLegend';
import { GraphIllustration } from '../../components/brand/GraphIllustration';

/**
 * The real shared knowledge graph rendered by the app's own graph component. Falls back to a labelled
 * illustration when the shared corpus is empty or the API is unreachable.
 */
export default function LiveGraphPreview() {
  const [graph, setGraph] = useState<GraphPayload | null | 'none'>(null);
  useEffect(() => {
    kbApi.graph().then((g) => setGraph(g.nodes.length ? g : 'none')).catch(() => setGraph('none'));
  }, []);

  if (graph === null) return <div className="h-full w-full animate-pulse bg-canvas" aria-label="Loading the live graph" />;
  if (graph === 'none') {
    return (
      <div className="relative flex h-full w-full items-center justify-center bg-canvas">
        <GraphIllustration className="h-[85%] w-[85%]" />
        <span className="absolute bottom-3 left-3 rounded-md bg-white/90 px-2 py-1 text-[11.5px] text-ink-muted ring-1 ring-line">
          Illustration: the shared demo graph has no documents yet
        </span>
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <GraphView graph={graph} highlight={null} selection={null} focusToken={0} onSelect={() => {}} onClearHighlight={() => {}} autoGuide={false} />
      <TopicLegend topics={graph.topics} activeIds={new Set()} onSelect={() => {}} />
    </div>
  );
}
