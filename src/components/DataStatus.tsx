// A season's data status in one line: when its results were last synced, whether
// the statistics built from them are prepared, and, only while they're out of step,
// a plain sentence and a way to check again. Healthy pages get the line, never a panel.
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SeasonReadiness } from "../shared/home";
import { ago } from "../lib/format";
import { fullTime, readinessView } from "../lib/readiness";
import { cn } from "./cn";

const MIN_CHECK_MS = 600;

/** A relative time with its full value (time zone included) as the title and for screen readers. */
export function Stamp({ iso }: { iso: string }) {
  const full = fullTime(iso);
  return (
    <time dateTime={iso} title={full}>
      <span aria-hidden>{ago(iso)}</span><span className="sr-only">{full}</span>
    </time>
  );
}

export function DataStatus({ readiness, fallbackResultsAt, onRetry, className }: {
  readiness: SeasonReadiness | null | undefined;
  /** When the season has no sync time of its own (e.g. an older database), the last sync of any season. */
  fallbackResultsAt?: string | null;
  /** Asks again; the button shows it's checking until this settles. */
  onRetry?: () => Promise<unknown> | void;
  className?: string;
}) {
  const v = readinessView(readiness);
  const resultsAt = readiness?.resultsAt ?? fallbackResultsAt ?? null;
  const statsAt = readiness?.statsAt ?? null;
  // Spins until the answer is in, and at least a moment, so a fast answer still shows it was asked.
  const [checking, setChecking] = useState(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const check = () => {
    if (!onRetry || checking) return;
    setChecking(true);
    void Promise.all([onRetry(), new Promise((r) => setTimeout(r, MIN_CHECK_MS))]).finally(() => { if (live.current) setChecking(false); });
  };
  return (
    <div className={cn("text-xs text-text-muted", className)}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
          v.tone === "ok" ? "bg-success/12 text-success" : "bg-warning/15 text-warning")}>
          <span className={cn("size-1.5 rounded-full", v.tone === "ok" ? "bg-success" : "bg-warning motion-safe:animate-pulse")} aria-hidden />
          {v.label}
        </span>
        <span>Results synced {resultsAt ? <Stamp iso={resultsAt} /> : "not yet"}</span>
        {statsAt && <span aria-hidden>·</span>}
        {statsAt && <span>statistics prepared <Stamp iso={statsAt} /></span>}
        {v.retry && onRetry && (
          <button type="button" onClick={check} aria-disabled={checking} aria-busy={checking}
            className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 font-semibold text-accent-text hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-80 max-sm:min-h-10">
            <RefreshCw className={cn("size-3.5", checking && "motion-safe:animate-spin")} aria-hidden /> {checking ? "Checking…" : "Check again"}
          </button>
        )}
      </p>
      {v.detail && <p className="mt-1 max-w-prose">{v.detail}</p>}
    </div>
  );
}
