// The names the parser recognises, read from the stored data (docs/search-pipeline.md, "Entities"): every team number
// and name, every place a team or event is in (a region, a country, a town), held in memory and rebuilt with the
// search index. Nothing here is typed by hand: a new team, town or country is known as soon as it's synced.
import { all } from "../../db.js";
import { searchVersion } from "../searchReads.js";
import { registerCache } from "../../caches.js";

export { fold, type Names, type Place, type TeamName } from "../../../src/shared/query/names.js";
import type { Names } from "../../../src/shared/query/names.js";

export { buildNames, joinDotted } from "../../../src/shared/query/names.js";
import { buildNames, type NameRow as Row } from "../../../src/shared/query/names.js";

let cache: { version: string; names: Promise<Names> } | null = null;

/** The index from the database, rebuilt when the search index is. */
export async function names(): Promise<Names> {
  const version = await searchVersion();
  if (cache?.version === version) return cache.names;
  const n = Promise.all([
    // Its strength: the best world OPR percentile in its two latest ranked seasons (./shared.ts).
    all<Row>(`SELECT t.number, t.name, t.city, t.state, t.country, p.last lastPlayed, r.strength FROM teams t
      LEFT JOIN (SELECT team, MAX(season) last FROM team_event_stats WHERE matches > 0 GROUP BY team) p ON p.team = t.number
      LEFT JOIN (SELECT team, MAX(pct) strength FROM (SELECT team, 1.0 - CAST(rank_np AS REAL) / ranked_teams pct,
          ROW_NUMBER() OVER (PARTITION BY team ORDER BY season DESC) k FROM team_season_stats WHERE rank_np IS NOT NULL AND ranked_teams > 0)
        WHERE k <= 2 GROUP BY team) r ON r.team = t.number`),
    all<{ city: string | null; state: string | null; country: string | null; name: string | null; code: string | null }>("SELECT city, state, country, name, code FROM events"),
  ]).then(([teams, places]) => buildNames(teams, places));
  cache = { version, names: n };
  n.catch(() => { if (cache?.names === n) cache = null; });
  return n;
}
registerCache("Search pipeline names", () => { cache = null; });
