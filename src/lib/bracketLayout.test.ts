import { describe, expect, it } from "vitest";
import { bracketOdds, type BracketAlliance, type Price } from "../shared/bracketOdds";
import { bracketLayout } from "./bracketLayout";

const alliances = (n: number): BracketAlliance[] => Array.from({ length: n }, (_, i) => ({ number: i + 1, teams: [100 * (i + 1) + 1, 100 * (i + 1) + 2] }));
const price: Price = () => ({ p: 0.6, tier: "confident" });
const series = (n: number) => bracketOdds({ season: 2025, alliances: alliances(n), matches: [], price, strength: () => 1, runs: 200, seed: 1 }).series;

describe("bracketLayout", () => {
  it("lays a 4-alliance bracket out in two lanes and a finals column", () => {
    const l = bracketLayout(series(4))!;
    expect(l.upper).toEqual([[1, 2], [4]]);
    expect(l.lower).toEqual([[3], [5]]);
    expect(l.final).toEqual([6, 7]);
    expect(l.edges).toEqual(expect.arrayContaining([[1, 4], [2, 4], [3, 5], [4, 6], [5, 6], [6, 7]]));
    expect(l.edges).toHaveLength(6); // no loser drops
  });

  it("lays a 6-alliance bracket out with byes into round two", () => {
    const l = bracketLayout(series(6))!;
    expect(l.upper).toEqual([[1, 2], [3, 4], [7]]);
    expect(l.lower).toEqual([[5, 6], [8], [9]]);
    expect(l.final).toEqual([10, 11]);
  });

  it("lays an 8-alliance bracket out, the lower lane a round longer", () => {
    const l = bracketLayout(series(8))!;
    expect(l.upper).toEqual([[1, 2, 3, 4], [7, 8], [11]]);
    // M5's winner plays M10 and M6's plays M9: M10 goes on top so the lines don't cross.
    expect(l.lower).toEqual([[5, 6], [10, 9], [12], [13]]);
    expect(l.final).toEqual([14, 15]);
  });

  it("gives up on series that don't read as a double-elimination bracket", () => {
    expect(bracketLayout([])).toBeNull();
    expect(bracketLayout(series(4).map((s) => ({ ...s, stage: "Series" })))).toBeNull();
  });
});
