// Time said loosely is never read as a time still to come (search audit 2026-11-24, Q2): a month with no year is the
// latest one that has begun ("june" asked in November 2026 is June 2026), a list by Worlds with no season is the
// latest Worlds held, and "this season" asked of a team that hasn't played the current one says so on the card.
import { describe, expect, it } from "vitest";
import { CURRENT_SEASON } from "../../data/seasons";
import { lastMonthSeason, readTeamFact } from "./families/facts";
import { listSeason } from "./families/compound";
import { completedSeason, defaultSeason, thisSeasonNote } from "./season";
import { monthIn, readTime, teamMonth, teamMonthWindow } from "../query/time";
import { windowSteps } from "../query/relax";
import { seasonLabel } from "../../../src/shared/format";

const S = CURRENT_SEASON;

describe("a month said without its year", () => {
  it("is the latest such month that has begun", () => {
    // June of the current season is still to come in its November: the June before.
    expect(lastMonthSeason(5, `${S}-11-24`)).toBe(S - 1);
    // October has begun: this season's.
    expect(lastMonthSeason(9, `${S}-11-24`)).toBe(S);
    expect(lastMonthSeason(5, `${S + 1}-06-02`)).toBe(S);
    // As of an earlier day: that day's own season, never today's (Loopy on #2254).
    expect(lastMonthSeason(5, `${S - 2}-11-24`)).toBe(S - 3);
    expect(lastMonthSeason(9, `${S - 2}-11-24`)).toBe(S - 2);
    // A bare year read as the team ("2024 events in march"): its month the latest begun too (Loopy on #2254).
    expect(readTeamFact("2024 events in march")).toMatchObject({ core: "2024", month: 2, season: lastMonthSeason(2) });
    expect(readTeamFact("2024 events in june")).toMatchObject({ core: "2024", month: 5, season: lastMonthSeason(5) });
  });
  it("is read by the parser as the latest such month begun, unless the question looks ahead", () => {
    expect(readTime("7149 events in june", `${S}-11-24`).time).toMatchObject({ from: `${S}-06-01`, season: S - 1, label: `in June ${S}` });
    expect(readTime("events in october", `${S}-11-24`).time).toMatchObject({ from: `${S}-10-01`, season: S });
    expect(readTime("upcoming events in june", `${S}-11-24`).time).toMatchObject({ from: `${S + 1}-06-01`, season: S });
    // Looking ahead to a month already over this season: next season's ("upcoming events in october" in November).
    expect(readTime("upcoming events in october", `${S}-11-24`).time).toMatchObject({ from: `${S + 1}-10-01`, season: S + 1 });
    // The month under way is still to come in part: this one.
    expect(readTime("upcoming events in november", `${S}-11-24`).time).toMatchObject({ from: `${S}-11-01`, season: S });
  });
  it("moves to another season's same month, the year with it", () => {
    const t = readTime("upcoming events in june", `${S}-11-24`).time!;
    expect(t.month).toBe(5);
    expect(monthIn(t, S - 1)).toMatchObject({ season: S - 1, from: `${S}-06-01`, to: `${S}-06-30`, label: `in June ${S}` });
    // A month typed with its year never moves.
    const y = readTime(`events in june ${S + 1}`, `${S}-11-24`).time!;
    expect(y.month).toBeUndefined();
    expect(monthIn(y, S - 1)).toBe(y);
  });
  it("asked of a team: its latest season's, never one to come, unless the question looks ahead", () => {
    const today = `${S}-11-24`;
    // "<team> events in june": the June before, also for a team whose latest season is this one.
    expect(teamMonth(readTime("events in june", today).time!, S, today)).toMatchObject({ from: `${S}-06-01`, season: S - 1 });
    // A team last seen two seasons back: that season's June.
    expect(teamMonth(readTime("events in june", today).time!, S - 2, today)).toMatchObject({ from: `${S - 1}-06-01`, season: S - 2 });
    // "<team> upcoming events in june": the coming June the parser read, kept (Loopy on #2254).
    const ahead = readTime("upcoming events in june", today).time!;
    expect(ahead.ahead).toBe(true);
    expect(teamMonth(ahead, S, today)).toBe(ahead);
  });
  it("an empty month of a team's is widened from the team's own season, never the parser's (Loopy on #2254)", () => {
    const today = `${S}-11-24`, t = readTime("events in june", today).time!;
    const moved = teamMonthWindow({ from: t.from!, to: t.to!, label: t.label, month: t.month }, t.season, S - 2, today)!;
    expect(moved).toMatchObject({ season: S - 2, window: { from: `${S - 1}-06-01` } });
    expect(windowSteps(moved.window, moved.season).map((s) => s.season)).toEqual([S - 2, S - 3]);
    // Nothing moves for the team's latest season being the parser's, or a look ahead.
    expect(teamMonthWindow({ from: t.from!, to: t.to!, label: t.label, month: t.month }, t.season, S, today)).toBeNull();
  });
});

describe("a list by Worlds with no season named", () => {
  const list = { kind: "list" as const, n: null, stat: null, region: null, country: null, city: null, season: null, award: null, worlds: false, thresholds: [], outputs: [] };
  it("is the latest Worlds held, never one still to come", () => {
    expect(listSeason({ ...list, noWorlds: true })).toBe(completedSeason());
    expect(listSeason({ ...list, worlds: true })).toBe(completedSeason());
    // A season named is that season; any other list is the default season.
    expect(listSeason({ ...list, noWorlds: true, season: S - 3 })).toBe(S - 3);
    expect(listSeason(list)).toBe(defaultSeason());
  });
});

describe("\"this season\" for a team that hasn't played the current one", () => {
  it("is said on the card", () => {
    expect(thisSeasonNote(S - 1, "4215")).toBe(`${seasonLabel(S)} has no data yet for 4215; showing ${seasonLabel(S - 1)}`);
    expect(thisSeasonNote(S, "4215")).toBeUndefined();
  });
});
