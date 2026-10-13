import { describe, expect, it } from "vitest";
import { CERTAINTY, carryZ, fmtZ, gain, heroFoot, histStats, learnSeries, platt, range80, ratingUpdate, rng, sigma, toyEvent, toyField, winProb } from "./math";

describe("gain", () => {
  it("starts at the fitted first-match gain and falls to the floor", () => {
    expect(gain(0)).toBeCloseTo(0.65, 10);
    expect(gain(3)).toBeCloseTo(0.65 / 1.3, 10);
    expect(gain(10)).toBeCloseTo(0.33, 10); // 0.325 is under the floor
    expect(gain(30)).toBe(0.33);
  });
  it("never rises with more matches", () => {
    for (let n = 0; n < 40; n++) expect(gain(n + 1)).toBeLessThanOrEqual(gain(n));
  });
});

describe("worked rating update", () => {
  it("matches the page's example: expected 145, scored 165, a 3rd match (2 played before)", () => {
    const u = ratingUpdate(145, 165, 2);
    expect(u.miss).toBe(20);
    expect(u.share).toBe(10);
    expect(u.gain).toBeCloseTo(0.65 / 1.2, 3);
    expect(u.move).toBeCloseTo(5.4, 1);
  });
});

describe("match model", () => {
  it("score spread grows with the expected score and with uncertainty", () => {
    expect(sigma(0, 0)).toBeCloseTo(14, 10);
    expect(sigma(100, 0)).toBeCloseTo(34, 10);
    expect(sigma(100, 400)).toBeCloseTo(Math.hypot(34, 20), 10);
  });
  it("Platt scaling pulls probabilities toward 50% and keeps their order", () => {
    expect(platt(0.9)).toBeLessThan(0.9);
    expect(platt(0.1)).toBeGreaterThan(0.1);
    expect(platt(0.7)).toBeGreaterThan(platt(0.6));
    // a = 0.937, b = 0.020: a raw 50% nudges just above 50%.
    expect(platt(0.5)).toBeCloseTo(1 / (1 + Math.exp(-0.0198)), 3);
  });
  it("gives the hero example (145 vs 120, well known) about 66%", () => {
    const p = winProb(145, 120, 2 * CERTAINTY.well);
    expect(Math.round(p * 100)).toBe(66);
  });
  it("is symmetric and never certain", () => {
    const p = winProb(200, 100, 20, false);
    expect(winProb(100, 200, 20, false)).toBeCloseTo(1 - p, 6);
    expect(winProb(300, 20, 20)).toBeLessThan(1);
  });
  it("more uncertainty means a less confident call", () => {
    expect(winProb(145, 120, 2 * CERTAINTY.pre)).toBeLessThan(winProb(145, 120, 2 * CERTAINTY.well));
  });
  it("80% range is clamped at zero", () => {
    expect(range80(10, 40)[0]).toBe(0);
    const [lo, hi] = range80(145, 43);
    expect(hi - 145).toBe(145 - lo);
  });
});

describe("carry-over", () => {
  it("weights last season 0.6 and the one before 0.2", () => {
    expect(carryZ(1.5, 1)).toBeCloseTo(1.1, 10);
    expect(carryZ(0, 0)).toBe(0);
  });
  it("formats z with a real minus sign", () => {
    expect(fmtZ(-0.7)).toBe("−0.70");
    expect(fmtZ(1.1)).toBe("+1.10");
    expect(fmtZ(-0.001)).toBe("+0.00");
  });
});

describe("toy simulations", () => {
  it("rating learning converges toward the real strength", () => {
    const s = learnSeries(85, 55, new Array(20).fill(0), gain);
    expect(s).toHaveLength(21);
    expect(Math.abs(s[20] - 85)).toBeLessThan(0.1);
  });
  it("qualifier ranks are valid and a top robot usually seeds high", () => {
    const rand = rng(7), field = toyField();
    const counts = new Array(24).fill(0);
    for (let i = 0; i < 300; i++) {
      const r = toyEvent(105, field, rand);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(24);
      counts[r - 1]++;
    }
    const st = histStats(counts);
    expect(st.runs).toBe(300);
    expect(st.top4!).toBeGreaterThan(0.25);
    const mid = new Array(24).fill(0);
    for (let i = 0; i < 300; i++) mid[toyEvent(52, field, rand) - 1]++;
    expect(histStats(mid).top4!).toBeLessThan(st.top4!);
    expect(st.median!).toBeLessThanOrEqual(7);
  });
  it("histogram stats are empty before any run", () => {
    expect(histStats(new Array(24).fill(0))).toEqual({ runs: 0, top4: null, median: null });
  });
  it("hero footnote reads the odds", () => {
    expect(heroFoot(0.66)).toMatch(/one match in 3/);
    expect(heroFoot(0.5)).toMatch(/coin flip/);
    expect(heroFoot(0.9)).toMatch(/Even a 90%/);
  });
});
