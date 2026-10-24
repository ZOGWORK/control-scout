// Simulated rankings: random schedules play every team the asked number of counted matches (surrogates fill the
// last match, never a team twice in one), the simulation is the same for the same seed, a stronger team ranks
// higher, a published schedule is played as published, and the odds add up (one #1 a run, four in the top 4).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rng } from "@control-scout/predict-engine";
import { deserializeInput, type FixtureEvent } from "./fixture";
import { randomSchedule, simulateRankings } from "../../src/shared/rankingSim";
import { perTeamOf } from "./rankingSim";

const fx = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "midpoint.json"), "utf8")) as { season: number; events: FixtureEvent[] };
const ev = fx.events[0];
const base = deserializeInput(ev.input);
const teams = [...base.ratings.keys()];
// Before the event: no results, no schedule.
const fresh = { ...base, quals: [] };

describe("a random schedule", () => {
  for (const [n, per] of [[12, 5], [13, 5], [17, 6], [24, 4], [7, 3]] as const) {
    it(`${n} teams, ${per} matches each: every team plays ${per} counted, surrogates only to fill, never twice in a match`, () => {
      const ts = Array.from({ length: n }, (_, i) => 100 + i);
      const s = randomSchedule(ts, per, rng(n * 31 + per));
      const counted = new Map(ts.map((t) => [t, 0]));
      for (const m of s) {
        const four = [...m.red, ...m.blue];
        expect(new Set(four).size).toBe(4);
        for (const t of four) if (!m.noRank?.includes(t)) counted.set(t, counted.get(t)! + 1);
      }
      for (const t of ts) expect(counted.get(t)).toBe(per);
      expect(s.length).toBe(Math.ceil((n * per) / 4));
      expect(s.filter((m) => m.noRank).length).toBe((n * per) % 4 ? 1 : 0);
    });
  }
  it("too few teams for a match: none", () => expect(randomSchedule([1, 2, 3], 5, rng(1))).toEqual([]));
});

describe("simulated rankings", () => {
  const o = { runs: 400, seed: 7, published: false, perTeam: 5 };
  it("the same seed gives the same numbers", () => {
    expect(simulateRankings(fresh, teams, o)).toEqual(simulateRankings(fresh, teams, o));
  });
  it("odds add up: one #1, four in the top 4 and eight in the top 8 per simulated event", () => {
    const r = simulateRankings(fresh, teams, o);
    expect(r.runs).toBe(400);
    expect(r.schedule).toBe("random");
    expect(r.perTeam).toBe(5);
    const sum = (k: "first" | "top4" | "top8") => r.teams.reduce((a, t) => a + t[k], 0);
    expect(sum("first")).toBeCloseTo(1, 6);
    expect(sum("top4")).toBeCloseTo(4, 6);
    expect(sum("top8")).toBeCloseTo(Math.min(8, teams.length), 6);
    for (const t of r.teams) { expect(t.p10).toBeLessThanOrEqual(t.mean + 0.5); expect(t.p90).toBeGreaterThanOrEqual(t.mean - 0.5); }
    // Best average rank first.
    for (let i = 1; i < r.teams.length; i++) expect(r.teams[i].mean).toBeGreaterThanOrEqual(r.teams[i - 1].mean);
  });
  it("a much stronger team ranks near the top", () => {
    // The weakest team, given twice the best team's scoring.
    const pts = (t: number) => { const r = base.ratings.get(t)!; return r.auto + r.teleop + r.endgame; };
    const star = [...teams].sort((a, b) => pts(a) - pts(b))[0];
    const best = base.ratings.get([...teams].sort((a, b) => pts(b) - pts(a))[0])!;
    const boosted = { ...fresh, ratings: new Map(base.ratings).set(star, { ...base.ratings.get(star)!, auto: best.auto * 2, teleop: best.teleop * 2, endgame: best.endgame * 2 }) };
    const r = simulateRankings(boosted, teams, o);
    expect(r.teams[0].team).toBe(star);
    expect(r.teams[0].first).toBeGreaterThan(0.5);
  });
  it("a published schedule is played as published", () => {
    const r = simulateRankings({ ...base, quals: base.quals.map(({ red, blue }) => ({ red, blue })) }, teams, { ...o, published: true });
    expect(r.schedule).toBe("published");
    expect(r.perTeam).toBeNull();
  });
  it("stops at the budget, after the fewest runs asked for", () => {
    let t = 0;
    const r = simulateRankings(fresh, teams, { ...o, runs: 5000, budgetMs: 10, minRuns: 50, clock: () => (t += 100) });
    expect(r.runs).toBe(50);
  });
});

describe("matches per team from the address", () => {
  it("takes 4 to 10, else 5", () => {
    expect(perTeamOf("6")).toBe(6);
    expect(perTeamOf("10")).toBe(10);
    expect(perTeamOf("3")).toBe(5);
    expect(perTeamOf("x")).toBe(5);
    expect(perTeamOf(undefined)).toBe(5);
  });
});
