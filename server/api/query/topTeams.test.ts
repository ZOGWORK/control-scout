// A place's top team said where a team would be (./topTeams.ts): the place's first team by prediction rating, as its
// "top teams" board ranks them, read into a two-team question, the card saying which team each phrase was.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "../answers/season";

// The latest completed season: the one search reads when none is said.
const S = CURRENT_SEASON - 1;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, state, country, rating, rated matches
  const teams: [number, string, string | null, string, number, number][] = [
    [4215, "Hypnotic Robotics", "NJ", "USA", 95, 10], [23268, "Ultraviolet", "NJ", "USA", 150, 10],
    // The highest rating in Ohio, on too few matches to be ranked: never its top team.
    [30001, "Buckeye Bots", "OH", "USA", 300, 2], [30002, "Lake Erie Robotics", "OH", "USA", 120, 8],
    [14270, "Quantum Robotics", null, "Romania", 180, 12], [24033, "Alphatronic", null, "Romania", 110, 9],
  ];
  for (const [n, name, state, country, rating, rm] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, ?)", [n, name, state, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank, rating_matches, matches, wins, losses, ties) VALUES (?, ?, ?, 3, 1, ?, ?, 5, 5, 0)", [S, n, rating, rm, rm]);
  }
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
  clearAllCaches();
});

describe("a place's top team, said as one of two teams", () => {
  it("each phrase is that place's top-rated ranked team, either wording, the card saying which", async () => {
    const a = await ask("who would win between the best ohio team and the top team in romania");
    expect(a.stat).toMatchObject({ intent: "predict", teams: [{ number: 30002 }, { number: 14270 }] });
    expect(a.understood?.label).toContain("The top Ohio team by prediction rating");
    expect(a.understood?.label).toContain("is Lake Erie Robotics (30002), and the top Romania team by prediction rating");
    expect(a.understood?.label).toContain("is Quantum Robotics (14270)");
    // One phrase beside a team named.
    expect((await ask("predict the strongest new jersey team vs 24033")).stat).toMatchObject({ intent: "predict", teams: [{ number: 23268 }, { number: 24033 }] });
  });
  it("leaves alone a leaderboard, a place with no ranked team, and words that aren't a place", async () => {
    expect((await ask("top teams in new jersey")).stat?.intent).toBe("top-rating");
    expect((await ask("who would win between the top texas team and 4215")).stat?.intent).not.toBe("predict");
    expect((await ask("who would win between the top robot team and 4215")).understood?.label ?? "").not.toMatch(/top .* team by prediction rating/);
  });
  it("'in a match between' two teams is their match's call", async () => {
    expect((await ask("who would win in a match between 4215 and 14270")).stat?.intent).toBe("predict");
  });
});
