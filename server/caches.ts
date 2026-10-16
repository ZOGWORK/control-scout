// In-memory caches that the owner portal's "Clear caches" empties. A module that keeps one
// registers a way to drop it; clearing never touches the database or stored files.
const caches = new Map<string, () => void>();

/** Register a cache under a readable name (registering the same name again replaces it). */
export function registerCache(name: string, clear: () => void): void { caches.set(name, clear); }

/** Empty every registered cache; returns the names cleared (a failing one is skipped, not fatal). */
export function clearAllCaches(): string[] {
  const done: string[] = [];
  for (const [name, clear] of caches) {
    try { clear(); done.push(name); } catch (e) { console.warn(`[caches] couldn't clear ${name}: ${(e as Error)?.message ?? e}`); }
  }
  return done;
}

export const cacheNames = () => [...caches.keys()];
