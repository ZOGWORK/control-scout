// Teams without a public page (src/shared/teamPages.ts): FIRST's placeholders ("Off-Season Demo Team",
// "Demo Team") and its 7-digit stand-in numbers. Their team page and API answer 404; the sitemap, world
// rankings, search, the team directory and the records leave them out; their matches stay. And the sitemap
// check: every team URL it lists answers 200. Real app over HTTP, in-memory database.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { clearAllCaches } from "./caches";
import { CURRENT_SEASON } from "./data/seasons";
import { rankings } from "./api/rankings";
import { listDirectory, directoryQuery } from "./api/directory";
import { resetSitemapCache, sitemapEntries } from "./sitemap";
import { teamPageTest } from "./teamPages";
import { pageMeta } from "./seoMeta";
import { all } from "./db";
import { WEEK_MS, weekOf } from "../src/shared/rankings";
import { hasTeamPage, isPlaceholderTeamName, teamPageSql } from "../src/shared/teamPages";

let server: Server;
let base = "";
const S = CURRENT_SEASON;
const W1 = weekOf(Date.now() - WEEK_MS);
// 4215 and 18360 are real teams; 99999 / 100000 are FIRST's off-season placeholders, 34320 its test "Demo Team",
// 202300005 a 2023 registration still waiting for its number.
const REAL = [4215, 18360], HIDDEN = [99999, 100000, 34320, 202300005];

beforeAll(async () => {
  process.env.APP_URL = "https://controlscout.org";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run(`INSERT INTO teams (number, name, rookie_year, country) VALUES (4215, 'Hypnotic Robotics', 2010, 'USA'), (18360, 'Zeta', 2020, 'USA'),
    (99999, 'Off-Season Demo Team', 1992, NULL), (100000, '  off-season demo team ', 1992, NULL), (34320, 'Demo Team', 2025, 'Moldova'), (202300005, 'Ammon Brick Heads', 2023, 'USA')`);
  for (const t of [...REAL, ...HIDDEN]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, t]);
  // An off-season event where 99999 played (and topped the field), with 4215 and 18360.
  await run("INSERT INTO events (season, code, name, start, end, remote, hybrid, source) VALUES (?, 'OFFS', 'Off-season', '2026-09-01', '2026-09-01', 0, 0, 't')", [S]);
  for (const t of [4215, 18360, 99999]) await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, 'OFFS', ?, ?)", [S, t, t === 99999 ? 1 : t === 4215 ? 2 : 3]);
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, 'OFFS', 'qual', 0, 1, 'Q1', 1, 't')", [S]);
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'OFFS', 'qual', 0, 1, 99999, 'red', 1), (?, 'OFFS', 'qual', 0, 1, 4215, 'blue', 1)", [S, S]);
  // Ratings: the placeholder is best, then 4215, then 18360; the stand-in number is rated too.
  for (const [t, r] of [[99999, 120], [4215, 90], [202300005, 80], [18360, 70]] as const) {
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_matches, matches) VALUES (?, ?, ?, 5, 5)", [S, t, r]);
  }
  // Last week's snapshot, taken before the rule: the placeholder ranked 1st.
  for (const [t, rank, rating] of [[99999, 1, 110], [4215, 2, 85], [18360, 3, 65]] as const) await run("INSERT INTO ranking_snapshots (season, week, team, rank, rating) VALUES (?, ?, ?, ?, ?)", [S, W1, t, rank, rating]);
  await run("INSERT INTO ranking_weeks (season, week, teams, taken_at) VALUES (?, ?, 3, ?)", [S, W1, new Date().toISOString()]);
  // The team records (stats job output) list the placeholder too.
  for (const t of [4215, 99999]) await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, ?, ?)", [S, t, t === 99999 ? "Off-Season Demo Team" : "Hypnotic Robotics"]);
  clearAllCaches();
  resetSitemapCache();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

describe("the rule", () => {
  it("six-digit numbers only, and never FIRST's placeholder names (trimmed, any case)", () => {
    expect(hasTeamPage(4215, "Hypnotic Robotics")).toBe(true);
    expect(hasTeamPage(4215)).toBe(true);
    expect(hasTeamPage(999999)).toBe(true);
    expect(hasTeamPage(1_000_000)).toBe(false);
    expect(hasTeamPage(202300005, "Ammon Brick Heads")).toBe(false);
    expect(hasTeamPage(0)).toBe(false);
    expect(hasTeamPage(99999, "Off-Season Demo Team")).toBe(false);
    expect(hasTeamPage(34320, " DEMO TEAM ")).toBe(false);
    // Only the exact placeholder names: a team that merely has "demo" in its name is a team.
    expect(isPlaceholderTeamName("Demolition Crew")).toBe(false);
    expect(isPlaceholderTeamName("Demo Team 2")).toBe(false);
  });

  it("the SQL says what hasTeamPage says, with or without a joined name, for every row", async () => {
    const rows = await all<{ number: number; name: string | null; a: number; b: number }>(
      `SELECT number, name, ${teamPageSql("number")} a, ${teamPageSql("number", "name")} b FROM teams`);
    const paged = await teamPageTest();
    for (const r of rows) {
      const want = hasTeamPage(Number(r.number), r.name);
      expect([Boolean(r.a), Boolean(r.b), paged(Number(r.number))], `team ${r.number}`).toEqual([want, want, want]);
    }
    expect(rows.filter((r) => r.a).map((r) => Number(r.number)).sort((x, y) => x - y)).toEqual(REAL);
  });
});

describe("pages and lists", () => {
  it("a hidden team's API and page answer 404; a real team's 200", async () => {
    for (const t of REAL) expect((await fetch(`${base}/api/teams/${t}`)).status, `team ${t}`).toBe(200);
    // A 7-digit number isn't a team number at all: the API rejects it (400) before looking.
    for (const t of HIDDEN) expect((await fetch(`${base}/api/teams/${t}`)).status, `team ${t}`).toBe(t > 999999 ? 400 : 404);
    // The server-rendered page (what a crawler gets) says not found too.
    for (const t of REAL) expect((await pageMeta(`/teams/${t}`)).notFound, `page ${t}`).toBeFalsy();
    for (const t of HIDDEN) expect((await pageMeta(`/teams/${t}`)).notFound, `page ${t}`).toBe(true);
  });

  it("world rankings leave the placeholder and the stand-in out and number the rest from 1, last week's too", async () => {
    const live = await rankings({ season: S, week: null, places: [], page: 1 });
    expect(live.rows.map((r) => [r.rank, r.team])).toEqual([[1, 4215], [2, 18360]]);
    expect(live.ranked).toBe(2);
    // Movement against the stored week, renumbered without the placeholder: 4215 was 1st, 18360 2nd.
    expect(live.rows.map((r) => r.move)).toEqual([0, 0]);
    const past = await rankings({ season: S, week: W1, places: [], page: 1 });
    expect(past.rows.map((r) => [r.rank, r.team])).toEqual([[1, 4215], [2, 18360]]);
  });

  it("search never offers them (pickers search too)", async () => {
    for (const q of ["99999", "100000", "34320", "2023"]) {
      const hits = (await (await fetch(`${base}/api/search?q=${q}`)).json()).hits as { kind: string; ref: string }[];
      expect(hits.filter((h) => h.kind === "team" && HIDDEN.map(String).includes(h.ref)), q).toEqual([]);
    }
    const hits = (await (await fetch(`${base}/api/search?q=4215`)).json()).hits as { ref: string }[];
    expect(hits[0]?.ref).toBe("4215");
  });

  it("the team directory and the team records list real teams only", async () => {
    const dir = await listDirectory(S, directoryQuery({}));
    expect(dir.rows.map((r) => r.team)).toEqual(REAL);
    expect(dir.total).toBe(2);
    const rec = await (await fetch(`${base}/api/records/${S}/teams?scope=season`)).json();
    expect(rec.rows.map((r: { team: number }) => r.team)).toEqual([4215]);
  });

  it("their matches stay on the event", async () => {
    const d = await (await fetch(`${base}/api/events/${S}/OFFS`)).json();
    expect(d.matches[0].red.teams.map((t: { number: number }) => t.number)).toEqual([99999]);
  });
});

describe("sitemap", () => {
  it("lists /teams and /matches, never /records or a hidden team", async () => {
    const locs = (await sitemapEntries()).map((e) => e.loc);
    expect(locs).toContain("https://controlscout.org/teams");
    expect(locs).toContain("https://controlscout.org/matches");
    expect(locs).not.toContain("https://controlscout.org/records");
    for (const t of HIDDEN) expect(locs).not.toContain(`https://controlscout.org/teams/${t}`);
  });

  it("every team URL it lists is a team page that answers 200", async () => {
    const teams = (await sitemapEntries()).map((e) => /\/teams\/(\d+)$/.exec(e.loc)?.[1]).filter((n): n is string => !!n);
    expect(teams.map(Number)).toEqual(REAL);
    for (const n of teams) {
      expect(hasTeamPage(Number(n))).toBe(true);
      expect((await fetch(`${base}/api/teams/${n}`)).status, `team ${n}`).toBe(200);
    }
  });
});

describe("/records", () => {
  it("301s to /teams, query kept", async () => {
    const r = await fetch(`${base}/records`, { redirect: "manual" });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/teams");
    const q = await fetch(`${base}/records?view=season&sort=opr`, { redirect: "manual" });
    expect(q.status).toBe(301);
    expect(q.headers.get("location")).toBe("/teams?view=season&sort=opr");
  });
});
