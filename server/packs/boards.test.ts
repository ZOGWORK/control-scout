// Offline leaderboards give the server's numbers (the brief's "same numbers as online"): a season pack is built from
// an in-memory database (buildFull, the real builder), opened as the app opens it (sql.js), and every board path is
// answered offline (src/lib/offline/boards.ts) and compared with the server's own HTTP answer for the same path:
// the world ranking (live, a place filter, page 2, the latest weeks, places with "my region"), records (the default
// pages cut to the columns a table asks for), league standings, the events lists and power rankings. Also: a view
// the pack doesn't hold says so, unofficial records stay marked, and the event pack carries its league's standings.
import type { AddressInfo } from "node:net";
import { get as httpGet, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setFlag } from "../flags";
import { CURRENT_SEASON } from "../data/seasons";
import { buildFull } from "./build";
import { buildPackApi, setPackReads, PACK_READS } from "./eventApi";
import { eventDetail } from "../api/events";
import { WEEK_MS, weekOf } from "../../src/shared/rankings";
import { RANKING_PACK_WEEKS } from "../../src/shared/packSchema";
import { recordsBoardPath } from "../../src/shared/recordsBoard";
import { packLookup } from "../../src/shared/eventBundle";
import { wrap, type Db } from "../../src/lib/offline/readers";
import { NotSaved, readBoard, readRankingPlaces, readRankings } from "../../src/lib/offline/boards";
import { recordsUrl, type TableState } from "../../src/lib/records/urlState";
import type { RecordScope } from "../../src/shared/statCatalog";

const S = CURRENT_SEASON, PAST = 2025;
const W0 = weekOf(Date.now()), W1 = weekOf(Date.now() - WEEK_MS), W2 = weekOf(Date.now() - 2 * WEEK_MS), W3 = weekOf(Date.now() - 3 * WEEK_MS);
let server: Server;
let base = "";
let dir = "";
const packs = new Map<number, Db>();

const get = (path: string) => new Promise<{ status: number; body: any }>((resolve, reject) => {
  httpGet(base + path, (res) => {
    let text = "";
    res.setEncoding("utf8");
    res.on("data", (d) => { text += d; });
    res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null }));
  }).on("error", reject);
});

async function seed() {
  const teams: [number, string, string, string][] = [[101, "Alpha", "TX", "USA"], [102, "Bravo", "OK", "USA"], [103, "Charlie", "ON", "Canada"], [104, "Delta", "TX", "USA"], [105, "Echo", "B", "Romania"]];
  for (const [n, name, state, country] of teams) await run("INSERT INTO teams (number, name, state, country) VALUES (?, ?, ?, ?)", [n, name, state, country]);
  // 60 more rated teams in California (a second page), and a placeholder that is never ranked.
  for (let i = 0; i < 60; i++) await run("INSERT INTO teams (number, name, state, country) VALUES (?, ?, 'CA', 'USA')", [1000 + i, `Filler ${i}`]);
  await run("INSERT INTO teams (number, name) VALUES (9999, 'Off-Season Demo Team')");
  const rated = [[101, 90, 5], [102, 85, 6], [103, 85, 4], [104, 70, 8], [105, 60, 3], [9999, 120, 9], ...Array.from({ length: 60 }, (_, i) => [1000 + i, 50 - i * 0.25, 3])];
  for (const [t, r, n] of rated) await run("INSERT INTO team_season_stats (season, team, rating_np, rating_matches, matches) VALUES (?, ?, ?, ?, ?)", [S, t, r, n, n]);
  for (const [t, sw, n] of [[101, 0.42, 6], [102, 0.3, 2], [104, 0.55, 8]]) {
    await run(`INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows, recent_near_zero, swing, idx, computed_at)
      VALUES (?, '', ?, ?, 0, 0, 0, ?, ?, 0, 0, ?, 80, '2026-11-13T00:00:00Z')`, [S, t, n, n, n, sw]);
  }
  const snap = async (week: string, rows: [number, number, number][]) => {
    for (const [t, rank, rating] of rows) await run("INSERT INTO ranking_snapshots (season, week, team, rank, rating) VALUES (?, ?, ?, ?, ?)", [S, week, t, rank, rating]);
    await run("INSERT INTO ranking_weeks (season, week, teams, taken_at) VALUES (?, ?, ?, ?)", [S, week, rows.length, new Date().toISOString()]);
  };
  await snap(W3, [[101, 1, 5], [104, 2, 4]]);
  await snap(W2, [[101, 1, 10], [102, 2, 9], [103, 3, 8], [104, 4, 7]]);
  await snap(W1, [[104, 1, 75], [101, 2, 70], [9999, 3, 68], [103, 4, 65], [102, 5, 60]]);
  await snap(W0, [[101, 1, 89], [102, 2, 84], [103, 3, 84], [104, 4, 71], [105, 5, 59]]);
  // Events: a league meet (with its league's standings) and a qualifier, each with a played match.
  for (const [season, code, name, type, league] of [[S, "USTXLM1", "Texas League Meet 1", "LeagueMeet", "LS"], [S, "USTXQ1", "Texas Qualifier", "Qualifier", null], [PAST, "FPECAR", "Carolinas Premier Event", "Premier", null], [PAST, "USNCQ1", "Carolina Qualifier", "Qualifier", null]] as const) {
    await run("INSERT INTO events (season, code, name, type, region, league, city, state, country, start, end, remote, hybrid, source) VALUES (?, ?, ?, ?, 'USTX', ?, 'Austin', 'TX', 'USA', '2026-10-10', '2026-10-10', 0, 0, 'test')", [season, code, name, type, league]);
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
      blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, 1, 'Q1', '2026-10-10T10:00:00', 1, 90, 90, 20, 50, 20, 0, 60, 60, 10, 40, 10, 0, 'test')`, [season, code]);
    for (const [team, alliance, station] of [[101, "red", 1], [102, "red", 2], [103, "blue", 1], [104, "blue", 2]] as const) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station, surrogate, on_field) VALUES (?, ?, 'qual', 0, 1, ?, ?, ?, 0, 1)", [season, code, team, alliance, station]);
      await run("INSERT OR IGNORE INTO event_teams (season, code, team, rank, wins, losses, ties, qual_played) VALUES (?, ?, ?, ?, 1, 0, 0, 1)", [season, code, team, station]);
    }
  }
  await run("INSERT INTO leagues (season, region, code, name, location, ranked_at) VALUES (?, 'USTX', 'LS', 'Lone Star League', 'Austin', '2026-11-13T20:09:00Z')", [S]);
  for (const [team, rank, rs] of [[101, 1, 2.5], [102, 2, 2], [103, 3, 1], [104, 4, 0.5]]) {
    await run("INSERT INTO league_rankings (season, region, league, team, rank, rs, tbp, wins, losses, ties, played, counted) VALUES (?, 'USTX', 'LS', ?, ?, ?, 40, 1, 0, 0, 1, 1)", [S, team, rank, rs]);
  }
  // Records: 70 team-events and team seasons (two pages and more), and match records, one of them not an official record.
  for (let i = 0; i < 70; i++) {
    const t = 1000 + (i % 60), code = i < 60 ? "USTXQ1" : "USTXLM1";
    await run("INSERT INTO team_event_records (season, code, team, event_name, event_type, event_region, event_start, team_name, rank, played, wins, losses, ties, np_opr, auto_opr, np_avg, np_max) VALUES (?, ?, ?, 'Texas', 'Qualifier', 'USTX', '2026-10-10', ?, ?, 5, 3, 2, 0, ?, ?, ?, ?)",
      [S, code, t, `Filler ${t - 1000}`, (i % 30) + 1, 100 - i * 1.37, 20 + (i % 7), 80 - i, 120 - i]);
  }
  for (let i = 0; i < 60; i++) await run("INSERT INTO team_season_records (season, team, team_name, events, played, wins, losses, ties, np_opr, np_avg) VALUES (?, ?, ?, 2, 10, 6, 4, 0, ?, ?)", [S, 1000 + i, `Filler ${i}`, 99 - i * 1.11, 70 - i]);
  for (const [season, code, n, high] of [[S, "USTXQ1", 1, 300], [S, "USTXQ1", 2, 280], [PAST, "FPECAR", 1, 999], [PAST, "USNCQ1", 1, 700]] as const) {
    await run("INSERT INTO match_records (season, code, level, series, number, label, event_name, event_type, event_start, red_teams, blue_teams, red_total, blue_total, high, combined, margin) VALUES (?, ?, 'qual', 0, ?, ?, 'Event', 'Qualifier', '2026-10-10', '101 102', '103 104', ?, 100, ?, ?, ?)",
      [season, code, n, `Q${n}`, high, high, high + 100, high - 100]);
  }
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await kvSet("data:version", "2026-11-14T01:09:00.000Z");
  await setFlag("powerRankings", true, "test");
  await seed();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = mkdtempSync(join(tmpdir(), "cs-boards-"));
  const SQL = await initSqlJs();
  for (const season of [S, PAST]) {
    const f = await buildFull(season, "2026-11-14.1", dir, () => {});
    packs.set(season, wrap(new SQL.Database(readFileSync(join(dir, f!.name)))));
  }
}, 120_000);
afterAll(() => { server?.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold it */ } });

/** The offline answer, as plain JSON (the offline mark is the app's, not part of the answer). */
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

describe("world ranking offline = the server's", () => {
  const paths = ["", "?region=USA:TX", "?region=USA,Canada", "?page=2", `?week=${W0}`, `?week=${W1}`];
  for (const q of paths) {
    it(`/api/rankings${q || " (live)"}`, async () => {
      const online = await get(`/api/rankings?season=${S}${q ? `&${q.slice(1)}` : ""}`);
      expect(online.status).toBe(200);
      const offline = await readRankings(packs.get(S)!, S, new URL(`http://x/${q}`).searchParams);
      expect(plain(offline)).toEqual(online.body);
    });
  }
  it("checks real movement and swing (not two empty answers)", async () => {
    const r = await readRankings(packs.get(S)!, S, new URLSearchParams());
    expect(r!.baseline).toBe(W1);
    expect(r!.rows[0]).toMatchObject({ team: 101, rank: 1, move: 1, swing: { value: 0.42 } });
    expect(r!.rows.some((x) => x.team === 9999)).toBe(false);
  });
  it("places, with my region", async () => {
    for (const team of [null, 104, 105]) {
      const online = await get(`/api/rankings/places?season=${S}${team ? `&team=${team}` : ""}`);
      expect(plain(await readRankingPlaces(packs.get(S)!, S, team))).toEqual(online.body);
    }
  });
  it(`keeps only the newest ${RANKING_PACK_WEEKS} weeks' rows; an older week says it needs a connection`, async () => {
    expect((await readRankings(packs.get(S)!, S, new URLSearchParams()))!.weeks).toEqual([W0, W1, W2, W3]);
    await expect(readRankings(packs.get(S)!, S, new URLSearchParams(`week=${W3}`))).rejects.toThrow(NotSaved);
  });
});

describe("boards offline = the server's", () => {
  it("records: season record line and regions", async () => {
    for (const p of [`/api/records/${S}/high-score`, `/api/records/${S}/regions`, `/api/records/${PAST}/high-score`]) {
      const season = Number(p.split("/")[3]);
      expect(await readBoard(packs.get(season)!, p)).toEqual((await get(p)).body);
    }
  });

  const state = (sort: string): TableState => ({ filter: null, filterError: null, sort, dir: "desc", cols: null, page: 1, regions: [], eventType: null, from: null, to: null, country: null, countryUnknown: null, homeState: null, stateUnknown: null });
  const asks: [RecordScope, string[], number][] = [
    ["teamEvent", ["teamName", "totalPointsNpOpr", "autoPointsOpr", "rank"], 1],
    ["teamEvent", ["teamName", "totalPointsNpOpr"], 2],
    ["teamSeason", ["teamName", "totalPointsNpOpr", "wins", "totalPointsNpAvg"], 1],
    ["match", ["redTotalPoints", "blueTotalPoints", "highScore", "winningMargin"], 1],
  ];
  for (const [scope, fields, page] of asks) {
    it(`records table ${scope} page ${page}, the columns a table asks for`, async () => {
      const sort = scope === "match" ? "highScore" : "totalPointsNpOpr";
      const path = recordsUrl({ season: S, scope, state: { ...state(sort), page }, fields });
      const online = await get(path);
      expect(online.status).toBe(200);
      expect(online.body.rows.length).toBeGreaterThan(0);
      expect(await readBoard(packs.get(S)!, path)).toEqual(online.body);
    });
  }
  it("a records view the pack doesn't hold (a filter, another sort, a later page) says so", async () => {
    const db = packs.get(S)!;
    await expect(readBoard(db, recordsUrl({ season: S, scope: "teamEvent", state: { ...state("autoPointsOpr") }, fields: ["teamName"] }))).rejects.toThrow(/Filters and other sorts need a connection/);
    await expect(readBoard(db, recordsUrl({ season: S, scope: "teamEvent", state: { ...state("totalPointsNpOpr"), regions: ["USTX"] }, fields: ["teamName"] }))).rejects.toThrow(NotSaved);
    await expect(readBoard(db, recordsUrl({ season: S, scope: "teamEvent", state: { ...state("totalPointsNpOpr"), page: 3 }, fields: ["teamName"] }))).rejects.toThrow(/first 100 rows/);
  });
  it("an unofficial record stays marked offline", async () => {
    const path = recordsUrl({ season: PAST, scope: "match", state: state("highScore"), fields: ["highScore"] });
    const online = (await get(path)).body;
    const offline = await readBoard(packs.get(PAST)!, path) as typeof online;
    expect(offline).toEqual(online);
    expect(offline.rows[0]).toMatchObject({ eventCode: "FPECAR", unofficial: expect.stringMatching(/^Not an official record: /) });
    expect(offline.rows[1].unofficial).toBeUndefined();
  });
  it("league standings, the events lists and power rankings", async () => {
    const paths = [`/api/leagues/${S}/USTX/LS`, `/api/leagues/${S}/ustx/ls`, `/api/events?season=${S}`, "/api/power-rankings"];
    for (const p of paths) {
      const online = await get(p);
      expect(online.status, p).toBe(200);
      expect(await readBoard(packs.get(S)!, p), p).toEqual(online.body);
    }
    expect((await get(`/api/leagues/${S}/USTX/LS`)).body.rows).toHaveLength(4);
  });
  it("a path the boards don't hold is no answer (the server is asked)", async () => {
    expect(await readBoard(packs.get(S)!, `/api/events?season=${S}&from=2026-10-01&to=2026-10-31`)).toBeNull();
  });
  it("the stored records pages keep the pack small: a stored page is the server's page, every stat", () => {
    const n = packs.get(S)!.all<{ n: number }>("SELECT COUNT(*) n FROM pack_boards WHERE path LIKE '/api/records/%'")[0].n;
    expect(n).toBe(2 + 3 * 2);
    expect(recordsBoardPath(S, "teamSeason", 1)).toContain("scope=season");
  });
});

describe("event pack", () => {
  it("a league meet's pack carries its league's standings, the server's answer", async () => {
    setPackReads(PACK_READS);
    const ev = await eventDetail(S, "USTXLM1");
    const parts = await buildPackApi(S, ev!);
    const got = packLookup(parts.api, `/api/leagues/${S}/USTX/LS`);
    expect(got && "body" in got ? got.body : null).toEqual((await get(`/api/leagues/${S}/USTX/LS`)).body);
  }, 60_000);
});
