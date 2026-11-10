// No-team answers the launch audit found missing (Phase E): the highest score in a lost match, an event's field (its
// teams' average OPR), a championship's divisions by field strength, and a place's teams by win streak. Fixture data
// only, every phrasing a rewording.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";

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
  // Alder: 6101 (100) and 6102 (80), average 90. Birch: 6103 (40) and 6104 (60), average 50.
  for (const [code, team, opr] of [["USNJCMPA", 6101, 100], ["USNJCMPA", 6102, 80], ["USNJCMPB", 6103, 40], ["USNJCMPB", 6104, 60]] as const)
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, ?, ?, ?, 5)", [S, code, team, opr]);
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
    // Red won Q1, Q2 (2 in a row), lost Q3, won Q4: the longest is 2, the run going now 1.
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
