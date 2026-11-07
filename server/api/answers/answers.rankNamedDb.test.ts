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
  // number, name, opr, auto, matches
  const teams: [number, string, number, number | null, number][] = [
    [4215, "Hypnotic Robotics", 101.6, 28, 32],
    [6980, "Bad Wolf", 46.9, 13, 24],
    // Stronger than both, never named.
    [23268, "Ultraviolet", 157.9, 40, 50],
    // Named, under 3 matches.
    [9999, "Two Matches", 300, 90, 2],
    // Named, no Auto OPR.
    [7149, "Enforcers", 115.3, null, 30],
  ];
  for (const [n, name, opr, auto, m] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Oradell', 'NJ', 'USA', 2015)", [n, name]);
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, wins, losses, ties, matches, rank_np, ranked_teams, rating_np, rating_matches) VALUES (2025, ?, ?, ?, 10, 5, 0, ?, 1, 100, 50, ?)", [n, opr, auto, m, m]);
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

  it("none ranked says so", async () => {
    const a = await searchAnswer("sort these teams by opr in 2025-26: 9999, 7777", { full: true, learn: false });
    expect(a.stat!.none).toMatch(/None of the 2 teams named has a 2025–26 OPR yet/);
  });
});
