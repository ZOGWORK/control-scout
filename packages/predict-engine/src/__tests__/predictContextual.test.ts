/**
 * Engine 2.0: the contextual win probability, the reliability state it
 * reads, and the symmetric population baseline.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { RatingBook, initialReliability, updateReliability, allianceResidual, type RatingBookData } from "../rating";
import { predictMatch } from "../matchModel";
import { contextualFeatures, contextualProbability, type ContextualModel } from "../contextual";
import { explainMatch } from "../explain";
import { FITTED_MODEL } from "../model";
import type { MatchRecord } from "../types";

const M = FITTED_MODEL;
const C = M.contextual as ContextualModel;          // engine 2.1 (22 inputs)
const C20 = C.fallback as ContextualModel;            // engine 2.0 (17 inputs), the fallback
const al = (teams: number[], np: number) => ({ teams, auto: np * 0.2, teleop: np * 0.7, endgame: np * 0.1, np, penCommitted: 0, total: np });
const match = (red: [number[], number], blue: [number[], number], n = 1, level: "qual" | "playoff" = "qual"): MatchRecord => ({
  season: 2025, eventCode: "E", level, series: 0, number: n, time: Date.UTC(2025, 10, 1) + n * 60_000,
  red: al(red[0], red[1]), blue: al(blue[0], blue[1]),
});
const opts = (level: "qual" | "playoff" = "qual") => ({ contextual: C, context: { level } });

/** A short season: four teams of different strength, some partner swaps. */
function played(params = M.rating) {
  const b = new RatingBook(params);
  b.startSeason(2025);
  const lineups: [number[], number, number[], number][] = [
    [[1, 2], 140, [3, 4], 70], [[1, 3], 120, [2, 4], 90], [[1, 4], 130, [2, 3], 60],
    [[1, 2], 20, [3, 4], 80], [[2, 3], 85, [1, 4], 110], [[5, 1], 150, [6, 2], 75],
  ];
  lineups.forEach(([r, rs, bl, bs], i) => b.update(match([r, rs], [bl, bs], i + 1)));
  return b;
}

describe("contextual probability: frozen-model parity", () => {
  // Golden cases from the validation package: the research reference and this
  // implementation must agree to floating-point precision.
  const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "contextual-parity.json"), "utf8")) as { cases: { x: number[]; r: number[]; p: number }[] };
  it("reproduces every golden case", () => {
    expect(fx.cases.length).toBeGreaterThanOrEqual(50);
    for (const { x, r, p } of fx.cases) {
      const L = x[0];
      // Research layout: x = 17 raw inputs, r = 5 reliability summaries.
      const d = [x[1], x[3], x[4], x[5], x[6], x[7], x[8], L * x[11], L / (1 + x[12] / 5), (L * Math.log1p(x[13])) / 5, (L * x[14]) / 4, L * (x[10] - 5), r[0], r[1], r[2], L * r[3], L * r[4]];
      expect(Math.abs(contextualProbability(C20, L, d) - p)).toBeLessThan(1e-12);
    }
  });

  it("reproduces every 2.1 golden case (the evaluated round-2 model)", () => {
    const fx21 = JSON.parse(readFileSync(join(__dirname, "fixtures", "contextual-2.1-parity.json"), "utf8")) as { cases: { L: number; d: number[]; p: number }[] };
    expect(fx21.cases.length).toBe(60);
    for (const { L, d, p } of fx21.cases) expect(Math.abs(contextualProbability(C, L, d) - p)).toBeLessThan(1e-12);
  });

  it("ships the full-precision frozen parameters (2.1, with the 2.0 model as its fallback)", () => {
    expect(C.coefficients).toHaveLength(22);
    expect(C.scale).toHaveLength(22);
    expect(C20.coefficients).toHaveLength(17);
    expect(C20.coefficients[2]).toBe(-0.2752969871497752);
    expect(C20.scale[14]).toBe(0.05);
    expect(C20.calibration).toEqual({ slope: 0.9414911747184092, intercept: 0.004591262950340726 });
  });

  it("is red/blue symmetric apart from the fitted calibration intercept", () => {
    const b = played();
    const sym = { ...C, calibration: { slope: C.calibration.slope, intercept: 0 } };
    for (const level of ["qual", "playoff"] as const) {
      const a = predictMatch(b, [1, 3], [2, 4], M.noise, M.calibration, { contextual: sym, context: { level } });
      const s = predictMatch(b, [2, 4], [1, 3], M.noise, M.calibration, { contextual: sym, context: { level } });
      expect(a.pRedWin + s.pRedWin).toBeCloseTo(1, 12);
    }
  });

  it("stays finite and strictly inside (0, 1) for extreme inputs", () => {
    for (const L of [-20, 0, 20]) {
      const p = contextualProbability(C, L, [L, 0, 0, 0, 0, 0, 0, 0, L, L, L, L * 3, 0, 0, 0, L * Math.log(25), L, 4, L * 3, 4, 1, 0]);
      expect(Number.isFinite(p) && p > 0 && p < 1).toBe(true);
    }
    expect(() => contextualProbability(C, 0, [1, 2])).toThrow();
  });
});

describe("predictMatch with the contextual model", () => {
  it("changes only the win probability: means, sds and raw probability are the score model's", () => {
    const b = played();
    const legacy = predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration);
    const ctx = predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration, opts());
    expect(ctx.red).toEqual(legacy.red);
    expect(ctx.blue).toEqual(legacy.blue);
    expect(ctx.pRaw).toBe(legacy.pRaw);
    expect(legacy.model).toBe("legacy");
    expect(ctx.model).toBe("contextual");
    expect(ctx.pRedWin).not.toBe(legacy.pRedWin);
  });

  it("corrects the raw Gaussian probability, not the Platt-calibrated one", () => {
    const b = played();
    const p = predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration, opts());
    const x = contextualFeatures(b, [1, 2], [3, 4], { ...p, pRedWin: p.pRaw! }, { level: "qual" }, C.coefficients.length)!;
    expect(p.pRedWin).toBe(contextualProbability(C, Math.log(p.pRaw! / (1 - p.pRaw!)), x));
  });

  it("uses the match level (playoff interaction)", () => {
    const b = played();
    const q = predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration, opts("qual"));
    const pl = predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration, opts("playoff"));
    expect(pl.pRedWin).not.toBe(q.pRedWin);
    // No context = the documented what-if default: a qualification match.
    expect(predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration, { contextual: C }).pRedWin).toBe(q.pRedWin);
  });

  it("falls back to the legacy probability for an empty alliance", () => {
    const b = played();
    const p = predictMatch(b, [], [3, 4], M.noise, M.calibration, opts());
    expect(p.model).toBe("legacy");
  });

  it("explainMatch reports which model produced the odds", () => {
    const b = played();
    expect(explainMatch(b, [1, 2], [3, 4], { noise: M.noise, calibration: M.calibration, contextual: C }).probabilityModel).toBe("contextual");
    expect(explainMatch(b, [1, 2], [3, 4], { noise: M.noise, calibration: M.calibration }).probabilityModel).toBe("legacy");
  });
});

describe("reliability state", () => {
  it("starts neutral, without shared mutable state", () => {
    const a = initialReliability(), b = initialReliability();
    a.bias = 5;
    expect(b).toEqual({ bias: 0, variance: 1, failure: 0.05, fast: 0, lastFail: 0, sinceFail: 10, eventSum: 0, eventN: 0 });
  });

  it("follows the documented EMA and clips extreme residuals", () => {
    const r = updateReliability(initialReliability(), -1, true);
    expect(r.bias).toBeCloseTo(-0.2, 15);
    expect(r.variance).toBeCloseTo(1, 15);
    expect(r.failure).toBeCloseTo(0.145, 12);
    const big = updateReliability(initialReliability(), 100, false);
    expect(big.bias).toBeCloseTo(0.8, 15);   // z clipped to 4
    expect(big.variance).toBeCloseTo(3.4, 15); // z² clipped to 25
  });

  it("standardizes against the expectation and flags a collapse", () => {
    const { z, failed } = allianceResidual({ np: 100, uncertainty: 0 }, 40);
    expect(z).toBeCloseTo(-60 / 34, 12);
    expect(failed).toBe(true);
    expect(allianceResidual({ np: 30, uncertainty: 0 }, 5).failed).toBe(false); // expectation under 40
  });

  it("is learned only after the prediction: predicting never changes it", () => {
    const b = played();
    const before = b.reliabilityOf(1);
    predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration, opts());
    expect(b.reliabilityOf(1)).toEqual(before);
    // The next result moves it, from the expectation held before that result.
    const next = match([[1, 2], 10], [[3, 4], 90], 99);
    b.setTime(next.time); // the expectation at the result's time (growth included)
    const exp = b.allianceExpectation([1, 2]);
    b.update(next);
    const { z, failed } = allianceResidual(exp, 10);
    expect(b.reliabilityOf(1)).toEqual(updateReliability(before, z, failed, "E"));
  });

  it("applies the alliance observation to every robot on it, and resets each season", () => {
    // Teams 5 and 6 played once (match 6), on opposite alliances.
    const b = played();
    expect(b.reliabilityOf(5)).not.toEqual(initialReliability());
    expect(b.reliabilityOf(6)).not.toEqual(initialReliability());
    expect(b.reliabilityOf(5)).not.toEqual(b.reliabilityOf(6));
    expect(b.reliabilityOf(7)).toEqual(initialReliability()); // never played
    b.startSeason(2026);
    expect(b.reliabilityOf(1)).toEqual(initialReliability());
    expect(b.reliabilityReady).toBe(true);
  });

  it("clone() copies it independently", () => {
    const b = played();
    const c = b.clone();
    c.update(match([[1, 2], 0], [[3, 4], 200], 50));
    expect(c.reliabilityOf(1)).not.toEqual(b.reliabilityOf(1));
    expect(c.reliabilityReady).toBe(true);
  });

  it("round-trips through toData/fromData (also for a team subset)", () => {
    const b = played();
    const back = RatingBook.fromData(JSON.parse(JSON.stringify(b.toData())));
    expect(back.reliabilityReady).toBe(true);
    for (const t of [1, 2, 3, 4, 5, 6]) expect(back.reliabilityOf(t)).toEqual(b.reliabilityOf(t));
    expect(predictMatch(back, [1, 2], [3, 4], M.noise, M.calibration, opts()).pRedWin).toBe(predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration, opts()).pRedWin);
    const part = b.toData(new Set([1]));
    expect(part.reliability!.map(([t]) => t)).toEqual([1]);
  });

  it("legacy (pre-2.0) data has no state: predictions use the legacy model instead of an invented history", () => {
    const b = played();
    const d = b.toData() as RatingBookData;
    delete d.reliability; delete d.stateVersion;
    const legacy = RatingBook.fromData(d);
    expect(legacy.reliabilityReady).toBe(false);
    const p = predictMatch(legacy, [1, 2], [3, 4], M.noise, M.calibration, opts());
    expect(p.model).toBe("legacy");
    expect(p.pRedWin).toBe(predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration).pRedWin);
    // ...and it never writes a partial state back out.
    expect(legacy.toData().reliability).toBeUndefined();
    expect(legacy.clone().reliabilityReady).toBe(false);
    // An unknown future layout is treated the same way.
    expect(RatingBook.fromData({ ...b.toData(), stateVersion: 99 }).reliabilityReady).toBe(false);
  });
});

describe("population baseline (symmetric, 2.0)", () => {
  const total = (v: { auto: number; teleop: number; endgame: number }) => v.auto + v.teleop + v.endgame;

  it("swapping the alliances of the season's first match leaves the baseline and the next newcomer's prior unchanged", () => {
    const a = new RatingBook(M.rating), b = new RatingBook(M.rating);
    a.startSeason(2025); b.startSeason(2025);
    const m = match([[1, 2], 200], [[3, 4], 60]);
    a.update(m);
    b.update({ ...m, red: m.blue, blue: m.red });
    expect(a.baseline()).toEqual(b.baseline());
    expect(a.get(10)).toEqual(b.get(10));
    // Seeded with the mean of both alliances: (200 + 60) / 4 robots.
    expect(total(a.baseline()!)).toBeCloseTo(65, 10);
  });

  it("stays order-independent on later matches too", () => {
    const a = new RatingBook(M.rating), b = new RatingBook(M.rating);
    a.startSeason(2025); b.startSeason(2025);
    for (let n = 1; n <= 5; n++) {
      const m = match([[1, 2], 80 + n * 9], [[3, 4], 50 + n * 3], n);
      a.update(m);
      b.update({ ...m, red: m.blue, blue: m.red });
    }
    const ba = a.baseline()!, bb = b.baseline()!;
    for (const c of ["auto", "teleop", "endgame", "pen"] as const) expect(ba[c]).toBeCloseTo(bb[c], 12);
  });

  it("the 1.1.0 sequential update is still available for exact replays (and is order-dependent)", () => {
    const P = { ...M.rating, populationUpdate: "sequential" as const };
    const a = new RatingBook(P), b = new RatingBook(P);
    a.startSeason(2025); b.startSeason(2025);
    const m = match([[1, 2], 200], [[3, 4], 60]);
    a.update(m);
    b.update({ ...m, red: m.blue, blue: m.red });
    expect(Math.abs(total(a.baseline()!) - total(b.baseline()!))).toBeGreaterThan(60);
  });
});

describe("engine 2.1 form state", () => {
  it("in-event form sums this event's residuals and starts over at a new event", () => {
    const b = played();
    const r = b.reliabilityOf(1);
    expect(r.eventCode).toBe("E");
    expect(r.eventN).toBe(6); // team 1 played all six matches at event E
    b.update({ ...match([[1, 3], 90], [[2, 4], 90], 20), eventCode: "F" });
    expect(b.reliabilityOf(1).eventCode).toBe("F");
    expect(b.reliabilityOf(1).eventN).toBe(1);
  });

  it("collapse recency: last-match flag and matches since", () => {
    const b = played();
    b.update(match([[1, 2], 5], [[3, 4], 90], 30)); // red collapses
    expect(b.reliabilityOf(1).lastFail).toBe(1);
    expect(b.reliabilityOf(1).sinceFail).toBe(0);
    b.update(match([[1, 2], 140], [[3, 4], 90], 31));
    expect(b.reliabilityOf(1).lastFail).toBe(0);
    expect(b.reliabilityOf(1).sinceFail).toBe(1);
  });

  it("in-event form only counts at the predicted match's event (none for a generic what-if)", () => {
    const b = played();
    const raw = predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration);
    const at = contextualFeatures(b, [1, 2], [3, 4], { ...raw, pRedWin: raw.pRaw! }, { level: "qual", event: "E" }, 22)!;
    const none = contextualFeatures(b, [1, 2], [3, 4], { ...raw, pRedWin: raw.pRaw! }, { level: "qual" }, 22)!;
    expect(at[17]).not.toBe(0);
    expect(none[17]).toBe(0);
    expect(none[18]).toBe(0);
    expect(at.slice(0, 17)).toEqual(none.slice(0, 17));
  });

  it("a book with engine 2.0 state (version 1) predicts with the 2.0 model, not the legacy one", () => {
    const b = played();
    const d = b.toData();
    const v1 = RatingBook.fromData({ ...d, stateVersion: 1, reliability: d.reliability!.map(([t, r]) => [t, { bias: r.bias, variance: r.variance, failure: r.failure }]) });
    expect(v1.stateVersion).toBe(1);
    const p = predictMatch(v1, [1, 2], [3, 4], M.noise, M.calibration, opts());
    expect(p.model).toBe("contextual");
    expect(p.modelId).toBe(C20.id);
    expect(predictMatch(b, [1, 2], [3, 4], M.noise, M.calibration, opts()).modelId).toBe(C.id);
    expect(v1.toData().stateVersion).toBe(1); // never claims the newer layout
  });
});
