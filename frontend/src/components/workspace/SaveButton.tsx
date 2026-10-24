import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { platformApi } from '../../api/platform';
import { errorMessage } from '../../lib/http';
import { useToast } from '../../lib/toast';
import { Button } from '../ui/Button';

/** Saves a snapshot of an analysis to the user's private saved analyses. */
export function SaveButton({ workspaceId, kind, title, payload, size = 'sm', label = 'Save' }: {
  workspaceId: string | null; kind: string; title: string; payload: () => Record<string, unknown>; size?: 'sm' | 'md'; label?: string;
}) {
  const toast = useToast();
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (saved) {
    return (
      <Link to={`/app/saved/${saved}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 text-[13px] font-medium text-brand-700 hover:bg-brand-100">
        <BookmarkCheck className="h-4 w-4" /> Saved
      </Link>
    );
  }
  return (
    <Button variant="secondary" size={size} loading={busy} icon={<Bookmark className="h-4 w-4" />}
      onClick={async () => {
        setBusy(true);
        try {
          const s = await platformApi.save({ workspace_id: workspaceId, kind, title: title.slice(0, 160), payload: payload() });
          setSaved(s.analysis_id);
          toast.success('Saved to your analyses. Only you can see it.');
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}>
      {label}
    </Button>
  );
}
