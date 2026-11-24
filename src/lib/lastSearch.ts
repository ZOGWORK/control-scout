// The last search this tab answered (sessionStorage), for a question that points back at it ("was that the same in
// all the matches you said": server/api/query/chat.ts): /search asks Bruno with it, so he answers from that search's
// records. Per tab and per visit, never synced or sent anywhere else; with storage blocked, kept in memory.
const KEY = "cs-last-search";
let memory: string | null = null;

/** Remember `q` as this tab's last answered search. */
export function rememberSearch(q: string): void {
  const query = q.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!query) return;
  memory = query;
  try { sessionStorage.setItem(KEY, query); } catch { /* blocked: memory keeps it */ }
}

/** This tab's last answered search, unless it is `current` itself; null when there is none. */
export function lastSearch(current = ""): string | null {
  let q: string | null;
  try { q = sessionStorage.getItem(KEY); } catch { q = memory; /* blocked: memory has it */ }
  if (!q) return null;
  return q.toLowerCase() === current.trim().replace(/\s+/g, " ").toLowerCase() ? null : q;
}
