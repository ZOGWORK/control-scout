// The pick list's notice for order changes that didn't reach the workspace (sharedPicklist.ts, picklistOps.ts): kept
// on this device, often from before a reload. It says how many, what each one is, and what a Retry found: someone
// changed the list since (what was added, removed and moved), a team it was placed next to is gone, or the change
// can't be sent as things are (another account, no access, read-only). Nothing is sent or dropped until the member
// chooses: Retry (or Apply mine anyway after reviewing a conflict) and Discard are both explicit.
import { useId } from "react";
import { ArrowUpDown, CircleAlert, Copy, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { describeChange, failedMessage, NOT_SENT_BEFORE_RELOAD, type FailedChange } from "../../lib/sharedPicklist";
import { describeConflict } from "../../lib/picklistConflict";
import { Button } from "../ui/button";
import { cn } from "../cn";

const OP_ICON = { add: Plus, remove: Trash2, move: ArrowUpDown, import: Copy } as const;
const BLOCKED_SHORT = { account: "Made by another account: not sent.", revoked: "That workspace is out of reach: not sent.", readonly: "That workspace is read-only: not sent." } as const;

/** One row's line: what a Retry found, else why it's waiting (short: the notice's summary says the rest). */
function rowNote(f: FailedChange): string {
  if (f.conflict) return describeConflict(f.conflict);
  if (f.blocked) return BLOCKED_SHORT[f.blocked];
  return f.message === NOT_SENT_BEFORE_RELOAD ? "Not sent yet." : f.message;
}

/** Colour-coded team chips: what someone else changed. */
function Chips({ teams, sign, tone, what }: { teams: number[]; sign: string; tone: string; what: string }) {
  if (!teams.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="sr-only">{what}:</span>
      {teams.slice(0, 8).map((t) => <span key={t} className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", tone)}><span aria-hidden>{sign}</span>{t}</span>)}
      {teams.length > 8 && <span className="text-[11px] text-text-muted">+{teams.length - 8} more</span>}
    </span>
  );
}

function Row({ f, readOnly, onRetry, onDiscard }: { f: FailedChange; readOnly: boolean; onRetry: (force: boolean) => void; onDiscard: () => void }) {
  const Icon = OP_ICON[f.op.op];
  const c = f.conflict;
  const canApply = !readOnly && !f.blocked && c?.kind !== "gone";
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5" data-kept-change={f.opId ?? f.id}>
      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", c || f.blocked ? "bg-warning/15 text-warning" : "bg-accent/15 text-accent-text")} aria-hidden><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{describeChange(f.op)}</p>
        <p className="text-xs text-text-muted">{rowNote(f)}</p>
        {c?.kind === "changed" && (
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <Chips teams={c.added} sign="+" tone="bg-success/15 text-success" what="Added since" />
            <Chips teams={c.removed} sign="−" tone="bg-destructive/15 text-destructive" what="Removed since" />
            <Chips teams={c.moved} sign="↕" tone="bg-accent/15 text-accent-text" what="Moved since" />
          </p>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {canApply && (
          <Button variant="secondary" size="sm" className="max-sm:h-11" disabled={f.busy} onClick={() => onRetry(!!c)}
            aria-label={`${c ? "Apply anyway" : "Retry"}: ${describeChange(f.op)}`}>
            {f.busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} {c ? "Apply anyway" : "Retry"}
          </Button>
        )}
        <Button variant="outline" size="sm" className="max-sm:h-11" disabled={f.busy} onClick={onDiscard} aria-label={`Discard: ${describeChange(f.op)}`}>
          <Trash2 /> Discard
        </Button>
      </div>
    </li>
  );
}

export function KeptPickChanges({ changes, readOnly = false, onRetryAll, onDiscardAll, onRetry, onDiscard }: {
  changes: FailedChange[]; readOnly?: boolean;
  onRetryAll: (force: boolean) => void; onDiscardAll: () => void;
  onRetry: (id: number, force: boolean) => void; onDiscard: (id: number) => void;
}) {
  const headingId = useId();
  if (!changes.length) return null;
  const n = changes.length;
  const sorted = [...changes].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.id - b.id);
  const busy = changes.some((f) => f.busy);
  const reviewing = changes.some((f) => f.conflict && f.conflict.kind !== "gone");
  const sendable = changes.filter((f) => !f.blocked && f.conflict?.kind !== "gone");
  const blocked = changes.find((f) => f.blocked);
  const allStored = changes.every((f) => f.stored);
  const summary = readOnly
    ? "This workspace is read-only now, so nothing is sent. They're kept on this device until it can be written again, or you discard them."
    : busy ? "Checking the pick list and sending…"
    : reviewing ? (changes.some((f) => f.conflict?.kind === "changed")
      ? "The pick list changed since you made these. Review what changed, then apply yours to the list as it is now, or discard them."
      : "A team one of these was placed next to has been removed. Applied now, it goes next to the nearest team that's still there.")
    : blocked && !sendable.length ? failedMessage(blocked)
    : `${changes.some((f) => f.restored) ? "Kept on this device from before the page reloaded." : "These didn't reach the workspace."} Nothing is sent until you choose: Retry checks the list first and sends each change once.${allStored ? "" : " This device couldn't keep a copy of some, so a reload loses them."}`;
  return (
    <section aria-labelledby={headingId} className="mb-3 rounded-2xl border border-warning/40 bg-warning/[0.08] p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1 basis-56">
          <h3 id={headingId} className="text-sm font-semibold">{n} unsaved pick-list change{n === 1 ? "" : "s"}</h3>
          <p className="mt-0.5 text-sm text-text-muted" aria-live="polite">{summary}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!readOnly && sendable.length > 0 && (
            <Button size="sm" className="max-sm:h-11" disabled={busy} onClick={() => onRetryAll(reviewing)}>
              {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} {reviewing ? "Apply mine anyway" : "Retry"}
            </Button>
          )}
          <Button variant="outline" size="sm" className="max-sm:h-11" disabled={busy} onClick={onDiscardAll}>
            <Trash2 /> {reviewing ? "Discard mine" : n === 1 ? "Discard" : "Discard all"}
          </Button>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-label="Unsaved changes">
        {sorted.map((f) => <Row key={f.id} f={f} readOnly={readOnly} onRetry={(force) => onRetry(f.id, force)} onDiscard={() => onDiscard(f.id)} />)}
      </ul>
    </section>
  );
}
