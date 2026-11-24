// Word order never changes an answer (the search audit's C3, 2026-11-24): the executor reads the parse's slots and its
// cues (src/shared/query/lexicon.ts CUES), never the raw text again, so the same words in another order are the same
// question ("in romania best teams" is "best teams in romania").
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "../answers/season";
import { parseContext } from "./context";
import { parseQuery } from "./parse";

const S = CURRENT_SEASON - 1;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });
/** What an answer says, its query aside. */
const said = (a: Awaited<ReturnType<typeof ask>>) => a && { understood: a.understood, intent: a.intent, stat: a.stat, card: a.card };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, city, state, country, OPR
  const teams: [number, string, string, string | null, string, number][] = [
    [14270, "Quantum Robotics", "Cluj-Napoca", null, "Romania", 180], [24033, "Alphatronic", "Bucharest", null, "Romania", 110],
    [19564, "Delta Bots", "Bucharest", null, "Romania", 140],
    [4215, "Hypnotic Robotics", "Oradell", "NJ", "USA", 95], [23268, "Ultraviolet", "Oradell", "NJ", "USA", 150],
  ];
  for (const [n, name, city, state, country, opr] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run("INSERT INTO team_season_stats (season, team, opr_np, rating_np, rating_sd, rating_rank, rating_matches, events, matches, wins, losses, ties) VALUES (?, ?, ?, ?, 3, 1, 10, 2, 10, 5, 5, 0)",
      [S, n, opr, opr]);
  }
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
  clearAllCaches();
});

describe("word order", () => {
  it("reads the place's own preposition, and a filter keeps the board", async () => {
    const ctx = await parseContext();
    // Two places joined: the preposition is the place's own, never the first place's.
    const two = await parseQuery("from romania vs new jersey best teams", ctx);
    expect(two.places?.list.length).toBe(2);
    expect(two.placePrep).toBeUndefined();
    // A filter said beside the place ("never won an award") is the board's, never the place card's unfiltered list.
    const filtered = await ask("best teams in romania that never won an award");
    expect(filtered?.card?.title ?? "").not.toMatch(/^Top teams in Romania/);
    expect(filtered?.stat?.blocks.some((b) => b.kind === "leaderboard"), "the board").toBe(true);
  });

  it("reads the same cues in any order", async () => {
    const ctx = await parseContext();
    // A word typed one letter off twice ("compre"), fixed twice by the parse: each counted.
    const twice = await parseQuery("4215 compre 23268 compre", ctx);
    expect(twice.fixed?.length).toBe(2);
    expect(twice.cues.compare).toBe(2);
    const a = await parseQuery("the best team in oradell sorted by opr", ctx), b = await parseQuery("sorted by opr in oradell the best team", ctx);
    expect(a.cues).toEqual(b.cues);
    expect(a.cues).toMatchObject({ team: 1, goodBad: 1, sorted: 1 });
  });

  it.each([
    ["best teams in romania", ["in romania best teams", "teams in romania best"]],
    ["best team in oradell", ["in oradell best team"]],
    ["worst teams in romania", ["in romania worst teams"]],
    ["best teams in romania this season", ["this season in romania best teams"]],
  ])("answers %s however it's ordered", async (q, others) => {
    const want = said(await ask(q));
    expect(want?.stat ?? want?.card, q).toBeTruthy();
    for (const o of others) expect(said(await ask(o)), o).toEqual(want);
  });
});

describe("the executor's words", () => {
  // Its answers read the parse (slots, symbols, cues). A regex on the query as typed reads it in one word order, and
  // misses the words the parse fixed: a cue (src/shared/query/lexicon.ts CUES) is the way to read how it was said.
  it("never re-reads the raw text with a regex", () => {
    const src = readFileSync(new URL("./execute.ts", import.meta.url), "utf8").replace(/^\s*(?:\/\/|\/?\*).*$/gm, "");
    const raw = [/\.test\(\s*(?:p\.q|said)\s*\)/, /\bnormalise\(\s*p\.q\s*\)/, /\bp\.q\.(?:match|matchAll|endsWith|startsWith|includes|search)\(/, /\bsaid\.(?:endsWith|startsWith)\(/];
    for (const re of raw) expect(src, String(re)).not.toMatch(re);
  });
});
