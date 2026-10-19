// The state of one piece of shared work (src/lib/pendingWork.ts): Draft, Saving, Saved or Needs attention.
// Small and quiet while things are fine (muted text, nothing at all once "Saved" has had its moment); amber and
// plain-spoken when the member has to decide something. The wrapper is always in the page and polite, so a
// screen reader hears each change ("Note on 16236: saved") without being interrupted.
import { CircleAlert, Check, Loader2, PencilLine } from "lucide-react";
import type { SaveState } from "../lib/pendingWork";
import { cn } from "./cn";

export const SAVE_STATE_TEXT: Record<SaveState, string> = { draft: "Draft", saving: "Saving…", saved: "Saved", attention: "Needs attention" };

export function SaveStatus({ state, what, className, text }: {
  /** null: nothing to say (the calm state). */
  state: SaveState | null;
  /** What it's about, for a screen reader ("Note on 16236"). */
  what: string;
  className?: string;
  /** Visible text instead of the state's own word. */
  text?: string;
}) {
  return (
    <span aria-live="polite" aria-atomic="true" className={cn("inline-flex min-w-0 items-center", className)} data-save-state={state ?? undefined}>
      {state && (
        <span className={cn("inline-flex min-w-0 items-center gap-1 text-[11px] leading-4",
          state === "attention" ? "rounded-full bg-warning/15 px-1.5 py-px font-medium text-warning ring-1 ring-warning/50" : "text-text-muted")}>
          {state === "draft" ? <PencilLine className="size-3 shrink-0" aria-hidden />
            : state === "saving" ? <Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            : state === "saved" ? <Check className="size-3 shrink-0 text-success" aria-hidden />
            : <CircleAlert className="size-3 shrink-0" aria-hidden />}
          <span className="sr-only">{what}: </span>
          <span className="truncate">{text ?? SAVE_STATE_TEXT[state]}</span>
        </span>
      )}
    </span>
  );
}
