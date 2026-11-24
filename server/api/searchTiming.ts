// Search's own time on each answer, sent as a Server-Timing header (the browser's network panel shows it beside the
// request; `curl -sD-` prints it): how long this process spent on each part, in milliseconds, so a slow search on the
// live site can be told apart from a slow network. Nothing about the query or who asked: names and durations only.

/** The header's value: each part as `name;dur=<ms>` to a tenth of a millisecond, in the order given. A part that
 *  isn't a finite, non-negative time is left out. */
export function searchTiming(parts: Record<string, number>): string {
  return Object.entries(parts)
    .filter(([name, ms]) => /^[a-z][a-z0-9-]*$/.test(name) && Number.isFinite(ms) && ms >= 0)
    .map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`)
    .join(", ");
}

/** A search slower than this is logged with its parts (slowSearchLine): the slow ones become visible in the journal. */
export const SLOW_SEARCH_MS = 1000;

/** The journal line for a slow search (null: under SLOW_SEARCH_MS in all): the route, the total, each part, and the
 *  words searched (cut to 80 characters; never who asked). `journalctl -u 'control-scout@*' -g '\[search\] slow'`. */
export function slowSearchLine(route: string, parts: Record<string, number>, q: string): string | null {
  const total = Object.values(parts).reduce((a, ms) => a + (Number.isFinite(ms) && ms > 0 ? ms : 0), 0);
  if (total < SLOW_SEARCH_MS) return null;
  const each = Object.entries(parts).filter(([, ms]) => Number.isFinite(ms) && ms >= 0).map(([k, ms]) => `${k} ${Math.round(ms)}`).join(", ");
  return `[search] slow ${route} ${Math.round(total)} ms (${each}) q=${JSON.stringify(q.replace(/\s+/g, " ").trim().slice(0, 80))}`;
}
