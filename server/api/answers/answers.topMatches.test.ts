// A season's highest-scoring matches with no team (server/api/answers/families/topMatches.ts): the top alliance scores
// and the top combined scores, from official events only, in a place or at an event, and "ever" as each season apart.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { readTopMatches } from "./families/topMatches";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [207, "Critical Mass"], [23268, "Ultraviolet"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
  }
  const ev = (season: number, code: string, name: string, type: string, state: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Town', ?, 'USA', ?, ?, 't')", [season, code, name, type, state, start, start]);
  await ev(2025, "USNJQ1", "New Jersey Qualifier", "Qualifier", "NJ", "2026-01-10");
  await ev(2025, "USTXQ1", "Texas Qualifier", "Qualifier", "TX", "2026-01-17");
  await ev(2025, "USNJSCR", "Summer Scrimmage", "Scrimmage", "NJ", "2026-07-01");
  await ev(2024, "USNJQ0", "Old Qualifier", "Qualifier", "NJ", "2025-01-10");
  const match = (season: number, code: string, n: number, red: number, blue: number) => Promise.all([
    run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, NULL, 1, ?, ?, ?, ?, 't')", [season, code, n, `Q${n}`, red + 10, red, blue, blue]),
    ...[[4215, "red"], [207, "red"], [6980, "blue"], [23268, "blue"]].map(([t, a]) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [season, code, n, t, a])),
  ]);
  await match(2025, "USNJQ1", 1, 300, 100); // NJ's best alliance score
  await match(2025, "USNJQ1", 2, 200, 250); // NJ's best combined
  await match(2025, "USTXQ1", 1, 350, 50); // the season's best alliance score, in Texas
  await match(2025, "USNJSCR", 1, 900, 900); // a scrimmage never counts
  await match(2024, "USNJQ0", 1, 500, 10); // last season's best: a different game
  await rebuildSearch();
});

describe("season top matches", () => {
  it("what's read: a season, a place, an event, ever; a team or a world record is another answer's", () => {
    expect(readTopMatches("highest scoring games in decode")).toMatchObject({ season: 2025, region: null, ever: false });
    expect(readTopMatches("highest scoring matches in new jersey")).toMatchObject({ region: { state: "NJ" } });
    expect(readTopMatches("highest scoring matches at new jersey qualifier")).toMatchObject({ event: "new jersey qualifier" });
    expect(readTopMatches("highest scoring match ever")).toMatchObject({ ever: true });
    expect(readTopMatches("top scores this season")).not.toBeNull();
    for (const q of ["4215 highest score", "hypnotic robotics highest score", "world record score decode", "best auto team"]) expect(readTopMatches(q), q).toBeNull();
  });
  it("the season's top alliance scores and top combined scores, official events only, both alliances named", async () => {
    const a = (await searchAnswer("highest scoring games in decode", { limit: 25 })).stat!;
    expect(a).toMatchObject({ title: "Highest-scoring matches, DECODE 2025–26", headline: { value: "350 points", label: "Q1 at Texas Qualifier" } });
    const ms = a.blocks.find((b) => b.kind === "matches");
    expect(ms && ms.kind === "matches" && ms.rows.map((r) => r.ownNp)).toEqual([350, 300, 250, 200, 100, 50]);
    expect(ms && ms.kind === "matches" && ms.rows[0]).toMatchObject({ own: 360, partners: [{ label: "207 Critical Mass" }, { label: "4215 Hypnotic Robotics" }], opponents: [{ label: "6980 Bad Wolf" }, { label: "23268 Ultraviolet" }] });
    const combined = a.blocks.find((b) => b.kind === "table");
    expect(combined && combined.kind === "table" && combined.rows.map((r) => r.cells.combined)).toEqual([450, 400, 400]);
    expect(a.blocks.find((b) => b.kind === "bars")).toBeDefined();
  });
  it("in a place, or at one event", async () => {
    expect((await searchAnswer("highest scoring matches in new jersey in decode", { limit: 25 })).stat!.headline).toMatchObject({ value: "300 points" });
    expect((await searchAnswer("highest scoring matches at texas qualifier", { limit: 25 })).stat!).toMatchObject({ title: "Highest-scoring matches at Texas Qualifier, DECODE 2025–26", headline: { value: "350 points" } });
  });
  it("ever: each season's best apart, never one record", async () => {
    const a = (await searchAnswer("highest scoring match ever", { limit: 25 })).stat!;
    const per = a.blocks[0];
    expect(per.kind === "table" && per.rows.map((r) => [r.cells.season, r.cells.score])).toEqual([["DECODE 2025–26", 350], ["INTO THE DEEP 2024–25", 500]]);
    expect(a.headline).toMatchObject({ value: "350 points" });
    expect(a.definition).toContain("there is no all-time record");
  });
});
