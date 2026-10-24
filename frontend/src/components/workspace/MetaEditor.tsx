import { useEffect, useState } from 'react';
import { workspacesApi } from '../../api/platform';
import { errorMessage } from '../../lib/http';
import { useToast } from '../../lib/toast';
import type { DocMeta } from '../../types/platform';
import { Button } from '../ui/Button';
import { Checkbox, Field, Input } from '../ui/Form';
import { Modal } from '../ui/Overlay';
import { Notice } from '../ui/Feedback';

export type MetaField = keyof DocMeta;

export const META_LABEL: Record<MetaField, string> = {
  company: 'Company', fiscal_year: 'Financial year', doc_kind: 'Document type', jurisdiction: 'Jurisdiction',
  authority: 'Issuing authority', effective_date: 'Effective date', source_url: 'Official source link',
};

const META_HINT: Partial<Record<MetaField, string>> = {
  company: 'Analyses group documents by this exact name.',
  fiscal_year: 'For example FY2024.',
  doc_kind: 'For example Annual report, Statute, Regulation, Journal article.',
  jurisdiction: 'Legal research filters sources by this value.',
  effective_date: 'Only enter a date you have verified in the official text.',
  source_url: 'Must start with http:// or https://. Paheli never invents links.',
};

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  doc: { doc_id: string; filename: string; meta: Partial<DocMeta>; verified_at?: number | null } | null;
  fields: MetaField[];
  allowVerified?: boolean;
  onSaved: () => void;
}

/** Edit the user-supplied facts about a document (company, period, jurisdiction, official link…). */
export function MetaEditor({ open, onClose, workspaceId, doc, fields, allowVerified, onSaved }: Props) {
  const toast = useToast();
  const [values, setValues] = useState<Partial<Record<MetaField, string>>>({});
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) return;
    setValues(Object.fromEntries(fields.map((f) => [f, doc.meta[f] ?? ''])));
    setVerified(!!doc.verified_at);
    setError(null);
  }, [doc, fields]);

  const save = async () => {
    if (!doc) return;
    const url = values.source_url?.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setError('Source links must start with http:// or https://.');
      return;
    }
    setBusy(true);
    try {
      const body: Partial<DocMeta> & { verified?: boolean } = {};
      for (const f of fields) body[f] = values[f]?.trim() || null;
      if (allowVerified) body.verified = verified;
      await workspacesApi.setMeta(workspaceId, doc.doc_id, body);
      toast.success('Document details saved.');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Document details" description={doc?.filename}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save details</Button></>}>
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        {fields.map((f) => (
          <Field key={f} label={META_LABEL[f]} hint={META_HINT[f]}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} value={values[f] ?? ''} type={f === 'effective_date' ? 'date' : f === 'source_url' ? 'url' : 'text'}
                maxLength={f === 'source_url' ? 500 : 300} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} />
            )}
          </Field>
        ))}
        {allowVerified && (
          <Checkbox checked={verified} onChange={(e) => setVerified(e.target.checked)} label="I have checked this against the official source"
            description="Records today’s date as the last-verified date shown with legal results." />
        )}
      </div>
    </Modal>
  );
}
