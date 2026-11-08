// One team, Compare asked for ("compare <team>"): Compare opened with it in, and its closest-rated rivals as searches
// to compare it with. Fixture teams only; every phrasing is a rewording, never a logged query's words.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";

const ask = (q: string) => searchAnswer(q, { limit: 25, learn: false });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, state, rating (2025), rated matches
  const teams: [number, string, string, number, number][] = [
    [4215, "Hypnotic Robotics", "NJ", 100, 12], [6980, "Bad Wolf", "NJ", 96, 10], [8000, "Near Above", "NJ", 103, 9],
    [8001, "Far Off", "NJ", 40, 9], [8002, "Too Few Matches", "NJ", 100, 2], [8003, "Other State Twin", "TX", 100, 12],
    [8004, "Middling", "NJ", 70, 8],
    // A placeholder entry: rated, in the state, nearest of all, and never a rival (it has no page to compare).
    [8005, "Off-Season Demo Team", "NJ", 100.5, 9],
  ];
  for (const [n, name, state, rating, rm] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'X', ?, 50, 5)", [n]);
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_matches, matches) VALUES (2025, ?, ?, ?, ?)", [n, rating, rm, rm]);
  }
  // A team numbered like a year, unrated (never a rival).
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (2024, 'Year Numbered', 'Town', 'NJ', 'USA')");
  await run("INSERT INTO team_seasons (season, team) VALUES (2025, 2024)");
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'X', 2024, 50, 5)");
  // An earlier season, rated differently: a season named picks its rivals there.
  for (const [n, rating] of [[4215, 60], [6980, 20], [8004, 58]]) {
    await run("INSERT INTO team_seasons (season, team) VALUES (2024, ?)", [n]);
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_matches, matches) VALUES (2024, ?, ?, 6, 6)", [n, rating]);
  }
  // A season just started: one NJ team rated in it, with two rated rivals there, all rated last season too.
  for (const [n, name, r25, r26] of [[8006, "New Season Lead", 5, 50], [8007, "New Season Near", 6, 52], [8008, "New Season Far", 7, 20]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [n, name]);
    for (const [season, rating] of [[2025, r25], [2026, r26]]) {
      await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [season, n]);
      await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'X', ?, 50, 5)", [season, n]);
      await run("INSERT INTO team_season_stats (season, team, rating_np, rating_matches, matches) VALUES (?, ?, ?, 5, 5)", [season, n, rating]);
    }
  }
  await rebuildSearch();
});

describe("Compare asked for one team", () => {
  it("opens Compare with the team in it and suggests its closest-rated rivals in its state", async () => {
    for (const q of ["compare hypnotic robotics", "4215 compare", "4215 comparison"]) {
      const a = await ask(q);
      expect(a.hits[0], q).toMatchObject({ kind: "compare", href: "/compare?teams=4215" });
      expect(a.understood, q).toMatchObject({ kind: "compare" });
      // Nearest first; too few rated matches and another state are never picked.
      expect(a.suggest, q).toEqual(["4215 vs 8000 2025-26", "4215 vs 6980 2025-26", "4215 vs 8004 2025-26"]);
    }
  });

  it("each suggestion is a working comparison", async () => {
    for (const s of (await ask("compare 6980")).suggest ?? []) expect((await ask(s)).hits[0], s).toMatchObject({ kind: "compare" });
  });

  it("a season after the team, as a bare year or in words, is the season compared and its rivals'", async () => {
    const a = await ask("compare 4215 2024");
    expect(a.hits[0]).toMatchObject({ kind: "compare", href: "/compare?teams=4215&season=2024" });
    expect(a.suggest).toEqual(["4215 vs 8004 2024-25", "4215 vs 6980 2024-25"]);
    // "Last season" is read by the season reader around this one (today is in 2026–27): its rivals kept.
    expect((await ask("compare 4215 last season")).suggest).toEqual(["4215 vs 8000 2025-26", "4215 vs 6980 2025-26", "4215 vs 8004 2025-26"]);
  });

  it("a team numbered like a year, said as a team, is that team", async () => {
    expect((await ask("compare team 2024")).hits[0]).toMatchObject({ kind: "compare", href: "/compare?teams=2024" });
  });

  it("two teams named stay the versus's", async () => {
    expect((await ask("compare 4215 and 6980")).hits[0]).not.toMatchObject({ href: "/compare?teams=4215" });
  });

  it("the rivals' season goes with each suggestion: a season just started, never the one before", async () => {
    expect((await ask("compare 8006")).suggest).toEqual(["8006 vs 8007 2026-27", "8006 vs 8008 2026-27"]);
  });

  it("a state with too few rated teams widens to the country", async () => {
    expect((await ask("compare 8003")).suggest).toEqual(["8003 vs 4215 2025-26", "8003 vs 8000 2025-26", "8003 vs 6980 2025-26"]);
  });
});
