// A board by team number (failed search #2034: "team with the lowest team number (ex 310, 23777)"): the active teams
// by the number FIRST lists, the lowest first (or the highest, asked so); a bracket of examples is never more of the
// ask, so its numbers are no teams.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer, withoutExamples } from "../searchAnswer";
import { readLeaderboard } from "./read";
import type { StatAnswer } from "../../../src/shared/searchStat";

const box = (q: string) => searchAnswer(q, { limit: 25 });
const page = async (q: string) => (await searchAnswer(q, { limit: 25, full: true })).stat as StatAnswer;
const rows = (s: StatAnswer) => { const b = s.blocks.find((x) => x.kind === "leaderboard"); return b && b.kind === "leaderboard" ? b.rows.map((r) => r.team.label) : []; };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // 5 played only long ago: not active, so never the lowest number now.
  const teams: [number, string, string, number][] = [[5, "Old Timers", "NJ", 2015], [310, "Low Number", "CA", 2008], [7149, "ENFORCERS", "NJ", 2013], [4215, "Hypnotic Robotics", "NJ", 2010], [23777, "New Kids", "TX", 2023], [31002, "Gearheads", "NJ", 2025]];
  for (const [n, name, state, rookie] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Town', ?, 'USA', ?)", [n, name, state, rookie]);
    for (const s of n === 5 ? [2019] : [2024, 2025]) {
      await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
      await run("INSERT INTO team_season_stats (season, team, opr_np, rating_np, matches, wins, losses, ties) VALUES (?, ?, 50, ?, 10, 5, 5, 0)", [s, n, 100 - (n % 90)]);
    }
  }
  await rebuildSearch();
});

describe("the team with the lowest team number", () => {
  it("the logged query, its bracket of examples left out: the active teams, lowest number first, in the box and on the page", async () => {
    for (const q of ["team with the lowest team number (ex 310, 23777)", "team with the lowest team number"]) {
      const a = await box(q);
      expect(a.step, q).toBe("deterministic");
      expect(a.understood?.label, q).toBe("Lowest team numbers still active worldwide");
      const s = await page(q);
      expect(s, q).toMatchObject({ intent: "lowest-number", headline: { value: "310 Low Number" } });
      expect(rows(s), q).toEqual(["310 Low Number", "4215 Hypnotic Robotics", "7149 ENFORCERS", "23777 New Kids", "31002 Gearheads"]);
    }
  });
  it("the highest, and a place's", async () => {
    expect(rows(await page("highest team number in new jersey"))).toEqual(["31002 Gearheads", "7149 ENFORCERS", "4215 Hypnotic Robotics"]);
    expect(readLeaderboard("lowest team number in nj")).toMatchObject({ kind: "number", asc: true, region: { key: "USA:NJ" } });
  });
  it("the oldest teams and the lowest-rated stay their own boards", async () => {
    expect(readLeaderboard("oldest team still active")).toMatchObject({ kind: "oldest" });
    expect(readLeaderboard("lowest rated teams")?.kind).not.toBe("number");
  });
});

describe("a bracket of examples", () => {
  it("goes, whichever way it is said; any other bracket stays", () => {
    expect(withoutExamples("team with the lowest team number (ex 310, 23777)")).toBe("team with the lowest team number");
    expect(withoutExamples("best teleop (e.g. 4215 or 7149) in nj")).toBe("best teleop in nj");
    expect(withoutExamples("teams named robot (like Robot Raiders)")).toBe("teams named robot");
    expect(withoutExamples("4215 (hypnotic robotics) opr")).toBe("4215 (hypnotic robotics) opr");
    expect(withoutExamples('"(ex 310)"')).toBe('"(ex 310)"');
  });
});
