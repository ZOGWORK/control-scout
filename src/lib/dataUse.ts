// How much data this visit has used, measured by the browser: the sum of transferSize over the page load
// (navigation) and every file and request since (resource), from the browser's own timing entries. A file the
// browser already had (its cache, the service worker's copy) counts as 0, as it costs no data. Started once in
// main.tsx so nothing is missed when the entry buffer fills; the Network & offline screen shows it.
import { useSyncExternalStore } from "react";

type Sized = PerformanceEntry & { transferSize?: number };

let bytes = 0;
/** The browser gives sizes (Safari before 16.4 and some others don't): until then the screen says it doesn't know. */
let measured = false;
let started = false;
const listeners = new Set<() => void>();
let pending: ReturnType<typeof setTimeout> | undefined;
const emit = () => {
  // A burst of requests (a page change) tells listeners once.
  if (pending) return;
  pending = setTimeout(() => { pending = undefined; listeners.forEach((f) => f()); }, 250);
};

/** Add these entries' sizes. Exported for tests. */
export function addEntries(list: readonly Sized[]) {
  let added = false;
  for (const e of list) {
    if (typeof e.transferSize !== "number") continue;
    measured = true;
    bytes += e.transferSize;
    added = true;
  }
  if (added) emit();
}

/** Start counting (main.tsx, once). */
export function startDataUse() {
  if (started || typeof performance === "undefined") return;
  started = true;
  if (typeof PerformanceObserver !== "undefined") {
    for (const type of ["navigation", "resource"]) {
      try {
        // buffered: the entries from before this ran (the page load and its first files) come too.
        new PerformanceObserver((l) => addEntries(l.getEntries() as Sized[])).observe({ type, buffered: true });
      } catch { /* this entry type isn't supported */ }
    }
  } else {
    addEntries([...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")] as Sized[]);
  }
}

/** Bytes this visit has used, or null when the browser doesn't say. */
export function dataUsed(): number | null { return measured ? bytes : null; }

export function useDataUse(): number | null {
  return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, dataUsed, () => null);
}

/** Tests: back to nothing counted. */
export function resetDataUse() { bytes = 0; measured = false; started = false; clearTimeout(pending); pending = undefined; }
