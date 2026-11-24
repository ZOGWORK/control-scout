// The last search this tab answered (sessionStorage), for a question that points back at it ("was that the same in
// all the matches you said": server/api/query/chat.ts): /search asks Bruno with it, so he answers from that search's
// records, in the season it was answered for (its ?in= pick). Per tab and per visit, never synced or sent anywhere
// else. Storage that refuses the write (blocked, full, private mode) or the read: kept in memory instead, for this
// page's life.
const KEY = "cs-last-search";

/** A search as it was answered: its words, and the season picked on its answer (?in=), or null for its own. */
export interface LastSearch { q: string; season: number | null }

/** The last search when storage refused it; null while storage holds it, so an older one never shadows it. */
let memory: LastSearch | null = null;

const tidy = (q: string) => q.trim().replace(/\s+/g, " ").slice(0, 200);

/** What storage holds: the JSON this writes, or null for anything else. */
function parse(raw: string | null): LastSearch | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LastSearch>;
    if (typeof v?.q !== "string" || !tidy(v.q)) return null;
    return { q: tidy(v.q), season: Number.isInteger(v.season) ? v.season! : null };
  } catch { return null; }
}

/** Remember `q`, answered for `season` (the picked one, or null), as this tab's last answered search. */
export function rememberSearch(q: string, season: number | null = null): void {
  const query = tidy(q);
  if (!query) return;
  const last: LastSearch = { q: query, season };
  try { sessionStorage.setItem(KEY, JSON.stringify(last)); memory = null; } catch { memory = last; /* refused: memory keeps it */ }
}

/** This tab's last answered search, unless it is `current` itself; null when there is none. */
export function lastSearch(current = ""): LastSearch | null {
  let last: LastSearch | null;
  // A write refused while reads still work: storage has nothing (or an older one), memory has the latest.
  try { last = memory ?? parse(sessionStorage.getItem(KEY)); } catch { last = memory; /* unreadable: memory has it */ }
  if (!last) return null;
  return last.q.toLowerCase() === tidy(current).toLowerCase() ? null : last;
}
