// "My" and "our" in a search ("what is my next event", "our team's record"): the visitor's own team, My team on this
// device (src/lib/personal.tsx). The search box sends it as ?my= only when the query says one of these words, so every
// other query's URL (and its cached answer) stays the same for everyone. server/api/searchMine.ts answers with it.

/** The query speaks of the visitor's own team. */
export const MINE = /\b(?:my|our)\b/i;

/** The query with the visitor's team in place of "my" and "our": "my team's record" → "4215's record", "how did my
 *  team do" → "how did 4215 do", "what is my next event" → "what is 4215's next event". */
export function mineQuery(q: string, team: number): string {
  return q
    .replace(/\b(?:my|our)\s+(?:own\s+)?team(?:['’]s|s['’]?)?(?=\s|$|[?!.,])/gi, (m) => (/['’]s$/.test(m) ? `${team}'s` : String(team)))
    .replace(/\b(?:my|our)\s+(?:own\s+)?/gi, `${team}'s `);
}

/** A My team number as the search box sends it: a whole FTC team number, else none. */
export function myTeamOf(raw: unknown): number | null {
  const n = Number(typeof raw === "string" ? raw : NaN);
  return Number.isInteger(n) && n > 0 && n <= 999_999 ? n : null;
}
