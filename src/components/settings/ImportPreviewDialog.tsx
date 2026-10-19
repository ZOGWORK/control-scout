// The import preview (audit E3): opens once a file is chosen in Settings › Scouting, before anything is written.
// It counts the file's valid, already-here and invalid rows, ties each reason to its row, says exactly what
// Import will do (add, update, skip) and what happens to entries the file doesn't mention, and offers a backup
// before anything here is replaced. Cancel (the button, Esc, the close button) writes nothing.
import { useId, useState, type ComponentType, type ReactNode } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, Download, FileJson, Plus, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { Button } from "../ui/button";
import { RadioGroup, RadioGroupItem } from "../ui/controls";
import { cn } from "../cn";
import { downloadScoutBackup, importPlan, replaces, rowName, type DuplicateAge, type DuplicatePolicy, type DuplicateRow, type ImportPreview } from "../../lib/scoutImport";

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** Lists longer than this show their first rows, and the rest behind "Show all". */
const SHOWN = 5;

const AGE: Record<DuplicateAge, string> = {
  newer: "file's copy is newer",
  older: "file's copy is older",
  same: "same as the copy here",
  undated: "file's copy has no date",
};

type Tone = "success" | "info" | "danger" | "muted";
const TONE: Record<Tone, string> = {
  success: "border-success/35 bg-success/10 text-success",
  info: "border-info/35 bg-info/10 text-info",
  danger: "border-danger/35 bg-danger/10 text-danger",
  muted: "border-line bg-text-base/[0.04] text-text-muted",
};

function Stat({ tone, icon: Icon, value, label, detail }: { tone: Tone; icon: ComponentType<{ className?: string }>; value: number; label: string; detail?: string }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2.5", TONE[tone])}>
      <dt className="flex items-center gap-1.5 text-xs font-semibold"><Icon className="size-3.5" aria-hidden />{label}</dt>
      <dd className="mt-0.5 font-display text-2xl font-bold tabular-nums text-text-base">{value}</dd>
      {detail && <dd className="text-xs text-text-muted">{detail}</dd>}
    </div>
  );
}

/** A list of rows: the first few, then the rest behind a native disclosure (keyboard operable, announced as expandable). */
function RowList<T>({ title, tone, items, render }: { title: string; tone: Tone; items: T[]; render: (t: T) => ReactNode }) {
  const id = useId();
  if (!items.length) return null;
  const head = items.length > SHOWN + 1 ? items.slice(0, SHOWN) : items;
  const rest = items.slice(head.length);
  const li = (t: T, i: number) => <li key={i} className="py-1.5 text-sm text-text-base">{render(t)}</li>;
  return (
    <section aria-labelledby={id} className="rounded-xl border border-line">
      <h3 id={id} className={cn("flex items-center gap-2 rounded-t-xl border-b px-3 py-2 text-sm font-semibold", TONE[tone])}>
        {title} <span className="tabular-nums">({items.length})</span>
      </h3>
      <ul className="divide-y divide-line px-3">{head.map(li)}</ul>
      {rest.length > 0 && (
        <details className="group border-t border-line">
          <summary className="cursor-pointer rounded-b-xl px-3 py-2 text-sm font-medium text-accent-text hover:bg-text-base/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            <span className="group-open:hidden">Show {rest.length} more</span><span className="hidden group-open:inline">Hide {rest.length}</span>
          </summary>
          <ul className="divide-y divide-line px-3">{rest.map((t, i) => li(t, i + head.length))}</ul>
        </details>
      )}
    </section>
  );
}

const rowHead = (r: { row: number; label: string }) => <span className="font-medium tabular-nums">{rowName(r)}</span>;

export function ImportPreviewDialog({ open, fileName, preview, onCancel, onImport }: {
  open: boolean;
  fileName: string;
  preview: ImportPreview;
  onCancel: () => void;
  onImport: (policy: DuplicatePolicy) => void;
}) {
  const [policy, setPolicy] = useState<DuplicatePolicy>("newer");
  // The preview a backup was taken for: when entries here change (the preview is rebuilt), that backup may lack
  // what Import would now replace, so it no longer counts and the offer comes back.
  const [backedUpFor, setBackedUpFor] = useState<ImportPreview | null>(null);
  const backedUp = backedUpFor === preview;
  const plan = importPlan(preview, policy);
  const p = preview;
  const valid = p.fresh.length + p.duplicates.length;
  const ages = (["newer", "older", "same", "undated"] as const).map((a) => [a, p.duplicates.filter((d) => d.age === a).length] as const).filter(([, k]) => k);
  const differing = p.duplicates.some((d) => d.age !== "same");
  const total = plan.add + plan.update;
  const policyId = useId();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-xl gap-5" data-import-preview="">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileJson className="size-5 text-accent" aria-hidden /> Review this import</DialogTitle>
          <DialogDescription>
            <span className="break-all font-medium text-text-base">{fileName}</span> · {n(p.total, "row")}. Nothing on this device has changed yet.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-3 gap-2">
          <Stat tone="success" icon={CheckCircle2} value={valid} label="Valid" detail={p.fresh.length ? `${p.fresh.length} new` : undefined} />
          <Stat tone="info" icon={Copy} value={p.duplicates.length} label="Already here" detail={ages.map(([a, k]) => `${k} ${a}`).join(" · ") || undefined} />
          <Stat tone={p.invalid.length ? "danger" : "muted"} icon={AlertTriangle} value={p.invalid.length} label="Invalid" detail={p.invalid.length ? "left out" : undefined} />
        </dl>

        {differing && (
          <fieldset className="grid gap-2">
            <legend id={policyId} className="mb-2 text-sm font-semibold text-text-base">Entries already on this device</legend>
            <RadioGroup aria-labelledby={policyId} value={policy} onValueChange={(v) => setPolicy(v as DuplicatePolicy)} className="gap-1.5">
              {([
                ["newer", "Keep whichever copy is newer", "Recommended. Replaces a copy here only when the file's is newer."],
                ["file", "Use the file's copy", "Replaces every copy here that differs, newer or not."],
              ] as const).map(([v, label, hint]) => (
                <label key={v} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors", policy === v ? "border-accent/60 bg-accent-soft" : "border-line hover:bg-text-base/[0.04]")}>
                  <RadioGroupItem value={v} className="mt-0.5" aria-describedby={`${policyId}-${v}`} />
                  <span className="grid gap-0.5"><span className="text-sm font-medium text-text-base">{label}</span><span id={`${policyId}-${v}`} className="text-xs text-text-muted">{hint}</span></span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        )}

        <section aria-label="What Import will do" className="rounded-xl border border-line bg-text-base/[0.03] p-3">
          <h3 className="text-sm font-semibold text-text-base">Import will</h3>
          <ul className="mt-2 grid gap-1.5 text-sm">
            <li className="flex items-center gap-2"><Plus className="size-4 text-success" aria-hidden /><span><b className="tabular-nums">Add {plan.add}</b> new {plan.add === 1 ? "entry" : "entries"}</span></li>
            <li className="flex items-center gap-2"><RefreshCw className="size-4 text-info" aria-hidden /><span><b className="tabular-nums">Update {plan.update}</b> already here{plan.update ? ", replacing the copy on this device" : ""}</span></li>
            <li className="flex items-center gap-2"><AlertTriangle className={cn("size-4", plan.skip ? "text-warning" : "text-text-muted")} aria-hidden /><span><b className="tabular-nums">Skip {plan.skip}</b>
              {plan.skip ? ` (${[p.invalid.length && `${p.invalid.length} invalid`, plan.keep && `${plan.keep} kept as here`, p.deletedInFile.length && `${p.deletedInFile.length} deleted in the file`].filter(Boolean).join(", ")})` : ""}</span></li>
          </ul>
          <p className="mt-3 flex items-start gap-2 text-xs text-text-muted">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" aria-hidden />
            <span>Import merges. {p.untouched ? `Your ${n(p.untouched, "other entry", "other entries")} on this device ${p.untouched === 1 ? "isn't" : "aren't"} in the file and ${p.untouched === 1 ? "stays" : "stay"} as ${p.untouched === 1 ? "it is" : "they are"}.` : "Nothing here is removed."} Entries go to your personal notes; workspace entries aren't touched.</span>
          </p>
        </section>

        {plan.update > 0 && (
          <div role="note" className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 sm:flex-row sm:items-center">
            <p className="text-sm text-text-base sm:min-w-0 sm:flex-1">
              <b>{n(plan.update, "entry", "entries")}</b> on this device will be replaced. A backup lets you put {plan.update === 1 ? "it" : "them"} back.
            </p>
            <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={() => { downloadScoutBackup(); setBackedUpFor(preview); }}>
              {backedUp ? <><Check className="text-success" /> Backup downloaded</> : <><Download /> Download a backup first</>}
            </Button>
          </div>
        )}

        <div className="grid gap-3">
          <RowList title="Invalid rows, left out" tone="danger" items={p.invalid} render={(r) => <>{rowHead(r)}: <span className="text-danger">{r.reason}</span></>} />
          <RowList title="Already on this device" tone="info" items={p.duplicates} render={(d: DuplicateRow) => (
            <>{rowHead(d)}: <span className="text-text-muted">{AGE[d.age]}{d.deletedHere ? " (deleted here)" : ""}</span>{" "}
              <span className={cn("ml-1 inline-block rounded-full px-2 text-xs font-semibold", replaces(d, policy) ? "bg-info/15 text-info" : "bg-text-base/[0.06] text-text-muted")}>
                {replaces(d, policy) ? "will update" : "kept as here"}
              </span></>
          )} />
          <RowList title="Marked deleted in the file, left out" tone="muted" items={p.deletedInFile} render={(r) => rowHead(r)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onImport(policy)} disabled={!total}>
            <Upload /> {total ? `Import ${n(total, "entry", "entries")}` : "Nothing to import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
