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
  { number: 30006, name: "Blue Lanternfish", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 30007, name: "Lanternfih", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 30008, name: "s", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 30009, name: "Mitspe Yam/מצפה ים", city: "Town", state: null, country: "Israel", lastPlayed: 2026 },
  { number: 30010, name: "Powerplay Pioneers", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 30011, name: "March Madness", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 30012, name: "The King's School", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 30013, name: "The King's School", city: "Newark", state: "NJ", country: "USA", lastPlayed: 2026 },
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
    // A colour the lexicon read as an alliance can start the name: the whole name is nearer than its last word alone.
    expect(await parseQuery("blue lanternfsh record", near)).toMatchObject({ teams: [{ number: 30006, via: "near" }], alliance: null, complete: true });
    // An alliance said apart from the name stays: the one said outside the name.
    expect(await parseQuery("on red blue lanternfsh record", near)).toMatchObject({ teams: [{ number: 30006 }], alliance: "red" });
    expect(await parseQuery("red alliance blue lanternfsh record", near)).toMatchObject({ teams: [{ number: 30006 }], alliance: "red" });
  });
  it("drops a possessive after any letter, so a name in another script never leaves a stray 's'", async () => {
    expect(await parse("what is 30009 Mitspe Yam/מצפה ים's lowest score")).toMatchObject({ teams: [{ number: 30009 }], intent: "lowest-score" });
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
  it("reads two alliances of two either side of a vs, any wording, as a match's call", async () => {
    for (const q of [
      "predict 4215 6980 vs 24033 23268", "4215 and 6980 vs 24033 and 23268 who wins", "custom matchup 4215 6980 vs 24033 23268",
      "predict a match with 4215 6980 vs 24033 23268", "4215 6980 versus 24033 23268 predicted score in 2025-26",
    ]) {
      const p = await parse(q);
      expect(p, q).toMatchObject({ intent: "alliance-predict", complete: true });
      expect(p.teams.filter((t) => t.at < p.vsAt!).map((t) => t.number), q).toEqual([4215, 6980]);
      expect(p.teams.filter((t) => t.at > p.vsAt!).map((t) => t.number), q).toEqual([24033, 23268]);
    }
    // Three or five teams are no two alliances of two; two teams stay the two-team call.
    expect((await parse("4215 6980 vs 24033")).intent).not.toBe("alliance-predict");
    expect((await parse("4215 vs 6980 matchup")).intent).toBe("two-predict");
  });
  it("reads a forecast held up against what happened as the forecast at the event (its card shows both)", async () => {
    for (const q of [
      "4215 last prediction for east bergen conference", "show me 4215's predictions before and after east bergen conference",
      "4215 predicted rank at nj championship vs actual rank", "did the prediction for 4215 at east bergen conference get it right, or was it way off",
      "4215 predicted vs actual at nj championship", "how accurate was the prediction for 4215 at nj championship",
    ]) {
      expect(await parse(q), q).toMatchObject({ intent: "team-predict", complete: true, teams: [{ number: 4215 }], event: { words: expect.stringMatching(/east bergen conference|nj championship/) } });
    }
    // Held up against what happened is the forecast's word alone: never another answer's.
    expect((await parse("4215 record or not")).complete).toBe(false);
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
  it("reads a place typed right after a shared name as which team, never where its matches were", async () => {
    for (const q of ["ultraviolet nj latest", "ultraviolet nj highlights", "ultraviolet new jersey latest"]) {
      const p = await parse(q);
      expect(p.teams, q).toMatchObject([{ number: 23268, rule: "the one in New Jersey" }]);
      expect(p.place, q).toBeNull();
      expect(p.complete, q).toBe(true);
    }
    expect(await parse("ultraviolet latest")).toMatchObject({ intent: "recent-match", complete: false });
    // A possessive in the name ("The King's School nj") still reads the place as right after it.
    const k = await parse("the king's school nj latest");
    expect(k.teams).toMatchObject([{ number: 30013 }]);
    expect(k.place).toBeNull();
    // Said with a preposition, the place still picks the team and stays where its matches were.
    expect((await parse("ultraviolet record in new jersey")).place).toMatchObject({ name: "New Jersey" });
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
  it("takes \"this season\" in with a season said outright, wherever it stands", () => {
    expect(readTime("biggest upset in nj this season in 2025-26", "2026-11-04")).toEqual({ time: expect.objectContaining({ kind: "season", season: 2025 }), rest: "biggest upset in nj" });
    // A bare year beside it is the season named too, whichever comes first.
    expect(readTime("4215 record this season in 2025", "2026-11-04")).toEqual({ time: expect.objectContaining({ kind: "season", season: 2025, year: 2025 }), rest: "4215 record" });
    expect(readTime("4215 record in 2025 this season", "2026-11-04")).toEqual({ time: expect.objectContaining({ kind: "season", season: 2025, year: 2025 }), rest: "4215 record" });
    // A year the parser keeps for a team is left alone: "this season" stands.
    expect(readTime("2025 record this season", "2026-11-04", () => false)).toEqual({ time: expect.objectContaining({ kind: "season", relative: "this" }), rest: "2025 record" });
  });
  it("a team numbered like a year beside \"this season\" stays the team", async () => {
    for (const q of ["this season 2024 record", "2024 record this season", "2024 this season record"]) {
      expect(await parse(q), q).toMatchObject({ teams: [{ number: 2024 }], time: { relative: "this" }, complete: true });
    }
    // With another team named, or a number no team has, the bare year is the season.
    expect(await parse("4215 record this season 2025")).toMatchObject({ teams: [{ number: 4215 }], time: { season: 2025, year: 2025 }, complete: true });
    expect(await parse("4215 record this season 2026")).toMatchObject({ teams: [{ number: 4215 }], time: { season: 2026 } });
    expect(await parse("2024 record this season 2025")).toMatchObject({ teams: [{ number: 2024 }], time: { season: 2025 } });
    // Joined to another team by "vs" or "and", it's one of the teams compared.
    for (const q of ["2024 vs 4215 opr this season", "4215 vs 2024 opr", "2024 and 4215 opr this season"]) {
      expect((await parse(q)).teams.map((t) => t.number).sort(), q).toEqual([2024, 4215]);
    }
    expect(await parse("2024 vs 4215 opr in 2025")).toMatchObject({ time: { season: 2025 } });
    expect(readTime("this season 12345 opr in 2025-26", "2026-11-04")).toMatchObject({ time: { season: 2025 }, rest: "12345 opr" });
    expect(readTime("12345 opr this season", "2026-11-04").time).toMatchObject({ relative: "this" });
    // "Last season" beside a season named is a second season (a comparison): left for the parse to leave unread.
    expect(readTime("12345 record in 2025-26 vs last season", "2026-11-04").rest).toContain("last season");
  });
  it("names the season a date is in", () => {
    expect(seasonOfDate("2026-09-01")).toBe(2026);
    expect(seasonOfDate("2026-08-31")).toBe(2025);
  });
});

describe("review fixes", () => {
  it("never moves a date that doesn't exist to another day", () => {
    expect(readTime("highest score on february 30, 2026", "2026-11-04").time).toBeNull();
    expect(readTime("highest score on 2026-13-45", "2026-11-04").time).toBeNull();
    expect(readTime("highest score on 2/30/2026", "2026-11-04").time).toBeNull();
    expect(readTime("highest score on february 28, 2026", "2026-11-04").time).toMatchObject({ from: "2026-02-28" });
    expect(readTime("highest score on february 30, 2026", "2026-11-04")).toMatchObject({ time: null, unread: "on february 30, 2026" });
  });
  it("an impossible date leaves the question unread", async () => {
    expect(await parse("4215 highest score on february 30, 2026")).toMatchObject({ complete: false });
  });
  it("reads \"total\" with points, matches, events and awards", async () => {
    expect(await parse("4215 total points")).toMatchObject({ intent: "total-points", complete: true });
    expect(await parse("4215 total matches")).toMatchObject({ intent: "total-matches", complete: true });
    expect(await parse("4215 total events")).toMatchObject({ intent: "total-events", complete: true });
    expect(await parse("4215 total awards")).toMatchObject({ intent: "total-awards", complete: true });
  });
  it("keeps an event word the lexicon read beside an event's name", async () => {
    const c: ParseContext = { ...ctx, isEvent: async (w) => ["northern league", "northern league meet"].includes(w) };
    expect((await parseQuery("4215 rank at northern league meet", c)).event?.words).toBe("northern league meet");
  });
  it("leaves two shared names that only settle each other unread", async () => {
    const names = buildNames([
      ...TEAMS,
      { number: 30001, name: "Twin Gears", city: "A", state: "NJ", country: "USA", lastPlayed: 2026 },
      { number: 30002, name: "Twin Gears", city: "B", state: "MI", country: "USA", lastPlayed: 2026 },
      { number: 30003, name: "Mirror Bots", city: "C", state: "NJ", country: "USA", lastPlayed: 2026 },
      { number: 30004, name: "Mirror Bots", city: "D", state: "MI", country: "USA", lastPlayed: 2026 },
    ], []);
    const p = await parseQuery("twin gears vs mirror bots", { ...ctx, names });
    expect(p.complete).toBe(false);
  });
});

describe("shared names in any order", () => {
  it("a name settled on its own settles the other, whichever is typed first", async () => {
    const names = buildNames([
      ...TEAMS,
      // Twin Gears: one in NJ, one in MI, both newest. Mirror Bots: the NJ one played most recently.
      { number: 30001, name: "Twin Gears", city: "A", state: "NJ", country: "USA", lastPlayed: 2026 },
      { number: 30002, name: "Twin Gears", city: "B", state: "MI", country: "USA", lastPlayed: 2026 },
      { number: 30003, name: "Mirror Bots", city: "C", state: "NJ", country: "USA", lastPlayed: 2026 },
      { number: 30004, name: "Mirror Bots", city: "D", state: "MI", country: "USA", lastPlayed: 2024 },
    ], []);
    for (const q of ["twin gears vs mirror bots", "mirror bots vs twin gears"]) {
      const p = await parseQuery(q, { ...ctx, names });
      expect(p.teams.map((t) => t.number).sort(), q).toEqual([30001, 30003]);
    }
  });
});

describe("a name said as words", () => {
  it("is the words after 'named' or 'called', however the question's asked, never the team that has the name", async () => {
    for (const q of ["how many teams named ultraviolet", "how many teams are called Ultraviolet?", "number of teams named ultraviolet", "teams named ultraviolet",
      "how many teams have the name ultraviolet", "how many teams named ultraviolet are there please"]) {
      expect(await parse(q), q).toMatchObject({ intent: "teams-named", named: { words: "ultraviolet" }, teams: [], complete: true });
    }
    expect(await parse("how many teams are called hypnotic robotics")).toMatchObject({ intent: "teams-named", named: { words: "hypnotic robotics" }, teams: [] });
  });
  it("ends where a place or a season starts", async () => {
    expect(await parse("teams named bad wolf from NJ in 2025-26")).toMatchObject({ named: { words: "bad wolf" }, place: { state: "NJ" }, time: { season: 2025 }, complete: true });
    expect(await parse("teams named ultraviolet last season")).toMatchObject({ named: { words: "ultraviolet" }, time: { relative: "last" }, complete: true });
  });
  it("a stored name keeps its time words; the closing filler is left off, a phrase of it too", async () => {
    // A game's or a month's word inside a stored name is the name, never a time.
    expect(await parse("how many teams named powerplay pioneers")).toMatchObject({ named: { words: "powerplay pioneers" }, time: null });
    expect(await parse("teams called march madness in 2025-26")).toMatchObject({ named: { words: "march madness" }, time: { season: 2025 } });
    for (const q of ["teams named ultraviolet thank you", "how many teams named ultraviolet are there thank you"]) {
      expect(await parse(q), q).toMatchObject({ named: { words: "ultraviolet" }, complete: true });
    }
    expect((await parse("teams named nobody here thank you")).named?.words).toBe("nobody");
  });
  it("with nothing after it, is no name: the question stays the readers' it was", async () => {
    expect(await parse("what is 4215 called")).toMatchObject({ teams: [{ number: 4215 }], complete: false });
    expect((await parse("what is 4215 called")).named).toBeUndefined();
  });
  it("a count of teams in a place is its own intent; a name alone is still a team", async () => {
    expect(await parse("how many teams from Oradell")).toMatchObject({ intent: "count-teams", place: { kind: "city" }, complete: true });
    expect(await parse("ultraviolet")).toMatchObject({ intent: null, complete: false });
  });
});

describe("leaderboards said other ways", () => {
  it("a place's leaderboard, the highest rated, a stat not to go by, records beside", async () => {
    expect(await parse("Romania leaderboard 2025-26")).toMatchObject({ intent: "leaderboard", place: { kind: "country" }, complete: true });
    expect(await parse("highest rated teams in Romania in 2025-26")).toMatchObject({ intent: "leaderboard", complete: true });
    expect((await parse("highest rated teams in Romania")).symbols).toContain("metric:rating");
    const not = await parse("top 5 teams in Romania by rating, not OPR");
    expect(not).toMatchObject({ intent: "leaderboard", n: 5, complete: true });
    expect(not.symbols).not.toContain("metric:opr");
    expect(not.notStats).toEqual(["OPR"]);
    expect(await parse("top 10 teams in New Jersey by OPR, with their records")).toMatchObject({ intent: "leaderboard", complete: true });
    expect(await parse("most points in a match in New Jersey")).toMatchObject({ intent: "top-matches", complete: true });
  });
  it("'not' drops a stat only: a win or a loss said with it stays", async () => {
    expect((await parse("matches 4215 did not win")).symbols).toContain("metric:win");
  });
});
describe("when, said with 'time' or as a verb", () => {
  it("the last or first time a team played is its last or first match, never a team named 'Time'", async () => {
    for (const q of ["when was the last time 4215 played", "4215 last played when", "when did 4215 last play"]) expect(await parse(q), q).toMatchObject({ intent: "recent-match", teams: [{ number: 4215 }], complete: true });
    for (const q of ["when did 4215 first play", "the first time 4215 played a match"]) expect(await parse(q), q).toMatchObject({ intent: "first-match", teams: [{ number: 4215 }], complete: true });
  });
  it("a match's number is never read as the last one played", async () => {
    expect(await parse("when did 4215 last play match 12")).toMatchObject({ complete: false });
  });
});
