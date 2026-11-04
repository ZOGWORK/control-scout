/**
 * Engine 3.5: margin calibration of the served expected scores. The shown scores shrink toward their midpoint
 * (margin × s, total unchanged) and the ranges recentre on them; NOTHING a probability reads may move.
 *
 * The guard: every probability path is run with the scale off (1), at the shipped value and at an extreme one (0.3).
 * If any of them read a served (scaled) score, the extreme run would differ, and these tests fail.
 */
import { describe, it, expect } from "vitest";
import { RatingBook } from "../rating";
import { explainMatch, type ExplainOptions } from "../explain";
import { DEFAULT_MARGIN, modelView, predictMatch, scoreBand, servedScores, type MarginParams, type PredictOptions } from "../matchModel";
import { contextualFeatures } from "../contextual";
import { Forecaster, type AdvancementRecord, type PredictModel } from "../forecast";
import { FITTED_MODEL } from "../model";
import type { EventInput } from "../inputs";
import type { MatchRecord } from "../types";

const al = (teams: number[], auto: number, teleop: number, endgame: number, pen = 0) => ({
  teams, auto, teleop, endgame, np: auto + teleop + endgame, penCommitted: pen, total: auto + teleop + endgame + pen,
});
let n = 0;
const rec = (red: ReturnType<typeof al>, blue: ReturnType<typeof al>, season = 2025, code = "E"): MatchRecord => {
  n++;
  return { season, eventCode: code, level: "qual", series: 0, number: n, time: Date.UTC(season, 10, 1) + n * 60_000, red, blue };
};
/** Team 1 is strong, 4 gives away penalties: lopsided lineups, so a scale visibly moves the shown scores. */
function seasonBook(matchesEach = 6): RatingBook {
  const book = new RatingBook(FITTED_MODEL.rating);
  book.startSeason(2025);
  for (let i = 0; i < matchesEach; i++) {
    book.update(rec(al([1, 2], 60, i % 3 ? 80 : 10, 20, 0), al([3, 4], 15, 50, 25, 30)));
    book.update(rec(al([1, 3], 55, 85, 22, 0), al([2, 4], 18, 40, 20, 25)));
    book.update(rec(al([1, 4], 58, 75, 18, 20), al([2, 3], 20, 45, 24, 0)));
  }
  return book;
}

const SCALES: MarginParams[] = [{ scale: 1 }, DEFAULT_MARGIN, { scale: 0.3 }];
const bonus = { season: 2025, model: { model: FITTED_MODEL.bonus["2025"], source: "fitted" as const, samples: null } };
const opts = (margin: MarginParams, level: "qual" | "playoff" = "qual"): ExplainOptions & PredictOptions => ({
  noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, contextual: FITTED_MODEL.contextual, shadow: FITTED_MODEL.contextual?.fallback,
  context: { level, event: "E" }, band: FITTED_MODEL.band, margin, ...(level === "qual" ? { bonus } : {}),
});

describe("margin calibration (3.5)", () => {
  it("the shipped scale is the fitted model's", () => {
    expect(FITTED_MODEL.margin).toEqual(DEFAULT_MARGIN);
    expect(DEFAULT_MARGIN.scale).toBeGreaterThan(0.85);
    expect(DEFAULT_MARGIN.scale).toBeLessThan(1);
  });

  it("scales the margin by s around the midpoint; the total is unchanged", () => {
    const s = servedScores(130, 90, { scale: 0.9 });
    expect(s.red - s.blue).toBeCloseTo(36, 12);
    expect(s.red + s.blue).toBeCloseTo(220, 12);
    expect(servedScores(130, 90, { scale: 1 })).toEqual({ red: 130, blue: 90 });
  });

  it.each(["qual", "playoff"] as const)("%s: served scores and ranges are the transform of the model's; probabilities identical", (level) => {
    const book = seasonBook();
    const off = predictMatch(book, [1, 2], [3, 4], FITTED_MODEL.noise, FITTED_MODEL.calibration, opts({ scale: 1 }, level));
    expect(off.red.mean).toBe(off.red.modelMean);
    expect(Math.abs(off.red.mean - off.blue.mean)).toBeGreaterThan(20);
    for (const margin of SCALES) {
      const p = predictMatch(book, [1, 2], [3, 4], FITTED_MODEL.noise, FITTED_MODEL.calibration, opts(margin, level));
      const want = servedScores(off.red.mean, off.blue.mean, margin);
      expect(p.red.mean).toBe(want.red);
      expect(p.blue.mean).toBe(want.blue);
      expect(p.red.band).toEqual(scoreBand(want.red, off.red.band.sd, off.red.band.level));
      expect(p.blue.band).toEqual(scoreBand(want.blue, off.blue.band.sd, off.blue.band.level));
      // The model's numbers and every probability: bit for bit.
      expect(modelView(p)).toEqual({ ...off, red: { ...off.red, band: p.red.band }, blue: { ...off.blue, band: p.blue.band } });
      for (const k of ["pRedWin", "pRaw", "pShadow", "model", "modelId", "shadowModelId", "partnershipShift"] as const) expect(p[k]).toBe(off[k]);
      for (const side of ["red", "blue"] as const) for (const k of ["modelMean", "sd", "np"] as const) expect(p[side][k]).toBe(off[side][k]);
      // The contextual model's inputs, read from the probability view.
      const f = (q: typeof p) => contextualFeatures(book, [1, 2], [3, 4], { ...modelView(q), pRedWin: q.pRaw! }, { level, event: "E" }, FITTED_MODEL.contextual!.coefficients.length);
      expect(f(p)).toEqual(f(off));
    }
  });

  it("explainMatch: win odds, tie, bonus odds and the whole factor sheet are identical at any scale; the shown scores still add up", () => {
    const book = seasonBook();
    const xs = SCALES.map((m) => book.withEvent("E", () => explainMatch(book, [1, 2], [3, 4], opts(m))));
    const [off] = xs;
    expect(off.bonus).not.toBeNull();
    for (const x of xs) {
      for (const k of ["winProbA", "winProbB", "factors", "factorSheet", "bonus", "shadow", "confidence", "probabilityModel", "probabilityModelId", "teamsA", "teamsB", "overlapA", "overlapB", "reasons", "partnership", "modelScoreA", "modelScoreB"] as const) {
        expect(x[k]).toEqual(off[k]);
      }
      // The factors split the model's margin exactly; the shown margin is marginScale × it.
      const split = off.factorSheet.phases.reduce((s, f) => s + f.points!, 0);
      expect(split).toBeCloseTo(x.modelScoreA - x.modelScoreB, 0);
      const served = servedScores(x.modelScoreA, x.modelScoreB, { scale: x.marginScale });
      expect(x.predictedScoreA).toBe(Math.round(served.red));
      expect(x.predictedScoreB).toBe(Math.round(served.blue));
      // "score ± pm" still reaches both ends of the recentred range.
      expect(x.predictedScoreA - x.scorePlusMinusA).toBeLessThanOrEqual(x.scoreRangeA[0]);
      expect(x.predictedScoreA + x.scorePlusMinusA).toBeGreaterThanOrEqual(x.scoreRangeA[1]);
    }
    expect(xs[2].predictedScoreA - xs[2].predictedScoreB).toBeLessThan(off.predictedScoreA - off.predictedScoreB);
    expect(xs[1].marginScale).toBe(DEFAULT_MARGIN.scale);
  });

  it("forecasts: every simulated odd, match probability, bonus odd and factor sheet is identical; only redMean/blueMean and bands move", () => {
    class F extends Forecaster {
      protected readonly awardHistory = new Map();
      constructor(protected readonly model: PredictModel, readonly b: RatingBook) { super(); }
      protected book() { return this.b; }
      protected hasRatings() { return true; }
      storedPlayedKeys() { return new Set<string>(); }
      protected advancementRecords(): AdvancementRecord[] { return []; }
      protected regionOf() { return null; }
      protected awardSlots() { return []; }
    }
    const ev: EventInput = {
      season: 2025, code: "FIX", type: "Qualifier", start: "2025-11-20", end: "2025-11-20",
      field: [1, 2, 3, 4].map((t) => ({ teamNumber: t, rank: null })), alliances: [],
      matches: [
        { key: "qual:0:1", label: "Q1", level: "qual", series: 0, number: 1, time: "2025-11-20T10:00:00Z", played: false, red: { teams: [{ number: 1 }, { number: 2 }], score: null }, blue: { teams: [{ number: 3 }, { number: 4 }], score: null } },
        { key: "qual:0:2", label: "Q2", level: "qual", series: 0, number: 2, time: "2025-11-20T10:10:00Z", played: false, red: { teams: [{ number: 1 }, { number: 3 }], score: null }, blue: { teams: [{ number: 2 }, { number: 4 }], score: null } },
      ],
    };
    const run = (margin: MarginParams) => new F({ ...FITTED_MODEL, margin }, seasonBook()).forecast(ev, 1, 200, { factorSheets: true });
    const [off, ...rest] = SCALES.map(run);
    expect(off.matches.every((m) => m.pRedWin != null)).toBe(true);
    for (const f of rest) {
      expect(f.teams).toEqual(off.teams);
      expect(f.matchesOnly).toEqual(off.matchesOnly);
      f.matches.forEach((m, i) => {
        const o = off.matches[i];
        for (const k of ["pRedWin", "pShadow", "modelId", "bonus", "factorSheet", "history"] as const) expect(m[k]).toEqual(o[k]);
        expect(m.redMean! + m.blueMean!).toBeCloseTo(o.redMean! + o.blueMean!, 9);
        expect(m.redBand!.sd).toBe(o.redBand!.sd);
      });
    }
    const shrunk = rest[1].matches[0];
    expect(Math.abs(shrunk.redMean! - shrunk.blueMean!)).toBeLessThan(Math.abs(off.matches[0].redMean! - off.matches[0].blueMean!));
  });
});
