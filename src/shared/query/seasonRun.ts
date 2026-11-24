// A run of seasons as typed ("2023-24 to 2025-26", "since 2023", "between 2023 and 2025", "the last 3 seasons"): read
// here, with no imports, so the time reader (./time.ts) and the name words a hit search looks up (../searchQuery.ts
// nameWords) read the same words, and a year in a run is never also a team's number to look up.
import type { TimeSlot } from "./time.js";

/** A season as typed in a run: "2023-24", "2023–2024" or a bare year (its season). Null when the halves don't follow. */
const SEASON_WORD = String.raw`(20[1-3]\d)(?:\s*[-–/]\s*(\d\d(?:\d\d)?))?`;
const seasonOf = (y: string, end: string | undefined): number | null =>
  end === undefined || (end.length === 2 ? (Number(y) + 1) % 100 : Number(y) + 1) === Number(end) ? Number(y) : null;
const seasonText = (s: number) => `${s}–${String((s + 1) % 100).padStart(2, "0")}`;
const COUNT_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** The run of seasons `rest` names, and its match, or null. */
export function seasonRange(rest: string): { t: TimeSlot; m: RegExpExecArray } | null {
  // A bare year in a run is a season by the run's own words ("since", "between", "to"), even one a team has.
  const ok = seasonOf;
  // "2023-24 to 2025-26", "from 2023 to 2025", "between 2023 and 2025", "2023 through 2025".
  let m = new RegExp(String.raw`\b(?:from\s+|between\s+)?(?:the\s+)?${SEASON_WORD}(?:\s+seasons?)?\s+(?:to|through|thru|until|and|-|–)\s+(?:the\s+)?${SEASON_WORD}(?:\s+seasons?)?\b`).exec(rest);
  if (m && (!/\band\b/.test(m[0]) || /\bbetween\b/.test(m[0]))) {
    const a = ok(m[1], m[2]), b = ok(m[3], m[4]);
    // Said either way round, the run is the same seasons; one season said twice is that season.
    if (a != null && b != null && a === b) return { m, t: { kind: "season", season: a, label: `in ${seasonText(a)}`, typed: m[0].trim() } };
    if (a != null && b != null) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return { m, t: { kind: "seasons", season: null, range: { from: lo, to: hi }, label: /^between/.test(m[0].trim()) ? `between ${seasonText(lo)} and ${seasonText(hi)}` : `${seasonText(lo)} to ${seasonText(hi)}`, typed: m[0].trim() } };
    }
  }
  // "since 2023", "since the 2023-24 season": that season to the latest.
  m = new RegExp(String.raw`\b(?:since|from)\s+(?:the\s+)?${SEASON_WORD}(?:\s+seasons?)?(?:\s+(?:on|onwards?))?\b`).exec(rest);
  if (m && /^since|\bon(?:wards?)?$/.test(m[0].trim())) {
    const a = ok(m[1], m[2]);
    if (a != null) return { m, t: { kind: "seasons", season: null, range: { from: a, to: null }, label: `since ${seasonText(a)}`, typed: m[0].trim() } };
  }
  // "last 3 seasons", "the past three seasons".
  m = /\b(?:the\s+)?(?:last|past|previous|recent)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+seasons\b/.exec(rest);
  if (m) {
    const n = COUNT_WORDS[m[1]] ?? Number(m[1]);
    if (n >= 2 && n <= 20) return { m, t: { kind: "seasons", season: null, range: { from: null, to: null, last: n }, label: `the last ${n} seasons`, typed: m[0].trim() } };
  }
  return null;
}

/** Where a run of seasons stands in `q` (lower case or not), or null: the words to leave out of a name search. Only
 *  A–Z are lowered, so every other letter keeps its place (a run's words are all A–Z) and the place is `q`'s own. */
export function seasonRunAt(q: string): { index: number; length: number } | null {
  const r = seasonRange(q.replace(/[A-Z]+/g, (w) => w.toLowerCase()));
  return r ? { index: r.m.index, length: r.m[0].length } : null;
}
