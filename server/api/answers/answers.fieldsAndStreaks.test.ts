// No-team answers the launch audit found missing (Phase E): the highest score in a lost match, an event's field (its
// teams' average OPR), a championship's divisions by field strength, and a place's teams by win streak. Fixture data
// only, every phrasing a rewording.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { oprPhaseOf, saysOtherThanOpr } from "./families/eventVersus";

const S = 2025;
const ask = (q: string) => searchAnswer(q, { learn: false, limit: 25, full: true, now: Date.parse("2026-05-01T12:00:00Z") });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string][] = [[6101, "Lark Gears", "NJ"], [6102, "Pine Bots", "NJ"], [6103, "Kestrel", "NJ"], [6104, "Moss Lab", "NJ"], [6201, "Dune Works", "TX"], [6202, "Mesa Build", "TX"]];
  for (const [n, name, state] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  const event = (code: string, name: string, type: string, division: string | null, state: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, 'Town', ?, 'USA', ?, ?, 't')", [S, code, name, type, division, state, start, start]);
  await event("USNJCMP", "New Jersey Championship", "Championship", null, "NJ", "2026-03-01");
  await event("USNJCMPA", "New Jersey Championship - Alder Division", "Championship", "USNJCMP", "NJ", "2026-03-01");
  await event("USNJCMPB", "New Jersey Championship - Birch Division", "Championship", "USNJCMP", "NJ", "2026-03-01");
  await event("USNJQ1", "Ridge Qualifier", "Qualifier", null, "NJ", "2026-01-10");
  // Alder: 6101 (100) and 6102 (80), average 90. Birch: 6103 (40) and 6104 (60), average 50. By Auto OPR the other way
  // round: Alder 10 and 10, Birch 30 and 40.
  for (const [code, team, opr, auto] of [["USNJCMPA", 6101, 100, 10], ["USNJCMPA", 6102, 80, 10], ["USNJCMPB", 6103, 40, 30], ["USNJCMPB", 6104, 60, 40]] as const)
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, matches) VALUES (?, ?, ?, ?, ?, 5)", [S, code, team, opr, auto]);
  // Ridge Qualifier: 6101 and 6102 (red) against 6103 and 6104 (blue), in date order.
  // Q1 red 50-40, Q2 red 60-55, Q3 blue 90-80 (red lost scoring 80), Q4 red 70-30.
  const scores = [[50, 40], [60, 55], [80, 90], [70, 30]];
  for (const [i, [red, blue]] of scores.entries()) {
    const n = i + 1;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'USNJQ1', 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')",
      [S, n, `Q${n}`, `2026-01-10T1${n}:00:00Z`, red, red, blue, blue]);
    for (const [t, a] of [[6101, "red"], [6102, "red"], [6103, "blue"], [6104, "blue"]] as const)
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'USNJQ1', 'qual', 0, ?, ?, ?, 1)", [S, n, t, a]);
  }
  // An off-season event after it: red wins three more, never on a record.
  await event("USNJOFF", "Ridge Off-Season Scrimmage", "OffSeason", null, "NJ", "2026-01-20");
  for (const n of [1, 2, 3]) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'USNJOFF', 'qual', 0, ?, ?, ?, 1, 90, 90, 10, 10, 't')",
      [S, n, `Q${n}`, `2026-01-20T1${n}:00:00Z`]);
    for (const [t, a] of [[6101, "red"], [6102, "red"], [6103, "blue"], [6104, "blue"]] as const)
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'USNJOFF', 'qual', 0, ?, ?, ?, 1)", [S, n, t, a]);
  }
  await rebuildSearch();
});

describe("the highest score in a lost match", () => {
  it("is the losing alliance's score, its teams named, never a win", async () => {
    for (const q of ["who has the highest score in a match they lost in new jersey", "highest losing score in nj"]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("find-loss-high");
      expect(a.stat?.headline?.value, q).toBe("80 points, and lost");
      expect(a.stat?.headline?.label, q).toMatch(/^6101 Lark Gears, 6102 Pine Bots lost Q3/);
    }
  });
});

describe("an event's field", () => {
  it("its teams' average OPR there: a division alone, or the parent with its divisions", async () => {
    const d = await ask("what's the average OPR of teams at the New Jersey Championship Alder Division");
    expect(d.stat?.intent).toBe("event-field");
    expect(d.stat?.headline).toMatchObject({ value: "90.0", label: "average OPR of the 2 teams at New Jersey Championship - Alder Division" });
    expect((await ask("nj states average opr")).stat?.headline?.value).toBe("70.0");
  });
});

describe("a championship's divisions by field strength", () => {
  it("the hardest first, the easiest when asked, each by its own name", async () => {
    const h = await ask("which division was hardest at nj states, by average opr");
    expect(h.stat?.intent).toBe("division-field");
    expect(h.stat?.headline).toMatchObject({ value: "90.0", label: "average OPR: Alder Division was the hardest" });
    const e = await ask("easiest division at nj states");
    expect(e.stat?.headline?.label).toBe("average OPR: Birch Division was the easiest");
  });
  it("by average OPR, or one phase's OPR said with OPR: another stat said is no question it answers", async () => {
    // A phase's OPR ranks by that phase's ("by average auto OPR", in any word order).
    for (const q of ["which division was hardest at nj states, by average auto opr", "by average auto opr which division was hardest at nj states"]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("division-field");
      expect(a.stat?.headline, q).toMatchObject({ value: "35.0", label: "average Auto OPR: Birch Division was the hardest" });
      expect(a.stat?.scope, q).toContain("By average Auto OPR");
    }
    // OPR's long name with hyphens or slashes between its words is OPR all the same.
    for (const q of ["hardest division at nj states by average auto offensive-power-rating", "hardest division at nj states by average auto offensive/power/rating"])
      expect(oprPhaseOf(q, "nj"), q).toBe("auto");
    expect((await ask("hardest division at nj states by average auto offensive-power-rating")).stat?.headline?.label).toBe("average Auto OPR: Birch Division was the hardest");
    // A phase with no OPR on record says so, never the whole OPR instead.
    for (const q of ["hardest division at nj states by average end-game opr", "hardest division at nj states by average tele op opr", "hardest division at nj states by average dc opr"]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("division-field");
      expect(a.stat?.none, q).toMatch(/no division with (?:TeleOp|Endgame) OPR on record/);
    }
    // A stat that is no OPR, or a phase's points without OPR: no question this answers.
    for (const q of ["which division was hardest at nj states by average score", "hardest division at nj states by auto points", "hardest division at nj states by average auto and endgame opr"])
      expect((await ask(q)).stat?.intent, q).not.toBe("division-field");
    // A place's name is the place, never a stat its letters spell ("DC" is no driver controlled).
    expect(saysOtherThanOpr("states average opr in dc", "dc")).toBe(false);
    expect(saysOtherThanOpr("dc average dc opr", "dc")).toBe(true);
    // OPR said in full is OPR.
    expect((await ask("hardest division at nj states by average offensive power rating")).stat?.intent).toBe("division-field");
    expect((await ask("nj states average auto opr")).stat?.intent).not.toBe("event-field");
  });
  it("the season said, never the latest instead", async () => {
    // Only 2025–26 has divisions here: last season has none to rank.
    expect((await ask("hardest division at nj states last season")).stat?.intent).not.toBe("division-field");
  });
  it("a team's own division is never it", async () => {
    expect((await ask("6101 hardest division")).stat?.intent).not.toBe("division-field");
  });
});

describe("a place's teams by win streak", () => {
  it("the longest run and the run going now, a tie or a loss ending it", async () => {
    const a = await ask("who has the longest winning streak in new jersey right now");
    expect(a.stat?.intent).toBe("streak-board");
    // Red won Q1, Q2 (2 in a row), lost Q3, won Q4: the longest is 2, the run going now 1. The off-season wins after
    // it are on no record, so they never add to either.
    expect(a.stat?.headline?.value).toBe("2 wins");
    const tables = (a.stat?.blocks ?? []).filter((b) => b.kind === "table");
    expect(tables.map((b) => b.kind === "table" && b.title)).toEqual(["Longest in 2024–25 and 2025–26", "Going now, up to each team's latest match"]);
    const now = tables[1];
    expect(now.kind === "table" && now.rows.map((r) => r.cells.streak)).toEqual(["1 win", "1 win"]);
  });
  it("a match type said is a streak this board doesn't count", async () => {
    expect((await ask("longest playoff win streak in new jersey")).stat?.intent).not.toBe("streak-board");
  });
  it("needs a place: the world's every match is left alone", async () => {
    expect((await ask("longest win streak")).stat?.intent).not.toBe("streak-board");
    expect((await ask("longest win streak in texas")).stat?.none).toMatch(/^No matches played by teams from Texas in 2024–25 and 2025–26/);
  });
});

describe("a streak's matches in the event's own order", () => {
  it("by match, never by time: a match without one is still where it was played", async () => {
    await run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, 'USTXQ1', 'Mesa Qualifier', 'Qualifier', NULL, 'Town', 'TX', 'USA', '2026-02-01', '2026-02-01', 't')", [S]);
    // Q1 red wins, Q2 (no time on record) blue wins, Q3 red wins: no team has two in a row.
    for (const [n, time, red, blue] of [[1, "2026-02-01T10:00:00Z", 50, 40], [2, null, 40, 50], [3, "2026-02-01T12:00:00Z", 50, 40]] as const) {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'USTXQ1', 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [S, n, `Q${n}`, time, red, red, blue, blue]);
      for (const [t, a] of [[6201, "red"], [6202, "blue"]] as const)
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'USTXQ1', 'qual', 0, ?, ?, ?, 1)", [S, n, t, a]);
    }
    expect((await ask("longest win streak in texas")).stat?.headline?.value).toBe("1 win");
  });
  it("a double elimination bracket numbered from 0: its first match first", async () => {
    // A week later: playoff series 0, 1, 2 in that order; 6201 wins the first, loses the next two.
    await run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, 'USTXQ2', 'Mesa Playoff Day', 'Qualifier', NULL, 'Town', 'TX', 'USA', '2026-02-08', '2026-02-08', 't')", [S]);
    for (const [series, red, blue] of [[0, 50, 40], [1, 40, 50], [2, 40, 50]] as const) {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'USTXQ2', 'playoff', ?, 1, ?, NULL, 1, ?, ?, ?, ?, 't')", [S, series, `M${series + 1}`, red, red, blue, blue]);
      for (const [t, a] of [[6201, "red"], [6202, "blue"]] as const)
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'USTXQ2', 'playoff', ?, 1, ?, ?, 1)", [S, series, t, a]);
    }
    // In order 6201 is W L W, W L L and 6202 L W L, L W W: both longest runs are 2, and 6202's two is going now.
    // Series 0 counted last would leave 6201 a run of 1 going now and 6202 none.
    const a = await ask("longest win streak in texas");
    expect(a.stat?.headline?.label).toMatch(/^6201 .* and 1 more/);
    const going = (a.stat?.blocks ?? []).find((b) => b.kind === "table" && b.title.startsWith("Going now"));
    expect(going?.kind === "table" && going.rows.map((r) => [String(r.cells.team).slice(0, 4), r.cells.streak])).toEqual([["6202", "2 wins"]]);
  });
});
