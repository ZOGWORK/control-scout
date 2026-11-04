// Search's spelling correction (./spelling.ts): real misspellings of team names, stat words, event words and places,
// on a small fixture database, and the words it must never touch.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { buildVocab, correctQuery, correctWord, strength } from "./spelling";
import type { SearchAnswer } from "../../src/shared/api";

const S = CURRENT_SEASON;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string][] = [
    [4215, "Hypnotic Robotics", "Oradell"], [6980, "Bad Wolf", "Oradell"], [7149, "ENFORCERS", "Egg Harbor Township"],
    [19719, "RE-ENFORCERS", "Newark"], [14795, "Bionic Enforcers", "Newark"], [15715, "Crusader Robotics", "Oradell"],
    [16000, "Volt Bots", "Oradell"], [16001, "Bolt Bots", "Oradell"], [16002, "Gear Heads", "Paramus"],
    // A one-off spelling of a city in the data: a typo of Oradell, corrected like one.
    [16003, "Iron Owls", "Oradel"],
  ];
  for (const [n, name, city] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, 'NJ', 'USA')", [n, name, city]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  const events: [string, string, string][] = [
    ["USNJCMP", "New Jersey Championship", "Championship"], ["USNJBQ", "Bergen Qualifier", "Qualifier"],
    ["USNJMQ", "Morris Qualifier", "Qualifier"], ["USNJPQ", "Passaic Qualifier", "Qualifier"],
    ["USNJEQ", "Essex Qualifier", "Qualifier"], ["USNJHQ", "Hudson Qualifier", "Qualifier"],
    // The data's own typo ("Qualifer") in one event's name.
    ["USNJSQ", "Sunday Qualifer", "Qualifier"],
  ];
  for (const [code, name, type] of events) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, source) VALUES (?, ?, ?, ?, 'Oradell', 'NJ', 'USA', '2025-12-01', 'test')", [S, code, name, type]);
  }
  for (const [n] of teams) await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'USNJBQ', ?, 50, 5)", [S, n]);
  await rebuildSearch();
});

describe("correctQuery", () => {
  it("corrects misspelled team names, stat words, event words and places", async () => {
    const cases: [string, string][] = [
      ["hypnotc robotics", "hypnotic robotics"], ["hipnotic robotics", "hypnotic robotics"], ["bad wolff", "bad wolf"],
      ["enforcrs", "enforcers"], ["4215 oper", "4215 opr"], ["4215 recrod", "4215 record"], ["4215 awrds", "4215 awards"],
      ["new jersey champinship", "new jersey championship"], ["bergen qualifer", "bergen qualifier"], ["new jersy", "new jersey"],
      ["oradel", "oradell"], ["4215 wrolds", "4215 worlds"], ["4215 playofs", "4215 playoffs"], ["4215 inspyre", "4215 inspire"],
    ];
    for (const [typed, fixed] of cases) expect((await correctQuery(typed))?.q, typed).toBe(fixed);
  });
  it("keeps the case each word was typed in", async () => {
    expect((await correctQuery("Hypnotc Robotics"))?.q).toBe("Hypnotic Robotics");
  });
  it("says when every fix is one of search's own words", async () => {
    expect(await correctQuery("4215 recrod")).toMatchObject({ q: "4215 record", own: true });
    expect(await correctQuery("bad wolff")).toMatchObject({ q: "bad wolf", own: false });
  });
  it("never corrects numbers, codes, short words, capitals, a word typed on the way to a name, or what is spelled right", async () => {
    for (const q of ["4215", "12345 6980", "USNJCMP", "USNJCPM", "q12", "opr", "hypnotic robotics", "bad wolf", "enforcers",
      "4215 record", "4215 awards", "new jersey championship", "oradell", "hypno", "4215 winning alliance", "4215 placed first",
      "4215 opponents at worlds", "events at bergen qualifier", "4215 trend over seasons", "4215 win streak", "decode"]) {
      expect(await correctQuery(q), q).toBeNull();
    }
  });
  it("a fix to search's own word that a name's word fits as well is never offered as sure (\"molt\": most, Volt, Bolt)", async () => {
    expect(await correctQuery("molt bots")).toMatchObject({ q: "most bots", own: false });
    expect(await correctQuery("volf bots")).toBeNull();
  });
});

describe("correctWord", () => {
  const v = buildVocab(
    [{ name: "Gear Heads", city: "Oradell", state: "NJ" }, { name: "Bear Bots", city: "Oradell", state: "NJ" }, { name: "Gears of War", city: "Oradell", state: "NJ" }],
    [{ code: "USNJQ1", name: "Bergen Qualifier", city: "Oradell", state: "NJ" }],
  );
  it("never turns one word into its plural or singular", () => {
    expect(correctWord("gears", v)).toBeNull();
  });
  it("prefers a doubled letter or a swap over another one-letter change", () => {
    expect(correctWord("gaer", v)?.word).toBe("gear");
  });
  it("prefers search's own word to a name's (\"oper\" is OPR)", () => {
    expect(correctWord("oper", v)).toEqual({ word: "opr", own: true });
  });
});

describe("searchAnswer with spelling", () => {
  it("a misspelled team name reaches that team, labelled as a correction", async () => {
    for (const [q, team, fix] of [["hypnotc robotics", "4215", "hypnotic robotics"], ["bad wolff", "6980", "bad wolf"], ["enforcrs", "7149", "enforcers"]]) {
      const a = await searchAnswer(q, { learn: false });
      expect(a.step, q).toBe("did-you-mean");
      expect(a.didYouMean?.toLowerCase(), q).toBe(fix);
      // The team itself (Enforcers shares its name with others, all listed: the next test).
      expect(a.hits.filter((h) => h.kind === "team").map((h) => h.ref), q).toContain(team);
      if (q !== "enforcrs") expect(a.hits[0], q).toMatchObject({ kind: "team", ref: team });
      expect(a.q, q).toBe(q);
    }
  });
  it("the shared name is all of them: enforcers lists every Enforcers team", async () => {
    const a = await searchAnswer("enforcrs", { learn: false });
    expect(a.hits.filter((h) => h.kind === "team").map((h) => h.ref)).toEqual(expect.arrayContaining(["7149", "19719", "14795"]));
  });
  it("two names equally close are both shown, never one guessed", async () => {
    const a = await searchAnswer("molt bots", { learn: false });
    expect(a.hits.map((h) => h.ref)).toEqual(expect.arrayContaining(["16000", "16001"]));
    expect(a.didYouMean).toBeUndefined();
  });
  it("a misspelled stat word answers the corrected question", async () => {
    for (const [q, fix] of [["4215 recrod", "4215 record"], ["4215 awrds", "4215 awards"], ["hypnotic oper", "hypnotic opr"]]) {
      const a = await searchAnswer(q, { learn: false, limit: 25 });
      const right = await searchAnswer(fix, { learn: false, limit: 25 });
      expect(a, q).toMatchObject({ step: "did-you-mean", didYouMean: fix, q });
      expect(a.understood, q).toEqual(right.understood);
      expect(a.hits.map((h) => h.ref), q).toEqual(right.hits.map((h) => h.ref));
      expect(!!a.stat || !!a.card, q).toBe(!!right.stat || !!right.card);
    }
  });
  it("a team whose page had the rest is improved on by the corrected question (\"4215 oper\")", async () => {
    const a = await searchAnswer("4215 oper", { learn: false, limit: 25 });
    expect(a).toMatchObject({ step: "did-you-mean", didYouMean: "4215 opr" });
    expect(a.understood).toEqual((await searchAnswer("4215 opr", { learn: false, limit: 25 })).understood);
  });
  it("a one-off spelling of a place in the data reaches the usual one (\"oradel\": Oradell)", async () => {
    const a = await searchAnswer("oradel", { learn: false, limit: 25 });
    expect(a).toMatchObject({ step: "did-you-mean", didYouMean: "oradell" });
    expect(a.hits.filter((h) => /Oradell/.test(h.subtitle)).length).toBeGreaterThan(1);
  });
  it("misspelled event words and places find the events", async () => {
    const champ = await searchAnswer("new jersey champinship", { learn: false });
    expect(champ.step).toBe("did-you-mean");
    expect(champ.didYouMean?.toLowerCase()).toBe("new jersey championship");
    expect(champ.hits.find((h) => h.kind === "event")).toMatchObject({ ref: `${S}:USNJCMP` });
    const qual = await searchAnswer("bergen qualifer", { learn: false });
    expect(qual.didYouMean?.toLowerCase()).toBe("bergen qualifier");
    expect(qual.hits.find((h) => h.kind === "event")).toMatchObject({ ref: `${S}:USNJBQ` });
    const place = await searchAnswer("new jersy", { learn: false });
    expect(place.didYouMean).toBe("new jersey");
    expect(place.hits.some((h) => h.kind === "event")).toBe(true);
  });
  it("a query spelled right is answered as typed, with nothing offered", async () => {
    for (const q of ["hypnotic robotics", "bad wolf", "4215 record", "new jersey championship", "4215", "USNJCMP"]) {
      expect((await searchAnswer(q, { learn: false })).didYouMean, q).toBeUndefined();
    }
  });
  it("strength: a direct answer, then results, near matches, a correction, nothing", () => {
    const a = (x: Partial<SearchAnswer>): SearchAnswer => ({ q: "", hits: [], pages: [], step: "deterministic", weak: false, ...x });
    const hit = { kind: "team" as const, ref: "1", title: "1 | A", subtitle: "", season: S };
    expect([a({ card: { kind: "info", title: "", lines: [] } }), a({ hits: [hit] }), a({ hits: [{ ...hit, match: "fuzzy" }] }), a({ step: "did-you-mean", hits: [hit] }), a({ step: "recovery" })].map(strength)).toEqual([4, 3, 2, 1, 0]);
  });
  it("a quoted phrase asks for exactly those words", async () => {
    expect((await searchAnswer('"hypnotc robotics"', { learn: false })).didYouMean).not.toBe("hypnotic robotics");
  });
});
