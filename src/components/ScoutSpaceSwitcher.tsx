// The Scout page's space switcher: Personal | each Control Point workspace the account belongs to.
// A segmented control (it scrolls sideways on a phone) for a few spaces, a dropdown for many.
// Each space shows its role ("admin") and, when entries wait to sync there, how many.
// Next to it, a manual refresh (Task 12): a fallback the live stream should make unnecessary.
import { useRef, useState } from "react";
import { Lock, RefreshCw } from "lucide-react";
import SegmentedControl from "./arc/segmented-control/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/controls";
import { Button } from "./ui/button";
import { cn } from "./cn";
import { useNow } from "../lib/useNow";
import { PERSONAL_PARAM, spaceParam, workspaceLabel, type WorkspaceSpace } from "../lib/scoutSpace";
import type { PendingScoutCounts, ScoutSpace } from "../lib/scouting";

/** More workspaces than this: a dropdown instead of the segmented control. */
export const SEGMENTED_MAX_WORKSPACES = 4;

function Extras({ role, readOnly, pending, active }: { role?: WorkspaceSpace["role"]; readOnly?: boolean; pending: number; active: boolean }) {
  return (
    <>
      {/* A read-only space (Task 19): deleted in Control Point, or no admin left. Its role no longer lets anyone change it. */}
      {readOnly ? <span className="inline-flex items-center gap-0.5 text-[11px] font-normal text-muted-foreground"><Lock className="size-3" aria-hidden />read-only</span>
        : role === "admin" && <span className="text-[11px] font-normal text-muted-foreground">admin</span>}
      {/* The space on screen shows its own sync state in the header; the others, only a count. */}
      {pending > 0 && !active && (
        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warning/15 px-1.5 text-[11px] font-medium tabular-nums text-warning">
          {pending}<span className="sr-only"> pending</span>
        </span>
      )}
    </>
  );
}

/** "Updated just now", then "Updated 3 min ago" (on the app's shared 30 s clock). */
export function updatedLabel(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  return min < 1 ? "Updated just now" : min < 60 ? `Updated ${min} min ago` : "Updated over an hour ago";
}

function UpdatedText({ at }: { at: number }) {
  const now = Math.max(useNow(), at);
  return <>{updatedLabel(at, now)}</>;
}

/**
 * Refresh the space on screen now: push its queue, pull what's new, re-read the account (its
 * workspaces and roles) and reconnect the live stream (ScoutPage's refreshSpace). `onRefresh`
 * resolves true when the push and pull went through.
 */
function RefreshButton({ onRefresh }: { onRefresh: () => Promise<boolean> }) {
  const [state, setState] = useState<{ busy: boolean; at: number | null; failed: boolean }>({ busy: false, at: null, failed: false });
  const busy = useRef(false);
  const refresh = async () => {
    if (busy.current) return;
    busy.current = true;
    setState((s) => ({ ...s, busy: true }));
    let ok = false;
    try { ok = await onRefresh(); } catch { ok = false; }
    busy.current = false;
    setState((s) => ({ busy: false, at: ok ? Date.now() : s.at, failed: !ok }));
  };
  return (
    <>
      <Button type="button" variant="outline" size="icon" onClick={refresh} aria-busy={state.busy || undefined}
        aria-label="Refresh this space" title="Refresh this space">
        <RefreshCw className={cn("size-4", state.busy && "animate-spin motion-reduce:animate-none")} />
      </Button>
      <span role="status" className="col-span-2 min-h-4 text-right text-xs text-muted-foreground empty:hidden sm:col-span-1 sm:text-left">
        {state.busy ? "Updating…" : state.failed ? <span className="text-warning">Couldn't update. Check your connection.</span> : state.at != null ? <UpdatedText at={state.at} /> : null}
      </span>
    </>
  );
}

export function ScoutSpaceSwitcher({ workspaces, space, pending, onSelect, onRefresh, className }: {
  workspaces: WorkspaceSpace[];
  space: ScoutSpace;
  pending: PendingScoutCounts;
  onSelect: (space: ScoutSpace) => void;
  /** The manual refresh; no button without it (the account isn't confirmed yet, e.g. opened offline). */
  onRefresh?: () => Promise<boolean>;
  className?: string;
}) {
  const value = spaceParam(space);
  const choose = (v: string) => onSelect(v === PERSONAL_PARAM ? null : v);
  const count = (id: string | null) => (id == null ? pending.personal : pending.workspaces[id] ?? 0);
  const spaces = [{ id: null as string | null, name: "Personal", role: undefined as WorkspaceSpace["role"] | undefined, readOnly: false },
    ...workspaces.map((w) => ({ id: w.id as string | null, name: workspaceLabel(w), role: w.role, readOnly: !!w.orphaned }))];

  const control = workspaces.length > SEGMENTED_MAX_WORKSPACES ? (
    <Select value={value} onValueChange={choose}>
      <SelectTrigger aria-label="Scout space" className={cn("h-10 w-full max-w-xs rounded-lg border-border bg-card font-medium sm:w-72", !onRefresh && className)}><SelectValue /></SelectTrigger>
      <SelectContent className="min-w-[16rem]">
        {spaces.map((s) => (
          <SelectItem key={spaceParam(s.id)} value={spaceParam(s.id)} className="max-sm:py-2.5">
            <span className="inline-flex min-w-0 items-center gap-2"><span className="truncate">{s.name}</span><Extras role={s.role} readOnly={s.readOnly} pending={count(s.id)} active={s.id === space} /></span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : (
    <SegmentedControl label="Scout space" value={value} onValueChange={choose}
      className={cn("max-w-full max-sm:[&_button]:min-h-10", !onRefresh && className)}
      options={spaces.map((s) => ({ value: spaceParam(s.id), label: s.name, accessory: <Extras role={s.role} readOnly={s.readOnly} pending={count(s.id)} active={s.id === space} /> }))} />
  );
  if (!onRefresh) return control;
  // Phone: the switcher (it scrolls sideways) and the button share a row; the status goes under them.
  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 sm:flex sm:flex-wrap", className)}>
      <div className="min-w-0">{control}</div>
      {/* One per space: a result (or a request still on its way) never shows under another space. */}
      <RefreshButton key={value} onRefresh={onRefresh} />
    </div>
  );
}
