// An event's initialisms, as people shorten its name (owner: "MTI highlights" for the Multinational Tech
// Invitational): the first letters of its significant words, and any short form its name states in parentheses
// ("… Invitational (MTI)"). Read from the stored names, never typed here; the search index holds them with the
// event's other words (server/stats/job.ts), so a query word that is one finds the event.
import { all } from "../../db.js";
import { fold, names } from "./names.js";

/** Words an initialism skips ("Festival of the Robots" is FR). */
const SMALL = new Set(["of", "the", "and", "for", "at", "in", "a", "an", "on", "to", "by", "de", "la", "du", "des", "y", "et"]);

/** The lowest and highest length an initialism has: a 2-word name's to a 6-word one's. */
export const INITIALISM_LETTERS = [2, 6] as const;

/** `name`'s initialisms, lower case: what it states in parentheses, then its significant words' first letters (only
 *  for a name of 2 to 6 such words, none of them a number or a date). */
export function eventInitialisms(name: string): string[] {
  const out = new Set<string>();
  for (const m of String(name ?? "").matchAll(/\(([A-Za-z]{2,6})\)/g)) out.add(m[1].toLowerCase());
  const ws = fold(String(name ?? "").replace(/\([^)]*\)/g, " ")).split(" ").filter((w) => w && !SMALL.has(w));
  if (ws.length >= INITIALISM_LETTERS[0] && ws.length <= INITIALISM_LETTERS[1] && ws.every((w) => /^[a-z]/.test(w))) out.add(ws.map((w) => w[0]).join(""));
  return [...out];
}

/** The one event `word` is the initialism of, when several share it ("mti"): the latest held (its season, then its
 *  date), then the one with the most teams, among those `when` keeps (a season or year asked). Null when the word is no
 *  event's initialism, or a team's name. Every reader that resolves an event by its initialism picks with this. */
export async function initialismEvent(word: string, when?: (e: { season: number; start: string | null }) => boolean): Promise<{ season: number; code: string } | null> {
  const w = word.trim().toLowerCase();
  if (!w || /\s/.test(w)) return null;
  const idx = await names();
  const codes = idx.initialism(w);
  if (!codes.length || idx.teamsNamed(w).length) return null;
  const rows = await all<{ season: number; code: string; name: string; start: string | null; n: number }>(
    `SELECT e.season, e.code, e.name, e.start, (SELECT COUNT(*) FROM event_teams t WHERE t.season = e.season AND t.code = e.code) n
     FROM events e WHERE e.code IN (${codes.map(() => "?").join(", ")})`, codes);
  const fit = rows.map((r) => ({ ...r, season: Number(r.season), n: Number(r.n) })).filter((r) => eventInitialisms(r.name).includes(w) && (!when || when(r)));
  fit.sort((a, b) => b.season - a.season || String(b.start ?? "").localeCompare(String(a.start ?? "")) || b.n - a.n);
  return fit[0] ? { season: fit[0].season, code: fit[0].code } : null;
}
