// Everyday English is never corrected into a word only a name has (search audit 2026-11-24, Q1): "minor" is no typo of
// a team called Milnor, "pizza" none of one called PITZZA, unless "team" before it says it names a team there. A real
// typo of a name ("hypnotc") is still corrected, and an everyday word may still be a slip from one of search's own.
import { describe, expect, it } from "vitest";
import { buildVocab, correctWord } from "./spelling";
import { buildNames } from "./query/names";
import { parseQuery, type ParseContext } from "./query/parse";
import { everydayWord } from "../../src/shared/query/everyday";

const TEAMS = [
  { name: "Milnor", city: "Milnor", state: "ND" }, { name: "PITZZA", city: "Town", state: "NY" },
  { name: "Hypnotic Robotics", city: "Oradell", state: "NJ" }, { name: "Cheam Bots", city: "Town", state: "OH" },
];
const v = buildVocab(TEAMS, []);

describe("everyday words in spelling", () => {
  it("never corrects an everyday word to a name's word", () => {
    for (const w of ["minor", "pizza", "cheap"]) expect(correctWord(w, v), w).toBeNull();
  });
  it("still corrects a real typo of a name, and an everyday word said to be a team's", () => {
    expect(correctWord("hypnotc", v)?.word).toBe("hypnotic");
    expect(correctWord("minor", v, false, true)?.word).toBe("milnor");
  });
  it("still corrects an everyday word that is a slip from one of search's own words", () => {
    expect(correctWord("scare", buildVocab([], []))?.word).toBe("score");
  });
  it("knows plain plurals", () => {
    expect([everydayWord("hotels"), everydayWord("Pizzas"), everydayWord("hypnotic")]).toEqual([true, true, false]);
  });
});

describe("everyday words in the parser's near names", () => {
  const names = buildNames(TEAMS.map((t, i) => ({ number: 30001 + i, ...t, country: "USA", lastPlayed: 2026 })), []);
  const ctx: ParseContext = { names, today: "2026-11-24", isEvent: async () => false, nearTeam: async (w) => names.nearTeam(w) };
  it("reads no team in an everyday word typed near a name", async () => {
    for (const q of ["best pizza in new york", "what is a minor penalty"]) expect((await parseQuery(q, ctx)).teams, q).toEqual([]);
  });
  it("reads the team when \"team\" says so, and a real typo of a name", async () => {
    expect((await parseQuery("team pizza record", ctx)).teams.map((t) => t.number)).toEqual([30002]);
    expect((await parseQuery("hypnotc robotics record", ctx)).teams.map((t) => t.number)).toEqual([30003]);
  });
});
