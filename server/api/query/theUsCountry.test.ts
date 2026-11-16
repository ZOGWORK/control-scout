// Logged failed search #1587 ("best team in the us rn"): "us" said with "the" before it names the United States, so the
// answer is the country's board, the same one "best team in usa rn" gives, never the world's. Fixture teams only.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "../answers/season";

const ask = (q: string) => searchAnswer(q, { limit: 25, full: true });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // The strongest team is outside the US: a world board leads with it, the US board never shows it.
  const teams: [number, string, string, string, string, number][] = [
    [31587, "Far Knights", "Shanghai", "", "China", 90], [31588, "Garden Bots", "Newark", "NJ", "USA", 70], [31589, "Lake Bots", "Detroit", "MI", "USA", 60],
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

describe("\"the us\" names the United States (#1587)", () => {
  it("the logged query is the US board, the one \"best team in usa rn\" gives, with its link", async () => {
    const us = await ask("best team in the us rn");
    const usa = await ask("best team in usa rn");
    expect(usa.card?.title).toMatch(/^Top teams in USA/);
    expect(us.card).toEqual(usa.card);
    expect(us.pages).toEqual(usa.pages);
    expect(us.pages[0]?.href).toMatch(/[?&]region=USA$/);
    const shown = us.card?.kind === "leaderboard" ? us.card.lines.map((l) => l.text) : [];
    expect(shown[0]).toMatch(/^31588 /);
    expect(shown.some((t) => t.startsWith("31587 "))).toBe(false);
  });
  it("\"us\" as a pronoun is still a pronoun: the world's board, no place", async () => {
    for (const q of ["tell us the best team", "best team for us"]) {
      const a = await ask(q);
      expect(a.understood?.place, q).toBeUndefined();
      expect(JSON.stringify(a.stat?.scope ?? a.card?.title ?? ""), q).not.toMatch(/United States|USA/);
    }
  });
});
