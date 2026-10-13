// Loading / error / empty states — every page uses these, so no page ever
// shows a blank screen or a raw error.
import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw, Search, SearchX, WifiOff } from "lucide-react";
import { useSearch } from "./layout/Search";
import { Button } from "./ui/button";
import { EmptyState } from "./page";
import type { ApiError, ApiState } from "../lib/api";
import { cn } from "./cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton h-4", className)} />;
}

/** A page-shaped placeholder while the first data loads. */
export function LoadingBlock({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      <Skeleton className="h-8 w-1/3" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: ApiError | Error; onRetry?: () => void; className?: string }) {
  const offline = (error as ApiError).offline;
  const status = (error as ApiError).status;
  const search = useSearch();
  const missing = status === 404 || status === 400;
  return (
    <EmptyState
      className={className}
      icon={offline ? WifiOff : missing ? SearchX : AlertTriangle}
      title={offline ? "You're offline" : status === 404 ? "Not found" : status === 400 ? "That isn't valid" : "Couldn't load this"}
      description={offline ? "This page needs a connection. Predictions still work offline from a downloaded lite pack (see Download)." : error.message}
      // A bad or missing address won't fix itself: no "Try again" for 400/404.
      // A missing or bad address can't be retried: offer the way forward instead.
      action={missing ? <Button variant="secondary" onClick={search.open}><Search /> Search teams and events</Button>
        : onRetry ? <Button variant="secondary" onClick={onRetry}><RefreshCw /> Try again</Button> : undefined}
    />
  );
}

/** Render loading → error → empty → content for an API state. */
export function Async<T>({ state, empty, children, loading }: {
  state: ApiState<T>;
  /** Return a node when the data counts as empty. */
  empty?: (data: T) => ReactNode | null | false;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data === undefined) return <>{loading ?? <LoadingBlock />}</>;
  const e = empty?.(state.data);
  if (e) return <>{e}</>;
  return <>{children(state.data)}</>;
}
