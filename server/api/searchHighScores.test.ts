// High-score questions (server/api/searchHighScores.ts) on a small fixture database: what's read as one (a game named
// with any spacing, a season label, "this season"; never a team's win-loss "record"), a season's best scores without
// penalties from official events only, a team's, and before a season's first official match its scrimmages' best,
// said plainly.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { parseHighScore } from "./searchHighScores";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [23268, "Ultraviolet"], [207, "Critical Mass"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (season: number, code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Hillsborough', 'NJ', 'USA', ?, ?, 't')", [season, code, name, type, start, start]);
  await ev(2025, "USNJCMP", "New Jersey Championship", "Championship", "2026-03-15");
  await ev(2025, "USNJSCR", "Summer Scrimmage", "Scrimmage", "2026-07-01");
  await ev(2026, "USNJSCR1", "Kickoff Scrimmage", "Scrimmage", "2026-09-20");
  const match = (season: number, code: string, n: number, red: [number, number], blue: [number, number], teams: [number, string][]) => Promise.all([
    run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, ?, ?, ?, ?, 't')", [season, code, n, `Q${n}`, ...red, ...blue]),
    ...teams.map(([t, alliance]) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, ?)", [season, code, n, t, alliance])),
  ]);
  // Q1: blue's 900 is mostly red's penalties; red's 250 is the best score without penalties.
  await match(2025, "USNJCMP", 1, [262, 250], [900, 180], [[4215, "red"], [23268, "red"], [6980, "blue"], [207, "blue"]]);
  await match(2025, "USNJCMP", 2, [221, 221], [190, 190], [[207, "red"], [6980, "red"], [4215, "blue"], [23268, "blue"]]);
  // Scrimmages: never the record, however high.
  await match(2025, "USNJSCR", 1, [400, 400], [10, 10], [[6980, "red"]]);
  await match(2026, "USNJSCR1", 1, [120, 115], [80, 80], [[4215, "red"], [207, "blue"]]);
  await rebuildSearch();
});

describe("what's read as a high-score question", () => {
  it("reads the game with any spacing, a season label or this season, and what's left names the team", () => {
    expect(parseHighScore("World record score bio buzz")).toEqual({ season: 2026, game: "BIOBUZZ", core: "" });
    expect(parseHighScore("world record score BIOBUZZ")).toMatchObject({ season: 2026, core: "" });
    expect(parseHighScore("highest score in into the deep")).toMatchObject({ season: 2024, game: "INTO THE DEEP", core: "" });
    expect(parseHighScore("what is the highest score in 2025-26")).toMatchObject({ season: 2025, core: "" });
    expect(parseHighScore("4215 high score")).toEqual({ season: null, game: null, core: "4215" });
    expect(parseHighScore("hypnotic robotics best score this season")).toMatchObject({ season: 2026, core: "hypnotic robotics" });
  });
  it("a team's win-loss record or a plain search is never one", () => {
    for (const q of ["4215 record", "hypnotic robotics", "score", "records"]) expect(parseHighScore(q), q).toBeNull();
  });
});

describe("the answer", () => {
  it("a season's best scores without penalties, official events only, each a link to its match with its alliance", async () => {
    const a = await searchAnswer("world record score decode");
    expect(a.card).toMatchObject({ kind: "high-scores", title: "Highest scores in 2025–26 (DECODE)" });
    expect(a.card!.team).toBeUndefined();
    expect(a.card!.lines.map((l) => l.text)).toEqual(["250 points: Q1 at New Jersey Championship", "221 points: Q2 at New Jersey Championship", "190 points: Q2 at New Jersey Championship", "180 points: Q1 at New Jersey Championship"]);
    expect(a.card!.lines[0]).toMatchObject({
      detail: "2025–26 · Mar 15, 2026 · Hillsborough, NJ",
      results: ["Red alliance: 4215 Hypnotic Robotics, 23268 Ultraviolet", "262 with the other alliance's penalties"],
      href: "/events/2025/USNJCMP?match=qual:0:1",
    });
  });
  it("a team's, in the latest season it played", async () => {
    const a = await searchAnswer("4215 high score");
    expect(a.card).toMatchObject({ title: "Highest scores in 2026–27", team: { number: 4215 } });
    // 2026 has only a scrimmage for 4215: said plainly, its scrimmage score the closest record.
    expect(a.card!.none).toMatch(/^No official 2026–27 matches for Hypnotic Robotics have been played yet, only scrimmages/);
    expect(a.card!.closest!.map((l) => l.text)).toEqual(["115 points: Q1 at Kickoff Scrimmage"]);
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "4215" });
    const d = await searchAnswer("hypnotic best score in decode");
    expect(d.card!.lines.map((l) => l.text)).toEqual(["250 points: Q1 at New Jersey Championship", "190 points: Q2 at New Jersey Championship"]);
  });
  it("the season's first official match not played yet: no record, its scrimmages' best below", async () => {
    const a = await searchAnswer("World record score bio buzz");
    expect(a.card!.lines).toEqual([]);
    expect(a.card!.none).toMatch(/no record yet/);
    expect(a.card!.closest!.map((l) => l.text)).toEqual(["115 points: Q1 at Kickoff Scrimmage", "80 points: Q1 at Kickoff Scrimmage"]);
  });
});
