// The workspace picker behind "My teams" (more than one Control Point workspace): each workspace with
// the account's role there and how many entries wait to sync; choosing one opens its scout space.
// A popover beside the sidebar row on desktop, a bottom sheet on phones.
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check, ChevronRight, Star } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/overlay";
import { usePendingScoutCounts } from "../../lib/scouting";
import { scoutSpaceHref, workspaceLabel, type WorkspaceSpace } from "../../lib/scoutSpace";
import { FOLLOWED_TEAM_PATH } from "../../lib/yoursRow";
import { cn } from "../cn";

const TITLE = "Your teams";
const DESCRIPTION = "Pick a workspace to open its shared scout space.";

export function WorkspaceList({ workspaces, onChoose }: { workspaces: WorkspaceSpace[]; onChoose: () => void }) {
  const pending = usePendingScoutCounts();
  const loc = useLocation();
  const current = /^\/scout\/?$/i.test(loc.pathname) ? new URLSearchParams(loc.search).get("space") : null;
  return (
    <div className="space-y-3">
      <ul className="space-y-1" aria-label="Workspaces">
        {workspaces.map((w) => {
          const n = pending.workspaces[w.id] ?? 0;
          const here = current === w.id;
          return (
            <li key={w.id}>
              <Link to={scoutSpaceHref(w.id)} onClick={onChoose} aria-current={here ? "page" : undefined}
                className={cn("flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 outline-none hover:bg-text-base/[0.05] focus-visible:ring-2 focus-visible:ring-ring/60",
                  here && "bg-accent/10")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-base">{workspaceLabel(w)}</span>
                  <span className="block text-xs text-text-muted">{w.role === "admin" ? "Admin" : "Member"}</span>
                </span>
                {n > 0 && (
                  <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warning/15 px-1.5 text-[11px] font-medium tabular-nums text-warning">
                    {n}<span className="sr-only"> pending</span>
                  </span>
                )}
                {here ? <Check className="size-4 shrink-0 text-accent" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-text-muted" aria-hidden />}
              </Link>
            </li>
          );
        })}
      </ul>
      <Link to={FOLLOWED_TEAM_PATH} onClick={onChoose} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs text-text-muted hover:bg-text-base/[0.05] hover:text-text-base">
        <Star className="size-3.5" aria-hidden /> My followed team
      </Link>
    </div>
  );
}

/** Desktop: a popover beside the sidebar row (`children` is the row, the trigger). */
export function WorkspacePickerPopover({ workspaces, open, onOpenChange, children }: { workspaces: WorkspaceSpace[]; open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="right" align="start" collisionPadding={8} className="max-h-[var(--radix-popover-content-available-height)] w-80 overflow-y-auto p-3">
        <p className="px-1 font-display text-base font-semibold">{TITLE}</p>
        <p className="mb-2 px-1 text-xs text-text-muted">{DESCRIPTION}</p>
        <WorkspaceList workspaces={workspaces} onChoose={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** Phones: a bottom sheet. */
export function WorkspacePickerSheet({ workspaces, open, onOpenChange }: { workspaces: WorkspaceSpace[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="gap-2 p-4 pt-5">
        <SheetTitle className="font-display text-base">{TITLE}</SheetTitle>
        <SheetDescription className="text-xs">{DESCRIPTION}</SheetDescription>
        <WorkspaceList workspaces={workspaces} onChoose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
