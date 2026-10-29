// GET /api/home/overview?season=…: one season's coverage (teams registered,
// competition events listed, match scores recorded) and where its teams are
// from, by the country their directory entry reports. Counted in SQL, cached
// per season and data version, so the home page never downloads a directory
// to count it.
import { all, get, kvGet } from "../db.js";
import { dataVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";
import { NO_MATCH_TYPES } from "./events.js";
import { readinessKey, seasonReadiness } from "./readiness.js";
import { countryOf } from "../../src/shared/countries.js";
import type { CountryTotal, HomeOverview, UnmappedTotal } from "../../src/shared/home.js";
import { teamPageSql } from "../../src/shared/teamPages.js";

/** Group per-label counts by normalised country; labels no country fits stay apart, as reported. */
export function groupByCountry(rows: { label: string | null; listings: number; withResults: number }[]): Pick<HomeOverview, "countries" | "unmapped"> {
  const byCode = new Map<string, CountryTotal>();
  const unmapped = new Map<string | null, number>();
  for (const r of rows) {
    const c = countryOf(r.label);
    if (!c) {
      // Blank and whitespace-only labels are one "not reported" bucket.
      const label = r.label?.trim() ? r.label.trim() : null;
      unmapped.set(label, (unmapped.get(label) ?? 0) + r.listings);
      continue;
    }
    const t = byCode.get(c.code) ?? { code: c.code, numeric: c.numeric, name: c.name, listings: 0, withResults: 0 };
    t.listings += r.listings;
    t.withResults += r.withResults;
    byCode.set(c.code, t);
  }
  return {
    countries: [...byCode.values()].sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name)),
    unmapped: [...unmapped].map(([label, listings]): UnmappedTotal => ({ label, listings }))
      .sort((a, b) => b.listings - a.listings || (a.label ?? "￿").localeCompare(b.label ?? "￿")),
  };
}

export async function buildOverview(season: number, now = new Date()): Promise<HomeOverview> {
  const [labels, coverage, events, scores, sync, full, live, readiness] = await Promise.all([
    // One row per reported label. team_seasons has one row per team per season (its key), and the
    // records table one per team, so neither join can count a team twice.
    all<{ label: string | null; listings: number; withResults: number }>(
      `SELECT t.country label, COUNT(*) listings, COUNT(r.team) withResults
       FROM team_seasons ts
       LEFT JOIN teams t ON t.number = ts.team
       LEFT JOIN team_season_records r ON r.season = ts.season AND r.team = ts.team
       WHERE ts.season = ? AND ${teamPageSql("ts.team", "t.name")} GROUP BY t.country`, [season]),
    // Teams with a page only (src/shared/teamPages.ts), as the directory lists them.
    get<{ n: number }>(`SELECT COUNT(*) n FROM team_seasons ts WHERE ts.season = ? AND ${teamPageSql("ts.team")}`, [season]),
    get<{ n: number }>(`SELECT COUNT(*) n FROM events WHERE season = ? AND type NOT IN (${NO_MATCH_TYPES.map(() => "?").join(",")})`, [season, ...NO_MATCH_TYPES]),
    get<{ n: number }>("SELECT COUNT(*) n FROM matches WHERE season = ? AND played = 1", [season]),
    kvGet<{ at: string }>("sync:last"),
    kvGet<{ at: string }>("stats:last"),
    kvGet<{ at: string }>("records:last"),
    // withResults reads the records: until they're built for the season (or while they're behind its
    // results) a zero there isn't a fact, and the atlas must say so (DATA-F01).
    seasonReadiness(season),
  ]);
  const stats = !live ? full : !full || live.at > full.at ? live : full;
  return {
    season, generatedAt: now.toISOString(), dataAsOf: sync?.at ?? null, statsAt: stats?.at ?? null,
    coverage: { teamListings: Number(coverage?.n ?? 0), events: Number(events?.n ?? 0), matchScores: Number(scores?.n ?? 0) },
    readiness,
    ...groupByCountry(labels.map((r) => ({ label: r.label, listings: Number(r.listings), withResults: Number(r.withResults) }))),
  };
}

/** A built overview is reused until the data or the stats move on, and for ten minutes at most. */
export const OVERVIEW_TTL_MS = 10 * 60_000;
const overviews = new Map<number, { key: string; at: number; value: Promise<HomeOverview> }>();
registerCache("Home overview", () => overviews.clear());

/** The version an overview is built from: synced data, then the stats and live records rebuilt from it,
 *  and the season's own sync and records build (so its readiness moves as soon as either does). */
async function overviewKey(season: number): Promise<string> {
  const [v, full, live, own] = await Promise.all([dataVersion(), kvGet<{ at: string }>("stats:last"), kvGet<{ at: string }>("records:last"), readinessKey(season)]);
  return `${v}|${full?.at ?? ""}|${live?.at ?? ""}|${own}`;
}

export async function homeOverview(season: number): Promise<HomeOverview> {
  const key = await overviewKey(season);
  const hit = overviews.get(season);
  if (hit && hit.key === key && Date.now() - hit.at < OVERVIEW_TTL_MS) return hit.value;
  const value = buildOverview(season);
  overviews.set(season, { key, at: Date.now(), value });
  value.catch(() => { if (overviews.get(season)?.value === value) overviews.delete(season); });
  return value;
}
