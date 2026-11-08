// An event's teams are FIRST's participant list (/teams?eventCode=), never a league meet's /rankings: that is the
// whole league's running standing (2026 USNJNEM2 the day before: 33 ranked, 13 listed).
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstEventBundle } from "./first";
import { MIGRATIONS, all, migrate, openDb, run, setDb, writeBatch } from "../db";
import { bundleStatements } from "../data/bundle";
import { ROSTER } from "../data/registrations";
import type { EventRow } from "../data/bundle";

const META: EventRow = {
  season: 2026, code: "USNJNEM2", name: "P1-5 AM Northeast League Meet", type: "LeagueMeet", divisionCode: null, region: "USNJ", league: "NE",
  venue: null, city: "Ramsey", state: "NJ", country: "USA", start: "2026-11-07", end: "2026-11-07", timezone: null, remote: false, hybrid: false,
  website: null, livestream: null, source: "first", upstreamUpdated: null,
};

const LEAGUE = [31255, 13048, 4215, 6980, 207, 11124];
const ranking = (teamNumber: number, i: number) => ({ rank: i + 1, teamNumber, sortOrder1: 2 - i / 10, sortOrder2: 20, wins: 5, losses: 1, ties: 0, dq: 0, matchesPlayed: 6 });
const team = (teamNumber: number) => ({ teamNumber, nameShort: `T${teamNumber}`, city: "Ramsey", stateProv: "NJ", country: "USA" });

/** FIRST answering /rankings with the league and /teams with `listed` (a number: that HTTP status); `others`: other
 *  events' lists by code. */
function stubFirst(listed: number[] | number, schedule: number[][] = [], others: Record<string, number[]> = {}) {
  vi.stubEnv("FTC_EVENTS_USERNAME", "u"); vi.stubEnv("FTC_EVENTS_TOKEN", "t");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/teams?")) {
      const other = others[new URL(url).searchParams.get("eventCode") ?? ""];
      if (other) return json({ teams: other.map(team), teamCountTotal: other.length, pageCurrent: 1, pageTotal: 1 });
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

  it("an AM/PM pair's list filed under one session is not that session's teams", async () => {
    // The other session lists none: FIRST filed everyone under this one.
    stubFirst([4215, 6980, 11124], [], { USNJNEM3: [] });
    expect((await firstEventBundle(META, { pair: "USNJNEM3" })).detail!.entries).toEqual([]);
    // The same list on both sessions.
    stubFirst([4215, 6980], [], { USNJNEM3: [4215, 6980] });
    expect((await firstEventBundle(META, { pair: "USNJNEM3" })).detail!.entries).toEqual([]);
    // Each session its own list (USNJNEM2 / NEM3 on 2026-11-06: 13 and 12, two teams in both).
    stubFirst([4215, 6980, 11124], [], { USNJNEM3: [4215, 6980, 8902] });
    expect((await firstEventBundle(META, { pair: "USNJNEM3" })).detail!.entries.map((e) => e.team).sort((x, y) => x - y)).toEqual([4215, 6980, 11124]);
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

describe("the stored list after a FIRST fetch", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const roster = async () => (await all<{ team: number }>(`SELECT team FROM ${ROSTER} r WHERE season = 2026 AND code = 'USNJNEM2' ORDER BY team`)).map((r) => Number(r.team));

  it("replaces the registrations too: a list FIRST emptied stays empty, never the older one", async () => {
    const c = openDb("file::memory:");
    setDb(c);
    await migrate(c);
    stubFirst([4215, 6980]);
    await writeBatch(bundleStatements(await firstEventBundle(META)));
    expect(await roster()).toEqual([4215, 6980]);
    // An older registrations read (before the meet's first fetch) is replaced, not kept.
    await run("INSERT INTO event_registrations (season, code, team, fetched_at) VALUES (2026, 'USNJNEM2', 207, 'x')");
    stubFirst([]);
    await writeBatch(bundleStatements(await firstEventBundle(META)));
    expect(await roster()).toEqual([]);
    c.close();
  });

  it("leaves an AM/PM pair's shared list as it is", async () => {
    const c = openDb("file::memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO events (season, code, name, type, start, end, source, synced_at) VALUES (2026, 'USNJNEM2', 'M', 'LeagueMeet', '2026-11-07', '2026-11-07', 'first', 'x')");
    await run("INSERT INTO event_registrations (season, code, team, fetched_at, shared) VALUES (2026, 'USNJNEM2', 4215, 'x', 1)");
    stubFirst([4215], [], { USNJNEM3: [] });
    await writeBatch(bundleStatements(await firstEventBundle(META, { pair: "USNJNEM3" })));
    expect(await all("SELECT team, shared FROM event_registrations")).toEqual([{ team: 4215, shared: 1 }]);
    c.close();
  });
});

describe("migration 74: stored league meets keep only their own teams", () => {
  it("drops unscheduled rows at in-person league meets only", async () => {
    const c = openDb("file::memory:");
    setDb(c);
    const v = MIGRATIONS.find((m) => m.name === "league meets keep only their own teams")!.version;
    await migrate(c, v - 1);
    for (const [code, type, remote] of [["MEET", "LeagueMeet", 0], ["SOON", "LeagueMeet", 0], ["QUAL", "Qualifier", 0], ["REMOTE", "LeagueMeet", 1]] as const) {
      await run("INSERT INTO events (season, code, name, type, start, end, source, synced_at, remote) VALUES (2025, ?, ?, ?, '2025-11-01', '2025-11-01', 'first', 'x', ?)", [code, code, type, remote]);
      for (const t of [1, 2, 3]) await run("INSERT INTO event_teams (season, code, team) VALUES (2025, ?, ?)", [code, t]);
    }
    for (const code of ["MEET", "QUAL"]) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, ?, 'qual', 0, 1, 'Q1', 1, 'first')", [code]);
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (2025, ?, 'qual', 0, 1, 1, 'red', 1)", [code]);
    }
    await migrate(c, v);
    const rows = await all<{ code: string; team: number }>("SELECT code, team FROM event_teams ORDER BY code, team");
    // A remote meet keeps its ranked teams: it never has matches.
    expect(rows.map((r) => `${r.code}:${r.team}`)).toEqual(["MEET:1", "QUAL:1", "QUAL:2", "QUAL:3", "REMOTE:1", "REMOTE:2", "REMOTE:3"]);
    c.close();
  });
});
