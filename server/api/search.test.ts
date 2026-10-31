// Search against an in-memory database with a few real-shaped rows.
import { beforeAll, describe, it, expect } from "vitest";
import { openDb, migrate, setDb, run } from "../db";
import { rebuildSearch } from "../stats/job";
import { ensureSearchIndex, search, searchIntent } from "./search";
import { hitHref } from "../../src/shared/search";
import { all as dbAll } from "../db";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string | null, string][] = [
    [16321, "X Drive", null, "Seattle"], [10820, "Cyber Dragons", "Lincoln High", "Austin"], [18360, "Pymble Pyrophosphate", null, "Sydney"],
    [1622, "Team Spyder", null, "San Diego"], [16000, "Gear Maniacs", null, "Boston"], [4215, "Hypnotic Robotics", null, "Ames"],
    [2222, "Robo-Raptors", null, "Leeds"], [3333, "机器人队", null, "Shenzhen"],
    [5555, "Drive Team", null, "Austin"],
  ];
  for (const [n, name, school, city] of teams) {
    await run("INSERT INTO teams (number, name, school, city) VALUES (?, ?, ?, ?)", [n, name, school, city]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, city, start, source) VALUES (2025, 'AUSYQ1', 'Sydney South Qualifier', 'Sydney', '2025-11-16', 'first')");
  await run("INSERT INTO events (season, code, name, city, start, source) VALUES (2024, 'USMICMP2', 'Michigan FTC State Championship-SE', 'Warren', '2024-12-06', 'first')");
  await run("INSERT INTO events (season, code, name, city, state, country, start, source) VALUES (2026, 'USNJRAM1', 'P1-5 AM Northeast League Meet', 'Ramsey', 'NJ', 'USA', '2026-11-07', 'first')");
  for (const [season, code, name] of [[2026, "USNJCMP", "New Jersey Championship"], [2025, "USNJCMP", "New Jersey Championship"], [2025, "USNJCMPPKWY", "New Jersey Championship - Parkway Division"]] as const)
    await run("INSERT INTO events (season, code, name, city, state, country, start, source) VALUES (?, ?, ?, 'Union', 'NJ', 'USA', '2027-03-14', 'first')", [season, code, name]);
  await run("INSERT INTO events (season, code, name, city, state, country, start, source) VALUES (2026, 'USTXCAP', 'Capitol Qualifier', 'Austin', 'TX', 'USA', '2026-12-05', 'first')");
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'AUSYQ1', 'qual', 0, 12, 'Q12', 1, 'first')");
  // FIRST's placeholders (src/shared/teamPages.ts): never a hit, by name or number.
  await run("INSERT INTO teams (number, name, city) VALUES (99999, 'Off-Season Demo Team', NULL), (34320, 'Demo Team', 'Chisinau'), (21795, 'FIRSTIL TEST TEAM', 'Tel Aviv')");
  await rebuildSearch();
});

const titles = async (q: string) => (await search(q, 5)).map((h) => h.title);

describe("search", () => {
  it("never offers a placeholder team, by name, number or typo", async () => {
    for (const q of ["off-season demo team", "demo team", "demo tem", "99999", "34320", "9999", "3432", "firstil test team", "test team", "21795", "tel aviv"]) {
      expect((await search(q, 12)).filter((h) => h.kind === "team" && ["99999", "34320", "21795"].includes(h.ref)), q).toEqual([]);
    }
  });
  it("finds places by full state name, not just the code (New Jersey → NJ)", async () => {
    expect(await titles("new jersey")).toContain("P1-5 AM Northeast League Meet");
    expect(await titles("ramsey nj")).toContain("P1-5 AM Northeast League Meet");
  });
  it("offers a state's events as one link", async () => {
    const hits = await search("new jersey", 12);
    expect(hits[0]).toMatchObject({ kind: "place", ref: "USA:NJ", title: "All events in New Jersey" });
    expect((await search("NJ", 12))[0]?.kind).toBe("place");
  });
  it("shows an event code once, from its newest season, unless a year is typed", async () => {
    const refs = (await search("new jersey championship", 12)).filter((h) => h.kind === "event").map((h) => h.ref);
    expect(refs).toContain("2026:USNJCMP");
    expect(refs).not.toContain("2025:USNJCMP");
    expect(refs).toContain("2025:USNJCMPPKWY"); // a division is its own event
    expect((await search("2025 new jersey championship", 12)).map((h) => h.ref)).toContain("2025:USNJCMP");
  });
  it("drops older seasons of an event from typo matches too", async () => {
    const refs = (await search("jresey chmpionship", 12)).filter((h) => h.kind === "event").map((h) => h.ref);
    expect(refs).toContain("2026:USNJCMP");
    expect(refs).not.toContain("2025:USNJCMP");
  });
  it("tolerates typos in team names", async () => {
    expect((await titles("X Drvie"))[0]).toBe("16321 X Drive");
    expect((await titles("cyber dragns"))[0]).toBe("10820 Cyber Dragons");
  });
  it("matches as you type", async () => {
    expect((await titles("pymb"))[0]).toBe("18360 Pymble Pyrophosphate");
    expect((await titles("x dri"))[0]).toBe("16321 X Drive");
  });
  it("ranks your own teams first after an exact number match", async () => {
    const pref = new Set(["team:16321"]);
    expect((await search("16", 5, pref)).map((h) => h.title)).toEqual(["16321 X Drive", "1622 Team Spyder", "16000 Gear Maniacs"]);
    // An exact match still wins over a preferred one.
    expect((await search("1622", 5, pref))[0].title).toBe("1622 Team Spyder");
    // Typo fallback (no shared trigram): equally good matches tip toward your team too.
    const both = (await search("dirve", 5)).map((h) => h.ref);
    expect(both).toEqual(expect.arrayContaining(["16321", "5555"]));
    expect((await search("dirve", 5, new Set(["team:5555"])))[0].ref).toBe("5555");
    expect((await search("dirve", 5, new Set(["team:16321"])))[0].ref).toBe("16321");
    // Text: near-tied matches tip toward your team.
    expect((await search("dragons", 5, new Set(["team:10820"])))[0].title).toBe("10820 Cyber Dragons");
  });

  it("prefix-matches team numbers, exact number first", async () => {
    expect(await titles("16")).toEqual(["1622 Team Spyder", "16000 Gear Maniacs", "16321 X Drive"]);
    expect((await titles("4215"))[0]).toBe("4215 Hypnotic Robotics");
    expect(await titles("0")).toEqual([]);
  });
  it("finds events by misspelled name, and matches by code", async () => {
    expect((await titles("sydney south qualifer"))[0]).toBe("Sydney South Qualifier");
    expect((await titles("AUSYQ1 Q12"))[0]).toBe("Q12 · Sydney South Qualifier");
  });
  it("finds short swapped typos that share no trigram (dirve → Drive)", async () => {
    expect(await titles("dirve")).toContain("16321 X Drive"); // ties with "Drive Team" (preference test)
  });
  it("matches across punctuation in stored names (Robo-Raptors)", async () => {
    expect((await titles("robo raptrs"))[0]).toBe("2222 Robo-Raptors");
  });
  it("keeps non-Latin names searchable", async () => {
    expect((await titles("机器人"))[0]).toBe("3333 机器人队");
  });
  it("still finds events by year", async () => {
    expect(await titles("2025")).toContain("Sydney South Qualifier");
  });
  it("fills an empty typo index on an upgraded database", async () => {
    await run("DELETE FROM search_fuzzy");
    await ensureSearchIndex(rebuildSearch);
    expect(Number((await dbAll<{ n: number }>("SELECT COUNT(*) n FROM search_fuzzy"))[0].n)).toBeGreaterThan(0);
    expect((await titles("X Drvie"))[0]).toBe("16321 X Drive");
  });
  it("recovers after a failed index read instead of caching the failure", async () => {
    const c = (await import("../db")).db();
    const real = c.execute.bind(c);
    let fail = true;
    (c as any).execute = (q: any) => (fail && String(q?.sql ?? q).includes("FROM search_fuzzy") && !String(q?.sql ?? q).includes("MATCH") ? Promise.reject(new Error("db down")) : real(q));
    await run("UPDATE kv SET value = '\"v-fail\"' WHERE key = 'search:version'");
    await expect(search("dirve", 5)).rejects.toThrow("db down");
    fail = false;
    expect(await titles("dirve")).toContain("16321 X Drive"); // ties with "Drive Team" (preference test)
    (c as any).execute = real;
  });
  it("keeps to the asked kinds before the limit, so teams can't crowd events out", async () => {
    // Two Austin teams and one Austin event: a 1-hit, events-only search still gets the event.
    expect((await search("austin", 1))[0]?.kind).toBe("team"); // without kinds a team takes the one slot
    expect(await search("austin", 1, new Set(), new Set(["event"]))).toEqual([expect.objectContaining({ kind: "event", ref: "2026:USTXCAP" })]);
    expect((await search("austn", 5, new Set(), new Set(["event", "place"]))).every((h) => h.kind === "event" || h.kind === "place")).toBe(true);
    expect(await search("1622", 5, new Set(), new Set(["event", "place"]))).toEqual([]);
    expect((await search("new jersey", 12, new Set(), new Set(["event"]))).some((h) => h.kind === "place")).toBe(false);
    expect((await search("new jersey", 12, new Set(), new Set(["place"])))[0]).toMatchObject({ kind: "place", ref: "USA:NJ" });
    expect(await search("AUSYQ1 Q12", 5, new Set(), new Set(["team"]))).toEqual([]);
  });
  it("doesn't return far-off guesses", async () => {
    expect(await titles("garden state")).toEqual([]);
    expect(await titles("zzzzzz")).toEqual([]);
  });
});

// "hypnotic awards", "4215 ranking points": the name finds the team, the rest says what about it.
describe("search with a topic", () => {
  beforeAll(async () => {
    await run("INSERT INTO teams (number, name, city) VALUES (7777, 'Match Point', 'Reno')");
    await run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, matches, wins, losses, ties, avg_score) VALUES (2025, 4215, 101.64, 616, 8375, 32, 26, 6, 0, 140.2)");
    await run("INSERT INTO event_teams (season, code, team, rank, rp) VALUES (2025, 'AUSYQ1', 4215, 2, 2.456), (2025, 'AUSYQ1', 16321, 1, 3.1)");
    await run("INSERT INTO awards (season, code, type, placement, team) VALUES (2025, 'AUSYQ1', 'Inspire', 1, 4215)");
    await rebuildSearch();
  });

  it("reads the topic and what's left, phrases and typos included", () => {
    expect(searchIntent("hypnotic ranking points")).toMatchObject({ topic: "rp", rest: "hypnotic" });
    expect(searchIntent("Hypnotic Robotics AWARDS")).toMatchObject({ topic: "awards", rest: "Hypnotic Robotics" });
    expect(searchIntent("ultra violet team")).toMatchObject({ topic: null, rest: "ultra violet" });
    expect(searchIntent("hypnotic awrds")).toBeNull();
    expect(searchIntent("hypnotic awrds", true)).toMatchObject({ topic: "awards", rest: "hypnotic" });
    expect(searchIntent("awards")).toBeNull(); // nothing left to search for
    expect(searchIntent("hypnotic")).toBeNull(); // nothing dropped
    // Questions read as their name and topic.
    expect(searchIntent("how many awards did hypnotic robotics win?")).toMatchObject({ topic: "awards", rest: "hypnotic robotics" });
    expect(searchIntent("what are 4215's ranking points")).toMatchObject({ topic: "rp", rest: "4215" });
  });

  it("opens the team on what was asked, with its own numbers", async () => {
    const [aw] = await search("hypnotic awards", 5);
    expect(aw).toMatchObject({ kind: "team", ref: "4215", section: "awards" });
    expect(aw.facts).toEqual([{ label: "Awards", value: "1" }, { label: "Latest", value: "Inspire at Sydney South Qualifier" }, { label: "Season", value: "2025–26" }]);
    expect(hitHref(aw)).toBe("/teams/4215#awards");
    const [rp] = await search("4215 ranking points", 5);
    expect(rp.facts).toEqual([{ label: "Ranking score", value: "2.46 at Sydney South Qualifier" }, { label: "Event rank", value: "#2 of 2" }, { label: "Season", value: "2025–26" }]);
    expect((await search("hypnotic opr", 5))[0].facts).toEqual([{ label: "OPR", value: "101.6" }, { label: "OPR rank", value: "#616 of 8,375" }, { label: "Season", value: "2025–26" }]);
    expect((await search("hypnotic record", 5))[0].facts?.slice(0, 2)).toEqual([{ label: "Record", value: "26-6-0" }, { label: "Win rate", value: "81%" }]);
  });

  it("forgives a misspelled topic word, even next to a correct one", async () => {
    expect((await search("hypnotic awrds", 5))[0]).toMatchObject({ ref: "4215", section: "awards" });
    expect((await search("hypnotic robotics ranking ponts", 5))[0]).toMatchObject({ ref: "4215" });
    expect((await search("hypnotic robotics ranking ponts", 5))[0].facts?.[0].label).toBe("Ranking score");
  });

  it("opens an event on the asked tab, the topic named in its subtitle", async () => {
    const [ev] = await search("sydney south odds", 5);
    expect(ev).toMatchObject({ kind: "event", ref: "2025:AUSYQ1", section: "odds" });
    expect(ev.subtitle).toMatch(/^Advancement odds · /);
    expect(hitHref(ev)).toBe("/events/2025/AUSYQ1?tab=odds");
  });

  it("leaves names, plain queries and match queries as they were", async () => {
    expect((await search("drive team", 5))[0]).toMatchObject({ ref: "5555" });
    expect((await search("drive team", 5))[0].section).toBeUndefined();
    expect((await search("match point", 5))[0]).toMatchObject({ ref: "7777" });
    expect((await search("AUSYQ1 Q12", 5))[0]).toMatchObject({ kind: "match" });
    expect((await search("4215", 5))[0]).toEqual({ kind: "team", ref: "4215", title: "4215 Hypnotic Robotics", subtitle: "Ames", season: 2026 });
  });
});
