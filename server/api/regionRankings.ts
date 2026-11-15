// Region rankings (src/shared/regionRankings.ts): one region's teams out of the world ranking, read from the very lists
// /api/rankings reads (server/api/rankings.ts: the same memoized live list, snapshot weeks and baseline), so a team's
// rating and its place in the region are the numbers /rankings?region= shows. Beside the rating: the season's record,
// OPR, events and rated matches (team_season_stats), which /api/rankings doesn't carry. A new endpoint because the
// world ranking's page is 50 teams of one sort with no stats: the region table sorts every column over the whole
// region, finds an asked team's page, and lists the week's movers and the region's unranked teams.
import { all } from "../db.js";
import { dataVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";
import { RANKED_MIN_MATCHES, inPlaces, placeKey, type PlaceFilter } from "../../src/shared/rankings.js";
import { readSwing } from "../../src/shared/rankingsBoard.js";
import { teamPageSql } from "../../src/shared/teamPages.js";
import {
  REGION_PAGE_SIZE, UNRANKED_LIST_MAX, homeRegion, movers, namedState, regionName, regionRows, sortRows,
  type AskedTeam, type RegionListItem, type RegionListTeam, type RegionRankingsResponse, type RegionSort, type RegionsResponse, type UnrankedTeam,
} from "../../src/shared/regionRankings.js";
import { baselineWeek, liveList, memo, rows, snapshotWeeks, weekList } from "./rankings.js";
import { leagueIn, leagueList } from "./leagues.js";

type Stats = Pick<RegionListTeam, "opr" | "wins" | "losses" | "ties" | "events" | "ratedMatches">;
const statsMemo = memo<Map<number, Stats>>(120_000, 10);
const leaguesMemo = memo<Awaited<ReturnType<typeof leagueList>>>(120_000, 10);
const unrankedMemo = memo<UnrankedTeam[]>(120_000, 100);
const viewMemo = memo<RegionRankingsResponse>(120_000, 500);
const regionsMemo = memo<RegionsResponse>(600_000, 10);
registerCache("Region rankings", () => { statsMemo.clear(); leaguesMemo.clear(); unrankedMemo.clear(); viewMemo.clear(); regionsMemo.clear(); });

/** Every team's season stats (the columns beside the rating), by team. */
async function seasonStats(season: number): Promise<Map<number, Stats>> {
  return statsMemo(`${await dataVersion()}|${season}`, async () => new Map((await all<{ team: number; opr_np: number | null; wins: number; losses: number; ties: number; events: number; rating_matches: number | null }>(
    "SELECT team, opr_np, wins, losses, ties, events, rating_matches FROM team_season_stats WHERE season = ?", [season]))
    .map((r) => [Number(r.team), {
      opr: r.opr_np == null ? null : Math.round(Number(r.opr_np) * 100) / 100,
      wins: Number(r.wins), losses: Number(r.losses), ties: Number(r.ties), events: Number(r.events), ratedMatches: r.rating_matches == null ? 0 : Number(r.rating_matches),
    }])));
}

/** The season's leagues (memoized per data version). */
export async function seasonLeagueList(season: number) {
  return leaguesMemo(`${await dataVersion()}|${season}`, () => leagueList(season));
}

const regionWhere = (p: PlaceFilter) => (p.state ? "t.country = ? AND UPPER(t.state) = ?" : "t.country = ?");
const regionArgs = (p: PlaceFilter) => (p.state ? [p.country, p.state] : [p.country]);

/** The region's teams with a season but no rank: some rated matches but fewer than 3, or none yet (on an event's team
 *  list this season, or with season stats and no rating). Most rated matches first. */
async function unrankedTeams(season: number, p: PlaceFilter): Promise<UnrankedTeam[]> {
  return unrankedMemo(`${await dataVersion()}|${season}|${placeKey(p)}`, async () => (await all<{ team: number; name: string | null; rm: number }>(
    `SELECT t.number team, t.name, COALESCE(s.rating_matches, 0) rm FROM teams t LEFT JOIN team_season_stats s ON s.season = ? AND s.team = t.number
     WHERE ${regionWhere(p)} AND ${teamPageSql("t.number", "t.name")}
       AND (s.team IS NOT NULL OR EXISTS (SELECT 1 FROM event_teams et WHERE et.season = ? AND et.team = t.number))
       AND NOT (s.rating_np IS NOT NULL AND COALESCE(s.rating_matches, 0) >= ?)
     ORDER BY rm DESC, t.number`, [season, ...regionArgs(p), season, RANKED_MIN_MATCHES]))
    .map((r) => ({ team: Number(r.team), name: r.name ?? null, ratedMatches: Number(r.rm) })));
}

/** Where an asked team is when it isn't in the region's ranked list: unranked here, from elsewhere, or not a team. On a
 *  past week's view (`week`) a team from the region is "not in that week's ranking": today's rated matches say nothing
 *  about then. */
async function askedElsewhere(season: number, team: number, p: PlaceFilter, unranked: UnrankedTeam[], week: string | null): Promise<AskedTeam> {
  const u = unranked.find((x) => x.team === team);
  if (u) return { team, name: u.name, status: "unranked", ratedMatches: u.ratedMatches };
  const t = (await all<{ name: string | null; country: string | null; state: string | null; rm: number | null }>(
    "SELECT t.name, t.country, t.state, s.rating_matches rm FROM teams t LEFT JOIN team_season_stats s ON s.season = ? AND s.team = t.number WHERE t.number = ?", [season, team]))[0];
  if (!t) return { team, name: null, status: "unknown" };
  if (inPlaces(t, [p])) {
    return week ? { team, name: t.name ?? null, status: "notInWeek", week } : { team, name: t.name ?? null, status: "unranked", ratedMatches: Math.min(Number(t.rm ?? 0), RANKED_MIN_MATCHES - 1) };
  }
  const home = homeRegion(t.country, t.state);
  return { team, name: t.name ?? null, status: "elsewhere", region: home ? placeKey(home) : null };
}

export interface RegionQuery { season: number; week: string | null; place: PlaceFilter; page: number | null; sort: RegionSort; team: number | null }

/** One region's view: its table page (by `sort`), the week's movers, its unranked teams and its leagues. With `team`
 *  and no page, the page that team's row is on. */
export async function regionRankings(q: RegionQuery, now = Date.now()): Promise<RegionRankingsResponse> {
  const weeks = await snapshotWeeks(q.season);
  const base = baselineWeek(weeks, q.season, q.week, now);
  const key = [await dataVersion(), q.season, q.week ?? "live", placeKey(q.place), q.page ?? "-", q.sort, q.team ?? "-", base ?? "-", weeks.length, weeks[0] ?? "-"].join("|");
  return viewMemo(key, async () => {
    const live = !q.week;
    const [list, prev, stats, leagues] = await Promise.all([
      q.week ? weekList(q.season, q.week) : liveList(q.season),
      base ? weekList(q.season, base) : Promise.resolve(null),
      live ? seasonStats(q.season) : Promise.resolve(null),
      seasonLeagueList(q.season),
    ]);
    const withStats: RegionListTeam[] = stats ? list.map((t) => ({ ...t, ...stats.get(Number(t.team)) })) : list;
    const region = regionRows(withStats, prev, (t) => inPlaces(t, [q.place]));
    const sorted = sortRows(region, q.sort);
    const pages = Math.max(1, Math.ceil(sorted.length / REGION_PAGE_SIZE));
    const at = q.team != null ? sorted.findIndex((r) => r.team === q.team) : -1;
    const page = Math.min(Math.max(1, q.page ?? (at >= 0 ? Math.floor(at / REGION_PAGE_SIZE) + 1 : 1)), pages);
    const slice = sorted.slice((page - 1) * REGION_PAGE_SIZE, page * REGION_PAGE_SIZE);
    const swing = live && slice.length ? await readSwing(rows, q.season, slice.map((r) => r.team)) : null;
    const pageRows = slice.map((r) => (swing?.has(r.team) ? { ...r, swing: swing.get(r.team)! } : r));
    const unranked = live ? await unrankedTeams(q.season, q.place) : [];
    let asked: AskedTeam | undefined;
    if (q.team != null) {
      const r = at >= 0 ? sorted[at] : null;
      asked = r ? { team: r.team, name: r.name, status: "ranked", rank: r.rank, page: Math.floor(at / REGION_PAGE_SIZE) + 1 } : await askedElsewhere(q.season, q.team, q.place, unranked, q.week);
    }
    const regionKey = placeKey(q.place);
    return {
      season: q.season, week: q.week, asOf: q.week ? new Date(`${q.week}T00:00:00Z`).toISOString() : await dataVersion().then((v) => (v === "0" ? null : v)),
      baseline: prev ? base : null, weeks,
      region: { key: regionKey, country: q.place.country, state: q.place.state, name: regionName(regionKey) },
      total: region.length, worldRanked: list.length, stats: live, sort: q.sort, page, pages, pageSize: REGION_PAGE_SIZE, rows: pageRows,
      ...movers(region),
      unranked: unranked.slice(0, UNRANKED_LIST_MAX), unrankedTotal: unranked.length,
      leagues: leagues.filter((l) => leagueIn(l, q.place)),
      ...(asked ? { asked } : {}),
    };
  });
}

/** Every region with ranked teams this season: each country, and each of its states or provinces we can name. */
export async function regionsList(season: number): Promise<RegionsResponse> {
  return regionsMemo(`${await dataVersion()}|${season}`, async () => {
    const [list, leagues] = await Promise.all([liveList(season), seasonLeagueList(season)]);
    const by = new Map<string, RegionListItem>();
    const add = (p: PlaceFilter, t: (typeof list)[number]) => {
      const key = placeKey(p);
      const r = by.get(key);
      // The list is in rank order, so a region's first team is its top team.
      if (r) r.teams++;
      else by.set(key, { key, country: p.country, state: p.state, name: regionName(key), teams: 1, top: { team: Number(t.team), name: t.name ?? null, rating: t.rating }, leagues: 0 });
    };
    for (const t of list) {
      if (!t.country) continue;
      add({ country: t.country, state: null }, t);
      const st = t.state?.toUpperCase();
      if (st && namedState(t.country, st)) add({ country: t.country, state: st }, t);
    }
    for (const r of by.values()) r.leagues = leagues.filter((l) => leagueIn(l, r)).length;
    return { season, regions: [...by.values()].sort((a, b) => b.teams - a.teams || a.name.localeCompare(b.name)) };
  });
}

/** A team's place in its home region (state where named, else country) for the team page's "Rank in" link: rank null
 *  when the team isn't ranked (yet) that season. Null when its home isn't known. */
export async function teamRegionRank(season: number, team: number, country: string | null, state: string | null): Promise<{ key: string; name: string; rank: number | null; of: number } | null> {
  const home = homeRegion(country, state);
  if (!home) return null;
  const list = (await liveList(season)).filter((t) => inPlaces(t, [home]));
  const i = list.findIndex((t) => Number(t.team) === team);
  const key = placeKey(home);
  return { key, name: regionName(key), rank: i < 0 ? null : i + 1, of: list.length };
}
