// Owner console panels with a filter (a period, a queue, live or backtest) ask a new path on each pick. Without
// help, Async drops to a loading block (or an error) and every folded section inside unmounts, closing any the
// owner had opened. useKeepLast keeps the last answer on screen until the new one lands; KeptLast dims it and makes it
// inert (no mouse, no keyboard) meanwhile, so it's never acted on as the new pick. If the new answer fails it stays
// inert under the error, with Try again (the failed pick) and Go back (the pick the kept answer is for, cached, so
// it's back at once and usable). Callers label the kept answer from its own period, queue or kind, never the pick.
import { useRef, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Undo2 } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../cn";
import type { ApiState } from "../../lib/api";

/** `pick`: the filter's current choice; `keptPick` is the choice the kept answer came from (for Go back). */
export function useKeepLast<T, P>(state: ApiState<T>, pick: P) {
  const last = useRef<T | undefined>(undefined);
  const lastPick = useRef<P>(pick);
  if (state.data !== undefined) { last.current = state.data; lastPick.current = pick; }
  const kept = state.data === undefined ? last.current : undefined;
  return {
    /** The state to hand Async: the kept answer stands in while the new one loads or fails. */
    shown: kept === undefined ? state : { ...state, data: kept, error: undefined },
    /** On screen is the last pick's answer: the new one is loading or failed. */
    stale: kept !== undefined,
    /** The new pick's error, shown above the kept answer. */
    failed: kept === undefined ? undefined : state.error,
    keptPick: lastPick.current,
  };
}

export function KeptLast({ stale, failed, onRetry, onBack, children }: {
  stale: boolean; failed?: { message: string }; onRetry: () => void;
  /** Return to the pick the kept answer is for. */
  onBack: () => void; children: ReactNode;
}) {
  return (
    <>
      {failed && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/[0.06] px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">Couldn't load that view ({failed.message}). The last one is shown below, dimmed.</span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" className="max-sm:h-10" onClick={onRetry}><RotateCcw /> Try again</Button>
            <Button size="sm" variant="secondary" className="max-sm:h-10" onClick={onBack}><Undo2 /> Go back</Button>
          </span>
        </div>
      )}
      <div aria-busy={(stale && !failed) || undefined} inert={stale || undefined} data-stale={stale || undefined} className={cn("transition-opacity", stale && "pointer-events-none opacity-50")}>
        {children}
      </div>
    </>
  );
}
