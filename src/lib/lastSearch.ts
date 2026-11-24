// The last search this tab answered (sessionStorage), for a question that points back at it ("was that the same in
// all the matches you said": server/api/query/chat.ts): /search asks Bruno with it, so he answers from that search's
// records, read as it was answered: in the season picked on its answer (?in=) and, for "my" or "our", for the My team
// it was asked with. Per tab (another tab has its own) and per visit, never synced or sent anywhere else. A search
// that found nothing clears it, so a follow-up never reads an older one; one older than LAST_SEARCH_MAX_AGE_MS is not
// read. Storage that refuses the write (blocked, full, private mode) or the read: kept in memory, for this page's life.
const KEY = "cs-last-search";
/** How long a last search is still what a follow-up means. */
export const LAST_SEARCH_MAX_AGE_MS = 30 * 60 * 1000;

/** A search as it was answered: its words, the season picked on its answer (?in=, or null for its own), the My team a
 *  "my"/"our" search was asked with (null otherwise), and when. */
export interface LastSearch { q: string; season: number | null; my: number | null; at: number }

/** What storage refused: the latest search, or "none" for a cleared one; null while storage holds the latest. */
let memory: LastSearch | "none" | null = null;

const tidy = (q: string) => q.trim().replace(/\s+/g, " ").slice(0, 200);
const whole = (n: unknown) => (Number.isInteger(n) ? (n as number) : null);

/** What storage holds: the JSON this writes, or null for anything else. */
function parse(raw: string | null): LastSearch | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LastSearch>;
    if (typeof v?.q !== "string" || !tidy(v.q) || typeof v.at !== "number") return null;
    return { q: tidy(v.q), season: whole(v.season), my: whole(v.my), at: v.at };
  } catch { return null; }
}

function store(last: LastSearch | null): void {
  try {
    if (last) sessionStorage.setItem(KEY, JSON.stringify(last)); else sessionStorage.removeItem(KEY);
    memory = null;
  } catch { memory = last ?? "none"; /* refused: memory keeps it */ }
}

/** Remember `q` as this tab's last answered search: answered for `season` (the picked one, or null), and for `my`
 *  (the My team a "my"/"our" search was sent with, or null). */
export function rememberSearch(q: string, season: number | null = null, my: number | null = null, now = Date.now()): void {
  const query = tidy(q);
  if (query) store({ q: query, season, my, at: now });
}

/** A search that found nothing: a follow-up after it has no earlier answer to read. */
export function forgetSearch(): void { store(null); }

/** This tab's last answered search, unless it is `current` itself or too old; null when there is none. */
export function lastSearch(current = "", now = Date.now()): LastSearch | null {
  let last: LastSearch | null;
  // A write refused while reads still work: storage has nothing (or an older one), memory has the latest.
  try { last = memory === "none" ? null : memory ?? parse(sessionStorage.getItem(KEY)); } catch { last = memory === "none" ? null : memory; /* unreadable */ }
  if (!last || now - last.at > LAST_SEARCH_MAX_AGE_MS) return null;
  return last.q.toLowerCase() === tidy(current).toLowerCase() ? null : last;
}
