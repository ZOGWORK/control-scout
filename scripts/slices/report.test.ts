import { describe, expect, it } from "vitest";
import { calibrationTable, LOW_CONFIDENCE_N, sliceReport, type ScoredRow } from "./report.js";
import { EventOrdinals, densityBand, experienceOf, leastExperienced, marginBand, probBand, quantile, qualBand, volatilityTag } from "./tags.js";

const row = (p: number, y: number, tags: Record<string, string> = {}): ScoredRow => ({ p, y, tags });

describe("sliceReport", () => {
  it("scores Brier, log loss and accuracy, with ties half-scored and out of accuracy", () => {
    const r = sliceReport([row(0.8, 1), row(0.8, 0), row(0.5, 0.5), row(0.3, 0)], []);
    expect(r.all.n).toBe(4);
    expect(r.all.decided).toBe(3);
    expect(r.all.accuracy).toBeCloseTo(2 / 3, 12);
    expect(r.all.brier).toBeCloseTo((0.04 + 0.64 + 0 + 0.09) / 4, 12);
    expect(r.all.logLoss).toBeCloseTo(-(Math.log(0.8) + Math.log(0.2) + Math.log(0.5) + Math.log(0.7)) / 4, 12);
  });

  it("excess Brier sums to zero across a dimension and shares add to one", () => {
    const rows = [row(0.9, 1, { d: "a" }), row(0.6, 0, { d: "a" }), row(0.7, 1, { d: "b" }), row(0.55, 0, { d: "c" })];
    const r = sliceReport(rows, ["d"]);
    const ms = Object.values(r.dims.d);
    expect(ms.reduce((s, m) => s + m.excessBrier, 0)).toBeCloseTo(0, 12);
    expect(ms.reduce((s, m) => s + m.shareBrier, 0)).toBeCloseTo(1, 12);
    expect(ms.reduce((s, m) => s + m.shareMatches, 0)).toBeCloseTo(1, 12);
  });

  it("marks small slices and keeps them out of the ranking, ranks one slice per dimension, skips 'not measured'", () => {
    const rows: ScoredRow[] = [];
    // Dimension x: "bad" is wrong a lot (big excess), "tiny" is worse still but under the floor.
    for (let i = 0; i < 300; i++) rows.push(row(0.7, i % 2, { x: "bad", y: "not measured", z: "worse" }));
    for (let i = 0; i < 50; i++) rows.push(row(0.95, 0, { x: "tiny", y: "rest", z: "worse" }));
    for (let i = 0; i < 400; i++) rows.push(row(0.9, 1, { x: "good", y: "rest", z: "fine" }));
    const r = sliceReport(rows, ["x", "y", "z"]);
    expect(r.dims.x.tiny.lowConfidence).toBe(true);
    expect(r.dims.x.bad.lowConfidence).toBe(false);
    expect(LOW_CONFIDENCE_N).toBe(200);
    expect(r.top.map((t) => `${t.dim}:${t.value}`)).toEqual(["z:worse", "x:bad"]);
  });

  it("surprise is ~0 for calibrated probabilities and positive for overconfident ones", () => {
    const calibrated: ScoredRow[] = [], overconfident: ScoredRow[] = [];
    for (let i = 0; i < 1000; i++) {
      calibrated.push(row(0.7, i % 10 < 7 ? 1 : 0));
      overconfident.push(row(0.95, i % 10 < 7 ? 1 : 0));
    }
    expect(Math.abs(sliceReport(calibrated, []).all.surprise)).toBeLessThan(1e-12);
    expect(sliceReport(overconfident, []).all.surprise).toBeGreaterThan(0.1);
    expect(sliceReport(overconfident, []).all.calGap).toBeCloseTo(0.7 - 0.95, 12);
  });

  it("leaves ties out of surprise", () => {
    const calibrated: ScoredRow[] = [];
    for (let i = 0; i < 1000; i++) calibrated.push(row(0.7, i % 10 < 7 ? 1 : 0));
    const withTies = [...calibrated, ...Array.from({ length: 300 }, () => row(0.7, 0.5))];
    expect(Math.abs(sliceReport(withTies, []).all.surprise)).toBeLessThan(1e-12);
  });
});

describe("calibrationTable", () => {
  it("folds both sides onto the favourite and bands by its stated chance", () => {
    const t = calibrationTable([row(0.65, 1), row(0.35, 0), row(0.35, 1), row(0.95, 1), row(0.05, 0.5)]);
    const b60 = t.find((b) => b.band === "60-70")!;
    expect(b60.n).toBe(3);
    expect(b60.stated).toBeCloseTo(0.65, 12);
    expect(b60.empirical).toBeCloseTo(2 / 3, 12);
    const b90 = t.find((b) => b.band === "90-100")!;
    expect(b90.n).toBe(2);
    expect(b90.empirical).toBeCloseTo(0.75, 12); // one win, one tie
    expect(b90.midpointError).toBeCloseTo(0.2, 12);
  });
});

describe("tags", () => {
  it("bands", () => {
    expect([qualBand("qual", 10), qualBand("qual", 11), qualBand("qual", 26), qualBand("playoff", 1)]).toEqual(["q1-10", "q11-25", "q26+", "playoff"]);
    expect([densityBand(23), densityBand(24), densityBand(63), densityBand(64)]).toEqual(["thin", "normal", "normal", "dense"]);
    expect([probBand(0.5), probBand(0.35), probBand(0.9), probBand(0.05)]).toEqual(["50-60", "60-70", "90-100", "90-100"]);
    expect([marginBand(100, 100, 30, 40), marginBand(120, 100, 30, 40), marginBand(150, 100, 30, 40)]).toEqual(["close", "clear", "lopsided"]);
  });

  it("experience: rookie year against the season, least experienced robot wins", () => {
    expect([experienceOf(2025, 2025), experienceOf(2024, 2025), experienceOf(2010, 2025), experienceOf(null, 2025)]).toEqual(["rookie", "year2", "veteran", "unknown"]);
    expect(leastExperienced(["veteran", "year2", "unknown"])).toBe("year2");
    expect(leastExperienced(["veteran", "unknown"])).toBe("unknown");
    expect(leastExperienced(["veteran", "rookie"])).toBe("rookie");
  });

  it("event ordinals count each robot's events in the order first seen", () => {
    const o = new EventOrdinals();
    expect(o.ordinal(1, "A")).toBe(1);
    expect(o.ordinal(1, "A")).toBe(1);
    expect(o.ordinal(1, "B")).toBe(2);
    expect(o.ordinal(2, "B")).toBe(1);
    o.reset();
    expect(o.ordinal(1, "C")).toBe(1);
  });

  it("volatility cut and quantile", () => {
    expect(quantile([4, 1, 3, 2, NaN], 0.75)).toBeCloseTo(3.25, 12);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
    expect([volatilityTag(null, 2), volatilityTag(2, 2), volatilityTag(1.9, 2)]).toEqual(["not measured", "top quartile", "rest"]);
  });
});
