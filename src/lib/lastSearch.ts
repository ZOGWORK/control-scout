// The last search this tab answered (sessionStorage), for a question that points back at it ("was that the same in
// all the matches you said": server/api/query/chat.ts): /search asks Bruno with it, so he answers from that search's
// records. Per tab and per visit, never synced or sent anywhere else. Storage that refuses the write (blocked, full,
// private mode) or the read: kept in memory instead, for this page's life.
const KEY = "cs-last-search";
/** The last search when storage refused it; null while storage holds it, so an older one never shadows it. */
let memory: string | null = null;

/** Remember `q` as this tab's last answered search. */
export function rememberSearch(q: string): void {
  const query = q.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!query) return;
  try { sessionStorage.setItem(KEY, query); memory = null; } catch { memory = query; /* refused: memory keeps it */ }
}

/** This tab's last answered search, unless it is `current` itself; null when there is none. */
export function lastSearch(current = ""): string | null {
  let q: string | null;
  // A write refused while reads still work: storage has nothing (or an older one), memory has the latest.
  try { q = memory ?? sessionStorage.getItem(KEY); } catch { q = memory; /* unreadable: memory has it */ }
  if (!q) return null;
  return q.toLowerCase() === current.trim().replace(/\s+/g, " ").toLowerCase() ? null : q;
}
