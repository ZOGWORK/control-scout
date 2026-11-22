// Logged failed search #2178 ("best team in th world en"): "th" is the short form of "the", and a two-letter word the
// parser leaves unread at the end of a question it reads whole without it is a stray, left out and said as not read.
// The answer is the world's board, the one "best team in the world" gives. Fixture teams only.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { informalQuery } from "./lexicon";
import { refreshSearchSeason, resetSearchSeason } from "../answers/season";

const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string, string, string, number][] = [
    [32178, "Far Knights", "Shanghai", "", "China", 90], [32179, "Garden Bots", "Newark", "NJ", "USA", 70], [32180, "Lake Bots", "Detroit", "MI", "USA", 60],
  ];
  for (const [n, name, city, state, country, opr] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state || null, country]);
    for (const s of [CURRENT_SEASON, CURRENT_SEASON - 1]) {
      await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
      await run("INSERT INTO team_season_stats (season, team, opr_np, rating_np, rating_sd, rating_rank, rating_matches, matches, wins, losses, ties) VALUES (?, ?, ?, ?, 3, 1, 6, 6, 6, 0, 0)", [s, n, opr, opr]);
    }
  }
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
  clearAllCaches();
});

describe("a short \"the\" and a stray word at the end (#2178)", () => {
  it("the logged query is the world's board, the one \"best team in the world\" gives", async () => {
    const clean = await ask("best team in the world");
    expect(clean.stat?.family).toBe("leaderboard");
    expect(clean.stat?.scope).toContain("Worldwide");
    const a = await ask("best team in th world en");
    expect(a.step).toBe("deterministic");
    expect(a.stat).toEqual(clean.stat);
    expect(a.understood?.label).toBe(clean.understood?.label);
    expect(a.understood?.unread).toEqual(["en"]);
  });
  it("\"th\" after a number is its ordinal, never \"the\"", () => {
    expect(informalQuery("5 th place", () => false)).toBe("5 th place");
    expect(informalQuery("in th world", () => false)).toBe("in the world");
  });
});
