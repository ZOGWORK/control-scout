// GET /api/home/overview (season coverage, teams by country: aliases, unmapped
// labels, each team once, season isolation, cache by data version) and the
// /teams country filter it links to (?country=: same normalisation, whole-season
// counts and pages).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { CURRENT_SEASON } from "../data/seasons";
import { clearAllCaches } from "../caches";
import { buildOverview, groupByCountry } from "./home";
import type { HomeOverview } from "../../src/shared/home";

const S = CURRENT_SEASON, P = CURRENT_SEASON - 1;
let server: Server;
let base = "";
const getJson = async <T>(path: string) => { const r = await fetch(`${base}${path}`); return { status: r.status, body: (await r.json()) as T, headers: r.headers }; };

// [number, country label] — the directory's own spellings, aliases and gaps included.
const TEAMS: [number, string | null][] = [
  [1, "USA"], [2, "USA"], [3, "United States"], [4, "Türkiye"], [5, "Turkey"], [6, "eSwatini"], [7, "Eswatini"],
  [8, "Independent"], [9, null], [10, "  "], [11, "Atlantis"], [12, "Canada"],
];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, country] of TEAMS) await run("INSERT INTO teams (number, name, country) VALUES (?, ?, ?)", [n, `Team ${n}`, country]);
  for (const [n] of TEAMS) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  await run("INSERT INTO team_seasons (season, team) VALUES (?, 13)", [S]); // registered, no directory entry at all
  // Last season: only two teams, so a season's counts can't leak into another's.
  await run("INSERT INTO team_seasons (season, team) VALUES (?, 1), (?, 12)", [P, P]);
  // Played this season (team-season records): 1 and 4 only.
  for (const t of [1, 4]) await run("INSERT INTO team_season_records (season, team, team_name, np_opr) VALUES (?, ?, ?, ?)", [S, t, `Team ${t}`, 50 + t]);
  // Events: two competitions and a kickoff (not counted).
  for (const [code, type] of [["Q1", "Qualifier"], ["Q2", "LeagueMeet"], ["K1", "Kickoff"]])
    await run("INSERT INTO events (season, code, name, type, remote, hybrid, source) VALUES (?, ?, ?, ?, 0, 0, 'test')", [S, code, code, type]);
  // Three matches, two scored.
  for (const [n, played] of [[1, 1], [2, 1], [3, 0]])
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, 'Q1', 'qual', 0, ?, ?, ?, 'test')", [S, n, `Q${n}`, played]);
  await kvSet("sync:last", { at: "2026-10-17T12:00:00.000Z" });
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

describe("GET /api/home/overview", () => {
  it("counts the season's coverage", async () => {
    const { status, body } = await getJson<HomeOverview>(`/api/home/overview?season=${S}`);
    expect(status).toBe(200);
    expect(body.season).toBe(S);
    expect(body.coverage).toEqual({ teamListings: 13, events: 2, matchScores: 2 });
    expect(body.dataAsOf).toBe("2026-10-17T12:00:00.000Z");
    expect(Date.parse(body.generatedAt)).not.toBeNaN();
  });

  it("merges a country's spellings, keeps unmapped labels apart, and reconciles with the total", async () => {
    const { body } = await getJson<HomeOverview>(`/api/home/overview?season=${S}`);
    expect(body.countries).toEqual([
      { code: "US", numeric: "840", name: "United States", listings: 3, withResults: 1 },
      { code: "SZ", numeric: "748", name: "Eswatini", listings: 2, withResults: 0 },
      { code: "TR", numeric: "792", name: "Türkiye", listings: 2, withResults: 1 },
      { code: "CA", numeric: "124", name: "Canada", listings: 1, withResults: 0 },
    ]);
    // Blank and missing labels (and a team with no directory entry) are one "not reported" bucket.
    expect(body.unmapped).toEqual([
      { label: null, listings: 3 },
      { label: "Atlantis", listings: 1 },
      { label: "Independent", listings: 1 },
    ]);
    const sum = body.countries.reduce((a, c) => a + c.listings, 0) + body.unmapped.reduce((a, u) => a + u.listings, 0);
    expect(sum).toBe(body.coverage.teamListings);
  });

  it("keeps seasons apart", async () => {
    const { body } = await getJson<HomeOverview>(`/api/home/overview?season=${P}`);
    expect(body.coverage.teamListings).toBe(2);
    expect(body.countries.map((c) => [c.code, c.listings])).toEqual([["CA", 1], ["US", 1]]);
    expect(body.unmapped).toEqual([]);
  });

  it("answers an empty season with zeroes and no countries", async () => {
    const empty = await buildOverview(S - 2);
    expect(empty.coverage).toEqual({ teamListings: 0, events: 0, matchScores: 0 });
    expect(empty.countries).toEqual([]);
    expect(empty.unmapped).toEqual([]);
  });

  it("rejects a season it doesn't cover", async () => {
    expect((await fetch(`${base}/api/home/overview?season=1999`)).status).toBe(400);
    expect((await fetch(`${base}/api/home/overview?season=abc`)).status).toBe(400);
  });

  it("is publicly cacheable", async () => {
    const { headers } = await getJson(`/api/home/overview?season=${S}`);
    expect(headers.get("cache-control")).toMatch(/^public/);
  });

  it("is rebuilt when the data version moves, not before", async () => {
    clearAllCaches();
    const first = await getJson<HomeOverview>(`/api/home/overview?season=${S}`);
    await run("INSERT INTO teams (number, name, country) VALUES (14, 'Team 14', 'Canada')");
    await run("INSERT INTO team_seasons (season, team) VALUES (?, 14)", [S]);
    const cached = await getJson<HomeOverview>(`/api/home/overview?season=${S}`);
    expect(cached.body.coverage.teamListings).toBe(first.body.coverage.teamListings);
    await kvSet("data:version", "v-next");
    const fresh = await getJson<HomeOverview>(`/api/home/overview?season=${S}`);
    expect(fresh.body.coverage.teamListings).toBe(first.body.coverage.teamListings + 1);
    expect(fresh.body.countries.find((c) => c.code === "CA")?.listings).toBe(2);
    await run("DELETE FROM team_seasons WHERE season = ? AND team = 14", [S]);
    await run("DELETE FROM teams WHERE number = 14");
    await kvSet("data:version", "v-after");
  });
});

describe("groupByCountry", () => {
  it("never drops or double-counts a listing", () => {
    const rows = [
      { label: "USA", listings: 5, withResults: 2 }, { label: "United States of America", listings: 1, withResults: 1 },
      { label: null, listings: 2, withResults: 0 }, { label: "", listings: 1, withResults: 0 }, { label: "Narnia", listings: 4, withResults: 0 },
    ];
    const g = groupByCountry(rows);
    expect(g.countries).toEqual([{ code: "US", numeric: "840", name: "United States", listings: 6, withResults: 3 }]);
    expect(g.unmapped).toEqual([{ label: "Narnia", listings: 4 }, { label: null, listings: 3 }]);
  });
});

describe("GET /api/records/:season/teams?country=", () => {
  type Page = { total: number; page: number; rows: { team: number }[] };
  const teams = (q: string) => getJson<Page>(`/api/records/${S}/teams?scope=season&sort=teamNumber&dir=asc&fields=teamName&${q}`);

  it("lists the teams whose directory reports the country, under any of its spellings", async () => {
    await run("INSERT INTO team_season_records (season, team, team_name, np_opr) VALUES (?, 5, 'Team 5', 40), (?, 2, 'Team 2', 30), (?, 3, 'Team 3', 20)", [S, S, S]);
    clearAllCaches();
    const us = await teams("country=US");
    expect(us.status).toBe(200);
    expect(us.body.total).toBe(3);
    expect(us.body.rows.map((r) => r.team)).toEqual([1, 2, 3]);
    const tr = await teams("country=tr");
    expect(tr.body.rows.map((r) => r.team)).toEqual([4, 5]);
    await run("DELETE FROM team_season_records WHERE season = ? AND team IN (2, 3, 5)", [S]);
  });

  it("filters the whole season before paging, so the count and every page agree", async () => {
    for (let t = 100; t < 125; t++) {
      await run("INSERT INTO teams (number, name, country) VALUES (?, ?, ?)", [t, `Team ${t}`, t % 2 ? "Canada" : "USA"]);
      await run("INSERT INTO team_season_records (season, team, team_name, np_opr) VALUES (?, ?, ?, ?)", [S, t, `Team ${t}`, t]);
    }
    clearAllCaches();
    const seen: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await teams(`country=CA&pageSize=5&page=${page}`);
      expect(r.body.total).toBe(12);
      seen.push(...r.body.rows.map((x) => x.team));
    }
    expect(seen).toEqual([101, 103, 105, 107, 109, 111, 113, 115, 117, 119, 121, 123]);
    expect(new Set(seen).size).toBe(seen.length);
    // Team-event records filter by the team's country too.
    await run("INSERT INTO team_event_records (season, code, team, event_name, team_name) VALUES (?, 'Q1', 101, 'Q1', 'Team 101'), (?, 'Q1', 102, 'Q1', 'Team 102')", [S, S]);
    const ev = await getJson<Page>(`/api/records/${S}/teams?sort=teamNumber&dir=asc&fields=teamName&country=CA`);
    expect(ev.body.rows.map((r) => r.team)).toEqual([101]);
  });

  it("answers a country with no teams with no rows, and refuses what isn't a country", async () => {
    const none = await teams("country=FR");
    expect(none.status).toBe(200);
    expect(none.body.total).toBe(0);
    expect((await teams("country=ZZ")).status).toBe(400);
    expect((await teams("country=USA")).status).toBe(400);
    expect((await fetch(`${base}/api/records/${S}/matches?country=US`)).status).toBe(400);
  });

  it("exports the same rows as CSV", async () => {
    const r = await fetch(`${base}/api/records/${S}/teams?scope=season&sort=teamNumber&dir=asc&fields=teamName&country=TR&format=csv`);
    expect(r.status).toBe(200);
    const lines = (await r.text()).trim().split(/\r\n/);
    expect(lines.slice(1).map((l) => Number(l.split(",")[1]))).toEqual([4]);
  });
});
