// An event's teams are FIRST's participant list (/teams?eventCode=), never a league meet's /rankings: that is the
// whole league's running standing (2026 USNJNEM2 the day before: 33 ranked, 13 listed).
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstEventBundle } from "./first";
import { MIGRATIONS, all, migrate, openDb, run, setDb } from "../db";
import type { EventRow } from "../data/bundle";

const META: EventRow = {
  season: 2026, code: "USNJNEM2", name: "P1-5 AM Northeast League Meet", type: "LeagueMeet", divisionCode: null, region: "USNJ", league: "NE",
  venue: null, city: "Ramsey", state: "NJ", country: "USA", start: "2026-11-07", end: "2026-11-07", timezone: null, remote: false, hybrid: false,
  website: null, livestream: null, source: "first", upstreamUpdated: null,
};

const LEAGUE = [31255, 13048, 4215, 6980, 207, 11124];
const ranking = (teamNumber: number, i: number) => ({ rank: i + 1, teamNumber, sortOrder1: 2 - i / 10, sortOrder2: 20, wins: 5, losses: 1, ties: 0, dq: 0, matchesPlayed: 6 });
const team = (teamNumber: number) => ({ teamNumber, nameShort: `T${teamNumber}`, city: "Ramsey", stateProv: "NJ", country: "USA" });

/** FIRST answering /rankings with the league and /teams with `listed` (a number: that HTTP status). */
function stubFirst(listed: number[] | number, schedule: number[][] = []) {
  vi.stubEnv("FTC_EVENTS_USERNAME", "u"); vi.stubEnv("FTC_EVENTS_TOKEN", "t");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/teams?")) {
      if (typeof listed === "number") return new Response("down", { status: listed });
      return json({ teams: listed.map(team), teamCountTotal: listed.length, pageCurrent: 1, pageTotal: 1 });
    }
    if (url.includes("/rankings/")) return json({ rankings: LEAGUE.map(ranking) });
    if (url.includes("/schedule/") && url.includes("qual")) {
      return json({ schedule: schedule.map((ts, i) => ({ tournamentLevel: "QUALIFICATION", matchNumber: i + 1, teams: ts.map((n, k) => ({ teamNumber: n, station: k < 2 ? `Red${k + 1}` : `Blue${k - 1}` })) })) });
    }
    return json({});
  }));
}

describe("an event's teams in the FIRST bundle", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("a league meet's teams are FIRST's participants, not the league's standing", async () => {
    stubFirst([4215, 6980, 11124]);
    const b = await firstEventBundle(META);
    expect(b.detail!.entries.map((e) => e.team).sort((x, y) => x - y)).toEqual([4215, 6980, 11124]);
    // Their league standing still rides along for the ones ranked.
    expect(b.detail!.entries.find((e) => e.team === 4215)!.rank).toBe(3);
    expect(b.teams.map((t) => t.number)).toEqual([4215, 6980, 11124]);
  });

  it("a league meet FIRST lists no teams for has none from the league's standing", async () => {
    stubFirst([]);
    expect((await firstEventBundle(META)).detail!.entries).toEqual([]);
  });

  it("a scheduled team belongs to the meet even when FIRST's list hasn't caught up", async () => {
    stubFirst([4215, 6980], [[4215, 6980, 207, 11124]]);
    expect((await firstEventBundle(META)).detail!.entries.map((e) => e.team).sort((x, y) => x - y)).toEqual([207, 4215, 6980, 11124]);
  });

  it("a league meet whose list can't be read fails (FTC Scout or the stored list stands in), never the league", async () => {
    stubFirst(400);
    await expect(firstEventBundle(META)).rejects.toThrow(/teams/);
  });

  it("elsewhere a failed list read keeps the rankings", async () => {
    stubFirst(400);
    const b = await firstEventBundle({ ...META, type: "Qualifier" });
    expect(b.detail!.entries.map((e) => e.team)).toEqual(LEAGUE);
  });

  it("elsewhere the list still decides: a ranked team FIRST doesn't list is not at the event", async () => {
    stubFirst([4215, 6980]);
    expect((await firstEventBundle({ ...META, type: "Qualifier" })).detail!.entries.map((e) => e.team)).toEqual([4215, 6980]);
  });
});

describe("migration 74: stored league meets keep only their own teams", () => {
  it("drops unscheduled rows at league meets only", async () => {
    const c = openDb("file::memory:");
    setDb(c);
    const v = MIGRATIONS.find((m) => m.name === "league meets keep only their own teams")!.version;
    await migrate(c, v - 1);
    for (const [code, type] of [["MEET", "LeagueMeet"], ["SOON", "LeagueMeet"], ["QUAL", "Qualifier"]]) {
      await run("INSERT INTO events (season, code, name, type, start, end, source, synced_at) VALUES (2025, ?, ?, ?, '2025-11-01', '2025-11-01', 'first', 'x')", [code, code, type]);
      for (const t of [1, 2, 3]) await run("INSERT INTO event_teams (season, code, team) VALUES (2025, ?, ?)", [code, t]);
    }
    for (const code of ["MEET", "QUAL"]) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, ?, 'qual', 0, 1, 'Q1', 1, 'first')", [code]);
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (2025, ?, 'qual', 0, 1, 1, 'red', 1)", [code]);
    }
    await migrate(c, v);
    const rows = await all<{ code: string; team: number }>("SELECT code, team FROM event_teams ORDER BY code, team");
    expect(rows.map((r) => `${r.code}:${r.team}`)).toEqual(["MEET:1", "QUAL:1", "QUAL:2", "QUAL:3"]);
    c.close();
  });
});
