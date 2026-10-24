import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileUp, Sparkles, X } from 'lucide-react';
import { workspaceKbApi } from '../../api/kb';
import { placementApi } from '../../api/platform';
import { errorMessage } from '../../lib/http';
import { useToast } from '../../lib/toast';
import { TYPE_INFO, roleAtLeast } from '../../lib/workspaceTypes';
import type { Workspace } from '../../types/platform';
import { Button } from '../ui/Button';

/**
 * First-run onboarding shown after registration or when a workspace is created (?welcome=1).
 * `onLoaded` / `onUpload` should switch tabs (which drops the flag from the URL); the panel hides itself at once.
 */
export function WelcomePanel({ ws, onLoaded, onUpload }: { ws: Workspace; onLoaded: () => void; onUpload: () => void }) {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (!params.get('welcome') || hidden) return null;
  const info = TYPE_INFO[ws.type];
  const canWrite = roleAtLeast(ws.role, 'analyst');
  const dismiss = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('welcome'); return n; });

  const load = async () => {
    setBusy(true);
    try {
      if (ws.type === 'placement') await placementApi.loadSamples(ws.id);
      else await workspaceKbApi(ws.id).loadSamples();
      toast.success(ws.type === 'placement' ? 'Sample placement records imported.' : 'Sample documents are being processed.');
      setHidden(true);
      onLoaded();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative mb-6 animate-slide-up overflow-hidden rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white p-5">
      <button onClick={dismiss} className="absolute right-3 top-3 rounded-md p-1 text-ink-muted hover:bg-white" aria-label="Dismiss welcome">
        <X className="h-4 w-4" />
      </button>
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white"><info.icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-ink">Welcome to {ws.name}</h2>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">
            {info.tagline} Start with the sample set to see how it works, or bring your own
            {ws.type === 'placement' ? ' roster and application records.' : ' documents.'}
          </p>
          <p className="mt-1 text-[12.5px] text-ink-muted">Sample set: {info.sampleNote} It is labelled as sample data everywhere.</p>
          {canWrite ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button icon={<Sparkles className="h-4 w-4" />} onClick={load} loading={busy}>Load the sample {ws.type === 'placement' ? 'data' : 'documents'}</Button>
              <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} onClick={() => { setHidden(true); onUpload(); }}>
                {ws.type === 'placement' ? 'Import my records' : 'Upload my documents'}
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-ink-muted">You have viewer access. An analyst or owner can add data to this workspace.</p>
          )}
        </div>
      </div>
    </div>
  );
}
