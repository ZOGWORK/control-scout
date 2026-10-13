// 1.1.0: a three-team playoff alliance fields two robots, not three.
import { describe, it, expect } from "vitest";
import { simulateEvent } from "../sim";
import type { TeamRating } from "../types";

const r = (np: number): TeamRating => ({ auto: np * 0.2, teleop: np * 0.7, endgame: np * 0.1, pen: 0, n: 30, uncertainty: 10 });

describe("playoff lineups", () => {
  it("scores two robots per alliance even when three were selected", () => {
    // Six equal robots: alliance 1 has a second pick, alliance 2 doesn't.
    // Counting all three robots would make alliance 1 a near-certain winner.
    const ratings = new Map([1, 2, 3, 4, 5].map((t) => [t, r(60)]));
    const res = simulateEvent({
      season: 2024, ratings, quals: [], noise: { a: 14, b: 0.2 },
      ranks: new Map([[1, 1], [4, 2], [2, 3], [5, 4], [3, 5]]),
      alliances: [[1, 2, 3], [4, 5]],
      awards: { mode: "none" }, prequalified: new Set(), slots: 1, runs: 4000, seed: 3,
    });
    const pWin1 = res.get(1)!.pWin;
    expect(pWin1).toBeGreaterThan(0.4);
    expect(pWin1).toBeLessThan(0.6);
    // Every member of the alliance shares its result.
    expect(res.get(3)!.pWin).toBe(pWin1);
  });

  it("fields the two strongest robots of a three-team alliance", () => {
    const ratings = new Map<number, TeamRating>([[1, r(80)], [2, r(80)], [3, r(5)], [4, r(80)], [5, r(80)]]);
    const res = simulateEvent({
      season: 2024, ratings, quals: [], noise: { a: 14, b: 0.2 },
      ranks: new Map([[1, 1], [4, 2], [2, 3], [5, 4], [3, 5]]),
      alliances: [[1, 2, 3], [4, 5]],
      awards: { mode: "none" }, prequalified: new Set(), slots: 1, runs: 4000, seed: 5,
    });
    // The weak third robot sits out, so it neither helps nor hurts: an even final.
    expect(res.get(1)!.pWin).toBeGreaterThan(0.4);
    expect(res.get(1)!.pWin).toBeLessThan(0.6);
  });
});
