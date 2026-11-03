// Margin error on the track record: |predicted margin − real margin| averaged over the calls that had a
// predicted score, with "always say 0" as the no-skill line and qualifiers and playoffs apart.
import { describe, expect, it } from "vitest";
import { block, callMargin, marginError } from "./accuracy";

const call = (level: string, predicted: number, actual: number) => ({ p: 0.6, y: actual > 0 ? 1 : 0, tier: "confident" as const, level, time: null, margin: { predicted, actual } });

describe("margin error", () => {
  it("averages the absolute margin miss, with the 0-margin baseline and each level apart", () => {
    const m = marginError([call("qual", 10, 20), call("qual", -5, 5), call("playoff", 30, 18)])!;
    expect(m.n).toBe(3);
    expect(m.mae).toBeCloseTo((10 + 10 + 12) / 3);
    expect(m.baselineMae).toBeCloseTo((20 + 5 + 18) / 3);
    expect(m.byLevel.qual).toEqual({ n: 2, mae: 10 });
    expect(m.byLevel.playoff).toEqual({ n: 1, mae: 12 });
  });

  it("leaves out calls with no predicted score, and is null when none had one", () => {
    const none = { p: 0.6, y: 1, tier: "confident" as const, level: "qual", time: null, margin: null };
    expect(marginError([none])).toBeNull();
    expect(block([none])!.margin).toBeNull();
    expect(block([none, call("qual", 4, 6)])!.margin).toMatchObject({ n: 1, mae: 2 });
  });

  it("reads red minus blue from a ledger row, and nothing from a call logged with no score basis", () => {
    expect(callMargin({ red_mean: 120.5, blue_mean: 100, red_score: 90, blue_score: 110, no_score_basis: 0 })).toEqual({ predicted: 20.5, actual: -20 });
    expect(callMargin({ red_mean: 120, blue_mean: 100, red_score: 90, blue_score: 110, no_score_basis: 1 })).toBeNull();
    expect(callMargin({ red_mean: 120, blue_mean: 100, red_score: null, blue_score: 110, no_score_basis: 0 })).toBeNull();
  });
});
