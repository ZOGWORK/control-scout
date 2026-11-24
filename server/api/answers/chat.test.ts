// Logged failed searches #2216 "who is your creator?", #2215 "answered lol", #2213 "where do i get a lazy susan
// bearing" and #2214/#2210 "was that the same auto points in all the matches u said here": queries that aren't a search
// of FTC data (server/api/query/chat.ts). Each gets a short, true card saying what it is, never a guess at a team or an
// event from its words; and a query search answers keeps its answer.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { failureOf } from "../../searchFailures";
import { chatKind } from "../query/chat";
import { refreshSearchSeason, resetSearchSeason } from "./season";

const full = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // A team whose name is a reaction ("lol"), and teams whose names start like one: a reaction never lists them.
  for (const [n, name] of [[36403, "lol"], [38378, "Lollipop"], [4215, "Hypnotic Robotics"], [23702, "Weatherford Eagles"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
    await run("INSERT INTO team_season_stats (season, team, opr_np, matches, wins, losses, ties) VALUES (2026, ?, 80, 10, 6, 4, 0)", [n]);
  }
  await rebuildSearch();
  clearAllCaches();
  await refreshSearchSeason();
});

afterAll(() => {
  resetSearchSeason();
  vi.useRealTimers();
});

describe("a question to the site itself (#2216)", () => {
  it("says what Control Scout and Bruno are, from the FAQ's own words", async () => {
    const r = await full("who is your creator?");
    expect(r.chat).toBe("meta");
    expect(r.card?.title).toBe("About Control Scout and Bruno");
    expect(r.card?.lines.map((l) => l.text)).toContain("Bruno is Control Point's AI");
    expect(r.hits).toEqual([]);
    expect(failureOf("who is your creator?", r)).toBeNull();
  });
});

describe("a reaction (#2215)", () => {
  it("is never a list of teams whose names share a word with it", async () => {
    const r = await full("answered lol");
    expect(r.chat).toBe("reaction");
    expect(r.step).toBe("deterministic");
    expect(r.didYouMean).toBeUndefined();
    expect(r.recovery).toBeUndefined();
    expect(r.hits).toEqual([]);
    expect(r.card?.title).toBe("Nothing to look up in that");
  });
  it("said to Bruno by name is still a reaction, never the About card", () => {
    expect(chatKind("thanks bruno")).toBe("reaction");
    expect(chatKind("thanks a lot bruno")).toBe("reaction");
    expect(chatKind("who is your creator?")).toBe("meta");
  });
  it("a team named by it alone is still that team", async () => {
    const r = await full("lol");
    expect(r.chat).toBeUndefined();
    expect(r.hits[0]).toMatchObject({ kind: "team", ref: "36403" });
  });
});

describe("a question about getting something (#2213)", () => {
  it("says it isn't in FTC results, never a team or an event location", async () => {
    const r = await full("where do i get a lazy susan bearing");
    expect(r.chat).toBe("off-topic");
    expect(r.card?.title).toBe("Not in FTC results data");
    expect(r.hits).toEqual([]);
    expect(r.understood?.kind).toBe("question");
  });
});

describe("a question about something search holds nothing on (#2234, #2227, #2228)", () => {
  it("says it isn't in FTC results, whatever place, time or ranking is said with it", async () => {
    for (const q of ["whats the weather like in seattle tonight", "is it going to rain in denver tomorrow", "best burger in boston"]) {
      const r = await full(q);
      expect(r.chat, q).toBe("off-topic");
      expect(r.card?.title, q).toBe("Not in FTC results data");
      // What search covers, and what to ask instead: never the parts lines of "where do i get".
      expect(r.card?.lines.map((l) => l.detail), q).toContain("Anything outside FTC robotics isn't in those records");
      expect(r.hits, q).toEqual([]);
      expect(failureOf(q, r), q).toBeNull();
    }
  });
  it("is never a team found from its words, nor a spelling's guess at its other words", async () => {
    // "weather" begins a team's name: the question is still about the weather.
    const r = await full("what will the weather be in seattle this weekend");
    expect(r.chat).toBe("off-topic");
    expect(r.didYouMean).toBeUndefined();
  });
  it("leaves a question about FTC data to search, with a place, a time or a ranking", async () => {
    expect(chatKind("best team in boston")).toBeNull();
    expect(chatKind("who has the best auto in texas")).toBeNull();
    expect(chatKind("4215 events this weekend")).toBeNull();
    expect(chatKind("teams in seattle")).toBeNull();
    expect(chatKind("best drivers in texas")).toBeNull();
    expect((await full("hypnotic robotics")).chat).toBeUndefined();
  });
  it("is off-topic joined with and/or too, and never with an unread word before its place", () => {
    expect(chatKind("best pizza and coffee in boston")).toBe("off-topic");
    expect(chatKind("rain or snow in denver tomorrow")).toBe("off-topic");
    expect(chatKind("weather forecast in denver tomorrow")).toBe("off-topic");
    expect(chatKind("best coffee place in boston")).toBe("off-topic");
    expect(chatKind("whats the weather like in denver in summer")).toBe("off-topic");
    expect(chatKind("best teleop in boston")).toBeNull();
    expect(chatKind("local event in boston")).toBeNull();
    expect(chatKind("exciting match in denver")).toBeNull();
    expect(chatKind("qzv stuff in denver")).toBeNull();
    expect(chatKind("qzv nothing at all")).toBeNull();
  });
  it("leaves a reaction or a question to the site what it was", () => {
    expect(chatKind("lol funny")).toBe("reaction");
    expect(chatKind("thanks that was helpful")).toBe("reaction");
    expect(chatKind("who made you so smart")).toBe("meta");
    expect(chatKind("lol that match was funny")).not.toBe("off-topic");
  });
});

describe("a question about an earlier answer (#2214, #2210)", () => {
  it("says search reads each search on its own and needs the team or event", async () => {
    const r = await full("was that the same auto points in all the matches u said here");
    expect(r.chat).toBe("follow-up");
    expect(r.card?.title).toBe("A question about an earlier answer");
    expect(r.card?.lines[0].detail).toMatch(/team or event/);
    // Never a spelling's guess at its words ("said" read as another word) answered instead.
    expect(r.step).toBe("deterministic");
    expect(r.didYouMean).toBeUndefined();
    expect(failureOf("was that the same auto points in all the matches u said here", r)).toBeNull();
  });
});

describe("what isn't chat", () => {
  it("a search with data in it keeps its own answer", async () => {
    expect((await full("4215")).chat).toBeUndefined();
    expect((await full("where is 4215 from")).chat).toBeUndefined();
    expect((await full("hypnotic robotics opr")).chat).toBeUndefined();
  });
  it("asking for something new is no follow-up, nor a team's past results", () => {
    expect(chatKind("can you show me the best team")).not.toBe("follow-up");
    expect(chatKind("bad wolf previous results")).toBeNull();
    expect(chatKind("where can i find bad wolf")).toBeNull();
  });
});
