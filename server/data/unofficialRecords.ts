// Matches whose scores are not official records (the owner's call, with why). They stay listed by score as played;
// wherever a record or a season's best scores show one, it is marked with the reason.
import { UNOFFICIAL_NOTE } from "../../src/shared/searchStat.js";

export { UNOFFICIAL_NOTE };

export interface MatchKey { season: number; code: string; level: string; series: number; number: number }

const UNOFFICIAL: (MatchKey & { why: string })[] = [
  // DECODE's highest score: Carolinas Premier Event did not play by the game's usual rules.
  { season: 2025, code: "FPECAR", level: "qual", series: 0, number: 49, why: "the event did not play by the game's usual rules" },
];


/** Why match `m` is not an official record, or null when it counts as one. */
export function unofficialWhy(m: MatchKey): string | null {
  const u = UNOFFICIAL.find((x) => x.season === Number(m.season) && x.code === m.code && x.level === m.level && x.series === Number(m.series) && x.number === Number(m.number));
  return u?.why ?? null;
}

/** "Not an official record: the event …", for a line under a marked match. */
export const unofficialLine = (m: MatchKey) => {
  const why = unofficialWhy(m);
  return why ? `${UNOFFICIAL_NOTE}: ${why}` : null;
};

/** A match's label in a table, marked when its score is not an official record ("Q49 (not an official record)"). */
export const markedLabel = (m: MatchKey & { label: string }) => (unofficialWhy(m) ? `${m.label} (${UNOFFICIAL_NOTE.toLowerCase()})` : m.label);
