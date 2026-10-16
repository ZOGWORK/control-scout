// /api/rankings end to end on an in-memory database with hand-made snapshots: order and ties,
// movement against last week (worked out by hand below), "new" teams, place filters, pages, the
// cached body and its ETag (304), a past week's view, the default season, and the places list.
import type { AddressInfo } from "node:net";
import { get as httpGet, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { clearAllCaches } from "../caches";
import { CURRENT_SEASON } from "../data/seasons";
import { baselineWeek, defaultRankingsSeason, rankings } from "./rankings";
import { WEEK_MS, weekOf, weekStartMs, type RankingsResponse } from "../../src/shared/rankings";

let server: Server;
let base = "";
const S = CURRENT_SEASON, PAST = CURRENT_SEASON - 1;
// Weeks relative to today, so "last week" is always W1: the newest snapshot at least 7 days old.
const W0 = weekOf(Date.now()), W1 = weekOf(Date.now() - WEEK_MS), W2 = weekOf(Date.now() - 2 * WEEK_MS);

async function team(n: number, name: string, state: string | null, country: string | null) {
  await run("INSERT INTO teams (number, name, state, country) VALUES (?, ?, ?, ?)", [n, name, state, country]);
}
async function rated(season: number, n: number, rating: number | null, matches: number) {
  await run("INSERT INTO team_season_stats (season, team, rating_np, rating_matches, matches) VALUES (?, ?, ?, ?, ?)", [season, n, rating, matches, matches]);
}
async function snap(season: number, week: string, rows: [team: number, rank: number, rating: number][]) {
  for (const [t, rank, rating] of rows) await run("INSERT INTO ranking_snapshots (season, week, team, rank, rating) VALUES (?, ?, ?, ?, ?)", [season, week, t, rank, rating]);
  await run("INSERT INTO ranking_weeks (season, week, teams, taken_at) VALUES (?, ?, ?, ?)", [season, week, rows.length, new Date().toISOString()]);
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await team(101, "Alpha", "TX", "USA");
  await team(102, "Bravo", "OK", "USA");
  await team(103, "Charlie", "ON", "Canada");
  await team(104, "Delta", "TX", "USA");
  await team(105, "Echo", "B", "Romania");
  await team(106, "Two Matches", "TX", "USA");
  await team(107, "No Rating", "TX", "USA");
  // Live ratings now. 102 and 103 tie at 85: team number decides. 106 has 2 rated matches, 107 none: unranked.
  await rated(S, 101, 90, 5);
  await rated(S, 102, 85, 6);
  await rated(S, 103, 85, 4);
  await rated(S, 104, 70, 8);
  await rated(S, 105, 60, 3);
  await rated(S, 106, 99, 2);
  await rated(S, 107, null, 0);
  // 120 more teams below them (for pages), all in California.
  for (let i = 0; i < 120; i++) { await team(1000 + i, `Filler ${i}`, "CA", "USA"); await rated(S, 1000 + i, 50 - i * 0.25, 3); }
  // Last week (W1): 104 led, 105 wasn't ranked. Two weeks ago (W2) and this week (W0) differ, to prove W1 is the one used.
  await snap(S, W2, [[101, 1, 10], [102, 2, 9], [103, 3, 8], [104, 4, 7]]);
  await snap(S, W1, [[104, 1, 75], [101, 2, 70], [103, 3, 65], [102, 4, 60]]);
  await snap(S, W0, [[101, 1, 89], [102, 2, 84], [103, 3, 84], [104, 4, 71], [105, 5, 59]]);
  // A finished season: final ratings, and snapshots.
  await rated(PAST, 101, 40, 9);
  await rated(PAST, 104, 50, 9);
  await snap(PAST, W2, [[101, 1, 30], [104, 2, 20]]);
  await snap(PAST, W1, [[104, 1, 45], [101, 2, 35]]);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

// node:http rather than fetch: fetch marks any request with If-None-Match "Cache-Control: no-cache"
// (the Fetch standard), which rightly never gets a 304. A browser revalidating its copy doesn't.
const get = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: any; headers: Headers }>((resolve, reject) => {
  httpGet(base + path, { headers }, (res) => {
    let text = "";
    res.setEncoding("utf8");
    res.on("data", (d) => { text += d; });
    res.on("end", () => {
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") h.set(k, v);
      resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null, headers: h });
    });
  }).on("error", reject);
});
const rows = (b: RankingsResponse) => b.rows.map((r) => [r.rank, r.team, r.move, r.dRating, r.trend]);

describe("GET /api/rankings", () => {
  it("every rated team by rating, ties by team number, with last week's moves worked out by hand", async () => {
    const { status, body } = await get(`/api/rankings?season=${S}`);
    expect(status).toBe(200);
    expect(body.baseline).toBe(W1);
    expect(body.ranked).toBe(125);
    expect(rows(body).slice(0, 5)).toEqual([
      // rank then − rank now; rating now − then; Rising/Falling/Steady (8% band)
      [1, 101, 1, 20, "up"],     // 2 → 1, 70 → 90 (+28.6%)
      [2, 102, 2, 25, "up"],     // 4 → 2, 60 → 85 (+41.7%)
      [3, 103, 0, 20, "up"],     // 3 → 3, 65 → 85 (+30.8%)
      [4, 104, -3, -5, "flat"],  // 1 → 4, 75 → 70 (−6.7%: Steady)
      [5, 105, "new", null, null], // not ranked last week
    ]);
    expect(body.rows.some((r: any) => r.team === 106 || r.team === 107)).toBe(false);
    expect(body.rows[0]).toMatchObject({ name: "Alpha", state: "TX", country: "USA", rating: 90 });
  });

  it("filters by country, by state, and by both at once (ranks stay world ranks)", async () => {
    const usa = (await get(`/api/rankings?season=${S}&region=USA`)).body;
    expect(usa.total).toBe(123);
    expect(usa.rows.slice(0, 3).map((r: any) => r.team)).toEqual([101, 102, 104]);
    const tx = (await get(`/api/rankings?season=${S}&region=USA:TX`)).body;
    expect(rows(tx)).toEqual([[1, 101, 1, 20, "up"], [4, 104, -3, -5, "flat"]]);
    expect(tx.places).toEqual(["USA:TX"]);
    const mixed = (await get(`/api/rankings?season=${S}&region=${encodeURIComponent("USA:TX,Canada,Romania")}`)).body;
    expect(mixed.rows.map((r: any) => r.team)).toEqual([101, 103, 104, 105]);
    // A repeated parameter works the same as a list.
    expect((await get(`/api/rankings?season=${S}&region=USA:TX&region=Canada`)).body.rows.map((r: any) => r.team)).toEqual([101, 103, 104]);
    const none = (await get(`/api/rankings?season=${S}&region=Peru`)).body;
    expect([none.total, none.rows.length, none.ranked]).toEqual([0, 0, 125]);
  });

  it("pages of 50, clamped to the last page", async () => {
    const p1 = (await get(`/api/rankings?season=${S}`)).body;
    expect([p1.page, p1.pages, p1.pageSize, p1.rows.length]).toEqual([1, 3, 50, 50]);
    const p3 = (await get(`/api/rankings?season=${S}&page=3`)).body;
    expect([p3.page, p3.rows.length, p3.rows[0].rank, p3.rows.at(-1).rank]).toEqual([3, 25, 101, 125]);
    expect((await get(`/api/rankings?season=${S}&page=99`)).body.page).toBe(3);
    const ca2 = (await get(`/api/rankings?season=${S}&region=USA:CA&page=2`)).body;
    expect([ca2.total, ca2.pages, ca2.rows.length, ca2.rows[0].team]).toEqual([120, 3, 50, 1050]);
  });

  it("an unchanged page is a 304 to a browser that has it; another page has another ETag", async () => {
    const a = await get(`/api/rankings?season=${S}&region=USA`);
    const etag = a.headers.get("etag")!;
    expect(etag).toMatch(/^"rk-[\w-]{20}"$/);
    expect(a.headers.get("cache-control")).toContain("max-age=60");
    const again = await get(`/api/rankings?season=${S}&region=USA`, { "If-None-Match": etag });
    expect(again.status).toBe(304);
    expect(again.body).toBeNull();
    const other = await get(`/api/rankings?season=${S}&region=USA&page=2`, { "If-None-Match": etag });
    expect(other.status).toBe(200);
    expect(other.headers.get("etag")).not.toBe(etag);
    // New data (a new data version) is a new body, so a new ETag.
    await run("UPDATE team_season_stats SET rating_np = 91 WHERE season = ? AND team = 101", [S]);
    await run("INSERT INTO kv (key, value, updated_at) VALUES ('data:version', '\"v2\"', 'x') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const moved = await get(`/api/rankings?season=${S}&region=USA`, { "If-None-Match": etag });
    expect(moved.status).toBe(200);
    expect(moved.body.rows[0]).toMatchObject({ team: 101, rating: 91, dRating: 21 });
    await run("UPDATE team_season_stats SET rating_np = 90 WHERE season = ? AND team = 101", [S]);
    await run("UPDATE kv SET value = '\"v3\"' WHERE key = 'data:version'");
  });

  it("a past week: that snapshot, against the one a week before it", async () => {
    const { body } = await get(`/api/rankings?season=${S}&week=${W1}`);
    expect([body.week, body.baseline, body.asOf]).toEqual([W1, W2, new Date(weekStartMs(W1)).toISOString()]);
    expect(rows(body)).toEqual([[1, 104, 3, 68, "up"], [2, 101, -1, 60, "up"], [3, 103, 0, 57, "up"], [4, 102, -2, 51, "up"]]);
    // The oldest week has nothing to compare with.
    const oldest = (await get(`/api/rankings?season=${S}&week=${W2}`)).body;
    expect(oldest.baseline).toBeNull();
    expect(oldest.rows[0]).toMatchObject({ move: null, trend: null });
  });

  it("a finished season's live list has no movement (there is no 'this week'), but its weeks do", async () => {
    const live = (await get(`/api/rankings?season=${PAST}`)).body;
    expect(live.baseline).toBeNull();
    expect(rows(live)).toEqual([[1, 104, null, null, null], [2, 101, null, null, null]]);
    expect((await get(`/api/rankings?season=${PAST}&week=${W1}`)).body.baseline).toBe(W2);
  });

  it("opens on the current season once anyone is rated in it, else the latest season with ratings", async () => {
    expect(await defaultRankingsSeason()).toBe(S);
    expect((await get("/api/rankings")).body.season).toBe(S);
    await run("UPDATE team_season_stats SET rating_matches = rating_matches - 10 WHERE season = ?", [S]);
    try {
      expect(await defaultRankingsSeason()).toBe(PAST);
    } finally {
      await run("UPDATE team_season_stats SET rating_matches = rating_matches + 10 WHERE season = ?", [S]);
    }
  });

  it("refuses what it can't answer", async () => {
    expect((await get("/api/rankings?season=2021")).status).toBe(404); // history-only season: no ratings
    expect((await get("/api/rankings?week=2026-10-13")).status).toBe(400); // not a Monday
    expect((await get(`/api/rankings?season=${S}&week=2020-01-06`)).status).toBe(404); // no such snapshot
    expect((await get(`/api/rankings?region=${encodeURIComponent("USA:T X")}`)).status).toBe(400);
    expect((await get("/api/rankings?page=0")).status).toBe(400);
    const r = await get("/api/rankings?page=abc");
    expect(r.status).toBe(400);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/rankings/places", () => {
  it("countries and their states by ranked teams, the snapshot weeks, and a team's own place", async () => {
    clearAllCaches();
    const { body } = await get(`/api/rankings/places?season=${S}&team=105`);
    expect(body.countries[0]).toEqual({ country: "USA", teams: 123, states: [{ state: "CA", teams: 120 }, { state: "OK", teams: 1 }, { state: "TX", teams: 2 }].sort((a, b) => b.teams - a.teams || a.state.localeCompare(b.state)) });
    expect(body.countries.map((c: any) => c.country)).toEqual(["USA", "Canada", "Romania"]);
    expect(body.weeks).toEqual([W0, W1, W2]);
    expect(body.mine).toBe("Romania:B");
    expect((await get(`/api/rankings/places?season=${S}`)).body.mine).toBeUndefined();
    expect((await get(`/api/rankings/places?season=${S}&team=999`)).body.mine).toBeNull();
  });
});

describe("baselineWeek", () => {
  const weeks = ["2026-10-19", "2026-10-12", "2026-10-05"]; // newest first, as stored
  it("live: the newest snapshot at least 7 days before now", () => {
    expect(baselineWeek(weeks, S, null, Date.parse("2026-10-19T00:00:00Z"))).toBe("2026-10-12"); // Monday 00:00: exactly a week
    expect(baselineWeek(weeks, S, null, Date.parse("2026-10-25T23:00:00Z"))).toBe("2026-10-12"); // Sunday: still that one
    expect(baselineWeek(weeks, S, null, Date.parse("2026-10-26T00:00:00Z"))).toBe("2026-10-19");
    expect(baselineWeek(weeks, S, null, Date.parse("2026-10-11T00:00:00Z"))).toBeNull(); // the season's first week
    expect(baselineWeek(weeks, PAST, null, Date.parse("2026-10-26T00:00:00Z"))).toBeNull();
  });
  it("a week: the week before it", () => {
    expect(baselineWeek(weeks, S, "2026-10-19", 0)).toBe("2026-10-12");
    expect(baselineWeek(weeks, PAST, "2026-10-12", 0)).toBe("2026-10-05");
    expect(baselineWeek(weeks, S, "2026-10-05", 0)).toBeNull();
  });
  it("rankings() at a given instant picks that week's baseline", async () => {
    const r = await rankings({ season: S, week: null, places: [], page: 1 }, Date.now() + WEEK_MS);
    expect(r.baseline).toBe(W0);
    expect(r.rows.find((x) => x.team === 105)).toMatchObject({ move: 0, dRating: 1 });
  });
});
