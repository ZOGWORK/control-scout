// A place's top team early in a new season (./topTeams.ts): the search season has rated teams elsewhere, but none yet in
// the places asked about, so each place's leader is the season before's, both from one season, and the card says which.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { seasonLabel } from "../../../src/shared/format";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { defaultSeason, refreshSearchSeason, resetSearchSeason } from "../answers/season";

const NOW = CURRENT_SEASON, BEFORE = CURRENT_SEASON - 1;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // season, number, name, state, country, rating, rated matches
  const rows: [number, number, string, string | null, string, number, number][] = [
    [BEFORE, 23268, "Ultraviolet", "NJ", "USA", 150, 10], [BEFORE, 4215, "Hypnotic Robotics", "NJ", "USA", 95, 10],
    [BEFORE, 14270, "Quantum Robotics", null, "Romania", 180, 12], [BEFORE, 24033, "Alphatronic", null, "Romania", 110, 9],
    // The new season: rated teams, none of them in New Jersey or Romania yet.
    [NOW, 30002, "Lake Erie Robotics", "OH", "USA", 120, 6], [NOW, 30003, "Buckeye Bots", "OH", "USA", 100, 6],
  ];
  const seen = new Set<number>();
  for (const [s, n, name, state, country, rating, rm] of rows) {
    if (!seen.has(n)) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, ?)", [n, name, state, country]);
    seen.add(n);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank, rating_matches, matches, wins, losses, ties) VALUES (?, ?, ?, 3, 1, ?, ?, 5, 5, 0)", [s, n, rating, rm, rm]);
  }
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
  clearAllCaches();
});

describe("a place's top team in a new season with none rated there yet", () => {
  it("reads every place's leader from the season before, and says that season", async () => {
    expect(defaultSeason()).toBe(NOW);
    const a = await ask("who would win in a match between the top NJ team and top Romania team");
    expect(a.stat).toMatchObject({ intent: "predict", teams: [{ number: 23268 }, { number: 14270 }] });
    expect(a.understood?.label).toContain(`The top New Jersey team by prediction rating in ${seasonLabel(BEFORE)} is Ultraviolet (23268)`);
    expect(a.understood?.label).toContain(`the top Romania team by prediction rating in ${seasonLabel(BEFORE)} is Quantum Robotics (14270)`);
  });
  it("a place with a rated team in the new season still reads the new season", async () => {
    const a = await ask("who would win between the top ohio team and 4215");
    expect(a.understood?.label).toContain(`The top Ohio team by prediction rating in ${seasonLabel(NOW)} is Lake Erie Robotics (30002)`);
  });
});
