// Layout shift for the visual pass (visual.ts): how it's measured, and how much each page may shift.

/** The committed list of pages CI measures (cls.json): each page's query, and a ceiling per view ("desktop", "390")
 *  for the pages over the default today. A ceiling is today's number plus a margin, to be lowered (and then removed)
 *  as that page's layout is fixed; it is never raised to let a change pass. */
export type ClsBudget = {
  /** A view's own default, over `max` for every page at that view until its layout is fixed (the phone's, audit U1). */
  views?: Record<string, { ceiling: number; why: string }>;
  pages: { q: string; ceiling?: Record<string, number>; why?: string }[];
};

/** What page view `q` at `view` may shift at most: its own ceiling in `budget`, else its view's, else `max`. */
export function clsCeiling(budget: ClsBudget | null, q: string, view: string, max: number): number {
  return budget?.pages.find((p) => p.q === q)?.ceiling?.[view] ?? budget?.views?.[view]?.ceiling ?? max;
}

export type Shift = { startTime: number; value: number; hadRecentInput: boolean };

/** Kept in each page before its own scripts run: every layout-shift entry from the first paint on (buffered), as
 *  window.__shifts, for clsOf to score. A string, so the bundler never touches it. */
export const CLS_OBSERVER = `(() => {
  // Set only once the observer is running: with no layout-shift entries, window.__shifts stays unset and the page
  // reads "not measured" (a gate failure), never 0.
  const shifts = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) shifts.push({ startTime: e.startTime, value: e.value, hadRecentInput: e.hadRecentInput });
    }).observe({ type: "layout-shift", buffered: true });
    window.__shifts = shifts;
  } catch { /* no layout-shift entries in this browser: nothing measured */ }
})()`;

/** CLS as Chrome scores it: the shifts no recent tap or key caused, grouped into bursts (each under 1 s after the one
 *  before, a burst at most 5 s from its first), the worst burst's sum. */
export function clsOf(shifts: Shift[]): number {
  let worst = 0, sum = 0, first = 0, last = 0;
  for (const e of shifts) {
    if (e.hadRecentInput) continue;
    if (sum > 0 && e.startTime - last < 1000 && e.startTime - first < 5000) sum += e.value;
    else { sum = e.value; first = e.startTime; }
    last = e.startTime;
    worst = Math.max(worst, sum);
  }
  return worst;
}
