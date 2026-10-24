import { useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, RotateCcw, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { placementApi } from '../../api/platform';
import { errorMessage } from '../../lib/http';
import { useAsync } from '../../lib/hooks';
import { fmtDateTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import type { ImportSummary, StagedImport } from '../../types/platform';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge, SampleBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Segmented, Select } from '../../components/ui/Form';
import { EmptyState, Notice, Skeleton } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Overlay';
import { Table, Td, Th } from '../../components/ui/Table';

type Kind = 'students' | 'applications';

const KIND_HELP: Record<Kind, string> = {
  students: 'One row per student per academic year: the denominators (eligible / registered) for placement rates.',
  applications: 'One row per student × company × opportunity: stage reached, result, internship and PPO outcomes, CTC.',
};

export function ImportView({ wsId, canImport, onImported }: { wsId: string; canImport: boolean; onImported: () => void }) {
  const toast = useToast();
  const history = useAsync(() => placementApi.imports(wsId), [wsId]);
  const [kind, setKind] = useState<Kind>('students');
  const [staged, setStaged] = useState<StagedImport | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [policy, setPolicy] = useState<'skip' | 'update'>('skip');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const stage = async (f: File | undefined) => {
    if (!f) return;
    setBusy('stage');
    setResult(null);
    try {
      const s = await placementApi.stage(wsId, kind, f);
      setStaged(s);
      setMapping(s.mapping);
      setDefaults({});
      setPolicy('skip');
      history.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
      if (file.current) file.current.value = '';
    }
  };

  const cleanDefaults = () => Object.fromEntries(Object.entries(defaults).filter(([, v]) => v.trim()));

  const revalidate = async () => {
    if (!staged) return;
    setBusy('preview');
    try {
      const s = await placementApi.preview(wsId, staged.import.id, mapping, cleanDefaults());
      setStaged(s);
      setMapping(s.mapping);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!staged) return;
    setConfirmUpdate(false);
    setBusy('commit');
    try {
      const r = await placementApi.commit(wsId, staged.import.id, mapping, cleanDefaults(), policy);
      setResult(r.summary);
      setStaged(null);
      toast.success(`Imported ${r.summary.inserted ?? 0} new record(s).`);
      history.reload();
      onImported();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!staged) return;
    setBusy('discard');
    try {
      await placementApi.discard(wsId, staged.import.id);
      setStaged(null);
      history.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const loadSamples = async () => {
    setBusy('samples');
    try {
      await placementApi.loadSamples(wsId);
      toast.success('Sample placement records imported. They are labelled as sample data.');
      history.reload();
      onImported();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!canImport) {
    return <Card><EmptyState icon={<ShieldCheck />} title="Imports need the analyst or owner role">Ask the workspace owner to change your role if you need to import records.</EmptyState></Card>;
  }

  const s = staged?.summary;
  const requiredUnmapped = staged?.fields.filter((f) => f.required && !mapping[f.key]) ?? [];

  return (
    <div className="space-y-6">
      {!staged && (
        <Card padded>
          <h2 className="text-[16px] font-semibold text-ink">Import placement data</h2>
          <p className="mt-1 text-[13.5px] text-ink-muted">Upload a CSV or Excel (.xlsx) file. You’ll review the column mapping and validation before anything is saved.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Segmented label="Import kind" value={kind} onChange={setKind} options={[{ value: 'students', label: 'Student roster' }, { value: 'applications', label: 'Application records' }]} />
            <Button icon={<Upload className="h-4 w-4" />} loading={busy === 'stage'} onClick={() => file.current?.click()}>Choose file</Button>
            <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={busy === 'samples'} onClick={loadSamples}>Load fictional sample data</Button>
            <input ref={file} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => stage(e.target.files?.[0])} />
          </div>
          <p className="mt-3 text-[13px] text-ink-soft">{KIND_HELP[kind]}</p>
          <Notice tone="neutral" className="mt-4" icon={<ShieldCheck className="h-4 w-4" />}>
            Names, contact details and sensitive characteristics (gender, category, religion, date of birth, marks…) are never imported, even if a column is mapped. Students are identified only by your institution’s ID.
          </Notice>
        </Card>
      )}

      {result && (
        <Notice tone="success" title="Import complete" icon={<CheckCircle2 className="h-4 w-4" />}>
          {result.inserted ?? 0} inserted · {result.updated ?? 0} updated · {result.skipped_existing ?? 0} already existed and were skipped · {result.invalid ?? 0} invalid row(s) not imported.
        </Notice>
      )}

      {staged && s && (
        <div className="space-y-5">
          <Card>
            <CardHeader title={`Preview: ${staged.filename}`} icon={<FileSpreadsheet className="h-4 w-4" />}
              description={`${staged.kind === 'students' ? 'Student roster' : 'Application records'}${staged.sheet ? ` · sheet “${staged.sheet}”` : ''} · nothing has been saved yet`}
              actions={<Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} loading={busy === 'discard'} onClick={discard}>Discard</Button>} />
            <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
              {[['Rows', s.total_rows], ['Valid', s.valid], ['Invalid', s.invalid], ['Duplicates in file', s.duplicates_in_file], ['Already imported', s.existing_matches], ['New records', s.new_records]].map(([l, v]) => (
                <div key={l as string}><div className="text-[12px] text-ink-muted">{l}</div><div className="text-[20px] font-semibold text-ink">{((v as number | undefined) ?? 0).toLocaleString()}</div></div>
              ))}
            </div>
            {staged.sensitive_columns.length > 0 && (
              <div className="px-5 pb-4"><Notice tone="warn" title="These columns will not be imported">{staged.sensitive_columns.join(', ')} — personal or sensitive data is excluded by design.</Notice></div>
            )}
          </Card>

          <Card>
            <CardHeader title="Column mapping" description="Match each Hypnexis field to a column in your file. Required fields must be mapped or given a default."
              actions={<Button variant="secondary" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={busy === 'preview'} onClick={revalidate}>Re-validate</Button>} />
            <Table caption="Column mapping">
              <thead><tr><Th>Field</Th><Th>Column in your file</Th><Th className="hidden lg:table-cell">Default when unmapped</Th><Th className="hidden md:table-cell">About</Th></tr></thead>
              <tbody>
                {staged.fields.map((f) => (
                  <tr key={f.key}>
                    <Td className="font-medium">{f.label}{f.required && <span className="ml-0.5 text-danger" aria-label="required">*</span>}</Td>
                    <Td>
                      <Select compact value={mapping[f.key] ?? ''} aria-label={`Column for ${f.label}`} className="w-56"
                        onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))}>
                        <option value="">— Not in file —</option>
                        {staged.headers.map((h) => <option key={h} value={h} disabled={staged.sensitive_columns.includes(h)}>{h}{staged.sensitive_columns.includes(h) ? ' (excluded)' : ''}</option>)}
                      </Select>
                    </Td>
                    <Td className="hidden lg:table-cell">
                      {(f.required || f.key === 'academic_year') && !mapping[f.key]
                        ? <Input value={defaults[f.key] ?? ''} onChange={(e) => setDefaults((d) => ({ ...d, [f.key]: e.target.value }))}
                            placeholder={f.key === 'academic_year' ? 'e.g. 2025-26' : f.key === 'opportunity_type' ? 'internship / full-time / PPO' : ''}
                            className="!h-8 w-48 text-[13px]" aria-label={`Default for ${f.label}`} />
                        : <span className="text-ink-faint">—</span>}
                    </Td>
                    <Td className="hidden text-[12.5px] text-ink-muted md:table-cell">{f.help}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {staged.unmapped_columns.length > 0 && <p className="px-5 py-3 text-[12.5px] text-ink-muted">Columns not used: {staged.unmapped_columns.join(', ')}</p>}
          </Card>

          {(staged.errors.length > 0 || staged.duplicates.length > 0 || Object.keys(s.unknown_values ?? {}).length > 0 || Object.keys(s.adjustments ?? {}).length > 0) && (
            <Card>
              <CardHeader title="Validation report" description="Invalid rows are skipped; valid rows can still be imported. Fix the file and upload again to include them." />
              <div className="space-y-4 px-5 py-4">
                {Object.entries(s.unknown_values ?? {}).map(([field, vals]) => (
                  <div key={field}>
                    <p className="text-[13px] font-medium text-ink">Unrecognised values in “{staged.fields.find((f) => f.key === field)?.label ?? field}”</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{vals.map((v) => <Badge key={v.value} tone="warn">{v.value} × {v.rows}</Badge>)}</div>
                    {field === 'stage' && <p className="mt-1 text-[12px] text-ink-muted">Add unknown stages to your pipeline in Settings, or correct them in the file.</p>}
                  </div>
                ))}
                {Object.keys(s.adjustments ?? {}).length > 0 && (
                  <div><p className="text-[13px] font-medium text-ink">Automatic adjustments</p>
                    <ul className="mt-1 list-disc pl-5 text-[12.5px] text-ink-soft">{Object.entries(s.adjustments!).map(([k, n]) => <li key={k}>{k}: {n} row(s)</li>)}</ul></div>
                )}
                {staged.errors.length > 0 && (
                  <div className="rounded-lg border border-line">
                    <Table caption="Invalid rows">
                      <thead><tr><Th align="right">Row</Th><Th>Field</Th><Th>Value</Th><Th>Problem</Th></tr></thead>
                      <tbody>{staged.errors.slice(0, 50).map((e, i) => (
                        <tr key={i}><Td align="right">{e.row}</Td><Td>{e.field ?? '—'}</Td><Td className="max-w-[200px] truncate">{e.value === undefined || e.value === null ? '—' : String(e.value)}</Td><Td className="text-danger-ink">{e.message}</Td></tr>
                      ))}</tbody>
                    </Table>
                    {staged.errors.length > 50 && <p className="px-3 py-2 text-[12px] text-ink-muted">Showing 50 of {staged.errors.length} problems.</p>}
                  </div>
                )}
                {staged.duplicates.length > 0 && (
                  <div><p className="text-[13px] font-medium text-ink">Duplicate rows in this file</p>
                    <ul className="mt-1 list-disc pl-5 text-[12.5px] text-ink-soft">{staged.duplicates.slice(0, 10).map((d) => <li key={d.row}>Row {d.row}: {d.message}</li>)}</ul></div>
                )}
              </div>
            </Card>
          )}

          {staged.sample_rows.length > 0 && (
            <Card>
              <CardHeader title="Sample of normalised rows" description="How the first valid rows will be stored." />
              <Table caption="Normalised sample rows">
                <thead><tr><Th align="right">Row</Th>{Object.keys(staged.sample_rows[0]).filter((k) => k !== 'row').map((k) => <Th key={k}>{staged.fields.find((f) => f.key === k)?.label ?? k}</Th>)}</tr></thead>
                <tbody>{staged.sample_rows.slice(0, 8).map((r, i) => (
                  <tr key={i}><Td align="right">{String(r.row)}</Td>{Object.entries(r).filter(([k]) => k !== 'row').map(([k, v]) => <Td key={k} className="whitespace-nowrap">{v === null || v === undefined ? '—' : String(v)}</Td>)}</tr>
                ))}</tbody>
              </Table>
            </Card>
          )}

          <Card padded>
            <h3 className="text-[14px] font-semibold text-ink">Records that already exist</h3>
            <p className="mt-0.5 text-[13px] text-ink-muted">{(s.existing_matches ?? 0).toLocaleString()} row(s) match records already imported. Existing records are never overwritten unless you choose to.</p>
            <div className="mt-3 space-y-2" role="radiogroup" aria-label="Duplicate policy">
              {([['skip', 'Skip existing records', 'Keep what is stored; import only new records.'], ['update', 'Update existing records', 'Replace stored values with the values in this file.']] as const).map(([v, l, d]) => (
                <label key={v} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 ${policy === v ? 'border-brand-600 bg-brand-50' : 'border-line'}`}>
                  <input type="radio" name="dup-policy" className="mt-0.5 accent-brand-600" checked={policy === v} onChange={() => setPolicy(v)} />
                  <span><span className="block text-[13.5px] font-medium text-ink">{l}</span><span className="text-[12.5px] text-ink-muted">{d}</span></span>
                </label>
              ))}
            </div>
            {requiredUnmapped.length > 0 && <Notice tone="warn" className="mt-3">Map or give a default for: {requiredUnmapped.map((f) => f.label).join(', ')}, then re-validate.</Notice>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button icon={<CheckCircle2 className="h-4 w-4" />} loading={busy === 'commit'} disabled={!s.valid || busy !== null}
                onClick={() => (policy === 'update' && (s.existing_matches ?? 0) > 0 ? setConfirmUpdate(true) : commit())}>
                Import {(s.valid ?? 0).toLocaleString()} valid row{s.valid === 1 ? '' : 's'}
              </Button>
              <Button variant="secondary" onClick={discard} disabled={busy !== null}>Cancel</Button>
            </div>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader title="Import history" description="Every stored record keeps its import and spreadsheet row number." />
        {history.initialLoading ? <div className="p-5"><Skeleton className="h-6 w-full" /></div>
          : !history.data?.length ? <p className="px-5 py-4 text-[13px] text-ink-muted">No imports yet.</p>
          : (
            <Table caption="Import history">
              <thead><tr><Th>File</Th><Th>Kind</Th><Th>Status</Th><Th align="right">Inserted</Th><Th align="right">Updated</Th><Th align="right">Skipped</Th><Th align="right">Invalid</Th><Th className="hidden md:table-cell">By</Th><Th className="hidden md:table-cell">When</Th></tr></thead>
              <tbody>{history.data.map((i) => (
                <tr key={i.id}>
                  <Td><span className="font-medium">{i.filename}</span> {i.is_sample && <SampleBadge className="ml-1" />}</Td>
                  <Td>{i.kind === 'students' ? 'Roster' : 'Applications'}</Td>
                  <Td><Badge tone={i.status === 'committed' ? 'brand' : i.status === 'failed' ? 'danger' : 'neutral'}>{i.status}</Badge>{i.duplicate_policy && <span className="ml-1 text-[11.5px] text-ink-muted">({i.duplicate_policy})</span>}</Td>
                  <Td align="right">{i.summary.inserted ?? '—'}</Td><Td align="right">{i.summary.updated ?? '—'}</Td>
                  <Td align="right">{i.summary.skipped_existing ?? '—'}</Td><Td align="right">{i.summary.invalid ?? '—'}</Td>
                  <Td className="hidden md:table-cell">{i.uploader ?? '—'}</Td>
                  <Td className="hidden whitespace-nowrap md:table-cell">{fmtDateTime(i.committed_at ?? i.created_at)}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
      </Card>

      <ConfirmDialog open={confirmUpdate} title="Update existing records?" confirmLabel="Update and import" tone="primary" busy={busy === 'commit'}
        onConfirm={commit} onCancel={() => setConfirmUpdate(false)}>
        {(s?.existing_matches ?? 0).toLocaleString()} stored record(s) will be replaced with the values in this file. Their provenance will point to this import.
      </ConfirmDialog>
    </div>
  );
}
