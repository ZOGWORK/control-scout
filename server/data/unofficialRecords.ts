// Matches whose scores are not official records (the owner's call, with why). They stay listed by score as played;
// wherever a record or a season's best scores show one, it is marked with the reason. An entry names one match, or a
// whole event (no level, series or number): every match played there is then marked.
import { UNOFFICIAL_NOTE } from "../../src/shared/searchStat.js";

export { UNOFFICIAL_NOTE };

export interface MatchKey { season: number; code: string; level: string; series: number; number: number }

/** One match, or (with no level, series or number) every match at the event. */
export type UnofficialEntry = { season: number; code: string; why: string } & ({ level: string; series: number; number: number } | { level?: undefined; series?: undefined; number?: undefined });

export const UNOFFICIAL: UnofficialEntry[] = [
  // Carolinas Premier Event (DECODE, Jul 25–26, 2026) did not play by the game's usual rules: none of its scores count.
  { season: 2025, code: "FPECAR", why: "the event did not play by the game's usual rules" },
];

/** Why match `m` is not an official record (its own entry first, then its event's), or null when it counts as one. */
export function unofficialWhy(m: MatchKey, entries: UnofficialEntry[] = UNOFFICIAL): string | null {
  const at = entries.filter((x) => x.season === Number(m.season) && x.code === m.code);
  const own = at.find((x) => x.level != null && x.level === m.level && x.series === Number(m.series) && x.number === Number(m.number));
  return (own ?? at.find((x) => x.level == null))?.why ?? null;
}

/** The matches of `season` that aren't official records, as SQL conditions on matches table `m` that leave them out
 *  (a whole event's, or one match's), with their arguments: for a question that asks for official records only. */
export function officialOnlySql(season: number, entries: UnofficialEntry[] = UNOFFICIAL): { sql: string[]; args: (string | number)[] } {
  const xs = entries.filter((x) => x.season === Number(season));
  return {
    sql: xs.map((x) => (x.level == null ? "m.code <> ?" : "NOT (m.code = ? AND m.level = ? AND m.series = ? AND m.number = ?)")),
    args: xs.flatMap((x) => (x.level == null ? [x.code] : [x.code, x.level, x.series, x.number])),
  };
}

/** "Not an official record: the event …", for a line under a marked match. */
export const unofficialLine = (m: MatchKey) => {
  const why = unofficialWhy(m);
  return why ? `${UNOFFICIAL_NOTE}: ${why}` : null;
};

/** A match's label in a table, marked when its score is not an official record ("Q49 (not an official record)"). */
export const markedLabel = (m: MatchKey & { label: string }) => (unofficialWhy(m) ? `${m.label} (${UNOFFICIAL_NOTE.toLowerCase()})` : m.label);
