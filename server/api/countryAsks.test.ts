// Countries and counts said the ways logged failed searches said them (#1524 "Top teams in Taiwan", #1311 "teams with
// highest opr in texas 2024", #1590 "How many teams in the world", #1594 "How many in Australia"). Every number is from the fixture.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { teamListAnswer } from "./searchCoverage";
import { CURRENT_SEASON } from "../data/seasons";
import { seasonLabel } from "../../src/shared/format";

const C = CURRENT_SEASON;
const ask = (q: string) => searchAnswer(q, { limit: 25, learn: false, full: true });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, city, state, country, [season, opr, wins, losses] rows
  const teams: [number, string, string, string | null, string, [number, number, number, number][]][] = [
    // Chinese Taipei as FIRST lists Taiwan: ranked last season only.
    [32602, "Byte Team", "Kaohsiung", "KHH", "Chinese Taipei", [[C - 1, 162, 5, 1]]],
    [28008, "Sea Team", "Taipei", "TPE", "Chinese Taipei", [[C - 1, 120, 4, 2]]],
    [18030, "Texas Big", "Austin", "TX", "USA", [[2024, 230, 48, 10], [C, 90, 6, 2]]],
    [11111, "Texas Small", "Dallas", "TX", "USA", [[2024, 100, 10, 10]]],
    [26000, "Theseus", "Brisbane", "QLD", "Australia", [[C, 80, 3, 3]]],
    [15210, "Roos", "Wayville", "SA", "Australia", [[C, 60, 2, 4]]],
    // One country stored under two labels, as FIRST's directory has it.
    [40001, "Mbabane Bots", "Mbabane", null, "eSwatini", [[C, 70, 3, 1]]],
    [40002, "Manzini Bots", "Manzini", null, "eSwatini", [[C, 50, 2, 2]]],
    [40003, "Lobamba Bots", "Lobamba", null, "Eswatini", [[C, 65, 3, 1]]],
  ];
  for (const [n, name, city, state, country, rows] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year, school) VALUES (?, ?, ?, ?, ?, 2015, 'School')", [n, name, city, state, country]);
    for (const [season, opr, w, l] of rows) {
      await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [season, n]);
      await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, rank_np, ranked_teams, rating_np, rating_matches, matches, wins, losses, ties)
        VALUES (?, ?, ?, 0, null, 5, ?, 10, ?, ?, ?, 0)`, [season, n, opr, opr, w + l, w, l]);
    }
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'AUQ1', 'Brisbane Qualifier', 'Qualifier', 'Brisbane', 'QLD', 'Australia', ?, ?, 't')", [C, `${C}-11-20`, `${C}-11-20`]);
  await rebuildSearch();
});

describe("a country or a place said the ways logged searches said it", () => {
  it("a country by another of its names: Taiwan's teams, last season's when none are ranked yet", async () => {
    const a = await ask("Top teams in Taiwan");
    expect(a.step).not.toBe("recovery");
    expect(a.card?.title).toBe(`Top teams in Chinese Taipei · ${seasonLabel(C - 1)}`);
    expect(a.card?.lines.map((l) => l.text)).toEqual(["32602 Byte Team", "28008 Sea Team"]);
    expect(a.understood?.label).toMatch(/no .* ranked teams yet/);
  });
  it("'teams with the highest …' is having it, never a second thing joined on", async () => {
    const a = await ask("teams with highest opr in texas 2024");
    expect(a.step).toBe("deterministic");
    expect(a.stat?.title).toBe(`Top 10 teams by OPR in Texas · ${seasonLabel(2024)}`);
  });
});

describe("counts", () => {
  it("'in the world' is everywhere: every team counted", async () => {
    const a = await ask("How many teams in the world");
    expect(a.card?.title).toBe(`How many teams · ${seasonLabel(C)}`);
    expect(a.card?.lines[0].text).toMatch(/^6 teams registered/);
    // Season words after it too.
    expect((await ask("how many teams in the world this season")).card?.title).toBe(`How many teams · ${seasonLabel(C)}`);
  });
  it("neither named and everywhere: both counts, no place", async () => {
    const a = await ask("how many in the world");
    expect(a.card?.title).toBe(`How many teams and events · ${seasonLabel(C)}`);
    expect(a.card?.lines.map((l) => l.text)).toEqual([`6 teams registered in ${seasonLabel(C)}`, `1 event in ${seasonLabel(C)}`]);
  });
  it("a bare year is a season of teams but a calendar year of events: no one season in the title", async () => {
    expect((await ask("how many in australia in 2024")).card?.title).toBe("How many teams and events in Australia");
  });
  it("a country stored under two labels counts both, asked by any of its names", async () => {
    for (const q of ["how many teams in swaziland", "how many teams in eswatini"]) expect((await ask(q)).card?.lines[0].text, q).toMatch(/^3 teams registered in /);
    expect((await ask("top teams in swaziland")).card?.lines.map((l) => l.text)).toEqual(["40001 Mbabane Bots", "40003 Lobamba Bots", "40002 Manzini Bots"]);
    // Every reader the place feeds: the season's best scores (no error from a second label) and most improved.
    const scores = await ask("top scores in swaziland");
    expect(scores.step).not.toBe("recovery");
    // The place readers' own best-scores list reads both labels in one filter, its arguments in step.
    expect((await teamListAnswer("top scores in swaziland"))?.understood?.label).toMatch(/eSwatini/);
    expect((await ask("most improved teams in swaziland")).step).not.toBe("recovery");
  });
  it("no teams or events named: both counts for the place", async () => {
    const a = await ask("How many in Australia");
    expect(a.card?.title).toBe(`How many teams and events in Australia · ${seasonLabel(C)}`);
    expect(a.card?.lines.map((l) => l.text)).toEqual([`2 teams registered in Australia in ${seasonLabel(C)}`, `1 event in Australia in ${seasonLabel(C)}`]);
  });
});
