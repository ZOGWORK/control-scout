// The parser reads slots in any word order with filler ignored (docs/search-pipeline.md). Fixture names only, no
// database: the same parse for every team, every place, every phrasing of one intent.
import { describe, expect, it } from "vitest";
import { buildNames } from "./names";
import { parseQuery, type ParseContext } from "./parse";
import { readTime, seasonOfDate } from "./time";

const TEAMS = [
  { number: 4215, name: "Hypnotic Robotics", city: "Oradell", state: "NJ", country: "USA", lastPlayed: 2026 },
  { number: 6980, name: "Bad Wolf", city: "Fair Lawn", state: "NJ", country: "USA", lastPlayed: 2026 },
  { number: 24033, name: "Alphatronic", city: "Cluj-Napoca", state: "CJ", country: "Romania", lastPlayed: 2026 },
  { number: 19108, name: "Alphatronic", city: "Cluj-Napoca", state: "CJ", country: "Romania", lastPlayed: 2025 },
  { number: 20245, name: "Ultraviolet", city: "Detroit", state: "MI", country: "USA", lastPlayed: 2026 },
  { number: 23268, name: "Ultraviolet", city: "Hackettstown", state: "NJ", country: "USA", lastPlayed: 2026 },
  { number: 19731, name: "Robotics", city: "Somewhere", state: "TX", country: "USA", lastPlayed: 2024 },
  { number: 2024, name: "Year Team", city: "Town", state: "OH", country: "USA", lastPlayed: 2025 },
  { number: 30001, name: "Santo Domingo Incredible First Team (Team Spark)", city: "Santo Domingo", state: null, country: "Dominican Republic", lastPlayed: 2026 },
  { number: 30003, name: "The Copper Lanterns", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 30004, name: "Deltav", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 30005, name: "Delta", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
];
const EVENTS = ["east bergen conference", "new jersey championship", "nj championship", "turnpike division"];
const ctx: ParseContext = {
  names: buildNames(TEAMS, [{ city: "Bucharest", state: "B", country: "Romania" }]),
  today: "2026-11-04",
  isEvent: async (w) => EVENTS.some((e) => e.includes(w) && w.length >= 3 && w.split(" ").length >= 2),
};
const parse = (q: string) => parseQuery(q, ctx);

describe("slots", () => {
  it("a name typed nearly right is that team, a leading 'the' included; never a guess between two", async () => {
    const near = { ...ctx, nearTeam: async (w: string) => ctx.names.nearTeam(w) };
    expect(await parseQuery("hypnotc robotics record", near)).toMatchObject({ teams: [{ number: 4215, via: "near" }], complete: true });
    expect(await parseQuery("the coper lanterns record", near)).toMatchObject({ teams: [{ number: 30003, via: "near", typed: "the coper lanterns" }], complete: true });
    // "deltv" is one letter from Deltav and from Delta: no team.
    expect((await parseQuery("deltv record", near)).teams).toEqual([]);
    // Two letters off a five-letter name is past the limit, even with no other name as close.
    expect(ctx.names.nearTeam("dexxa")).toBeNull();
  });
  it("reads a long name whole, punctuation and all, in any order", async () => {
    for (const q of ["greatest scoring for Santo Domingo Incredible First Team (Team Spark) 30001", "santo domingo incredible first team team spark record"]) {
      expect(await parse(q), q).toMatchObject({ teams: [{ number: 30001 }], place: null, complete: true });
    }
  });
  it("reads the brief's walkthrough: one match, place and time, no team", async () => {
    const p = await parse("highest-scoring match in California this week");
    expect(p).toMatchObject({ intent: "top-matches", complete: true, teams: [], place: { kind: "region", state: "CA" }, time: { kind: "window", from: "2026-11-02", to: "2026-11-08", season: 2026 } });
  });
  it("reads a forecast at a named event", async () => {
    const p = await parse("predicted chances of 4215 east bergen conference");
    expect(p).toMatchObject({ intent: "team-predict", complete: true, teams: [{ number: 4215 }], event: { words: "east bergen conference" }, time: null });
  });
  it("reads shared matches for two teams", async () => {
    for (const q of ["4215 and 6980 matches together", "matches 4215 6980 shared", "shared matches of 6980 with 4215", "4215 6980 in common matches please"]) {
      const p = await parse(q);
      expect(p, q).toMatchObject({ intent: "shared-matches", complete: true });
      expect(p.teams.map((t) => t.number).sort((a, b) => a - b), q).toEqual([4215, 6980]);
    }
  });
  it("keeps a team's own place out of a team named after a word", async () => {
    const p = await parse("hypnotc robotics opr");
    expect(p.teams).toEqual([]);
    expect(p.complete).toBe(false);
  });
  it("picks one of the teams sharing a name by the place named, else the newest played", async () => {
    expect((await parse("ultraviolet record in new jersey")).teams[0]).toMatchObject({ number: 23268, rule: "the one in New Jersey" });
    expect((await parse("alphatronic record")).teams[0]).toMatchObject({ number: 24033, rule: "the one that played most recently" });
    // Two still tied: never guessed; the other team named breaks it by region.
    expect((await parse("ultraviolet opr")).complete).toBe(false);
    expect((await parse("ultraviolet vs hypnotic robotics")).teams.map((t) => t.number)).toEqual([23268, 4215]);
  });
  it("reads a bare year as a season beside a team, and as a team alone", async () => {
    expect((await parse("4215 record 2027")).time).toMatchObject({ kind: "season", season: 2027, year: 2027 });
    expect((await parse("2024 record")).teams.map((t) => t.number)).toEqual([2024]);
    expect((await parse("team 2024 record in 2025")).time?.season).toBe(2025);
  });
  it("reads states and places generically", async () => {
    expect(await parse("24033 states")).toMatchObject({ intent: "results", states: true, complete: true });
    expect(await parse("4215 rank at nj states")).toMatchObject({ intent: "event-rank", states: true, place: { state: "NJ" } });
    expect((await parse("alphatronic wins from bucharest")).place).toMatchObject({ kind: "city", country: "Romania" });
  });
  it("reads a region code, a country and a place before their words are read as anything else", async () => {
    expect((await parse("4215 record in ME")).place).toMatchObject({ kind: "region", state: "ME" });
    expect((await parse("4215 record in IN")).place).toMatchObject({ kind: "region", state: "IN" });
    expect((await parse("4215 record in united states")).place).toMatchObject({ kind: "country", country: "USA" });
    expect(await parse("4215 record in united states")).toMatchObject({ states: false, complete: true });
    // "or" in lower case is a word, never Oregon.
    expect((await parse("4215 or 6980 opr")).place).toBeNull();
  });
  it("never drops a second event: the parse is left incomplete", async () => {
    expect((await parse("4215 record at nj championship at turnpike division")).complete).toBe(false);
  });
  it("a limit or a match number never makes a team's number a year", async () => {
    expect(await parse("2024 last 5 matches")).toMatchObject({ teams: [{ number: 2024 }], n: 5, time: null, intent: "last-matches" });
  });
  it("reads a limit, a match number and a match type", async () => {
    expect(await parse("4215 last 5 matches")).toMatchObject({ intent: "last-matches", n: 5 });
    expect(await parse("top 5 teams by opr in nj")).toMatchObject({ intent: "leaderboard", n: 5, place: { state: "NJ" } });
    expect(await parse("4215 playoff record")).toMatchObject({ intent: "record", level: "playoff" });
  });
});

describe("one intent, any phrasing", () => {
  // Every phrasing of one question, for every team: the same intent and the same slots.
  const PHRASES: [string, string[]][] = [
    ["highest-score", ["{t} highest score", "highest score {t}", "what is the best score for {t}", "{t} top score please", "score highest {t}", "show me {t} max points", "{t}'s biggest score rn"]],
    ["record", ["{t} record", "record of {t}", "{t} win loss record", "what is {t}'s w-l-t", "tell me the record for {t} pls"]],
    ["average-score", ["{t} average score", "average points {t}", "what does {t} score on average", "mean score of {t}"]],
    ["awards", ["{t} awards", "awards {t}", "what awards has {t} won", "show me {t} trophies"]],
    ["team-opr", ["{t} opr", "opr {t}", "what is the opr of {t}", "{t} offensive power rating rn"]],
  ];
  for (const [intent, forms] of PHRASES) for (const t of ["4215", "6980", "24033", "bad wolf", "hypnotic robotics"]) {
    it(`${intent} for ${t}`, async () => {
      const parses = await Promise.all(forms.map((f) => parse(f.replace("{t}", t))));
      for (const [i, p] of parses.entries()) expect({ q: forms[i], intent: p.intent, complete: p.complete, teams: p.teams.map((x) => x.number) }).toEqual({ q: forms[i], intent, complete: true, teams: [parses[0].teams[0].number] });
    });
  }
  it("is the same in any word order and with filler between", async () => {
    // A seeded shuffle: the order the words come in never changes the slots.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const base = ["4215", "highest", "score", "in", "playoffs", "2024-25"];
    const want = await parse(base.join(" "));
    for (let k = 0; k < 25; k++) {
      const ws = [...base].sort(() => rnd() - 0.5);
      // "in playoffs" and the season keep their own words together; filler goes anywhere.
      const q = ws.join(" ").replace(/\bin\b/, "").concat(rnd() > 0.5 ? " please" : " rn");
      const p = await parse(q);
      expect({ q, intent: p.intent, level: p.level, season: p.time?.season, teams: p.teams.map((t) => t.number) }).toEqual({ q, intent: want.intent, level: "playoff", season: 2024, teams: [4215] });
    }
  });
});

describe("time", () => {
  it("resolves every phrase against today", () => {
    const t = (q: string) => readTime(q, "2026-11-04").time;
    expect(t("this week")).toMatchObject({ from: "2026-11-02", to: "2026-11-08", season: 2026 });
    expect(t("last week")).toMatchObject({ from: "2026-10-26", to: "2026-11-01" });
    expect(t("this weekend")).toMatchObject({ from: "2026-11-07", to: "2026-11-08" });
    expect(t("last month")).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(t("on mar 15, 2026")).toMatchObject({ from: "2026-03-15", to: "2026-03-15", season: 2025 });
    expect(t("in march")).toMatchObject({ from: "2027-03-01", to: "2027-03-31", season: 2026 });
    expect(t("march 2026")).toMatchObject({ from: "2026-03-01", season: 2025 });
    expect(t("in may")).toMatchObject({ from: "2027-05-01", to: "2027-05-31", season: 2026 });
    expect(t("may 2026")).toMatchObject({ from: "2026-05-01", to: "2026-05-31", season: 2025 });
    expect(t("may")).toBeNull();
    expect(t("2024-25")).toMatchObject({ kind: "season", season: 2024 });
    expect(t("into the deep")).toMatchObject({ kind: "season", season: 2024 });
    expect(t("2025")).toMatchObject({ kind: "season", season: 2025, year: 2025 });
    expect(t("last season")).toMatchObject({ kind: "season", relative: "last" });
    expect(t("of all time")).toMatchObject({ kind: "ever" });
  });
  it("names the season a date is in", () => {
    expect(seasonOfDate("2026-09-01")).toBe(2026);
    expect(seasonOfDate("2026-08-31")).toBe(2025);
  });
});
