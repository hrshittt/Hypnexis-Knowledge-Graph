import { Suspense, lazy, useEffect, useState } from 'react';
import { Modal } from '../ui/Overlay';

const GraphExplainer = lazy(() => import('./GraphExplainer'));
const EVENT = 'paheli:explain-graph';

/** Opens the "What is a knowledge graph?" walkthrough from anywhere (graph toolbars, intro notes, help). */
export const openGraphExplainer = () => window.dispatchEvent(new Event(EVENT));

/** Owns the walkthrough dialog; mounted once per layout. */
export default function ExplainerHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <Modal open={open} onClose={() => setOpen(false)} size="lg" title="What is a knowledge graph?"
      description="A short walkthrough using four real sentences from the sample documents.">
      {open && (
        <Suspense fallback={<div className="skeleton-shimmer h-[420px] rounded-xl" />}>
          <GraphExplainer variant="stacked" />
        </Suspense>
      )}
    </Modal>
  );
}
