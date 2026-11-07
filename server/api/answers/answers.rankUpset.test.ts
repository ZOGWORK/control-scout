// Matches a low-ranked team won against a high-ranked one. Fixture teams and matches only; every phrasing is a
// rewording, never a logged query's words.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rankUpsetAnswer, readRankUpset } from "./families/rankUpset";

describe("reading it", () => {
  it("the winner's line and the loser's, either way round", () => {
    expect(readRankUpset("games where a team ranked lower than 500 defeated a team in the top 20")).toEqual({ below: 500, top: 20, season: null });
    expect(readRankUpset("show me times a robot outside the top 300 upset a team ranked above 10")).toEqual({ below: 300, top: 9, season: null });
    expect(readRankUpset("a team in the top 25 lost to a team ranked 800 or worse in 2024-25")).toEqual({ below: 799, top: 25, season: 2024 });
    expect(readRankUpset("match where team ranked below 600 beat team ranked top 40")).toEqual({ below: 600, top: 40, season: null });
  });

  it("never a line that isn't an upset, nor other rank questions", () => {
    expect(readRankUpset("a team ranked below 10 beat a team ranked top 100")).toBeNull();
    expect(readRankUpset("teams ranked top 100")).toBeNull();
    expect(readRankUpset("12345 rank")).toBeNull();
  });
});

describe("the answer", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO events (season, code, name, type, source) VALUES (2025, 'Q1', 'Fixture Qualifier', 'Qualifier', 'test'), (2025, 'SCRIM', 'Fixture Scrimmage', 'Scrimmage', 'test')");
    // team, world rank
    for (const [t, r] of [[1, 5], [2, 50], [3, 900], [4, 1500], [5, 3000], [6, 200]]) {
      await run("INSERT INTO teams (number, name, country) VALUES (?, ?, 'USA')", [t, `Team ${t}`]);
      await run("INSERT INTO team_season_stats (season, team, rating_np, rating_rank, rating_matches) VALUES (2025, ?, 10, ?, 9)", [t, r]);
    }
    // code, number, red teams, blue teams, red score, blue score
    const ms: [string, number, number[], number[], number, number][] = [
      ["Q1", 1, [5, 6], [1, 3], 120, 100], // 3000 beat 5: gap 2995
      ["Q1", 2, [2, 6], [4, 3], 90, 110], // 1500 beat 50: gap 1450
      ["Q1", 3, [4, 6], [3, 2], 100, 100], // a tie: never
      ["Q1", 4, [3, 6], [1, 2], 130, 80], // 900 isn't below 1000
      ["SCRIM", 1, [5, 4], [1, 2], 140, 60], // a scrimmage: not official
    ];
    for (const [code, n, red, blue, rt, bt] of ms) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, 'qual', 0, ?, ?, 1, ?, ?, ?, ?, 'test')", [code, n, `Q${n}`, rt, rt, bt, bt]);
      for (const [i, t] of red.entries()) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (2025, ?, 'qual', 0, ?, ?, 'red', ?)", [code, n, t, i + 1]);
      for (const [i, t] of blue.entries()) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (2025, ?, 'qual', 0, ?, ?, 'blue', ?)", [code, n, t, i + 1]);
    }
  });

  it("lists the matches, biggest rank gap first, ties and unofficial events left out", async () => {
    const a = await rankUpsetAnswer({ below: 1000, top: 100, season: null });
    expect(a.headline?.value).toBe("2 matches");
    const block = a.blocks[0];
    expect(block.kind === "matches" && block.rows.map((r) => [r.label, r.alliance, r.own, r.opp])).toEqual([["Q1", "red", 120, 100], ["Q2", "blue", 110, 90]]);
    expect(block.kind === "matches" && block.rows[0].partners?.map((p) => p.label)).toEqual(["5 Team 5 (#3,000)", "6 Team 6 (#200)"]);
  });

  it("none, said plainly", async () => {
    const a = await rankUpsetAnswer({ below: 5000, top: 10, season: 2025 });
    expect(a.none).toMatch(/^None of the 3 decided matches in 2025–26/);
  });
});
