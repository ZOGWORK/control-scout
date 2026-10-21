import { describe, it, expect } from "vitest";
import { RatingBook } from "../rating";
import { explainMatch } from "../explain";
import { predictMatch } from "../matchModel";
import { FITTED_MODEL } from "../model";
import { rng } from "../sim";
import { BONUS_CONFIDENCE_RULE, BONUS_MIN_SAMPLES, BONUS_WINDOW, allianceBonusOdds, bonusModelBefore, recentBonusModel, bonusProbability, bonusSamples, fitBonusModel, seasonBonusModel, winRankingPoints, type BonusSample } from "../bonus";
import { rankingPoints } from "../rules";
import type { MatchRecord } from "../types";

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const B2025 = FITTED_MODEL.bonus["2025"];

/** Monte Carlo of exactly what the event simulator does for one alliance: draw a score, floor at 0, flip the bonus. */
function simulated(coef: [number, number], mean: number, sd: number, runs = 400_000): number {
  const r = rng(7);
  let hit = 0;
  for (let i = 0; i < runs; i++) {
    let u = 0; while (u === 0) u = r();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
    if (r() < logistic(coef[0] + coef[1] * Math.max(0, mean + z * sd))) hit++;
  }
  return hit / runs;
}

describe("bonusProbability", () => {
  it("is the simulator's bonus draw, integrated exactly", () => {
    for (const [mean, sd] of [[120, 45], [60, 30], [180, 50], [5, 20]] as const) {
      for (const slot of ["movement", "goal", "pattern"] as const) {
        expect(bonusProbability(B2025[slot], mean, sd)).toBeCloseTo(simulated(B2025[slot], mean, sd), 2);
      }
    }
  });

  it("with no spread is the logistic of the (floored) mean", () => {
    expect(bonusProbability([-2, 0.03], 100, 0)).toBeCloseTo(logistic(1), 12);
    expect(bonusProbability([-2, 0.03], -50, 0)).toBeCloseTo(logistic(-2), 12);
  });

  it("rises with the expected score", () => {
    const ps = [40, 80, 120, 160, 200].map((m) => bonusProbability(B2025.goal, m, 40));
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1]);
  });
});

describe("expected ranking points", () => {
  it("counts win RPs per the season's rules", () => {
    expect(winRankingPoints(2025).win).toBe(rankingPoints(2025, { total: 2 }, { total: 1 }));
    expect(winRankingPoints(2025).tie).toBe(rankingPoints(2025, { total: 1 }, { total: 1 }));
    expect(winRankingPoints(2024).win).toBe(rankingPoints(2024, { total: 2 }, { total: 1 }));
  });

  it("is 3 × P(win) + the expected bonus RPs, and nothing before 2025", () => {
    const o = allianceBonusOdds(2025, B2025, { mean: 130, sd: 45 }, 0.6)!;
    expect(o.expectedBonus).toBeCloseTo(o.p.movement + o.p.goal + o.p.pattern, 12);
    expect(o.expectedRp).toBeCloseTo(1.8 + o.expectedBonus, 12);
    expect(allianceBonusOdds(2024, B2025, { mean: 130, sd: 45 }, 0.6)).toBeNull();
  });
});

describe("fitBonusModel", () => {
  const synth = (n: number, truth: Record<"movement" | "goal" | "pattern", [number, number]>, seed = 3): BonusSample[] => {
    const r = rng(seed);
    return Array.from({ length: n }, () => {
      const np = 20 + r() * 200;
      return { np, bonus: { movement: r() < logistic(truth.movement[0] + truth.movement[1] * np), goal: r() < logistic(truth.goal[0] + truth.goal[1] * np), pattern: r() < logistic(truth.pattern[0] + truth.pattern[1] * np) } };
    });
  };

  it("recovers the coefficients it was generated from", () => {
    const truth = { movement: [-1.5, 0.03] as [number, number], goal: [-6, 0.05] as [number, number], pattern: [-3, 0.02] as [number, number] };
    const m = fitBonusModel(synth(20_000, truth))!;
    for (const s of ["movement", "goal", "pattern"] as const) {
      expect(m[s][0]).toBeCloseTo(truth[s][0], 0);
      expect(m[s][1]).toBeCloseTo(truth[s][1], 2);
    }
  });

  it("stays finite when every alliance (or none) earns a bonus", () => {
    const xs = Array.from({ length: 300 }, (_, i) => ({ np: 50 + i, bonus: { movement: true, goal: false, pattern: i % 2 === 0 } }));
    const m = fitBonusModel(xs)!;
    for (const s of ["movement", "goal", "pattern"] as const) { expect(Number.isFinite(m[s][0])).toBe(true); expect(Number.isFinite(m[s][1])).toBe(true); }
    const p = bonusProbability(m.movement, 120, 40);
    expect(p).toBeGreaterThan(0.98); expect(p).toBeLessThan(1);
    expect(bonusProbability(m.goal, 120, 40)).toBeLessThan(0.02);
  });

  it("needs BONUS_MIN_SAMPLES alliances", () => {
    const xs = synth(BONUS_MIN_SAMPLES - 1, { movement: [0, 0.01], goal: [0, 0.01], pattern: [0, 0.01] });
    expect(fitBonusModel(xs)).toBeNull();
    expect(fitBonusModel([...xs, xs[0]])).not.toBeNull();
  });

  it("fits the season's latest results, else the shipped fit, never before 2025", () => {
    const xs = synth(500, { movement: [0, 0.01], goal: [0, 0.01], pattern: [0, 0.01] });
    expect(seasonBonusModel(FITTED_MODEL.bonus, 2025, () => xs)).toMatchObject({ source: "season", samples: 500 });
    expect(seasonBonusModel(FITTED_MODEL.bonus, 2025, () => xs.slice(0, 10))).toEqual({ model: B2025, source: "fitted", samples: null });
    expect(seasonBonusModel(FITTED_MODEL.bonus, 2026, () => xs)).toMatchObject({ source: "season", samples: 500 });
    expect(seasonBonusModel(FITTED_MODEL.bonus, 2026, () => xs.slice(0, 10))).toBeNull();
    expect(seasonBonusModel(FITTED_MODEL.bonus, 2024, () => xs)).toBeNull();
  });

  it("bonusModelBefore ignores results from the moment on, and never falls back to the shipped fit", () => {
    const f = (b: boolean) => ({ movement: b, goal: !b, pattern: b });
    const m = (time: number, np: number, b: boolean) => ({ time, level: "qual", red: { np, bonusRp: f(b) }, blue: { np: np + 10, bonusRp: f(!b) } });
    const early = Array.from({ length: 150 }, (_, i) => m(1000 + i, 50 + i, i % 3 === 0));
    const late = Array.from({ length: 300 }, (_, i) => m(5000 + i, 200 + i, true));
    const before = bonusModelBefore([...late, ...early], 3000)!;
    expect(before.samples).toBe(300);
    expect(before.model).toEqual(recentBonusModel(bonusSamples(early))!.model);
    expect(bonusModelBefore([...early, ...late], 1050)).toBeNull(); // 50 matches = 100 alliances: too few, and no shipped fit
  });

  it("learns from the latest BONUS_WINDOW alliances only", () => {
    const old = synth(5000, { movement: [-3, 0.01], goal: [-3, 0.01], pattern: [-3, 0.01] }, 5);
    const now = synth(BONUS_WINDOW, { movement: [1, 0.01], goal: [1, 0.01], pattern: [1, 0.01] }, 6);
    const m = recentBonusModel([...old, ...now])!;
    expect(m.samples).toBe(BONUS_WINDOW);
    expect(m.model).toEqual(fitBonusModel(now));
  });

  it("takes samples from qualification alliances with recorded bonus RPs only", () => {
    const f = { movement: true, goal: false, pattern: false };
    const xs = bonusSamples([
      { level: "qual", red: { np: 10, bonusRp: f }, blue: { np: 20 } },
      { level: "playoff", red: { np: 30, bonusRp: f }, blue: { np: 40, bonusRp: f } },
    ]);
    expect(xs).toEqual([{ np: 10, bonus: f }]);
  });
});

describe("explainMatch bonus odds", () => {
  const book = new RatingBook(FITTED_MODEL.rating);
  book.startSeason(2025);
  for (let i = 0; i < 10; i++) {
    for (const [r, b] of [[[1, 2], [3, 4]], [[1, 3], [2, 4]], [[1, 4], [2, 3]]] as const) {
      const m: MatchRecord = { season: 2025, eventCode: "E", level: "qual", series: 0, number: i * 3 + r[1], time: Date.UTC(2025, 10, 1) + (i * 3 + r[1]) * 60_000,
        red: { teams: [...r], auto: 30, teleop: 70, endgame: 10, np: 110, penCommitted: 0, total: 110 },
        blue: { teams: [...b], auto: 20, teleop: 50, endgame: 10, np: 80, penCommitted: 0, total: 80 } };
      book.update(m);
    }
  }
  const opts = { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration };

  it("leaves win odds untouched and is null without a bonus model", () => {
    const plain = explainMatch(book, [1, 2], [3, 4], opts);
    const withBonus = explainMatch(book, [1, 2], [3, 4], { ...opts, bonus: { season: 2025, model: { model: B2025, source: "fitted", samples: null } } });
    expect(plain.bonus).toBeNull();
    expect(withBonus.winProbA).toBe(plain.winProbA);
    expect(withBonus.factors).toEqual(plain.factors);
    expect(withBonus.confidence).toEqual(plain.confidence);
  });

  it("uses each alliance's own non-penalty score distribution and served win odds", () => {
    const x = explainMatch(book, [1, 2], [3, 4], { ...opts, bonus: { season: 2025, model: { model: B2025, source: "fitted", samples: null } } });
    const p = predictMatch(book, [1, 2], [3, 4], FITTED_MODEL.noise, FITTED_MODEL.calibration);
    expect(x.bonus!.A).toEqual(allianceBonusOdds(2025, B2025, { mean: p.red.np, sd: p.red.sd }, x.winProbA));
    expect(x.bonus!.B).toEqual(allianceBonusOdds(2025, B2025, { mean: p.blue.np, sd: p.blue.sd }, x.winProbB));
    expect(x.bonus!.confidence.tier).toBe(x.confidence.tier);
  });

  it("caps the tier by how much a season fit has learned from", () => {
    const src = (samples: number) => ({ model: B2025, source: "season" as const, samples });
    const few = explainMatch(book, [1, 2], [3, 4], { ...opts, bonus: { season: 2026, model: src(BONUS_CONFIDENCE_RULE.provisionalBelow - 1) } });
    expect(few.bonus!.confidence.tier).toBe("provisional");
    expect(few.bonus!.confidence.reason).toMatch(/only 599 alliance results/);
    const many = explainMatch(book, [1, 2], [3, 4], { ...opts, bonus: { season: 2026, model: src(BONUS_CONFIDENCE_RULE.confidentMin) } });
    expect(many.bonus!.confidence.tier).toBe(many.confidence.tier);
  });
});
