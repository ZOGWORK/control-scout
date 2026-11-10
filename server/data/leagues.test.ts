// FIRST's league standings, read by the sync: the league list once a day, each league with a started meet once, then
// again every few hours only while its latest meet is a few days old. A league is its region and code together (two
// regions' "NE" stay apart), and the API reads them back with names, meets played and the team's own place.
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { syncLeagues } from "./leagues";
import { leagueStandings, leaguesOf, teamLeagueStanding } from "../api/leagues";
import { pageMeta } from "../seoMeta";
import { newestLeagueSeason } from "../api/answers/families/facts";

const S = 2026;
const rank = (team: number, r: number, played = 6) => ({ teamNumber: team, rank: r, sortOrder1: 2 - r / 10, sortOrder2: 40, wins: 6 - r, losses: r, ties: 0, matchesPlayed: played, matchesCounted: played });

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  const ev = (code: string, region: string, start: string, type = "LeagueMeet") =>
    run("INSERT INTO events (season, code, name, type, region, league, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, 'NE', ?, 'USA', ?, ?, 'first')", [S, code, `${code} meet`, type, region, region.slice(2), start, start]);
  await ev("NJM1", "USNJ", "2026-10-25");
  await ev("NJM2", "USNJ", "2026-11-07");
  await ev("NJLT", "USNJ", "2027-02-06", "LeagueTournament");
  await ev("FLM1", "USFL", "2026-10-24");
  await ev("FLM9", "USFL", "2027-01-09");
  for (const [n, name] of [[6980, "Bad Wolf"], [7, "Seven"], [8, "Eight"]] as const) await run("INSERT INTO teams (number, name) VALUES (?, ?)", [n, name]);
  for (const [code, team, r] of [["NJM1", 6980, 2], ["NJM2", 6980, 2], ["NJM2", 7, 1], ["NJLT", 7, 1]] as const) await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, ?, ?, ?)", [S, code, team, r]);
  // Played matches at the two New Jersey meets (the tournament's roster has 7 ranked before it plays: not a meet played).
  for (const code of ["NJM1", "NJM2"]) {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, ?, 'qual', 0, 1, 'Q1', 1, 'first')", [S, code]);
    for (const team of code === "NJM1" ? [6980] : [6980, 7]) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, 1, ?, 'red')", [S, code, team]);
  }
});

const fetcher = (asked: string[]) => async (path: string) => {
  asked.push(path);
  if (path === `/${S}/leagues`) return { leagues: [{ region: "USNJ", code: "NE", name: "Northeast", location: "NJ" }, { region: "USFL", code: "NE", name: "Northeast Florida", location: "FL" }, { region: "USNJ", code: "", name: "" }] };
  if (path.endsWith("/USNJ/NE")) return { rankings: [rank(7, 1), rank(6980, 2), rank(8, 3, 0)] };
  if (path.endsWith("/USFL/NE")) return { rankings: [rank(8, 1)] };
  return null;
};

describe("league standings sync", () => {
  it("reads the list and every league with a started meet, then only recent ones every few hours", async () => {
    const asked: string[] = [];
    expect(await syncLeagues(S, { now: new Date("2026-11-08T12:00:00Z"), fetch: fetcher(asked) })).toEqual({ listed: 2, ranked: 2, failed: 0 });
    expect(asked).toEqual([`/${S}/leagues`, `/${S}/leagues/rankings/USNJ/NE`, `/${S}/leagues/rankings/USFL/NE`]);

    // An hour on: nothing is due, and the list was read today.
    asked.length = 0;
    expect(await syncLeagues(S, { now: new Date("2026-11-08T13:00:00Z"), fetch: fetcher(asked) })).toEqual({ listed: 0, ranked: 0, failed: 0 });
    expect(asked).toEqual([]);

    // Seven hours on: New Jersey's meet was the day before yesterday (due); Florida's last started meet weeks ago.
    expect(await syncLeagues(S, { now: new Date("2026-11-08T19:30:00Z"), fetch: fetcher(asked) })).toEqual({ listed: 0, ranked: 1, failed: 0 });
    expect(asked).toEqual([`/${S}/leagues/rankings/USNJ/NE`]);
  });

  it("keeps two regions' leagues of the same code apart, with names, meets played and the team's place", async () => {
    await syncLeagues(S, { now: new Date("2026-11-08T12:00:00Z"), fetch: fetcher([]) });
    const nj = await leagueStandings(S, "usnj", "ne");
    expect(nj).toMatchObject({ region: "USNJ", code: "NE", name: "Northeast", place: "New Jersey" });
    expect(nj!.rows.map((r) => [r.rank, r.team, r.name, r.meets])).toEqual([[1, 7, "Seven", 1], [2, 6980, "Bad Wolf", 2], [3, 8, "Eight", 0]]);
    expect(nj!.meets.map((m) => [m.code, m.played])).toEqual([["NJM1", true], ["NJM2", true], ["NJLT", false]]);
    expect((await leagueStandings(S, "USFL", "NE"))!.rows.map((r) => r.team)).toEqual([8]);
    expect(await leagueStandings(S, "USNY", "NE")).toBeNull();
    // Out of the teams that have played: team 8 hasn't in New Jersey.
    expect(await teamLeagueStanding(S, 6980)).toEqual({ region: "USNJ", code: "NE", name: "Northeast", rank: 2, of: 2, played: true });
    expect(await teamLeagueStanding(S, 1234)).toBeNull();
    expect((await leaguesOf(S, "USNJ")).map((l) => [l.code, l.name, l.teams])).toEqual([["NE", "Northeast", 3]]);
  });

  it("catches up on a league whose refresh window was missed", async () => {
    // Read once on Nov 1; the server is down from before New Jersey's Nov 7 meet until Nov 20.
    await syncLeagues(S, { now: new Date("2026-11-01T12:00:00Z"), fetch: fetcher([]) });
    const asked: string[] = [];
    expect(await syncLeagues(S, { now: new Date("2026-11-20T12:00:00Z"), fetch: fetcher(asked) })).toMatchObject({ ranked: 1 });
    expect(asked.filter((a) => a.includes("rankings"))).toEqual([`/${S}/leagues/rankings/USNJ/NE`]);
    asked.length = 0;
    expect(await syncLeagues(S, { now: new Date("2026-11-21T12:00:00Z"), fetch: fetcher(asked) })).toMatchObject({ ranked: 0 });
  });

  it.each([["a 404", null], ["an empty list", { rankings: [] }]])("keeps the stored standings when FIRST answers with %s, and asks again", async (_, none) => {
    await syncLeagues(S, { now: new Date("2026-11-08T12:00:00Z"), fetch: fetcher([]) });
    const missing = async (path: string) => (path.includes("rankings") ? none : fetcher([])(path));
    expect(await syncLeagues(S, { now: new Date("2026-11-08T19:00:00Z"), fetch: missing })).toMatchObject({ ranked: 0, failed: 1 });
    expect((await leagueStandings(S, "USNJ", "NE"))!.rows).toHaveLength(3);
    // Not again until REREAD_HOURS on, like any read.
    expect(await syncLeagues(S, { now: new Date("2026-11-08T19:05:00Z"), fetch: fetcher([]) })).toMatchObject({ ranked: 0 });
    expect(await syncLeagues(S, { now: new Date("2026-11-09T01:05:00Z"), fetch: fetcher([]) })).toMatchObject({ ranked: 1 });
  });

  it("serves a league's page meta, and a 404 for an address that is no league", async () => {
    await syncLeagues(S, { now: new Date("2026-11-08T12:00:00Z"), fetch: fetcher([]) });
    const m = await pageMeta("/Leagues/2026/usnj/ne");
    expect(m).toMatchObject({ title: "Northeast League (New Jersey) standings 2026–27", path: "/leagues/2026/USNJ/NE" });
    expect(m.bodyHtml).toContain("Bad Wolf");
    expect((await pageMeta("/leagues/2026/USNJ/a-b")).notFound).toBe(true);
    expect((await pageMeta("/leagues/2026/USNY/NE")).notFound).toBe(true);
  });

  it("tries a failed league again next sync", async () => {
    const asked: string[] = [];
    const failing = async (path: string) => { asked.push(path); if (path.includes("rankings")) throw new Error("FIRST 503"); return fetcher([])(path); };
    expect(await syncLeagues(S, { now: new Date("2026-11-08T12:00:00Z"), fetch: failing })).toEqual({ listed: 2, ranked: 0, failed: 2 });
    expect(await syncLeagues(S, { now: new Date("2026-11-08T18:05:00Z"), fetch: fetcher(asked) })).toMatchObject({ ranked: 2 });
  });

  it("never lets a league that keeps failing hold the sync's slots", async () => {
    const asked: string[] = [];
    const njFails = async (path: string) => { asked.push(path); return path.endsWith("/USNJ/NE") ? null : fetcher([])(path); };
    // One league per sync: New Jersey's (the newer meet) goes first and fails; the next sync reads Florida's.
    expect(await syncLeagues(S, { limit: 1, now: new Date("2026-11-08T12:00:00Z"), fetch: njFails })).toMatchObject({ ranked: 0, failed: 1 });
    expect(await syncLeagues(S, { limit: 1, now: new Date("2026-11-08T12:05:00Z"), fetch: njFails })).toMatchObject({ ranked: 1 });
    expect(asked.filter((a) => a.includes("rankings"))).toEqual([`/${S}/leagues/rankings/USNJ/NE`, `/${S}/leagues/rankings/USFL/NE`]);
  });

  it("takes a team's league standing from its newest league season with a match played", async () => {
    const row = (season: number, team: number, played: number) => run("INSERT INTO league_rankings (season, region, league, team, rank, played) VALUES (?, 'USNJ', 'NE', ?, 1, ?)", [season, team, played]);
    await row(S - 1, 6980, 10); await row(S, 6980, 6);
    await row(S - 1, 7, 10); await row(S, 7, 0);
    expect(await newestLeagueSeason(6980)).toBe(S);
    // Listed this season but no match yet: last season's standing.
    expect(await newestLeagueSeason(7)).toBe(S - 1);
    expect(await newestLeagueSeason(8)).toBeNull();
  });
});
