// Owner console panels with a filter (a period, a queue, live or backtest) ask a new path on each pick. Without
// help, Async drops to a loading block (or an error) and every folded section inside unmounts, closing any the
// owner had opened. useKeepLast keeps the last answer on screen until the new one lands. While it loads, KeptLast
// dims it and makes it inert (no mouse, no keyboard), so it's never acted on as the new pick. If the new answer
// fails, the last one stays usable under the error with a Try again: callers label and press their controls from
// the answer shown (its own period, queue or kind), never from the failed pick, so what's on screen is true.
import { useRef, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../cn";
import type { ApiState } from "../../lib/api";

export function useKeepLast<T>(state: ApiState<T>) {
  const last = useRef<T | undefined>(undefined);
  if (state.data !== undefined) last.current = state.data;
  const kept = state.data === undefined ? last.current : undefined;
  return {
    /** The state to hand Async: the kept answer stands in while the new one loads or fails. */
    shown: kept === undefined ? state : { ...state, data: kept, error: undefined },
    /** On screen is the last pick's answer: the new one is loading or failed. */
    stale: kept !== undefined,
    /** The new pick's error, shown above the kept answer. */
    failed: kept === undefined ? undefined : state.error,
  };
}

export function KeptLast({ stale, failed, onRetry, children }: { stale: boolean; failed?: { message: string }; onRetry: () => void; children: ReactNode }) {
  const loading = stale && !failed;
  return (
    <>
      {failed && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/[0.06] px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">Couldn't load that view ({failed.message}). The last one is shown below.</span>
          <Button size="sm" variant="outline" className="max-sm:h-10" onClick={onRetry}><RotateCcw /> Try again</Button>
        </div>
      )}
      <div aria-busy={loading || undefined} inert={loading || undefined} data-stale={stale || undefined} className={cn("transition-opacity", loading && "pointer-events-none opacity-50")}>
        {children}
      </div>
    </>
  );
}
