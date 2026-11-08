// The answer's season picker (/search?season=, ./season.ts withSeason): the query asked about the picked season,
// whatever season it named, so every reader takes the pick the way it takes a typed season.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason, withSeason } from "./season";

const NOW = Date.parse("2026-11-04T12:00:00Z");

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [season, start, end] of [[2024, "2025-04-16", "2025-04-19"], [2025, "2026-04-29", "2026-05-02"]] as const)
    await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'FTCCMP1', 'FIRST Championship', 'FIRSTChampionship', ?, ?, 'first')", [season, start, end]);
  // 2024 is a team's number too: never taken for a year unless said as a season.
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [2024, "Year Team"], [22024, "Five Digits"], [9999, "Powerplay Pioneers"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Oradell', 'NJ', 'USA', 2010)", [n, name]);
    for (const [season, opr] of [[2024, 144.8], [2025, 101.6]] as const)
      await run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, wins, losses, ties, matches) VALUES (?, ?, ?, 10, 8000, 20, 5, 0, 25)", [season, n, opr]);
  }
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason(NOW);
});

describe("withSeason", () => {
  it("adds the picked season to a query that names none", async () => {
    expect(await withSeason("4215 highlights", 2024, NOW)).toBe("4215 highlights 2024–25");
  });

  it("puts the picked season in place of a typed one, however it was said", async () => {
    expect(await withSeason("4215 record in 2025-26", 2023, NOW)).toBe("4215 record 2023–24");
    expect(await withSeason("4215 DECODE highlights", 2024, NOW)).toBe("4215 highlights 2024–25");
    expect(await withSeason("What is 4215's OPR this season?", 2024, NOW)).toBe("What is 4215's OPR 2024–25?");
    expect(await withSeason("4215 OPR this season's", 2024, NOW)).toBe("4215 OPR 2024–25");
    expect(await withSeason("4215 opr last season", 2025, NOW)).toBe("4215 opr 2025–26");
    expect(await withSeason("best opr of all time", 2024, NOW)).toBe("best opr 2024–25");
  });

  it("never takes a team's number for a year, unless it's said as a season", async () => {
    expect(await withSeason("2024 opr", 2025, NOW)).toBe("2024 opr 2025–26");
    expect(await withSeason("4215 opr in 2024", 2025, NOW)).toBe("4215 opr 2025–26");
    // "This season" before a team's number is the season; the number stays the team (as the parser reads it).
    expect(await withSeason("this season 2024 record", 2025, NOW)).toBe("2024 record 2025–26");
  });

  it("takes out whole words only, never part of a team's number", async () => {
    expect(await withSeason("22024 opr 2024", 2025, NOW)).toBe("22024 opr 2025–26");
  });

  it("never takes a score threshold for a year", async () => {
    expect(await withSeason("4215 predictions off by at least 2025 pts", 2024, NOW)).toBe("4215 predictions off by at least 2025 pts 2024–25");
  });

  it("keeps a stored name asked about as words, a game's name in it included", async () => {
    expect(await withSeason("teams named powerplay pioneers in 2025-26", 2024, NOW)).toBe("teams named powerplay pioneers 2024–25");
  });

  it("keeps a date window, whose season is its own", async () => {
    expect(await withSeason("4215 matches yesterday", 2024, NOW)).toBe("4215 matches yesterday 2024–25");
  });
});

describe("the picked season answers", () => {
  it("the same as typing it", async () => {
    const picked = await searchAnswer(await withSeason("4215 opr in 2025-26", 2024, NOW), {});
    const typed = await searchAnswer("4215 opr 2024–25", {});
    expect(picked.understood?.season).toBe(2024);
    expect({ ...picked, q: "" }).toEqual({ ...typed, q: "" });
  });
});
