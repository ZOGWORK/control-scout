// Teams named and ranked by one stat, on a small fixture database: only the teams named, ranked among themselves; a
// named team under 3 matches or with no number for the stat said as not ranked; no link to a place's full list.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, opr, auto, matches, penalty points given away a match
  const teams: [number, string, number, number | null, number, number][] = [
    [4215, "Hypnotic Robotics", 101.6, 28, 32, 5.8],
    [6980, "Bad Wolf", 46.9, 13, 24, 4.4],
    // Stronger than both, never named.
    [23268, "Ultraviolet", 157.9, 40, 50, 1],
    // Named, under 3 matches.
    [9999, "Two Matches", 300, 90, 2, 0],
    // Named, no Auto OPR.
    [7149, "Enforcers", 115.3, null, 30, 9],
  ];
  for (const [n, name, opr, auto, m, pen] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Oradell', 'NJ', 'USA', 2015)", [n, name]);
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, wins, losses, ties, matches, rank_np, ranked_teams, rating_np, rating_matches, rating_pen) VALUES (2025, ?, ?, ?, 10, 5, 0, ?, 1, 100, 50, ?, ?)", [n, opr, auto, m, m, pen]);
  }
  await rebuildSearch();
});

const rowsOf = (stat: NonNullable<Awaited<ReturnType<typeof searchAnswer>>["stat"]>) =>
  stat.blocks.flatMap((b) => (b.kind === "leaderboard" ? b.rows.map((r) => r.team.label) : []));

describe("teams named, ranked by a stat", () => {
  it("ranks only the teams named, says the ones not ranked, and links to no full list", async () => {
    const a = await searchAnswer("sort these teams by opr in 2025-26: 6980, 4215, 9999", { full: true, learn: false });
    expect(rowsOf(a.stat!)).toEqual(["4215 Hypnotic Robotics", "6980 Bad Wolf"]);
    expect(a.stat!.source).toMatch(/Not ranked \(under 3 matches or no OPR\): 9999/);
    expect(a.stat!.blocks.find((b) => b.kind === "leaderboard")).not.toHaveProperty("more");
  });

  it("a named team with no number for the stat is not ranked either", async () => {
    const a = await searchAnswer("sort these teams by auto opr in 2025-26: 7149, 4215", { full: true, learn: false });
    expect(rowsOf(a.stat!)).toEqual(["4215 Hypnotic Robotics"]);
    expect(a.stat!.source).toMatch(/: 7149$/);
  });

  it("penalties: the fewest first, ranked from 1 among the teams named", async () => {
    const a = await searchAnswer("sort these teams by penalties in 2025-26: 4215, 7149, 6980", { full: true, learn: false });
    const board = a.stat!.blocks.find((b) => b.kind === "leaderboard");
    expect(board && board.kind === "leaderboard" && board.rows.map((r) => [r.rank, r.team.label])).toEqual([[1, "6980 Bad Wolf"], [2, "4215 Hypnotic Robotics"], [3, "7149 Enforcers"]]);
    expect(board).not.toHaveProperty("lowest");
    expect(a.stat!.title).toMatch(/^3 teams, fewest first, by /);
    expect(a.stat!.headline?.sub).not.toMatch(/Lowest/);
  });

  it("counts by their singular, as search passes them, and an order said is kept", async () => {
    for (const q of ["rank these teams by matches in 2025-26: 6980, 4215", "rank these teams by match in 2025-26: 6980, 4215"]) {
      const a = await searchAnswer(q, { full: true, learn: false });
      expect(rowsOf(a.stat!), q).toEqual(["4215 Hypnotic Robotics", "6980 Bad Wolf"]);
    }
    const up = await searchAnswer("put these teams in ascending order by opr in 2025-26: 4215, 6980", { full: true, learn: false });
    expect(rowsOf(up.stat!)).toEqual(["6980 Bad Wolf", "4215 Hypnotic Robotics"]);
    const most = await searchAnswer("sort these teams by penalties from highest to lowest in 2025-26: 6980, 4215", { full: true, learn: false });
    expect(rowsOf(most.stat!)).toEqual(["4215 Hypnotic Robotics", "6980 Bad Wolf"]);
  });

  it("none ranked says so", async () => {
    const a = await searchAnswer("sort these teams by opr in 2025-26: 9999, 7777", { full: true, learn: false });
    expect(a.stat!.none).toMatch(/None of the 2 teams named has a 2025–26 OPR yet/);
  });
});
