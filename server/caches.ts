// In-memory caches that the owner portal's "Clear caches" empties. A module that keeps one
// registers a way to drop it; clearing never touches the database or stored files.
const caches = new Map<string, { clear: () => void; clipFree: boolean; onClip?: () => void }>();

/** Register a cache under a readable name (registering the same name again replaces it). `clipFree`: nothing in it
 *  comes from match videos or their clip starts (ratings, rankings, names), so a clip-start change leaves it alone.
 *  `onClip`: what a clip-start change does to it instead of `clear` (search's kept answers and pages: served once
 *  more while they're drawn again, never all drawn again with visitors waiting). */
export function registerCache(name: string, clear: () => void, o: { clipFree?: boolean; onClip?: () => void } = {}): void {
  caches.set(name, { clear, clipFree: !!o.clipFree, ...(o.onClip ? { onClip: o.onClip } : {}) });
}

function clearWhere(keep: (c: { clipFree: boolean }) => boolean, clip = false): string[] {
  const done: string[] = [];
  for (const [name, c] of caches) {
    if (keep(c)) continue;
    try { (clip && c.onClip ? c.onClip : c.clear)(); done.push(name); } catch (e) { console.warn(`[caches] couldn't clear ${name}: ${(e as Error)?.message ?? e}`); }
  }
  return done;
}

/** Empty every registered cache; returns the names cleared (a failing one is skipped, not fatal). */
export const clearAllCaches = (): string[] => clearWhere(() => false);

/** After clip starts change (an auto read put live, a typed start, an owner's approval): empty every cache except the
 *  clip-free ones. The clip autopilot delivers about once a minute; emptying the prediction ratings and the track
 *  record each time made the next team pages wait ~19 s for a full rebuild (07:48Z and 07:49Z, 2026-11-22). A cache
 *  not marked clip-free is still emptied, so forgetting the mark costs speed, never a stale clip. */
export const clearClipCaches = (): string[] => clearWhere((c) => c.clipFree, true);

export const cacheNames = () => [...caches.keys()];
