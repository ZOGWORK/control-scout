// Long garbage-collection pauses, named in the log. A pause holds the event loop like any synchronous work, and leaves no
// trace of its own: on 2026-11-22 a lane answered /api/health in 2,373 ms at 08:11:56Z, during its first clip-coverage
// pass after start, yet that pass run cold against the same database never held the loop past 64 ms. On the same VM a
// single full mark-compact of a 1.4 GB heap took 1,080 ms, and a lane runs at 1.7 GB with peaks of 3.6–4.7 GB as it
// warms. A pause of PAUSE_LOG_MS or more is logged ("gc: major 2,140 ms, heap 2,210 of 4,144 MB after") so the next
// one is known for what it is.
import { PerformanceObserver, constants, type PerformanceEntry } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";

/** A pause this long or longer is logged. */
export const PAUSE_LOG_MS = 250;

const KINDS: Record<number, string> = {
  [constants.NODE_PERFORMANCE_GC_MAJOR]: "major",
  [constants.NODE_PERFORMANCE_GC_MINOR]: "minor",
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: "incremental",
  [constants.NODE_PERFORMANCE_GC_WEAKCB]: "weak callbacks",
};

const mb = (bytes: number) => Math.round(bytes / 1048576).toLocaleString("en-US");

/** The log line for a pause, or null for one shorter than PAUSE_LOG_MS (`heap`: in use once it ended, and the limit). */
export function pauseLine(e: Pick<PerformanceEntry, "duration"> & { detail?: unknown }, heap: { used: number; limit: number }): string | null {
  if (e.duration < PAUSE_LOG_MS) return null;
  const kind = KINDS[(e.detail as { kind?: number } | undefined)?.kind ?? -1] ?? "gc";
  return `gc: ${kind} ${Math.round(e.duration).toLocaleString("en-US")} ms, heap ${mb(heap.used)} of ${mb(heap.limit)} MB after`;
}

let observer: PerformanceObserver | null = null;
/** Start logging long pauses (once a process). */
export function watchGcPauses(log: (s: string) => void): void {
  if (observer) return;
  observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.duration < PAUSE_LOG_MS) continue;
      const h = getHeapStatistics();
      const line = pauseLine(e, { used: h.used_heap_size, limit: h.heap_size_limit });
      if (line) log(line);
    }
  });
  observer.observe({ entryTypes: ["gc"] });
}

/** Tests: stop watching. */
export function stopWatchingGcPauses(): void {
  observer?.disconnect();
  observer = null;
}
