// Failed searches #1012 and #974: a leaderboard whose place is New Jersey conferences ("best auto in nj bergen": every
// conference with Bergen in its name that season, its teams from FTC New Jersey's sign-ups before FIRST's list), and a
// board of one conference tournament's teams asked in the search box ("best auto in east bergen conference"), which
// gets its link to the page's board, never a "nothing matched".
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { syncConferences } from "../../data/conferences";
import { searchAnswer } from "../searchAnswer";
import { BOARD_STATS, leaderboardAnswer, type BoardKind } from "./families/leaderboard";

const NOW = new Date("2026-11-21T12:00:00Z");
const box = (q: string) => searchAnswer(q, { now: NOW.getTime() });
const page = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW.getTime() });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Auto OPR, 2026–27: the Bergen conferences' teams, one from another NJ conference, one from Texas.
  const teams: [number, string, string, number][] = [[4215, "Hypnotic Robotics", "NJ", 30], [207, "Critical Mass", "NJ", 12], [23314, "Galactic Pigeon", "NJ", 40], [13615, "Wild Card", "NJ", 20], [7149, "ENFORCERS", "NJ", 50], [30030, "Exodus", "TX", 60]];
  for (const [n, name, state, auto] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    for (const s of [2021, 2025, 2026]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rating_np, rating_matches, matches, wins, losses, ties) VALUES (2026, ?, ?, ?, 40, 10, 80, 6, 6, 4, 2, 0)", [n, auto + 50, auto]);
  }
  const ev = (season: number, code: string, name: string, league: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, region, league, city, state, country, start, end, source) VALUES (?, ?, ?, 'LeagueTournament', 'USNJ', ?, 'Town', 'NJ', 'USA', ?, ?, 'first')", [season, code, name, league, start, start]);
  await ev(2026, "USNJNELT", "West/Central Bergen Conference Northeast League", "NE", "2027-02-06");
  await ev(2026, "USNJNELT2", "East Bergen Conference Northeast League", "NE", "2027-02-21");
  await ev(2026, "USNJNOLT", "Essex/Union Conference Northern League", "NO", "2027-02-13");
  await ev(2025, "USNJNOLT2", "East Bergen Conference Northern League Tournament", "NO", "2026-03-08");
  await ev(2021, "USNJNEELT1", "NJ Bergen County Conference, NE Edge League Tournament (Saturday)", "NEE", "2022-02-19");
  // 2026–27: no team list from FIRST yet, FTC New Jersey's sign-ups only.
  const signups = (code: string, title: string, list: number[]) => run(`INSERT INTO event_provisional (season, code, source, url, title, teams, fetched_at) VALUES (2026, ?, 'ftcnj', 'https://www.newjerseyftc.com/upcoming-events.html', ?, ?, '2026-11-15T23:47:01.825Z')`,
    [code, title, JSON.stringify(list.map((team) => ({ team, name: null, status: "registered", session: null })))]);
  await signups("USNJNELT", "FTCNJ W Central/Bergen Conference, Northeast League Tournament (Saturday)", [23314, 13615]);
  await signups("USNJNELT2", "FTCNJ Hudson/East Bergen Conference, Northeast League Tournament (Sunday)", [4215, 207]);
  await signups("USNJNOLT", "FTCNJ Essex/Union Conference, Northern League Tournament", [7149]);
  // Past tournaments, played: their teams and Auto OPR there.
  let n = 0;
  for (const [season, code, list] of [[2025, "USNJNOLT2", [4215, 207, 7149]], [2021, "USNJNEELT1", [23314, 13615]]] as const) {
    for (const [i, t] of list.entries()) {
      await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, ?, ?, ?)", [season, code, t, i + 1]);
      await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (?, ?, ?, ?, ?, 50, 10, 5)", [season, code, t, 100 - i * 10, 30 - i * 5]);
    }
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, 'Q1', ?, 1, 100, 100, 90, 90, 't')", [season, code, n, `${season + 1}-02-01T10:00:00Z`]);
  }
  for (const s of [2021, 2025, 2026]) await syncConferences(s, { now: NOW });
  await rebuildSearch();
});

describe("a board whose place is New Jersey conferences (#1012)", () => {
  it("best auto in nj bergen: the teams of both Bergen conferences by Auto OPR, said in the scope", async () => {
    const a = await page("best auto in nj bergen");
    expect(a.step).toBe("deterministic");
    expect(a.stat?.title).toBe("Top 10 teams by Auto OPR in the W Central/Bergen and Hudson/East Bergen Conferences · 2026–27");
    expect(a.stat?.scope).toEqual(["W Central/Bergen Conference", "Hudson/East Bergen Conference", "New Jersey", "2026–27"]);
    expect(a.stat?.definition).toMatch(/^“bergen” read as New Jersey's conferences with it in the name in 2026–27: W Central\/Bergen Conference and Hudson\/East Bergen Conference/);
    const board = a.stat?.blocks.find((b) => b.kind === "leaderboard");
    // Never 7149 (Essex/Union) or a Texas team; no link to the state's Teams list, a different list.
    expect(board?.kind === "leaderboard" && board.rows.map((r) => r.team.label)).toEqual(["23314 Galactic Pigeon", "4215 Hypnotic Robotics", "13615 Wild Card", "207 Critical Mass"]);
    expect(a.pages.some((p) => p.href.startsWith("/teams?"))).toBe(false);
    const b = await box("best auto in nj bergen");
    expect(b.step).toBe("deterministic");
    expect(b.pages[0]).toEqual({ title: "Top 10 teams by Auto OPR in the W Central/Bergen and Hudson/East Bergen Conferences", href: "/search?q=best%20auto%20in%20nj%20bergen" });
  });
});

describe("every board kind over conferences as the place", () => {
  it("reads its teams by the teams table, whatever the board's own alias (a gain board's is never `s`)", async () => {
    for (const kind of ["top", "gain", "improved", "steady", "phases"] as BoardKind[]) {
      const a = await leaderboardAnswer({ kind, stat: BOARD_STATS.opr, n: 10, region: null, city: null, season: 2026, conference: ["bergen"] });
      expect(a.title, kind).toContain("the W Central/Bergen and Hudson/East Bergen Conferences");
    }
  });
});

describe("a conference tournament's board asked in the search box (#974)", () => {
  it("links the page's board, the event its words name", async () => {
    for (const [q, event] of [
      ["best auto in bergen county", "NJ Bergen County Conference, NE Edge League Tournament (Saturday)"],
      ["best auto in bergen conference", "East Bergen Conference Northern League Tournament"],
      ["best auto in east bergen conference", "East Bergen Conference Northern League Tournament"],
      ["best auto in east bergen conference northern league tournament", "East Bergen Conference Northern League Tournament"],
    ]) {
      const a = await page(q);
      expect(a.stat?.title, q).toMatch(new RegExp(`^Best teams at ${event.replace(/[()]/g, "\\$&")} by Auto OPR there · `));
      const b = await box(q);
      expect(b.step, q).toBe("deterministic");
      expect(b.pages[0], q).toEqual({ title: `Best teams at ${event}`, href: `/search?q=${encodeURIComponent(q)}` });
    }
  });
});
