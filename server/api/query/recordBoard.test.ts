// A record asked with no team ("win loss record decode"): the season's best records with a "which team?" row, never
// one team whose name a word of the question happens to fit (launch audit D7).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "../answers/season";

const S = 2025; // DECODE
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, wins, losses: "Decode Dynamics" holds the game's name, the trap a team-less question fell into.
  const teams: [number, string, number, number][] = [[7149, "ENFORCERS", 39, 4], [17713, "Delta Force", 30, 14], [24033, "Alphatronic", 41, 16], [34193, "Decode Dynamics", 3, 9]];
  for (const [n, name, w, l] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank, rating_matches, matches, wins, losses, ties) VALUES (?, ?, 100, 3, 1, ?, ?, ?, ?, 0)", [S, n, w + l, w + l, w, l]);
  }
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
  clearAllCaches();
});

describe("a record asked with no team", () => {
  it("is the season's best-record board with a 'which team?' row, never one team's record", async () => {
    for (const q of ["win loss record decode", "win loss record decode season", "record for decode", "decode win loss record", "wins losses record 2025-26"]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("top-record");
      expect(a.understood?.season, q).toBe(S);
      const board = a.stat!.blocks.find((b) => b.kind === "leaderboard");
      expect(board?.kind === "leaderboard" && board.rows[0].team.label, q).toBe("7149 ENFORCERS");
      expect(a.stat!.blocks[0], q).toEqual({ kind: "related", title: "Which team? Ask for one team's record", queries: ["7149 record 2025-26", "24033 record 2025-26", "17713 record 2025-26"] });
      expect(a.understood?.label, q).not.toContain("Decode Dynamics");
    }
  });
  it("'best' or 'worst' asked is the board alone; a team named is that team's record", async () => {
    const best = await ask("best record in decode");
    expect(best.stat?.intent).toBe("top-record");
    expect(best.stat!.blocks.some((b) => b.kind === "related")).toBe(false);
    const own = await ask("17713 record decode");
    expect(own.understood?.label).toContain("Delta Force (17713)");
    expect(own.stat?.intent).not.toBe("top-record");
  });
});

describe("a count of wins asked with no team", () => {
  it("is the place's board by wins; a win's size is never a count", async () => {
    for (const q of ["most wins in nj 2025-26", "teams with the most wins in nj 2025-26"]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("top-wins");
      const board = a.stat!.blocks.find((b) => b.kind === "leaderboard");
      expect(board?.kind === "leaderboard" && board.rows[0].team.label, q).toBe("24033 Alphatronic");
    }
    expect((await ask("biggest win in nj 2025-26")).stat?.intent).not.toBe("top-wins");
  });
});

describe("a versus with a number no team has", () => {
  it("answers the other team's question and says the number is no team", async () => {
    for (const q of ["7149 vs 99 record 2025-26", "99 vs 7149 record 2025-26"]) {
      const a = await ask(q);
      expect(a.understood?.label, q).toContain("ENFORCERS (7149)");
      expect(a.understood?.label, q).toContain("No FTC team 99 in our data");
      expect(a.stat?.scope, q).toContain("No FTC team 99 in our data");
    }
    // The search box's short answer (no card) says it too, never the comparison's recovery.
    const short = await searchAnswer("7149 vs 99 record 2025-26", { limit: 8 });
    expect(short.step).not.toBe("recovery");
    expect(short.understood?.label).toContain("No FTC team 99 in our data");
  });
});

describe("a possessive after a name ending in punctuation", () => {
  it("is the team, as typed without it, never a word \"s\"", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (11002, 'Die Toaster, Die!', 'Town', 'UT', 'USA')");
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (37179, 's', 'Town', 'OH', 'USA')");
    await run("INSERT INTO team_seasons (season, team) VALUES (?, 11002)", [S]);
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank, rating_matches, matches, wins, losses, ties) VALUES (?, 11002, 50, 3, 9, 6, 6, 1, 5, 0)", [S]);
    await rebuildSearch();
    clearAllCaches();
    const plain = await ask("die toaster die record 2025-26");
    const owned = await ask("what's die toaster, die!'s record 2025-26");
    expect(plain.understood?.label).toContain("(11002)");
    expect(owned.understood?.label).toBe(plain.understood?.label);
    expect(owned.understood?.label).not.toContain("37179");
    // Any punctuation ending the name: "Green.Griffins;'s record".
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (10092, 'Green.Griffins;', 'Town', 'OH', 'USA')");
    await run("INSERT INTO team_seasons (season, team) VALUES (?, 10092)", [S]);
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank, rating_matches, matches, wins, losses, ties) VALUES (?, 10092, 40, 3, 10, 6, 6, 2, 4, 0)", [S]);
    await rebuildSearch();
    clearAllCaches();
    const semi = await ask("Green.Griffins;'s record 2025-26");
    expect(semi.understood?.label).toContain("(10092)");
    expect(semi.understood?.label).not.toContain("37179");
  });
});
