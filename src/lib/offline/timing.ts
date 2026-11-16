// Timings of the offline reads' slow steps (the SQLite engine's load, a saved season's open, a search index's build),
// as performance measures named "cs-offline:…", so scripts/offline-check.ts --trace can say where an offline page's
// time went. Nothing is sent anywhere; a browser without the API just skips them.

export const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Record `name` as having run from `start` (a now() reading) until now. */
export function measured(name: string, start: number): void {
  try { performance.measure(`cs-offline:${name}`, { start, end: now() }); } catch { /* no User Timing: nothing to record */ }
}
