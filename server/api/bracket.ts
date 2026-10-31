// The event page's playoff bracket predictor (src/shared/bracketOdds.ts) on the live ratings: every match
// priced by the forecaster's own playoff-level call (the same one the match rows show), cached per posted
// result, so the 30-second live refresh only simulates again when a result or the ratings move.
import type { BracketOdds } from "../../src/shared/api.js";
import { bracketOdds, bracketStateKey, type BracketAlliance, type BracketMatch } from "../../src/shared/bracketOdds.js";
import { textSeed } from "../../src/shared/projectionCore.js";
import type { FieldRow, MatchView } from "../../src/shared/api.js";
import type { ScoutForecaster } from "../predict/engine.js";
import { registerCache } from "../caches.js";
import { isEnabled } from "../flags.js";

interface AllianceRow { number: number; captain: number | null; pick1: number | null; pick2: number | null; backup: number | null }

const cache = new Map<string, BracketOdds | null>();
const CACHE_MAX = 200;
registerCache("Bracket odds", () => cache.clear());

/**
 * An event detail as the public sees it: without the bracket odds while the owner has switched them off (the
 * bracketOdds feature toggle). The detail is shared and cached, so a copy, never a change to it. The bracket and
 * its results are public data and stay either way.
 */
export async function withBracketGate<T extends { bracket?: BracketOdds | null }>(d: T): Promise<T> {
  return d.bracket && !(await isEnabled("bracketOdds")) ? { ...d, bracket: null } : d;
}

/** The posted playoff matches, as the bracket reads them. */
export function bracketMatches(matches: MatchView[]): BracketMatch[] {
  return matches.filter((m) => m.level === "playoff").map((m) => ({
    series: m.series, number: m.number,
    red: m.red.teams.map((t) => t.number), blue: m.blue.teams.map((t) => t.number),
    redScore: m.played && m.red.score ? m.red.score.total : null, blueScore: m.played && m.blue.score ? m.blue.score.total : null,
  }));
}

export function bracketAlliances(rows: AllianceRow[]): BracketAlliance[] {
  return rows.map((a) => ({ number: Number(a.number), teams: [a.captain, a.pick1, a.pick2].filter((t): t is number => t != null).map(Number), backup: a.backup == null ? null : Number(a.backup) }));
}

/**
 * Series calls and championship odds for an event whose alliances are posted (null before that, or without
 * ratings). `ratings` names the ratings in use (liveVersion): a new version prices the bracket again.
 */
export function eventBracket(season: number, code: string, f: ScoutForecaster | null, ratings: string, field: FieldRow[], matches: MatchView[], rows: AllianceRow[]): BracketOdds | null {
  if (!f || !rows.length) return null;
  const alliances = bracketAlliances(rows).filter((a) => a.teams.length);
  if (!alliances.length) return null;
  const posted = bracketMatches(matches);
  const state = bracketStateKey(alliances, posted);
  // Cached by the whole posted schedule too (series numbers and line-ups of unplayed matches shape the bracket);
  // the seed stays on the results alone.
  const schedule = JSON.stringify(posted.map((m) => [m.series, m.number, m.red, m.blue]).sort((x, y) => (x[0] as number) - (y[0] as number) || (x[1] as number) - (y[1] as number)));
  const key = `${season}|${code}|${ratings}|${state}|${schedule}`;
  if (cache.has(key)) return cache.get(key)!;
  const strength = new Map(field.map((r) => [r.team, r.rating?.np ?? null]));
  const odds = bracketOdds({
    season, alliances, matches: posted,
    price: (a, b) => {
      const x = f.explain(season, a, b, "playoff", code);
      return x ? { p: x.winProbA, tier: x.confidence.tier } : { p: 0.5, tier: "provisional" };
    },
    strength: (t) => strength.get(t) ?? null,
    // Seeded by the results alone: the same posted state draws the same runs.
    seed: textSeed(`${season}|${code}|bracket|${state}`),
  });
  cache.set(key, odds);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return odds;
}
