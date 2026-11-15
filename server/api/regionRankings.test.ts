// /api/rankings/region, /api/rankings/regions and /api/leagues end to end on an in-memory database: a region's rank is
// its place in /api/rankings?region= (same teams, same order, same ratings), its stats are the season's, moves are
// counted in the region against last week's snapshot (worked out by hand below), sorting never renumbers, ?team=
// opens that team's page, unranked teams are labeled, an empty region says so, and another season is all its own.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { CURRENT_SEASON } from "../data/seasons";
import { WEEK_MS, weekOf, type RankingsResponse } from "../../src/shared/rankings";
import { regionHref, sortRows, unrankedLabel, type LeaguesResponse, type RegionRankingsResponse, type RegionsResponse } from "../../src/shared/regionRankings";

let server: Server;
let base = "";
const S = CURRENT_SEASON, PAST = CURRENT_SEASON - 1;
const W1 = weekOf(Date.now() - WEEK_MS);

async function team(n: number, name: string, state: string | null, country: string | null) {
  await run("INSERT INTO teams (number, name, state, country) VALUES (?, ?, ?, ?)", [n, name, state, country]);
}
async function stats(season: number, n: number, rating: number | null, rated: number, o: { opr?: number | null; w?: number; l?: number; t?: number; ev?: number } = {}) {
  await run("INSERT INTO team_season_stats (season, team, rating_np, rating_matches, matches, opr_np, wins, losses, ties, events) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [season, n, rating, rated, rated, o.opr ?? null, o.w ?? 0, o.l ?? 0, o.t ?? 0, o.ev ?? 0]);
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // New Jersey: 4215 and four more ranked; 9001 has 2 rated matches, 9002 none (on an event's team list). One Texas team
  // sits between them in the world list, so world ranks and New Jersey ranks differ.
  await team(4215, "Bionic Bulldogs", "NJ", "USA");
  await team(5001, "Jersey A", "NJ", "USA");
  await team(5002, "Jersey B", "NJ", "USA");
  await team(5003, "Jersey C", "nj", "USA");
  await team(5004, "Jersey D", "NJ", "USA");
  await team(7001, "Texan", "TX", "USA");
  await team(9001, "Two Matches", "NJ", "USA");
  await team(9002, "No Matches", "NJ", "USA");
  await stats(S, 5001, 90, 30, { opr: 80, w: 20, l: 2, ev: 4 });
  await stats(S, 7001, 85, 10, { opr: 70, w: 5, l: 5, ev: 2 });
  await stats(S, 4215, 80, 12, { opr: 95.25, w: 8, l: 4, t: 1, ev: 3 });
  await stats(S, 5002, 70, 3, { opr: null, w: 1, l: 2, ev: 1 });
  await stats(S, 5003, 60, 20, { opr: 50, w: 15, l: 0, ev: 5 });
  await stats(S, 5004, 50, 8, { opr: 40, w: 2, l: 6, ev: 2 });
  await stats(S, 9001, 99, 2, { opr: 30, w: 1, l: 1, ev: 1 });
  await run("INSERT INTO events (season, code, name, type, state, country, region, league, source) VALUES (?, 'NJM1', 'NJ Meet 1', 'LeagueMeet', 'NJ', 'USA', 'USNJ', 'NE', 'first')", [S]);
  await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'NJM1', 9002)", [S]);
  await run("INSERT INTO leagues (season, region, code, name) VALUES (?, 'USNJ', 'NE', 'Northeast')", [S]);
  await run("INSERT INTO league_rankings (season, region, league, team, rank, wins, losses, ties, rs, played) VALUES (?, 'USNJ', 'NE', 5003, 1, 5, 0, 0, 2.4, 5), (?, 'USNJ', 'NE', 4215, 2, 4, 1, 0, 2.0, 5)", [S, S]);
  // Last week, in New Jersey: 4215 led, then 5003, 5001, 5004. 5002 wasn't ranked.
  // World ranks then: 4215 1, 7001 2, 5003 3, 5001 4, 5004 5.
  for (const [t, rank, rating] of [[4215, 1, 82], [7001, 2, 80], [5003, 3, 70], [5001, 4, 65], [5004, 5, 49]])
    await run("INSERT INTO ranking_snapshots (season, week, team, rank, rating) VALUES (?, ?, ?, ?, ?)", [S, W1, t, rank, rating]);
  await run("INSERT INTO ranking_weeks (season, week, teams, taken_at) VALUES (?, ?, 5, ?)", [S, W1, new Date().toISOString()]);
  // 130 more New Jersey teams, for pages: 4215's row moves to page 3 when sorted by events (it has 3, they have 10).
  for (let i = 0; i < 130; i++) { await team(20000 + i, `Filler ${i}`, "NJ", "USA"); await stats(S, 20000 + i, 40 - i * 0.1, 5, { opr: 10, w: 1, l: 1, ev: 10 }); }
  // Last season: 4215 only, with other numbers.
  await stats(PAST, 4215, 140, 40, { opr: 141, w: 30, l: 10, ev: 8 });
  // Wyoming: a team, no rated team.
  await team(8001, "Cowboys", "WY", "USA");
  await stats(S, 8001, null, 0);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

const get = async <T,>(path: string): Promise<T> => { const r = await fetch(base + path); expect(r.status, path).toBe(200); return r.json() as Promise<T>; };
const region = (q: string) => get<RegionRankingsResponse>(`/api/rankings/region?${q}`);

describe("the region table", () => {
  it("ranks New Jersey's teams in world order, with the same ratings /rankings?region= shows", async () => {
    const r = await region(`season=${S}&region=USA:NJ`);
    const world = await get<RankingsResponse>(`/api/rankings?season=${S}&region=USA:NJ`);
    expect(r.region).toMatchObject({ key: "USA:NJ", name: "New Jersey" });
    expect(r.total).toBe(world.total);
    expect(r.rows.map((x) => [x.team, x.rating, x.world])).toEqual(world.rows.map((x) => [x.team, x.rating, x.rank]));
    expect(r.rows.slice(0, 5).map((x) => [x.rank, x.world, x.team])).toEqual([[1, 1, 5001], [2, 3, 4215], [3, 4, 5002], [4, 5, 5003], [5, 6, 5004]]);
  });

  it("shows 4215's record, OPR, events and rated matches for the season", async () => {
    const r = await region(`season=${S}&region=USA:NJ`);
    expect(r.rows.find((x) => x.team === 4215)).toMatchObject({ rank: 2, rating: 80, opr: 95.25, wins: 8, losses: 4, ties: 1, events: 3, ratedMatches: 12 });
    // No OPR: null (the page shows —), never a made-up number.
    expect(r.rows.find((x) => x.team === 5002)?.opr).toBeNull();
    expect(r.stats).toBe(true);
  });

  it("counts moves in the region against last week, with climbers, fallers and new teams", async () => {
    const r = await region(`season=${S}&region=USA:NJ`);
    const m = Object.fromEntries(r.rows.slice(0, 5).map((x) => [x.team, x.move]));
    // NJ then: 4215 1, 5003 2, 5001 3, 5004 4. Now: 5001 1, 4215 2, 5002 3, 5003 4, 5004 5.
    expect(m).toEqual({ 5001: 2, 4215: -1, 5002: "new", 5003: -2, 5004: -1 });
    expect(r.baseline).toBe(W1);
    expect(r.climbers).toEqual([{ team: 5001, name: "Jersey A", rank: 1, rating: 90, move: 2 }]);
    expect(r.fallers.map((x) => [x.team, x.move])).toEqual([[5003, -2], [4215, -1], [5004, -1]]);
    expect(r.newcomers[0]).toEqual({ team: 5002, name: "Jersey B", rank: 3, rating: 70 });
    // The fillers weren't in the snapshot: new too.
    expect(r.newTotal).toBe(131);
  });

  it("sorts by OPR, record, events and move without renumbering", async () => {
    for (const sort of ["opr", "record", "events", "move", "rating"] as const) {
      const r = await region(`season=${S}&region=USA:NJ&sort=${sort}`);
      const all = (await Promise.all(Array.from({ length: r.pages }, (_, i) => region(`season=${S}&region=USA:NJ&sort=${sort}&page=${i + 1}`)))).flatMap((p) => p.rows);
      const byTeam = new Map((await Promise.all([1, 2, 3].map((p) => region(`season=${S}&region=USA:NJ&page=${p}`)))).flatMap((p) => p.rows).map((x) => [x.team, x.rank]));
      expect(all.every((x) => byTeam.get(x.team) === x.rank), sort).toBe(true);
      expect(new Set(all.map((x) => x.rank)).size).toBe(r.total);
    }
    expect((await region(`season=${S}&region=USA:NJ&sort=opr`)).rows[0].team).toBe(4215);
    expect((await region(`season=${S}&region=USA:NJ&sort=record`)).rows[0].team).toBe(5003);
    // Missing OPR sorts last.
    const opr = sortRows((await region(`season=${S}&region=USA:NJ`)).rows, "opr");
    expect(opr.at(-1)?.team).toBe(5002);
  });

  it("opens the page a team is on, and says where it is", async () => {
    const r = await region(`season=${S}&region=USA:NJ&sort=events&team=4215`);
    expect(r.page).toBe(3);
    expect(r.rows.some((x) => x.team === 4215)).toBe(true);
    expect(r.asked).toEqual({ team: 4215, name: "Bionic Bulldogs", status: "ranked", rank: 2, page: 3 });
    // A page asked for wins over the team's page.
    expect((await region(`season=${S}&region=USA:NJ&sort=events&team=4215&page=1`)).page).toBe(1);
    expect(regionHref("USA:NJ", { season: S, team: 4215, page: 3, sort: "events" })).toBe(`/rankings/regions/USA/NJ?season=${S}&sort=events&page=3&team=4215`);
  });

  it("labels unranked teams, never ranking them", async () => {
    const r = await region(`season=${S}&region=USA:NJ`);
    expect(r.unranked).toEqual([{ team: 9001, name: "Two Matches", ratedMatches: 2 }, { team: 9002, name: "No Matches", ratedMatches: 0 }]);
    expect(r.rows.some((x) => x.team === 9001 || x.team === 9002)).toBe(false);
    expect(unrankedLabel(2)).toBe("Not ranked yet — 2 of 3 rated matches");
    expect(unrankedLabel(0)).toBe("No rated matches yet");
    expect((await region(`season=${S}&region=USA:NJ&team=9001`)).asked).toEqual({ team: 9001, name: "Two Matches", status: "unranked", ratedMatches: 2 });
    expect((await region(`season=${S}&region=USA:NJ&team=7001`)).asked).toEqual({ team: 7001, name: "Texan", status: "elsewhere", region: "USA:TX" });
  });

  it("says a region with no rated teams has none", async () => {
    const r = await region(`season=${S}&region=USA:WY`);
    expect(r).toMatchObject({ total: 0, rows: [], region: { name: "Wyoming" } });
    expect(r.unranked).toEqual([{ team: 8001, name: "Cowboys", ratedMatches: 0 }]);
  });

  it("another season is that season's numbers only", async () => {
    const r = await region(`season=${PAST}&region=USA:NJ`);
    expect(r.season).toBe(PAST);
    expect(r.rows).toEqual([expect.objectContaining({ team: 4215, rank: 1, rating: 140, opr: 141, wins: 30, events: 8, ratedMatches: 40 })]);
    // A finished season has no "this week": no moves.
    expect(r.baseline).toBeNull();
    expect(r.climbers).toEqual([]);
  });

  it("a past week shows its saved ranks and ratings, without today's stats", async () => {
    const r = await region(`season=${S}&region=USA:NJ&week=${W1}`);
    expect(r.stats).toBe(false);
    expect(r.rows.map((x) => [x.rank, x.team, x.rating, x.opr])).toEqual([[1, 4215, 82, null], [2, 5003, 70, null], [3, 5001, 65, null], [4, 5004, 49, null]]);
    expect(r.unranked).toEqual([]);
    // 5002 is from New Jersey but wasn't in that week's ranking: said so, not labeled by today's rated matches.
    expect((await region(`season=${S}&region=USA:NJ&week=${W1}&team=5002`)).asked).toEqual({ team: 5002, name: "Jersey B", status: "notInWeek", week: W1 });
    expect((await region(`season=${S}&region=USA:NJ&week=${W1}&team=9001`)).asked).toEqual({ team: 9001, name: "Two Matches", status: "notInWeek", week: W1 });
  });

  it("lists the region's leagues", async () => {
    const r = await region(`season=${S}&region=USA:NJ`);
    expect(r.leagues).toEqual([expect.objectContaining({ region: "USNJ", code: "NE", name: "Northeast", place: "USA:NJ", placeName: "New Jersey", meets: 1, meetsPlayed: 0, teams: 2, top: { team: 5003, name: "Jersey C", rs: 2.4 } })]);
    expect((await region(`season=${S}&region=USA:TX`)).leagues).toEqual([]);
  });

  it("refuses more than one place or an unknown sort", async () => {
    expect((await fetch(`${base}/api/rankings/region?season=${S}&region=USA:NJ,USA:TX`)).status).toBe(400);
    expect((await fetch(`${base}/api/rankings/region?season=${S}&region=USA:NJ&sort=name`)).status).toBe(400);
  });
});

describe("the regions list", () => {
  it("lists every country and named state with ranked teams, most teams first, with its top team", async () => {
    const r = await get<RegionsResponse>(`/api/rankings/regions?season=${S}`);
    expect(r.regions.map((x) => [x.key, x.teams, x.top.team, x.leagues])).toEqual([["USA", 136, 5001, 1], ["USA:NJ", 135, 5001, 1], ["USA:TX", 1, 7001, 0]]);
    expect(r.regions[1].name).toBe("New Jersey");
  });
});

describe("the leagues list", () => {
  it("lists the season's leagues with where they play and FIRST's #1", async () => {
    const r = await get<LeaguesResponse>(`/api/leagues?season=${S}`);
    expect(r.leagues).toEqual([expect.objectContaining({ code: "NE", placeName: "New Jersey", teams: 2, top: { team: 5003, name: "Jersey C", rs: 2.4 } })]);
    expect((await get<LeaguesResponse>(`/api/leagues?season=${PAST}`)).leagues).toEqual([]);
  });
});

describe("links in", () => {
  it("the team page carries the team's place in its home region, and the link opens its page with its row", async () => {
    const t = await get<{ region: { key: string; name: string; rank: number | null; of: number } | null }>(`/api/teams/4215?season=${S}`);
    expect(t.region).toEqual({ key: "USA:NJ", name: "New Jersey", rank: 2, of: 135 });
    expect((await get<{ region: unknown }>(`/api/teams/9001?season=${S}`)).region).toEqual({ key: "USA:NJ", name: "New Jersey", rank: null, of: 135 });
    const r = await region(`season=${S}&region=USA:NJ&team=4215`);
    expect(r.page).toBe(1);
    expect(r.rows.some((x) => x.team === 4215)).toBe(true);
  });

  it("titles the region pages for previews and search engines, and a bad place is not found", async () => {
    const { pageMeta } = await import("../seoMeta");
    const m = await pageMeta("/rankings/regions/USA/NJ", { season: String(S) });
    expect(m.title).toMatch(/^FTC rankings: New Jersey /);
    expect(m.description).toContain("#1: 5001 Jersey A (90.0)");
    expect(m.path).toBe(`/rankings/regions/USA/NJ?season=${S}`);
    expect((await pageMeta("/rankings/regions", {})).title).toMatch(/^FTC rankings by region /);
    expect((await pageMeta("/rankings/regions/USA/N!J", {})).notFound).toBe(true);
    expect((await pageMeta("/rankings/regions/%E0", {})).notFound).toBe(true);
  });
});
