import { describe, expect, it } from "vitest";
import type { AllianceResult, MatchRecord } from "@control-scout/predict-engine";
import { Glicko2, Massey, TrueSkill, cdf, glicko2Period, pdf, targets } from "./r1-raters.js";

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

  it("Massey's same-day shortcut stays close to a full least-squares solve", () => {
    // 8 robots, random strengths and partners, noisy margins. "fast" re-solves only when the day changes (as in the
    // replay); "full" re-solves before every prediction. Both see identical results.
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const strength = Array.from({ length: 8 }, () => 40 * (rnd() - 0.5));
    const fast = new Massey({ lambda: 4, rho: 0.7 }), full = new Massey({ lambda: 4, rho: 0.7 });
    fast.startSeason(); full.startSeason();
    const day0 = Date.UTC(2025, 0, 1);
    let worst = 0, sq = 0, k = 0;
    for (let i = 0; i < 60; i++) {
      const ids = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => rnd() - 0.5).slice(0, 4).map((x) => x + 1);
      const d = strength[ids[0] - 1] + strength[ids[1] - 1] - strength[ids[2] - 1] - strength[ids[3] - 1] + 30 * (rnd() - 0.5);
      const m = match(ids.slice(0, 2), ids.slice(2), [0, 100 + d, 0, 0], [0, 100, 0, 0]);
      fast.setTime(day0 + (i < 20 ? i : 20) * 864e5); full.setTime(day0 + i * 864e5);
      if (i >= 20) { const a = fast.predict(m).margin, b = full.predict(m).margin; worst = Math.max(worst, Math.abs(a - b)); sq += b * b; k++; }
      fast.update(m); full.update(m);
    }
    // 40 matches on one day: the shortcut's largest miss stays under 5% of the typical predicted margin (measured: 0.48 of 17.5 points).
    expect(worst).toBeLessThan(0.05 * Math.sqrt(sq / k));
  });

  it("TrueSkill's update is exact moment matching on the performance difference (win and unequal draw)", () => {
    // Independent check: numerically integrate the truncated Gaussian of d = perf(red) − perf(blue) ~ N(Δ, c²).
    const moments = (mean: number, sd: number, inside: (x: number) => boolean) => {
      let w = 0, m1 = 0, m2 = 0;
      for (let x = mean - 12 * sd; x <= mean + 12 * sd; x += sd / 2000) { if (!inside(x)) continue; const p = pdf((x - mean) / sd); w += p; m1 += p * x; m2 += p * x * x; }
      return { mean: m1 / w, var: m2 / w - (m1 / w) ** 2 };
    };
    const p = { sigma0: 1, beta: 0.8, tau: 0, rho: 0.6, drawRate: 0.2 };
    for (const drawn of [false, true]) {
      const R = new TrueSkill(p) as any;
      R.startSeason();
      R.teams.set(1, { mu: 0.9, s2: 0.5 }); R.teams.set(2, { mu: 0.4, s2: 1 }); R.teams.set(3, { mu: -0.2, s2: 0.3 }); R.teams.set(4, { mu: 0.1, s2: 0.8 });
      const delta = 0.9 + 0.4 + 0.2 - 0.1, c2 = 0.5 + 1 + 0.3 + 0.8 + 4 * 0.64, c = Math.sqrt(c2), eps = R.eps as number;
      R.update(match([1, 2], [3, 4], drawn ? [10, 0, 0, 0] : [10, 0, 0, 0], drawn ? [10, 0, 0, 0] : [0, 0, 0, 0]));
      const t = moments(delta, c, drawn ? (x) => Math.abs(x) <= eps : (x) => x > eps);
      for (const [id, mu, s2, sign] of [[1, 0.9, 0.5, 1], [3, -0.2, 0.3, -1]] as const) {
        expect(R.teams.get(id).mu).toBeCloseTo(mu + sign * (s2 / c2) * (t.mean - delta), 4);
        expect(R.teams.get(id).s2).toBeCloseTo(s2 - (s2 * s2 / (c2 * c2)) * (c2 - t.var), 4);
      }
      // An unequal draw moves the favourite down and the underdog up.
      if (drawn) { expect(R.teams.get(1).mu).toBeLessThan(0.9); expect(R.teams.get(3).mu).toBeGreaterThan(-0.2); }
    }
  });

  it("TrueSkill reproduces the published 1-vs-1 example (robots with σ = 0 as partners)", () => {
    // trueskill.org: rate_1vs1(Rating(25, 25/3), Rating(25, 25/3)) → 29.396 / 7.171 and 20.604 / 7.171 (β 25/6, τ 25/300, draws 10%).
    // In the 2-vs-2 form a zero-σ partner adds nothing, and β/√2 per robot gives the 1-vs-1 noise 2β².
    const tau = 25 / 300, R = new TrueSkill({ sigma0: 25 / 3, beta: 25 / 6 / Math.SQRT2, tau, rho: 1, drawRate: 0.1 }) as any;
    R.startSeason();
    R.teams.set(2, { mu: 0, s2: -tau * tau }); R.teams.set(4, { mu: 0, s2: -tau * tau });
    R.update(match([1, 2], [3, 4], [10, 0, 0, 0], [0, 0, 0, 0]));
    expect(25 + R.teams.get(1).mu).toBeCloseTo(29.396, 2);
    expect(Math.sqrt(R.teams.get(1).s2)).toBeCloseTo(7.171, 2);
    expect(25 + R.teams.get(3).mu).toBeCloseTo(20.604, 2);
  });

  it("Glicko-2 reproduces Glickman's worked example", () => {
    // Glickman (2012): 1500/200/0.06 beats 1400/30, loses to 1550/100 and 1700/300, τ 0.5 → 1464.06 / 151.52 / 0.05999.
    const k = 173.7178, opp = (r: number, rd: number, s: number) => ({ mu: (r - 1500) / k, phi2: (rd / k) ** 2, s });
    const out = glicko2Period({ mu: 0, phi: 200 / k, sigma: 0.06 }, [opp(1400, 30, 1), opp(1550, 100, 0), opp(1700, 300, 0)], 0.5);
    expect(1500 + k * out.mu).toBeCloseTo(1464.06, 1);
    expect(k * out.phi).toBeCloseTo(151.52, 1);
    expect(out.sigma).toBeCloseTo(0.05999, 4);
  });

  it("season transitions carry ratings by ρ and widen uncertainty, capped at the start value", () => {
    const ts = new TrueSkill({ sigma0: 1, beta: 1, tau: 0.03, rho: 0.6, drawRate: 0.01 }) as any;
    ts.startSeason();
    ts.update(match([1, 2], [3, 4], [10, 0, 0, 0], [0, 0, 0, 0]));
    const a = { ...ts.teams.get(1) };
    ts.startSeason();
    expect(ts.teams.get(1).mu).toBeCloseTo(0.6 * a.mu, 12);
    expect(ts.teams.get(1).s2).toBeCloseTo(Math.min(1, a.s2 + 0.64), 12);
    const gl = new Glicko2({ phi0: 1, sigma0: 0.06, tau: 0.5, rho: 0.6 }) as any;
    gl.startSeason();
    gl.update(match([1, 2], [3, 4], [10, 0, 0, 0], [0, 0, 0, 0]));
    const b = { ...gl.teams.get(1) };
    gl.startSeason();
    expect(gl.teams.get(1).mu).toBeCloseTo(0.6 * b.mu, 12);
    expect(gl.teams.get(1).phi).toBeCloseTo(Math.min(1, Math.sqrt(b.phi ** 2 + 0.64)), 12);
  });

  it("normal CDF is accurate", () => {
    expect(cdf(0)).toBeCloseTo(0.5, 7);
    expect(cdf(1.96)).toBeCloseTo(0.975, 4);
  });
});
