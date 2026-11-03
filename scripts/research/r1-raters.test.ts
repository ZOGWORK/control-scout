import { describe, expect, it } from "vitest";
import type { AllianceResult, MatchRecord } from "@control-scout/predict-engine";
import { Glicko2, Massey, TrueSkill, cdf, targets } from "./r1-raters.js";

const side = (teams: number[], auto: number, teleop: number, endgame: number, pen: number, oppPen: number): AllianceResult => ({
  teams, auto, teleop, endgame, np: auto + teleop + endgame, penCommitted: pen, total: auto + teleop + endgame + oppPen,
});
let clock = Date.UTC(2025, 0, 1);
function match(red: number[], blue: number[], r: [number, number, number, number], b: [number, number, number, number]): MatchRecord {
  clock += 864e5;
  return { season: 2025, eventCode: "T", level: "qual", series: 0, number: 1, time: clock, red: side(red, r[0], r[1], r[2], r[3], b[3]), blue: side(blue, b[0], b[1], b[2], b[3], r[3]) };
}

describe("r1 raters", () => {
  it("phase targets add up to the total margin", () => {
    const m = match([1, 2], [3, 4], [20, 50, 10, 5], [15, 40, 20, 10]);
    const [total, ...phases] = targets(m.red, m.blue);
    expect(total).toBe(m.red.total - m.blue.total);
    expect(phases.reduce((s, x) => s + x, 0)).toBe(total);
  });

  it("Massey recovers ridge least squares on margins", () => {
    // Robots 1..4 with true strengths 30, 10, -10, -30 (margins exact), round-robin pairings.
    const truth: Record<number, number> = { 1: 30, 2: 10, 3: -10, 4: -30 };
    const pairs: [number[], number[]][] = [[[1, 2], [3, 4]], [[1, 3], [2, 4]], [[1, 4], [2, 3]]];
    const R = new Massey({ lambda: 1e-6, rho: 0 });
    R.startSeason();
    for (let k = 0; k < 20; k++) for (const [a, b] of pairs) {
      const d = truth[a[0]] + truth[a[1]] - truth[b[0]] - truth[b[1]];
      R.update(match(a, b, [0, 100 + d, 0, 0], [0, 100, 0, 0]));
    }
    R.setTime(clock + 864e5);
    const call = R.predict(match([1, 2], [3, 4], [0, 0, 0, 0], [0, 0, 0, 0]));
    expect(call.margin).toBeCloseTo(80, 3);
    expect(call.nativeMargin).toBe(true);
  });

  it("TrueSkill and Glicko-2 move ratings toward the winner and stay colour-symmetric", () => {
    for (const R of [new TrueSkill({ sigma0: 1, beta: 1, tau: 0.03, rho: 0.6, drawRate: 0.01 }), new Glicko2({ phi0: 1, sigma0: 0.06, tau: 0.5, rho: 0.6 })]) {
      R.startSeason();
      expect(R.predict(match([1, 2], [3, 4], [0, 0, 0, 0], [0, 0, 0, 0])).z).toBe(0);
      R.update(match([1, 2], [3, 4], [10, 10, 10, 0], [0, 0, 0, 0]));
      const a = R.predict(match([1, 2], [3, 4], [0, 0, 0, 0], [0, 0, 0, 0])), b = R.predict(match([3, 4], [1, 2], [0, 0, 0, 0], [0, 0, 0, 0]));
      expect(a.z).toBeGreaterThan(0);
      expect(b.z).toBeCloseTo(-a.z, 12);
    }
  });

  it("normal CDF is accurate", () => {
    expect(cdf(0)).toBeCloseTo(0.5, 7);
    expect(cdf(1.96)).toBeCloseTo(0.975, 4);
  });
});
