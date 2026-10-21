// A workspace admin's scout template editor (Task 5): the fields members fill in
// for this season's match and pit entries. Fields are listed by phase; each can
// be edited (label, type, phase, options, min/max), moved up or down, or removed,
// and new ones added with a type picker. Preview shows the form members will see.
//
// Touch first (390 px): every control is a button (no drag), at least 40 px on
// phones. Only rendered for admins; the server refuses anyone else's save anyway.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input, Label } from "../ui/basic";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { toast } from "../ui/sonner";
import { ScoutFieldInput } from "./ScoutFieldInput";
import { templateFor, type ScoutValue } from "../../lib/scouting";
import { announceTemplateChange, saveWorkspaceTemplate } from "../../lib/scoutTemplates";
import { seasonLabel } from "../../lib/format";
import {
  cleanField, FIELD_TYPE_LABEL, FIELD_TYPES, newFieldId, phaseLabel, phasesFor, TEMPLATE_LIMITS,
  type FieldPhase, type FieldType, type ScoutField, type TemplateKind, type WorkspaceTemplate,
} from "../../shared/scoutTemplate";

type Draft = Record<TemplateKind, ScoutField[]>;
const KINDS: TemplateKind[] = ["match", "pit"];

const fromTemplate = (wt: WorkspaceTemplate | null, season: number): Draft => ({
  match: wt?.match ?? templateFor(season, "match").fields,
  pit: wt?.pit ?? templateFor(season, "pit").fields,
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A new field of a type, with sensible starting values. */
export function blankField(type: FieldType, phase: FieldPhase, taken: Iterable<string>): ScoutField {
  const base = { id: newFieldId(taken), label: `New ${FIELD_TYPE_LABEL[type].toLowerCase()}`, type, phase };
  if (type === "counter") return { ...base, max: 20 };
  if (type === "rating") return { ...base, max: TEMPLATE_LIMITS.ratingDefault };
  if (type === "choice") return { ...base, options: ["Option 1", "Option 2"] };
  return base;
}

/** Why a draft field can't be saved yet (null: fine). */
export const fieldProblem = (f: ScoutField, kind: TemplateKind) => { const r = cleanField(f, kind); return "reason" in r ? r.reason : null; };

export function TemplateEditor({ workspaceId, workspaceName, season, template, onClose }: {
  workspaceId: string; workspaceName: string; season: number; template: WorkspaceTemplate | null; onClose: () => void;
}) {
  const saved = useMemo(() => fromTemplate(template, season), [template, season]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [base, setBase] = useState(template?.version ?? 0);
  const [kind, setKind] = useState<TemplateKind>("match");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<FieldPhase | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = !same(draft, saved);
  // A new version arrived (another admin, or our own save): take it unless there are unsaved edits
  // (then the banner below says so, and Discard loads it).
  const basis = useRef(saved);
  useEffect(() => {
    if (same(draft, basis.current)) { setDraft(saved); setBase(template?.version ?? 0); }
    basis.current = saved;
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const newer = (template?.version ?? 0) !== base;

  const fields = draft[kind];
  const setFields = (fn: (fs: ScoutField[]) => ScoutField[]) => setDraft((d) => ({ ...d, [kind]: fn(d[kind]) }));
  const problems = KINDS.flatMap((k) => draft[k].map((f) => ({ k, f, why: fieldProblem(f, k) }))).filter((p) => p.why);
  const tooMany = KINDS.some((k) => draft[k].length > TEMPLATE_LIMITS.fields);

  const move = (id: string, d: -1 | 1) => setFields((fs) => {
    const i = fs.findIndex((f) => f.id === id);
    // Swap with the next field in the same phase (the form groups by phase).
    let j = i + d;
    while (j >= 0 && j < fs.length && fs[j].phase !== fs[i].phase) j += d;
    if (i < 0 || j < 0 || j >= fs.length) return fs;
    const a = [...fs]; [a[i], a[j]] = [a[j], a[i]]; return a;
  });
  const update = (id: string, patch: Partial<ScoutField>) => setFields((fs) => fs.map((f) => (f.id === id ? tidy({ ...f, ...patch }) : f)));
  const remove = (f: ScoutField) => {
    const at = fields.findIndex((x) => x.id === f.id);
    const from = kind;
    setFields((fs) => fs.filter((x) => x.id !== f.id));
    if (editing === f.id) setEditing(null);
    // Undo puts it back where it was (in the kind it came from).
    toast(`Removed “${f.label}”`, { action: { label: "Undo", onClick: () => setDraft((d) => {
      if (d[from].some((x) => x.id === f.id)) return d;
      const a = [...d[from]]; a.splice(Math.min(at, a.length), 0, f); return { ...d, [from]: a };
    }) } });
  };
  const add = (type: FieldType, phase: FieldPhase) => {
    const f = blankField(type, phase, KINDS.flatMap((k) => draft[k].map((x) => x.id)));
    setFields((fs) => {
      // After the phase's last field, so it shows where it was asked for.
      const last = fs.map((x) => x.phase).lastIndexOf(phase);
      const a = [...fs]; a.splice(last < 0 ? a.length : last + 1, 0, f); return a;
    });
    setAdding(null); setEditing(f.id); setMode("edit");
  };

  const save = async () => {
    setBusy(true);
    try {
      // A kind left exactly as the built-in default is saved as "the default" (it follows future built-in changes).
      const body = Object.fromEntries(KINDS.map((k) => [k, same(draft[k], templateFor(season, k).fields) ? null : draft[k]]));
      const r = await saveWorkspaceTemplate(workspaceId, season, { match: body.match, pit: body.pit, baseVersion: base });
      setBase(r.template.version);
      setDraft(fromTemplate(r.template, season)); // as stored (trimmed, clamped)
      setEditing(null);
      if (!r.changed) toast("No changes to save");
      else if (r.dropped.length) toast.warning(`Saved as version ${r.template.version}. ${r.dropped.length} field${r.dropped.length === 1 ? " was" : "s were"} left out: ${r.dropped.map((d) => d.reason).join(", ")}.`);
      else toast.success(`Template saved (version ${r.template.version}). Members get it on their next new entry.`);
    } catch (e: any) {
      if (e?.status === 409) toast.error("Another admin changed this template meanwhile. Their version is loaded; make your change again.");
      else toast.error(e?.message ?? "Couldn't save the template. Try again.");
      // Theirs is fetched and loaded (the effect above takes it, the draft being back on the old basis).
      if (e?.status === 409) { setDraft(saved); announceTemplateChange({ space: workspaceId, season }); }
    } finally { setBusy(false); }
  };
  const discard = () => { setDraft(saved); setBase(template?.version ?? 0); setEditing(null); setAdding(null); };
  const resetKind = () => { setFields(() => templateFor(season, kind).fields); setEditing(null); };
  const isDefault = same(fields, templateFor(season, kind).fields);

  return (
    <section aria-labelledby="tpl-title" className="mb-8 max-sm:mb-5 rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="tpl-title" className="font-display text-lg font-semibold">Scout template · {seasonLabel(season)}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            What {workspaceName} members fill in for {seasonLabel(season)} entries. Personal entries keep the built-in fields.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {template && template.version > 0 ? <>Version {template.version}{template.updatedBy ? ` · saved by ${template.updatedBy}` : ""}{template.updatedAt ? ` · ${new Date(template.updatedAt).toLocaleString()}` : ""}</> : "Built-in fields so far: nothing customised yet."}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close template" onClick={onClose}><X /></Button>
      </div>

      {newer && dirty && (
        <p role="status" className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          Another admin saved version {template?.version} while you were editing. Saving now would be refused: discard to load theirs.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" value={kind} onValueChange={(v) => { if (v) { setKind(v as TemplateKind); setEditing(null); setAdding(null); } }} aria-label="Entry type">
          <ToggleGroupItem value="match">Match ({draft.match.length})</ToggleGroupItem>
          <ToggleGroupItem value="pit">Pit ({draft.pit.length})</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={mode} onValueChange={(v) => { if (v) setMode(v as typeof mode); }} aria-label="Edit or preview">
          <ToggleGroupItem value="edit"><Pencil className="size-3.5" /> Edit</ToggleGroupItem>
          <ToggleGroupItem value="preview"><Eye className="size-3.5" /> Preview</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {mode === "preview" ? <Preview kind={kind} fields={fields} /> : (
        <fieldset disabled={busy} className="mt-4 min-w-0 space-y-4 disabled:opacity-70">
          {phasesFor(kind).map((ph) => {
            const list = fields.filter((f) => f.phase === ph);
            return (
              <fieldset key={ph} className="min-w-0 rounded-xl border border-border p-3 sm:p-4">
                <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{phaseLabel(ph)}</legend>
                {!list.length && <p className="px-1 py-1 text-sm text-muted-foreground">No fields in this phase.</p>}
                <ul className="divide-y divide-border">
                  {list.map((f, i) => (
                    <li key={f.id} className="py-2">
                      <div className="flex items-center gap-1">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{f.label || <span className="text-muted-foreground">No label</span>}</p>
                          <p className="truncate text-xs text-muted-foreground">{summary(f)}</p>
                          {fieldProblem(f, kind) && <p className="text-xs text-destructive">Can't be saved: {fieldProblem(f, kind)}</p>}
                        </div>
                        <Button type="button" variant="ghost" size="icon-sm" className="max-sm:size-10" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(f.id, -1)}><ArrowUp /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" className="max-sm:size-10" aria-label={`Move ${f.label} down`} disabled={i === list.length - 1} onClick={() => move(f.id, 1)}><ArrowDown /></Button>
                        <Button type="button" variant={editing === f.id ? "secondary" : "ghost"} size="icon-sm" className="max-sm:size-10" aria-label={`Edit ${f.label}`} aria-expanded={editing === f.id} onClick={() => setEditing(editing === f.id ? null : f.id)}><Pencil /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" className="max-sm:size-10" aria-label={`Remove ${f.label}`} onClick={() => remove(f)}><Trash2 /></Button>
                      </div>
                      {editing === f.id && <FieldEditor f={f} kind={kind} onChange={(p) => update(f.id, p)} onDone={() => setEditing(null)} />}
                    </li>
                  ))}
                </ul>
                {adding === ph ? (
                  <div className="mt-2 rounded-lg border border-dashed border-border p-3">
                    <p className="text-xs text-muted-foreground">Pick a type for the new field</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {FIELD_TYPES.map((t) => <Button key={t} type="button" variant="outline" size="sm" className="max-sm:h-10" onClick={() => add(t, ph)}>{FIELD_TYPE_LABEL[t]}</Button>)}
                      <Button type="button" variant="ghost" size="sm" className="max-sm:h-10" onClick={() => setAdding(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="mt-2 max-sm:h-10" disabled={fields.length >= TEMPLATE_LIMITS.fields} onClick={() => { setAdding(ph); setEditing(null); }}><Plus /> Add field</Button>
                )}
              </fieldset>
            );
          })}
        </fieldset>
      )}

      <div className="mt-5 max-sm:mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={!dirty || busy || problems.length > 0 || tooMany}><Save /> {busy ? "Saving…" : "Save template"}</Button>
        <Button type="button" variant="outline" onClick={discard} disabled={!dirty || busy}>Discard changes</Button>
        <Button type="button" variant="ghost" onClick={resetKind} disabled={isDefault || busy}><RotateCcw /> Use built-in {kind} fields</Button>
        <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
          {problems.length ? `Fix ${problems.length} field${problems.length === 1 ? "" : "s"} before saving.` : dirty ? "Unsaved changes. Entries already made keep the fields they were made with." : "Saved. Entries already made keep the fields they were made with."}
        </p>
      </div>
    </section>
  );
}

/** Keep a field's settings consistent with its type while it's being edited. */
function tidy(f: ScoutField): ScoutField {
  const { options, min, max, ...rest } = f;
  if (f.type === "choice") return { ...rest, options: options?.length ? options : ["Option 1", "Option 2"] };
  if (f.type === "counter") { const hi = max ?? 20; const lo = Math.min(min ?? 0, hi - 1); return { ...rest, ...(lo > 0 ? { min: lo } : {}), max: hi }; }
  if (f.type === "rating") return { ...rest, max: Math.min(TEMPLATE_LIMITS.ratingMax, Math.max(TEMPLATE_LIMITS.ratingMin, max ?? TEMPLATE_LIMITS.ratingDefault)) };
  return rest;
}

function summary(f: ScoutField): string {
  const t = FIELD_TYPE_LABEL[f.type];
  if (f.type === "counter") return `${t} · ${f.min ?? 0} to ${f.max ?? 999}`;
  if (f.type === "rating") return `${t} · 1 to ${f.max ?? 5}`;
  if (f.type === "choice") return `${t} · ${(f.options ?? []).join(", ")}`;
  return t;
}

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

function FieldEditor({ f, kind, onChange, onDone }: { f: ScoutField; kind: TemplateKind; onChange: (p: Partial<ScoutField>) => void; onDone: () => void }) {
  const id = `tpl-${f.id}`;
  const phases = phasesFor(kind);
  return (
    <div className="mt-2 space-y-3 rounded-lg bg-muted/40 p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-label`}>Label</Label>
          <Input id={`${id}-label`} value={f.label} maxLength={TEMPLATE_LIMITS.label} onChange={(e) => onChange({ label: e.target.value })} className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-type`}>Type</Label>
          <Select value={f.type} onValueChange={(v) => onChange({ type: v as FieldType })}>
            <SelectTrigger id={`${id}-type`} className="h-11 w-full sm:w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t} value={t} className="max-sm:py-2.5">{FIELD_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {phases.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-phase`}>Phase</Label>
            <Select value={f.phase} onValueChange={(v) => onChange({ phase: v as FieldPhase })}>
              <SelectTrigger id={`${id}-phase`} className="h-11 w-full sm:w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{phases.map((p) => <SelectItem key={p} value={p} className="max-sm:py-2.5">{phaseLabel(p)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
      </div>
      {f.type === "counter" && (
        <div className="flex flex-wrap gap-3">
          <NumberBox id={`${id}-min`} label="Lowest" value={f.min ?? 0} lo={0} hi={(f.max ?? TEMPLATE_LIMITS.counterMax) - 1} onChange={(v) => onChange({ min: v })} />
          <NumberBox id={`${id}-max`} label="Highest" value={f.max ?? 20} lo={1} hi={TEMPLATE_LIMITS.counterMax} onChange={(v) => onChange({ max: v })} />
        </div>
      )}
      {f.type === "rating" && (
        <NumberBox id={`${id}-max`} label={`Steps (${TEMPLATE_LIMITS.ratingMin} to ${TEMPLATE_LIMITS.ratingMax})`} value={f.max ?? 5} lo={TEMPLATE_LIMITS.ratingMin} hi={TEMPLATE_LIMITS.ratingMax} onChange={(v) => onChange({ max: v })} />
      )}
      {f.type === "choice" && <OptionsEditor id={id} options={f.options ?? []} onChange={(options) => onChange({ options })} />}
      <Button type="button" variant="secondary" size="sm" className="max-sm:h-10" onClick={onDone}>Done</Button>
    </div>
  );
}

function NumberBox({ id, label, value, lo, hi, onChange }: { id: string; label: string; value: number; lo: number; hi: number; onChange: (v: number | undefined) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (num(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="numeric" value={text} className="h-11 w-28 font-mono"
        onChange={(e) => { const t = e.target.value.replace(/[^\d]/g, "").slice(0, 3); setText(t); const n = num(t); if (n !== undefined) onChange(Math.min(hi, Math.max(lo, n))); }}
        onBlur={() => setText(String(value))} />
    </div>
  );
}

function OptionsEditor({ id, options, onChange }: { id: string; options: string[]; onChange: (o: string[]) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Options</legend>
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input aria-label={`Option ${i + 1}`} id={i === 0 ? `${id}-opt` : undefined} value={o} maxLength={TEMPLATE_LIMITS.option} onChange={(e) => onChange(options.map((x, j) => (j === i ? e.target.value : x)))} className="h-11" />
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove option ${i + 1}`} disabled={options.length <= 2} onClick={() => onChange(options.filter((_, j) => j !== i))}><X /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="max-sm:h-10" disabled={options.length >= TEMPLATE_LIMITS.options} onClick={() => onChange([...options, `Option ${options.length + 1}`])}><Plus /> Add option</Button>
    </fieldset>
  );
}

function Preview({ kind, fields }: { kind: TemplateKind; fields: ScoutField[] }) {
  const [data, setData] = useState<Record<string, ScoutValue>>({});
  // Exactly what will be saved (trimmed, clamped, repeated options merged), so the preview matches members' form.
  const usable = fields.flatMap((f) => { const r = cleanField(f, kind); return "field" in r ? [r.field] : []; });
  return (
    <div className="mt-4">
      <p className="mb-3 text-xs text-muted-foreground">What members see in a new {kind} entry. Try the controls; nothing is saved.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {phasesFor(kind).map((ph) => {
          const list = usable.filter((f) => f.phase === ph);
          if (!list.length) return null;
          return (
            <fieldset key={ph} className="min-w-0 rounded-xl border border-border p-4">
              <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{phaseLabel(ph)}</legend>
              <div className="space-y-3">{list.map((f) => <ScoutFieldInput key={f.id} idPrefix="preview" f={f} value={data[f.id]} onChange={(v) => setData((d) => ({ ...d, [f.id]: v }))} />)}</div>
            </fieldset>
          );
        })}
        {!usable.length && <p className="text-sm text-muted-foreground">No fields: members would fill in notes only.</p>}
      </div>
    </div>
  );
}
