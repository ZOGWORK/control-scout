// GET /api/directory/:season (the /teams?view=listed directory, E1): every registered
// team, results or not; a country is the same set the home page's atlas counts (its
// spellings merged), with the same totals; zero-result countries are browsable;
// paging, sorting and seasons stay apart; bad input is refused.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { CURRENT_SEASON } from "../data/seasons";
import { clearAllCaches } from "../caches";
import type { DirectoryPage } from "../../src/shared/directory";
import type { HomeOverview } from "../../src/shared/home";

const S = CURRENT_SEASON, P = CURRENT_SEASON - 1;
let server: Server;
let base = "";
const getJson = async <T>(path: string) => { const r = await fetch(`${base}${path}`); return { status: r.status, body: (await r.json()) as T }; };
const dir = (q = "", season = S) => getJson<DirectoryPage>(`/api/directory/${season}${q ? `?${q}` : ""}`);

// [number, name, country label, rookie year]
const TEAMS: [number, string | null, string | null, number | null][] = [
  [10, "Zeta", "USA", 2015], [11, "alpha", "United States", 2020], [12, "Mu", "USA", null], [13, null, "USA", 2019],
  [20, "Kebab", "Türkiye", 2018], [21, "Lokum", "Turkey", 2021],
  [30, "Maple", "Canada", 2022], [31, "Moose", "Canada", 2023],
  [40, "Solo", "Independent", 2010], [41, "Blank", null, 2011],
];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name, country, rookie] of TEAMS) {
    await run("INSERT INTO teams (number, name, country, rookie_year) VALUES (?, ?, ?, ?)", [n, name, country, rookie]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  await run("INSERT INTO team_seasons (season, team) VALUES (?, 99)", [S]); // registered, no directory entry
  await run("INSERT INTO team_seasons (season, team) VALUES (?, 10), (?, 30)", [P, P]); // last season: two teams
  // Results this season: 10, 12 and 20. Canada has listings and no results.
  for (const t of [10, 12, 20]) await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, ?, ?)", [S, t, `Team ${t}`]);
  await run("INSERT INTO seasons (season, name, last_sync) VALUES (?, 'Test', '2026-10-17T12:00:00.000Z')", [S]);
  await kvSet(`records:at:${S}`, { at: "2026-10-17T12:05:00.000Z" });
  clearAllCaches();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

describe("GET /api/directory/:season", () => {
  it("lists every registered team, with and without results, and says how many can't be placed", async () => {
    const { status, body } = await dir();
    expect(status).toBe(200);
    expect(body.total).toBe(11);
    expect(body.withResults).toBe(3);
    expect(body.unplaced).toBe(3); // Independent, blank, and the number with no directory entry
    expect(body.rows.map((r) => r.team)).toEqual([10, 11, 12, 13, 20, 21, 30, 31, 40, 41, 99]);
    expect(body.rows.find((r) => r.team === 99)).toMatchObject({ name: null, country: null, hasResults: false });
    expect(body.readiness.state).toBe("ready");
  });

  it("filters by country under every spelling, with totals that match the atlas", async () => {
    const us = await dir("country=US");
    expect(us.body.rows.map((r) => [r.team, r.hasResults])).toEqual([[10, true], [11, false], [12, true], [13, false]]);
    expect(us.body).toMatchObject({ country: "US", total: 4, withResults: 2 });
    const tr = await dir("country=tr");
    expect(tr.body).toMatchObject({ country: "TR", total: 2, withResults: 1 });
    const { body: overview } = await getJson<HomeOverview>(`/api/home/overview?season=${S}`);
    for (const c of overview.countries) {
      const d = await dir(`country=${c.code}`);
      expect([d.body.total, d.body.withResults], c.code).toEqual([c.listings, c.withResults]);
    }
    // Countries + the unplaced add up to the season's listings, on both pages.
    expect(overview.countries.reduce((a, c) => a + c.listings, 0) + us.body.unplaced).toBe(overview.coverage.teamListings);
  });

  it("keeps a country with no results browsable", async () => {
    const ca = await dir("country=CA");
    expect(ca.body).toMatchObject({ total: 2, withResults: 0 });
    expect(ca.body.rows.map((r) => r.team)).toEqual([30, 31]);
    const fr = await dir("country=FR");
    expect(fr.status).toBe(200);
    expect(fr.body.total).toBe(0);
  });

  it("keeps seasons apart", async () => {
    const last = await dir("", P);
    expect(last.body.total).toBe(2);
    expect(last.body.withResults).toBe(0);
    expect((await dir("country=CA", P)).body.rows.map((r) => r.team)).toEqual([30]);
  });

  it("sorts with blanks last and pages without repeating a team", async () => {
    expect((await dir("country=US&sort=name")).body.rows.map((r) => r.team)).toEqual([11, 12, 10, 13]);
    expect((await dir("country=US&sort=name&dir=desc")).body.rows.map((r) => r.team)).toEqual([10, 12, 11, 13]);
    expect((await dir("country=US&sort=rookie")).body.rows.map((r) => r.team)).toEqual([10, 13, 11, 12]);
    expect((await dir("country=US&sort=results")).body.rows.map((r) => r.team)).toEqual([10, 12, 11, 13]);
    const seen: number[] = [];
    for (let page = 1; page <= 4; page++) {
      const r = await dir(`sort=name&pageSize=3&page=${page}`);
      expect(r.body.total).toBe(11);
      seen.push(...r.body.rows.map((x) => x.team));
    }
    expect(seen.length).toBe(11);
    expect(new Set(seen).size).toBe(11);
  });

  it("refuses what it can't read", async () => {
    expect((await dir("country=ZZ")).status).toBe(400);
    expect((await dir("country=USA")).status).toBe(400);
    expect((await dir("sort=opr")).status).toBe(400);
    expect((await dir("dir=up")).status).toBe(400);
    expect((await dir("page=0")).status).toBe(400);
    expect((await dir("pageSize=500")).status).toBe(400);
    expect((await dir("country=US&country=CA")).status).toBe(400);
    expect((await fetch(`${base}/api/directory/1999`)).status).toBe(400);
  });

  it("needs no account", async () => {
    const r = await fetch(`${base}/api/directory/${S}?country=US`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/^public/);
  });

  it("isn't cached while the statistics are behind, so Check again reaches the server", async () => {
    await kvSet(`results:at:${S}`, { at: "2026-10-17T13:00:00.000Z" });
    await run("INSERT INTO events (season, code, name, type, remote, hybrid, source) VALUES (?, 'Q9', 'Q9', 'Qualifier', 0, 0, 'test')", [S]);
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_np, blue_np, source) VALUES (?, 'Q9', 'qual', 0, 1, 'Q1', 1, 10, 20, 'test')", [S]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, 'Q9', 'qual', 0, 1, 10, 'red')", [S]);
    clearAllCaches();
    for (const path of [`/api/directory/${S}`, `/api/home/overview?season=${S}`]) {
      const r = await fetch(`${base}${path}`);
      expect(r.headers.get("cache-control"), path).toBe("no-store");
    }
  });
});
