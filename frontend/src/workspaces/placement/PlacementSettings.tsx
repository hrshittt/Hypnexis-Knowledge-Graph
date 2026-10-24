import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { placementApi } from '../../api/platform';
import { errorMessage } from '../../lib/http';
import { useToast } from '../../lib/toast';
import type { Cycle, PlacementConfig, PlacementStage } from '../../types/platform';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button, IconButton } from '../../components/ui/Button';
import { Checkbox, Field, Input, Select } from '../../components/ui/Form';
import { Notice } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Overlay';
import { Table, Td, Th } from '../../components/ui/Table';

export function PlacementSettings({ wsId, config, cycles, isOwner, onSaved }: {
  wsId: string; config: PlacementConfig; cycles: Cycle[]; isOwner: boolean; onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<PlacementConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => setDraft(config), [config]);

  const setStage = (i: number, patch: Partial<PlacementStage>) =>
    setDraft((d) => ({ ...d, stages: d.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, dir: -1 | 1) => setDraft((d) => {
    const st = [...d.stages];
    const j = i + dir;
    if (j < 0 || j >= st.length) return d;
    [st[i], st[j]] = [st[j], st[i]];
    return { ...d, stages: st };
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await placementApi.saveConfig(wsId, {
        stages: draft.stages, placement_denominator: draft.placement_denominator, placed_definition: draft.placed_definition,
        count_ppo_as_placement: draft.count_ppo_as_placement, ctc_unit: draft.ctc_unit, cycles: draft.cycles,
      });
      toast.success('Placement settings saved. Metrics now use them.');
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteAll = async () => {
    setBusy(true);
    try {
      const r = await placementApi.deleteAll(wsId);
      toast.success(`Deleted ${r.applications_removed} application and ${r.students_removed} roster record(s).`);
      setConfirmDelete(false);
      setTyped('');
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ro = !isOwner;
  return (
    <div className="space-y-6">
      {ro && <Notice tone="neutral">Only workspace owners can change placement settings. You can see the settings that metrics use.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <Card>
        <CardHeader title="Recruitment pipeline" description="Stages in order. Imported “stage” values are matched against the labels and synonyms. Keep a stage with key “offer”: offer metrics depend on it." />
        <Table caption="Pipeline stages">
          <thead><tr><Th>#</Th><Th>Label</Th><Th className="hidden md:table-cell">Key</Th><Th>Synonyms (comma-separated)</Th>{!ro && <Th align="right"><span className="sr-only">Actions</span></Th>}</tr></thead>
          <tbody>
            {draft.stages.map((s, i) => (
              <tr key={i}>
                <Td className="num text-ink-muted">{i + 1}</Td>
                <Td><Input value={s.label} disabled={ro} maxLength={60} aria-label={`Stage ${i + 1} label`} className="!h-8 min-w-[160px] text-[13px]" onChange={(e) => setStage(i, { label: e.target.value })} /></Td>
                <Td className="hidden font-mono text-[12px] text-ink-muted md:table-cell">{s.key || '(from label)'}</Td>
                <Td><Input value={s.synonyms.join(', ')} disabled={ro} aria-label={`Stage ${i + 1} synonyms`} className="!h-8 min-w-[200px] text-[13px]"
                  onChange={(e) => setStage(i, { synonyms: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Td>
                {!ro && (
                  <Td align="right">
                    <div className="flex justify-end gap-0.5">
                      <IconButton label="Move up" size="sm" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                      <IconButton label="Move down" size="sm" disabled={i === draft.stages.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                      <IconButton label="Remove stage" size="sm" disabled={s.key === 'offer' || draft.stages.length <= 2}
                        onClick={() => setDraft((d) => ({ ...d, stages: d.stages.filter((_, j) => j !== i) }))}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
        {!ro && (
          <div className="px-5 py-3">
            <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} disabled={draft.stages.length >= 20}
              onClick={() => setDraft((d) => ({ ...d, stages: [...d.stages, { key: '', label: 'New stage', synonyms: [] }] }))}>Add stage</Button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Placement policy" description="How placement rates are calculated. Changing this recalculates every metric." />
        <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
          <Field label="Placement rate denominator" hint="Placed students in this group ÷ students in this group.">
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} disabled={ro} value={draft.placement_denominator}
                onChange={(e) => setDraft((d) => ({ ...d, placement_denominator: e.target.value as PlacementConfig['placement_denominator'] }))}>
                <option value="eligible">Eligible students</option><option value="registered">Students registered for placements</option>
              </Select>
            )}
          </Field>
          <Field label="A student counts as placed when they have" hint="Declined offers never count as placed.">
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} disabled={ro} value={draft.placed_definition}
                onChange={(e) => setDraft((d) => ({ ...d, placed_definition: e.target.value as PlacementConfig['placed_definition'] }))}>
                <option value="offer_received">An offer received (accepted or awaiting decision)</option><option value="offer_accepted">An accepted offer</option>
              </Select>
            )}
          </Field>
          <Field label="CTC unit label" hint="Shown next to salary figures, e.g. LPA. Values are used as entered.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} disabled={ro} maxLength={20} value={draft.ctc_unit} onChange={(e) => setDraft((d) => ({ ...d, ctc_unit: e.target.value }))} />}
          </Field>
          <div className="pt-6">
            <Checkbox disabled={ro} checked={draft.count_ppo_as_placement} onChange={(e) => setDraft((d) => ({ ...d, count_ppo_as_placement: e.target.checked }))}
              label="Count PPOs as placements" description="A pre-placement offer from an internship counts as a full-time placement." />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Academic-year status" description="By default a cycle is ongoing until the June after it starts. Override it when your institution closes a cycle earlier or later." />
        <Table caption="Academic-year status">
          <thead><tr><Th>Academic year</Th><Th>Status</Th><Th>Cycle start date</Th></tr></thead>
          <tbody>
            {cycles.map((c) => {
              const o = draft.cycles[c.academic_year] ?? { status: null, start_date: null };
              const set = (patch: Partial<typeof o>) => setDraft((d) => ({ ...d, cycles: { ...d.cycles, [c.academic_year]: { ...o, ...patch } } }));
              return (
                <tr key={c.academic_year}>
                  <Td className="font-medium">{c.academic_year}</Td>
                  <Td>
                    <Select compact disabled={ro} value={o.status ?? ''} className="w-56" aria-label={`Status for ${c.academic_year}`}
                      onChange={(e) => set({ status: (e.target.value || null) as 'ongoing' | 'completed' | null })}>
                      <option value="">Automatic ({c.status_source === 'default' ? c.status : 'by date'})</option>
                      <option value="ongoing">Ongoing</option><option value="completed">Completed</option>
                    </Select>
                  </Td>
                  <Td><Input type="date" disabled={ro} value={o.start_date ?? ''} className="!h-8 w-44 text-[13px]" aria-label={`Start date for ${c.academic_year}`}
                    onChange={(e) => set({ start_date: e.target.value || null })} /><span className="ml-2 text-[12px] text-ink-muted">{o.start_date ? '' : `default ${c.start_date}`}</span></Td>
                </tr>
              );
            })}
            {!cycles.length && <tr><Td colSpan={3} className="text-ink-muted">Cycles appear here after you import records.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {!ro && (
        <div className="flex justify-end">
          <Button icon={<Save className="h-4 w-4" />} loading={busy} onClick={save}>Save settings</Button>
        </div>
      )}

      {!ro && (
        <Card className="border-danger/30">
          <CardHeader title="Delete all placement records" description="Removes every roster and application record in this workspace. Import history is kept. This can’t be undone." />
          <div className="px-5 py-4">
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>Delete all records</Button>
          </div>
        </Card>
      )}
      <ConfirmDialog open={confirmDelete} title="Delete every placement record?" confirmLabel="Delete permanently" busy={busy}
        disabled={typed.trim().toLowerCase() !== 'delete'} onConfirm={deleteAll} onCancel={() => { setConfirmDelete(false); setTyped(''); }}>
        <p>All student roster and application records in this workspace will be permanently deleted. Type <b>delete</b> to confirm.</p>
        <Input className="mt-3" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type delete to confirm" autoComplete="off" data-autofocus />
      </ConfirmDialog>
    </div>
  );
}
