// The names the parser recognises, read from the stored data (docs/search-pipeline.md, "Entities"): every team number
// and name, every place a team or event is in (a region, a country, a town), held in memory and rebuilt with the
// search index. Nothing here is typed by hand: a new team, town or country is known as soon as it's synced.
import { allInChunks, loopTurn } from "../../db.js";
import { runYielding } from "../../../src/shared/steps.js";
import { searchVersion } from "../searchReads.js";
import { registerCache } from "../../caches.js";

export { fold, type Names, type Place, type TeamName } from "../../../src/shared/query/names.js";
import type { Names } from "../../../src/shared/query/names.js";

export { buildNames, joinDotted } from "../../../src/shared/query/names.js";
import { namesSteps, type NameRow as Row } from "../../../src/shared/query/names.js";

let cache: { version: string; names: Promise<Names> } | null = null;

/** Every team with when it last played and its strength, in team number order. Read as the one query with two joined
 *  aggregates this was (every request held 0.5–0.8 s while it ran), now a few rows at a time: the teams and the
 *  seasons they played in key order, the rankings by rowid, joined here. Same rows, same values (names.test.ts). */
export async function teamNameRows(): Promise<Row[]> {
  const teams = await allInChunks<Row>("SELECT number, name, city, state, country FROM teams WHERE number > ?", [], "number", 2_500);
  // When it last played: its latest season with a match at an event.
  const played = new Map<number, number>();
  for (const r of await allInChunks<{ team: number; last: number }>("SELECT team, MAX(season) last FROM team_event_stats WHERE matches > 0 AND team > ? GROUP BY team", [], "team", 1_500)) played.set(Number(r.team), r.last);
  // Its strength: the best world OPR percentile in its two latest ranked seasons (./shared.ts).
  const ranked = new Map<number, { season: number; pct: number }[]>();
  for (const r of await allInChunks<{ rid: number; team: number; season: number; pct: number }>(
    "SELECT rowid rid, team, season, 1.0 - CAST(rank_np AS REAL) / ranked_teams pct FROM team_season_stats WHERE rank_np IS NOT NULL AND ranked_teams > 0 AND rowid > ?", [], "rid", 10_000)) {
    const at = ranked.get(Number(r.team)) ?? ranked.set(Number(r.team), []).get(Number(r.team))!;
    at.push({ season: Number(r.season), pct: r.pct });
  }
  const strength = (n: number): number | null => {
    const at = ranked.get(n);
    if (!at) return null;
    // A team holds one row a season, so its two latest are its two highest seasons.
    return Math.max(...[...at].sort((a, b) => b.season - a.season).slice(0, 2).map((x) => x.pct));
  };
  return teams.map((t) => ({ ...t, lastPlayed: played.get(Number(t.number)) ?? null, strength: strength(Number(t.number)) }));
}

/** The index from the database, rebuilt when the search index is. */
export async function names(): Promise<Names> {
  const version = await searchVersion();
  if (cache?.version === version) return cache.names;
  const n = Promise.all([
    teamNameRows(),
    allInChunks<{ rid: number; city: string | null; state: string | null; country: string | null; name: string | null; code: string | null }>("SELECT rowid rid, city, state, country, name, code FROM events WHERE rowid > ?", [], "rid", 2_500),
  ]).then(([teams, places]) => runYielding(namesSteps(teams, places), loopTurn));
  cache = { version, names: n };
  n.catch(() => { if (cache?.names === n) cache = null; });
  return n;
}
registerCache("Search pipeline names", () => { cache = null; }, { clipFree: true });
