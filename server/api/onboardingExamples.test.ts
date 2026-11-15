// The onboarding's step 3 searches (./onboardingExamples.ts): built from each team's own stored history, never one
// team's. Search itself is stood in for here (every query answers unless the test says it doesn't): what's checked is
// which team, season and game each example names.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { CURRENT_SEASON } from "../data/seasons";

const unanswered = new Set<string>();
vi.mock("./answers/followUps.js", () => ({ pageAnswer: async (q: string) => ({ q, hits: [], pages: [], step: unanswered.has(q) ? "recovery" : "deterministic", weak: false }) }));
vi.mock("../searchFailures.js", () => ({ failureOf: (q: string) => (unanswered.has(q) ? { type: "no-match" } : null) }));
const { onboardingExamples, resetOnboardingExamples, typedSeason } = await import("./onboardingExamples");

const NOW = CURRENT_SEASON, LAST = NOW - 1, BEFORE = NOW - 2;
let match = 0;
/** One played match at `code` in `season`: red and blue alliances. */
async function play(season: number, code: string, red: number[], blue: number[]) {
  match++;
  await run("INSERT INTO matches (season, code, level, series, number, label, played, red_np, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, 50, 40, 'first')", [season, code, match, `Q${match}`]);
  for (const [alliance, ts] of [["red", red], ["blue", blue]] as const)
    for (const t of ts) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, ?)", [season, code, match, t, alliance]);
}
const stats = (season: number, team: number, rank: number, of = 1000) =>
  run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, events, matches) VALUES (?, ?, 50, ?, ?, 1, 10)", [season, team, rank, of]);
const team = (n: number, name: string | null, school: string | null, city: string, state = "NJ", country = "USA") =>
  run("INSERT INTO teams (number, name, school, city, state, country) VALUES (?, ?, ?, ?, ?, ?)", [n, name, school, city, state, country]);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [s, name] of [[NOW, "BIOBUZZ"], [LAST, "DECODE"], [BEFORE, "CENTERSTAGE"]] as const) await run("INSERT OR REPLACE INTO seasons (season, name) VALUES (?, ?)", [s, name]);
  await run("INSERT INTO events (season, code, name, type, source) VALUES (?, 'WORLDS', 'FIRST Championship', 'FIRSTChampionship', 'first')", [BEFORE]);
  await run("INSERT INTO events (season, code, name, type, source) VALUES (?, 'WORLDS', 'FIRST Championship', 'FIRSTChampionship', 'first')", [LAST]);
  await run("INSERT INTO events (season, code, name, type, source) VALUES (?, 'LM1', 'League Meet', 'LeagueMeet', 'first')", [LAST]);
  // 1: a Worlds team (BEFORE), with a sister team (same school and town) and a team it met more often.
  await team(1, "Hypnotic Sample", "River High", "Oradell");
  await team(2, "Sister Bots", "River High", "Oradell");
  await team(3, "Often Met", null, "Ramsey");
  for (const t of [1, 2, 3]) { await stats(BEFORE, t, 50); await stats(LAST, t, 400); await stats(NOW, t, 10, 100); }
  await play(BEFORE, "WORLDS", [1, 3], [4, 5]);
  for (let i = 0; i < 3; i++) await play(LAST, "LM1", [1, 3], [5, 6]);
  await play(LAST, "LM1", [1, 6], [2, 5]);
  // 7: league meets only, no school: compared with the team it met most; its best season by rank share.
  await team(7, "League Only", "Family/Community", "Edison");
  await team(8, "Neighbour", "Family/Community", "Edison");
  await stats(BEFORE, 7, 900); await stats(LAST, 7, 100); await stats(LAST, 8, 200); await stats(LAST, 5, 300);
  for (let i = 0; i < 2; i++) await play(LAST, "LM1", [7, 5], [8, 6]);
  await play(LAST, "LM1", [7, 8], [6, 9]);
  // 10: registered at Worlds (an event row) but never on the field there: no Worlds season.
  await team(10, "Registered", null, "Trenton");
  await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'WORLDS', 10)", [LAST]);
  await stats(BEFORE, 10, 20); await stats(LAST, 10, 700);
  await play(LAST, "LM1", [10, 5], [6, 9]);
  // 11: a rookie with nothing played yet. 12, 13: two teams with one name (named by number).
  await team(11, "New Rookies", null, "Princeton");
  await team(12, "Twins", null, "Newark"); await team(13, "twins", null, "Camden");
  await stats(LAST, 12, 5); await play(LAST, "LM1", [12, 5], [6, 9]);
});
beforeEach(() => { unanswered.clear(); resetOnboardingExamples(); });

describe("onboarding step 3 examples", () => {
  it("a Worlds team: its sister team over its last finished season, and its auto OPR in its Worlds season", async () => {
    expect(await onboardingExamples(1)).toEqual({ team: 1, examples: [
      { q: `2 opr vs 1 opr over time in ${typedSeason(LAST)}`, kind: "compare" },
      { q: "what was hypnotic sample auto opr in centerstage", kind: "worlds-season" },
    ] });
  });
  it("league meets only: the team met most (a family/community school is no sister), its best season, no Worlds", async () => {
    const ex = (await onboardingExamples(7))!.examples;
    expect(ex).toEqual([
      { q: `8 opr vs 7 opr over time in ${typedSeason(LAST)}`, kind: "compare" },
      { q: "what was league only auto opr in decode", kind: "season" },
    ]);
    expect(ex.some((e) => /worlds|championship|states/i.test(e.q))).toBe(false);
  });
  it("a Worlds registration alone is no Worlds season", async () => {
    expect((await onboardingExamples(10))!.examples[1]).toEqual({ q: "what was registered auto opr in centerstage", kind: "season" });
  });
  it("a rookie with nothing played: its town and its region, each said with its state", async () => {
    expect((await onboardingExamples(11))!.examples).toEqual([
      { q: "teams in Princeton NJ", kind: "place" }, { q: "best rookie teams in NJ", kind: "place" },
    ]);
  });
  it("a name another team has too is said by number", async () => {
    expect((await onboardingExamples(12))!.examples[1].q).toBe("what was 12 auto opr in decode");
  });
  it("a search that doesn't answer is dropped for the next one", async () => {
    unanswered.add("what was hypnotic sample auto opr in centerstage");
    expect((await onboardingExamples(1))!.examples[1]).toEqual({ q: "what was hypnotic sample auto opr in biobuzz", kind: "season" });
    unanswered.add(`2 opr vs 1 opr over time in ${typedSeason(LAST)}`);
    resetOnboardingExamples();
    expect((await onboardingExamples(1))!.examples).toEqual([
      { q: "what was hypnotic sample auto opr in biobuzz", kind: "season" }, { q: "teams in Oradell NJ", kind: "place" },
    ]);
  });
  it("a team not stored is null", async () => {
    expect(await onboardingExamples(999)).toBeNull();
  });
});
