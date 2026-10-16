// The Scout page's space switcher: Personal | each Control Point workspace the account belongs to.
// A segmented control (it scrolls sideways on a phone) for a few spaces, a dropdown for many.
// Each space shows its role ("admin") and, when entries wait to sync there, how many.
import SegmentedControl from "./arc/segmented-control/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/controls";
import { cn } from "./cn";
import { PERSONAL_PARAM, spaceParam, workspaceLabel, type WorkspaceSpace } from "../lib/scoutSpace";
import type { PendingScoutCounts, ScoutSpace } from "../lib/scouting";

/** More workspaces than this: a dropdown instead of the segmented control. */
export const SEGMENTED_MAX_WORKSPACES = 4;

function Extras({ role, pending, active }: { role?: WorkspaceSpace["role"]; pending: number; active: boolean }) {
  return (
    <>
      {role === "admin" && <span className="text-[11px] font-normal text-muted-foreground">admin</span>}
      {/* The space on screen shows its own sync state in the header; the others, only a count. */}
      {pending > 0 && !active && (
        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warning/15 px-1.5 text-[11px] font-medium tabular-nums text-warning">
          {pending}<span className="sr-only"> pending</span>
        </span>
      )}
    </>
  );
}

export function ScoutSpaceSwitcher({ workspaces, space, pending, onSelect, className }: {
  workspaces: WorkspaceSpace[];
  space: ScoutSpace;
  pending: PendingScoutCounts;
  onSelect: (space: ScoutSpace) => void;
  className?: string;
}) {
  const value = spaceParam(space);
  const choose = (v: string) => onSelect(v === PERSONAL_PARAM ? null : v);
  const count = (id: string | null) => (id == null ? pending.personal : pending.workspaces[id] ?? 0);
  const spaces = [{ id: null as string | null, name: "Personal", role: undefined as WorkspaceSpace["role"] | undefined },
    ...workspaces.map((w) => ({ id: w.id as string | null, name: workspaceLabel(w), role: w.role }))];

  if (workspaces.length > SEGMENTED_MAX_WORKSPACES) {
    return (
      <Select value={value} onValueChange={choose}>
        <SelectTrigger aria-label="Scout space" className={cn("h-10 w-full max-w-xs rounded-lg border-border bg-card font-medium sm:w-72", className)}><SelectValue /></SelectTrigger>
        <SelectContent className="min-w-[16rem]">
          {spaces.map((s) => (
            <SelectItem key={spaceParam(s.id)} value={spaceParam(s.id)} className="max-sm:py-2.5">
              <span className="inline-flex min-w-0 items-center gap-2"><span className="truncate">{s.name}</span><Extras role={s.role} pending={count(s.id)} active={s.id === space} /></span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <SegmentedControl label="Scout space" value={value} onValueChange={choose}
      className={cn("max-w-full max-sm:[&_button]:min-h-10", className)}
      options={spaces.map((s) => ({ value: spaceParam(s.id), label: s.name, accessory: <Extras role={s.role} pending={count(s.id)} active={s.id === space} /> }))} />
  );
}
