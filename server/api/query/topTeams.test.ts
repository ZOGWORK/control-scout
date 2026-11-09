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
    // A country whose name has "and" in it.
    [31001, "Island Engineers", null, "Trinidad and Tobago", 130, 9], [31002, "Port of Spain Robotics", null, "Trinidad and Tobago", 90, 9],
    [31003, "Wadadli Bots", null, "Antigua and Barbuda", 100, 9], [31004, "Sarajevo Circuits", null, "Bosnia and Herzegovina", 105, 9],
    // Regions whose codes are also words ("or", "in").
    [32001, "Cascade Coders", "OR", "USA", 125, 9], [32002, "Hoosier Hammers", "IN", "USA", 115, 9],
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
    // Both "team in" phrases, or that one first: one phrase never runs into the next.
    for (const q of ["who would win between the best team in ohio and the top team in romania", "predict the top team in ohio vs the top romania team"]) {
      expect((await ask(q)).stat, q).toMatchObject({ intent: "predict", teams: [{ number: 30002 }, { number: 14270 }] });
    }
    // One phrase beside a team named.
    expect((await ask("predict the strongest new jersey team vs 24033")).stat).toMatchObject({ intent: "predict", teams: [{ number: 23268 }, { number: 24033 }] });
  });
  it("a place whose own name holds 'and' is read whole, in any position, while 'and' after a place still joins", async () => {
    for (const q of [
      "predict the best team from trinidad and tobago against the top team in romania",
      "who would win between the top team in romania and the strongest team in trinidad and tobago",
      "predict the top trinidad and tobago team vs 14270",
    ]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("predict");
      expect((a.stat?.teams ?? []).map((t: { number: number }) => t.number).sort(), q).toEqual([14270, 31001]);
      expect(a.understood?.label, q).toMatch(/[Tt]he top Trinidad and Tobago team by prediction rating in .+ is Island Engineers \(31001\)/);
    }
    // Other countries named with "and", in both "team in" phrases at once.
    const ab = await ask("who would win between the best team in antigua and barbuda and the top team from bosnia and herzegovina");
    expect(ab.stat?.intent).toBe("predict");
    expect((ab.stat?.teams ?? []).map((t: { number: number }) => t.number).sort()).toEqual([31003, 31004]);
    // "And" after a place still joins two teams.
    expect((await ask("who would win between the top team in ohio and 14270")).stat).toMatchObject({ intent: "predict", teams: [{ number: 30002 }, { number: 14270 }] });
    expect((await ask("predict the best team in romania and the top team in ohio")).stat?.teams?.map((t: { number: number }) => t.number).sort()).toEqual([14270, 30002]);
  });
  it("a region code that is also a word counts when typed in capitals, in either wording", async () => {
    const a = await ask("who would win between the top team in OR and the strongest IN team");
    expect(a.stat?.intent).toBe("predict");
    expect((a.stat?.teams ?? []).map((t: { number: number }) => t.number).sort()).toEqual([32001, 32002]);
    expect(a.understood?.label).toMatch(/[Tt]he top Oregon team by prediction rating in .+ is Cascade Coders \(32001\)/);
  });
  it("leaves alone a leaderboard, a place with no ranked team, and words that aren't a place", async () => {
    expect((await ask("top teams in new jersey")).stat?.intent).toBe("top-rating");
    expect((await ask("who would win between the top texas team and 4215")).stat?.intent).not.toBe("predict");
    expect((await ask("who would win between the top robot team and 4215")).understood?.label ?? "").not.toMatch(/top .* team by prediction rating/);
  });
  it("a season named picks each place's leader in it; part of a region is read as all of it, said so", async () => {
    // 2024-25: Ohio's leader was Buckeye Bots, ranked then.
    await run("INSERT INTO team_seasons (season, team) VALUES (?, 30001), (?, 14270)", [S - 1, S - 1]);
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank, rating_matches, matches, wins, losses, ties) VALUES (?, 30001, 200, 3, 1, 10, 10, 5, 5, 0), (?, 14270, 150, 3, 2, 10, 10, 5, 5, 0)", [S - 1, S - 1]);
    clearAllCaches();
    const a = await ask(`predict the top ohio team vs 14270 in ${S - 1}-${String(S % 100).padStart(2, "0")}`);
    expect(a.stat).toMatchObject({ intent: "predict", teams: [{ number: 30001 }, { number: 14270 }] });
    expect(a.understood?.label).toContain(`The top Ohio team by prediction rating in ${S - 1}–${String(S % 100).padStart(2, "0")} is Buckeye Bots (30001)`);
    expect((await ask("predict the top north jersey team vs 14270")).understood?.label).toContain("(North Jersey isn't a separate region: all of New Jersey)");
  });
  it("'in a match between' two teams is their match's call", async () => {
    expect((await ask("who would win in a match between 4215 and 14270")).stat?.intent).toBe("predict");
  });
});

describe("the best team with no place said (failed-search #1225)", () => {
  it("its highlights are the top-rated ranked team's of the season the highlights show, the card saying which", async () => {
    // Last season: one played match for its top ranked team (Ohio's 300 is on too few matches to be ranked).
    await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'ROQ1', 'Romania Qualifier', 'Qualifier', '2025-11-01', '2025-11-01', 'first')", [S]);
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'ROQ1', 'qual', 0, 1, 'Q1', '2025-11-01T10:00:00', 1, 120, 120, 80, 80, 'first')", [S]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'ROQ1', 'qual', 0, 1, 14270, 'red', 1), (?, 'ROQ1', 'qual', 0, 1, 24033, 'blue', 1)", [S, S]);
    // This season another team leads, with a played match of its own.
    const C = S + 1;
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank, rating_matches, matches, wins, losses, ties) VALUES (?, 23268, 170, 3, 1, 10, 10, 5, 5, 0), (?, 14270, 120, 3, 2, 10, 10, 5, 5, 0)", [C, C]);
    for (const n of [23268, 14270]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [C, n]);
    await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'NJQ1', 'Bergen Qualifier', 'Qualifier', ?, ?, 'first')", [C, `${C}-10-15`, `${C}-10-15`]);
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'NJQ1', 'qual', 0, 1, 'Q1', ?, 1, 150, 150, 90, 90, 'first')", [C, `${C}-10-15T10:00:00`]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'NJQ1', 'qual', 0, 1, 23268, 'red', 1), (?, 'NJQ1', 'qual', 0, 1, 4215, 'blue', 1)", [C, C]);
    clearAllCaches();
    // "Now" is this season's highlights: this season's leader, never last season's.
    const now = await ask("best team highlights now");
    expect(now.stat).toMatchObject({ intent: "team-highlights", team: { number: 23268 } });
    expect(now.understood?.label).toContain("The top team worldwide by prediction rating");
    expect(now.understood?.label).toContain("is Ultraviolet (23268)");
    // Last season said: last season's leader.
    expect((await ask("best team highlights last season")).stat).toMatchObject({ intent: "team-highlights", team: { number: 14270 } });
    // Dates said: the leader of their season.
    expect((await ask(`best team highlights in November ${S}`)).stat).toMatchObject({ intent: "team-highlights", team: { number: 14270 } });
    // A board asked of the best team stays the board.
    expect((await ask("best team")).stat?.intent).toBe("top-rating");
  });
});
