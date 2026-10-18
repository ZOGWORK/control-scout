// @vitest-environment node
import { describe, it, expect } from "vitest";
import { favouriteBin } from "./calibration";
import type { AccuracyBlock } from "../shared/api";

const block = (bins: [number, number, number][]): AccuracyBlock => ({
  n: 0, decided: 0, accuracy: 0, brier: 0, logLoss: 0, baselineBrier: 0.25, upsets: 0,
  byTier: { provisional: { n: 0, accuracy: 0, brier: 0 }, moderate: { n: 0, accuracy: 0, brier: 0 }, confident: { n: 0, accuracy: 0, brier: 0 } },
  byLevel: { qual: { n: 0, accuracy: 0 }, playoff: { n: 0, accuracy: 0 } }, weekly: [],
  reliability: bins.map(([n, predicted, actual], i) => ({ lo: i / 10, hi: (i + 1) / 10, n, predicted, actual })),
});

describe("favouriteBin", () => {
  it("combines red favourites with blue favourites read from the mirrored bin", () => {
    // Red favoured at ~0.85: 100 matches, red won 80%. Blue favoured at ~0.85
    // (pRed ~0.15): 300 matches, red won 10% → blue won 90%.
    const b = block([[0, 0, 0], [300, 0.15, 0.1], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [100, 0.85, 0.8], [0, 0, 0]]);
    const bin = favouriteBin(b, 0.85)!;
    expect(bin.n).toBe(400);
    expect(bin.said).toBeCloseTo(0.85, 6);
    expect(bin.won).toBeCloseTo((100 * 0.8 + 300 * 0.9) / 400, 6);
  });
  it("a blue favourite at pRed 0.2 reads the 80% favourite bin, not the 20% red bin", () => {
    const b = block([[0, 0, 0], [200, 0.2, 0.25], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const bin = favouriteBin(b, 1 - 0.2)!;
    expect(bin.said).toBeCloseTo(0.8, 6);
    expect(bin.won).toBeCloseTo(0.75, 6);
  });
});
