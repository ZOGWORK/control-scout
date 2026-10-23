import { describe, it, expect } from "vitest";
import { TIE_RULE, allianceBonusOdds, expectedOutcomeRp, tieProbability, winRankingPoints } from "../bonus";
import { simulateEvent, type QualMatch } from "../sim";
import type { TeamRating } from "../types";

describe("ties (engine 3.1)", () => {
  it("prices a tie as width × the margin's density at 0", () => {
    const sd = 40, p = 0.5;
    expect(tieProbability({ mean: 0, sd }, p)).toBeCloseTo(TIE_RULE.width / (Math.sqrt(2 * Math.PI) * sd), 12);
    // Further from even, less likely to tie; never more than the win/loss mass allows.
    expect(tieProbability({ mean: 40, sd }, 0.84)).toBeLessThan(tieProbability({ mean: 0, sd }, p));
    expect(tieProbability({ mean: 0, sd: 0.01 }, 0.999)).toBeCloseTo(0.002, 12);
    expect(tieProbability({ mean: 0, sd: 0 }, p)).toBe(0);
  });

  it("splits a tie's half-win out of the win probability and pays its tie RPs", () => {
    const { win, tie } = winRankingPoints(2025);
    expect(expectedOutcomeRp(2025, 0.6, 0)).toBeCloseTo(win * 0.6, 12);
    expect(expectedOutcomeRp(2025, 0.6, 0.02)).toBeCloseTo(win * 0.59 + tie * 0.02, 12);
    // Both alliances together: a tie pays 2 × tie RPs instead of one win's.
    const both = expectedOutcomeRp(2025, 0.6, 0.02) + expectedOutcomeRp(2025, 0.4, 0.02);
    expect(both).toBeCloseTo(win * 0.98 + 2 * tie * 0.02, 12);
    // Before 2025 a win (2) and two ties (1 + 1) pay the same in total.
    expect(expectedOutcomeRp(2024, 0.6, 0.02) + expectedOutcomeRp(2024, 0.4, 0.02)).toBeCloseTo(2, 12);
  });

  it("adds the tie term to an alliance's expected RPs and leaves bonus odds alone", () => {
    const model = { movement: [0, 0.01], goal: [-1, 0.02], pattern: [-2, 0.01] } as never;
    const a = allianceBonusOdds(2025, model, { mean: 80, sd: 25 }, 0.55, 0)!, b = allianceBonusOdds(2025, model, { mean: 80, sd: 25 }, 0.55, 0.01)!;
    expect(b.p).toEqual(a.p);
    expect(b.expectedRp - a.expectedRp).toBeCloseTo(-0.5 * winRankingPoints(2025).win * 0.01 + 0.01, 12);
  });

  it("only a tie width makes simulated quals tie, and it moves the standings", () => {
    const rating = (np: number): TeamRating => ({ auto: np * 0.2, teleop: np * 0.7, endgame: np * 0.1, pen: 0, n: 10, uncertainty: 1 });
    const teams = [1, 2, 3, 4, 5, 6, 7, 8];
    const ratings = new Map(teams.map((t) => [t, rating(t <= 4 ? 100 : 60)]));
    const quals: QualMatch[] = [];
    for (let k = 0; k < 6; k++) quals.push({ red: [1, 2], blue: [3, 4] }, { red: [5, 6], blue: [7, 8] }, { red: [1, 5], blue: [3, 7] }, { red: [2, 6], blue: [4, 8] });
    const base = { season: 2024, ratings, quals, noise: { a: 1, b: 0 }, awards: { mode: "none" as const }, prequalified: new Set<number>(), slots: 2, runs: 300, seed: 5 };
    const off = simulateEvent(base), zero = simulateEvent({ ...base, tieWidth: 0 });
    expect([...zero.values()].map((o) => o.meanRank)).toEqual([...off.values()].map((o) => o.meanRank));
    // A width wider than any margin: every simulated qual ties, so every team has the same ranking score and
    // ranks fall to the tiebreaks (strong teams' higher auto), not to results.
    const all = simulateEvent({ ...base, tieWidth: 1e9 });
    expect([...all.values()].map((o) => o.meanRank)).not.toEqual([...off.values()].map((o) => o.meanRank));
  });
});
