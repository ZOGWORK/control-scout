// Owner console panels with a filter (a period, a queue, live or backtest) ask a new path on each pick. Without
// help, Async drops to a loading block (or an error) and every folded section inside unmounts, closing any the
// owner had opened. useKeepLast keeps the last answer on screen until the new one lands; KeptLast dims and
// disables it meanwhile, so it's never read or acted on as the new pick, and if the new answer fails it stays
// (dimmed) under the error with a Try again, instead of being replaced by the error.
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
  return (
    <>
      {failed && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/[0.06] px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">Couldn't load that view ({failed.message}). The last one is shown, dimmed.</span>
          <Button size="sm" variant="outline" className="max-sm:h-10" onClick={onRetry}><RotateCcw /> Try again</Button>
        </div>
      )}
      <div aria-busy={(stale && !failed) || undefined} data-stale={stale || undefined} className={cn("transition-opacity", stale && "pointer-events-none opacity-50")}>
        {children}
      </div>
    </>
  );
}
