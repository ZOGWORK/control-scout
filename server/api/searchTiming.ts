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
