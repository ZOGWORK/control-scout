import { describe, expect, it } from "vitest";
import { bonusBlock } from "./accuracy.js";

describe("bonusBlock (track record)", () => {
  it("scores each alliance-bonus call by Brier, per bonus and against the base rate", () => {
    const b = bonusBlock([
      { p: [0.9, 0.2, 0.5], y: [true, false, true] },
      { p: [0.7, 0.1, 0.5], y: [true, false, false] },
    ], ["Movement", "Goal", "Pattern"], 1)!;
    expect(b.n).toBe(6);
    expect(b.matches).toBe(1);
    expect(b.brier).toBeCloseTo((0.01 + 0.04 + 0.25 + 0.09 + 0.01 + 0.25) / 6, 12);
    expect(b.bySlot[0]).toMatchObject({ label: "Movement", n: 2, predicted: 0.8, actual: 1 });
    // Base rates: movement 1 and goal 0 are perfect, pattern 0.5 scores 0.25 on both calls.
    expect(b.baseRateBrier).toBeCloseTo(0.5 / 6, 12);
    expect(b.reliability.reduce((s, r) => s + r.n, 0)).toBe(6);
    expect(bonusBlock([], ["a", "b", "c"], 0)).toBeNull();
  });
});
