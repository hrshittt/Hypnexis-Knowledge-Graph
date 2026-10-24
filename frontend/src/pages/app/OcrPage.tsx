import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { workspaceKbApi } from '../../api/kb';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/http';
import { useDocumentTitle } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { TYPE_INFO, roleAtLeast } from '../../lib/workspaceTypes';
import { Page, PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Form';
import OcrScanner from '../../components/ocr/OcrScanner';

/** Scan & OCR: read a photo or scanned PDF in the browser, then keep the text or add it to a workspace. */
export default function OcrPage() {
  useDocumentTitle('Scan & OCR');
  const { workspaces } = useAuth();
  const toast = useToast();
  // Placement workspaces analyse imported records, not documents, so they are not offered as a destination.
  const targets = useMemo(() => workspaces.filter((w) => roleAtLeast(w.role, 'analyst') && w.type !== 'placement'), [workspaces]);
  const [target, setTarget] = useState<string>(() => targets[0]?.id ?? '');
  const ws = targets.find((w) => w.id === target) ?? null;

  const add = async (file: File) => {
    if (!ws) return;
    try {
      const r = await workspaceKbApi(ws.id).upload([file]);
      const res = r.results[0];
      if (res && res.status !== 'queued') {
        toast.error(`${res.filename}: ${res.status === 'duplicate' ? 'already in this workspace' : res.error ?? 'not added'}`);
        throw new Error('not added');
      }
      toast.success(`Added to ${ws.name}. Paheli is adding it to the knowledge graph.`);
    } catch (e) {
      if ((e as Error).message !== 'not added') toast.error(errorMessage(e));
      throw e;
    }
  };

  return (
    <Page>
      <PageHeader title="Scan & OCR"
        description="Turn a photographed page or a scanned PDF into text. Check it, fix anything misread, then add it to a workspace so Paheli can answer questions about it." />
      <div className="mt-8">
        <OcrScanner onAdd={ws ? add : undefined} addLabel={ws ? `Add to ${ws.name}` : undefined}
          targetPicker={
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-medium text-ink-muted">Add the text to</span>
              {targets.length ? (
                <Select compact value={target} className="w-72" onChange={(e) => setTarget(e.target.value)}>
                  {targets.map((w) => <option key={w.id} value={w.id}>{w.name} · {TYPE_INFO[w.type].short}</option>)}
                  <option value="">Don’t add — just extract the text</option>
                </Select>
              ) : (
                <span className="block py-1.5 text-[13px] text-ink-muted">
                  No workspace you can add to yet. <Link to="/app" className="font-medium text-brand-700 hover:underline">Set one up</Link>
                </span>
              )}
            </label>
          } />
      </div>
      <section className="mt-14 grid gap-8 border-t border-line pt-8 sm:grid-cols-3">
        {[
          ['Sharp, flat, well lit', 'Photograph the page straight on, filling the frame. Avoid shadows and glare.'],
          ['Pick the right language', 'Choose Hindi or English + Hindi for Devanagari text; English is fastest.'],
          ['Check before you add', 'OCR can misread words. Edit the text first: Paheli answers from exactly what you add.'],
        ].map(([t, b]) => (
          <div key={t}>
            <h2 className="text-[14.5px] font-semibold text-ink">{t}</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{b}</p>
          </div>
        ))}
      </section>
    </Page>
  );
}
