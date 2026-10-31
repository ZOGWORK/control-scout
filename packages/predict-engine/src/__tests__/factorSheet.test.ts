/**
 * Engine 3.3: the full factor sheet. Every factor with its weight in the call, the top 3 factors taken
 * from the same ranking, and the served numbers untouched.
 */
import { describe, it, expect } from "vitest";
import { RatingBook } from "../rating";
import { explainMatch, type MatchExplanation } from "../explain";
import { predictMatch } from "../matchModel";
import { FITTED_MODEL } from "../model";
import { PARTNERSHIP_PARAMS, PartnershipBook } from "../partnership";
import type { MatchRecord } from "../types";

const al = (teams: number[], auto: number, teleop: number, endgame: number, pen = 0) => ({
  teams, auto, teleop, endgame, np: auto + teleop + endgame, penCommitted: pen, total: auto + teleop + endgame,
});
let n = 0;
const rec = (red: ReturnType<typeof al>, blue: ReturnType<typeof al>, season = 2025, code = "E"): MatchRecord => {
  n++;
  return { season, eventCode: code, level: "qual", series: 0, number: n, time: Date.UTC(season, 10, 1) + n * 60_000, red, blue };
};

/** Team 1 is an auto specialist, 4 commits lots of penalties, 2 collapses now and then. */
function seasonBook(matchesEach: number): RatingBook {
  const book = new RatingBook(FITTED_MODEL.rating);
  book.startSeason(2025);
  for (let i = 0; i < matchesEach; i++) {
    book.update(rec(al([1, 2], 60, i % 3 ? 80 : 10, 20, 0), al([3, 4], 15, 90, 25, 30)));
    book.update(rec(al([1, 3], 55, 85, 22, 0), al([2, 4], 18, 70, 20, 25)));
    book.update(rec(al([1, 4], 58, 75, 18, 20), al([2, 3], 20, 85, 24, 0)));
  }
  return book;
}

const ctx = { contextual: FITTED_MODEL.contextual, context: { level: "qual" as const, event: "E" } };
const sheetEntries = (x: MatchExplanation) => [...x.factorSheet.phases, ...x.factorSheet.model, ...x.factorSheet.reasons];
const sign = (f: { favors: "A" | "B" | "even" }) => (f.favors === "A" ? 1 : f.favors === "B" ? -1 : 0);

const cases: [string, () => MatchExplanation][] = [
  ["contextual", () => explainMatch(seasonBook(6), [1, 2], [3, 4], { noise: FITTED_MODEL.noise, ...ctx })],
  ["contextual, the underdog as A", () => explainMatch(seasonBook(6), [3, 4], [1, 2], { noise: FITTED_MODEL.noise, ...ctx })],
  ["contextual playoff", () => explainMatch(seasonBook(6), [1, 4], [2, 3], { noise: FITTED_MODEL.noise, contextual: FITTED_MODEL.contextual, context: { level: "playoff" } })],
  ["legacy, calibrated", () => explainMatch(seasonBook(4), [1, 2], [3, 4], { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration })],
  ["legacy, raw", () => explainMatch(seasonBook(4), [1, 2], [3, 4])],
  ["no season data", () => explainMatch(new RatingBook(FITTED_MODEL.rating), [1, 2], [3, 4], ctx)],
];

describe("factor sheet (3.3)", () => {
  it.each(cases)("%s: the top 3 factors are the sheet's first three phases, field for field", (_, make) => {
    const x = make();
    expect(x.factorSheet.phases).toHaveLength(4);
    expect(x.factors).toEqual(x.factorSheet.phases.slice(0, 3).map(({ id, points, favors, label }) => ({ id, points, favors, label })));
    for (const f of x.factorSheet.phases) {
      // A phase's weight points the same way as its points: the sheet never disagrees with the factors.
      if (f.favors !== "even") expect(Math.sign(f.logit)).toBe(sign(f));
      else expect(Math.abs(f.points!)).toBeLessThan(1);
    }
  });

  it.each(cases)("%s: every entry's log-odds add up to the served call, and the weights to 1", (_, make) => {
    const x = make();
    const p = Math.min(1 - 1e-12, Math.max(1e-12, x.winProbA));
    expect(x.factorSheet.logit).toBeCloseTo(Math.log(p / (1 - p)), 12);
    const all = sheetEntries(x);
    expect(all.reduce((s, f) => s + f.logit, 0)).toBeCloseTo(x.factorSheet.logit, 9);
    const w = all.reduce((s, f) => s + f.weight, 0);
    if (all.some((f) => f.logit !== 0)) expect(w).toBeCloseTo(1, 12);
    for (const f of all) {
      expect(f.weight).toBeGreaterThanOrEqual(0);
      expect(f.label).not.toMatch(/NaN|undefined|Infinity|\bD\d+\b|logit/);
      if (f.kind !== "phase" && f.favors !== "even") expect(Math.sign(f.logit)).toBe(sign(f));
    }
  });

  it("groups the contextual model's inputs into plain factors, largest weight first", () => {
    const x = cases[0][1]();
    expect(x.factorSheet.probabilityModel).toBe("contextual");
    expect(x.factorSheet.model.map((f) => f.id).sort()).toEqual(["certainty", "experience", "form", "momentum", "partners", "pointMix", "reliability"]);
    for (let i = 1; i < x.factorSheet.model.length; i++) expect(x.factorSheet.model[i - 1].weight).toBeGreaterThanOrEqual(x.factorSheet.model[i].weight);
    // The score gap carries most of a call between known robots.
    const phaseWeight = x.factorSheet.phases.reduce((s, f) => s + f.weight, 0);
    expect(phaseWeight).toBeGreaterThan(0.5);
  });

  it("the legacy model's sheet is the four phases and at most its calibration offset", () => {
    expect(cases[4][1]().factorSheet.model).toEqual([]);
    const cal = cases[3][1]().factorSheet;
    expect(cal.probabilityModel).toBe("legacy");
    expect(cal.model.map((f) => f.id)).toEqual(FITTED_MODEL.calibration.b ? ["certainty"] : []);
  });

  it("head-to-head and schedule strength are reasons with weight 0", () => {
    const book = new RatingBook(FITTED_MODEL.rating);
    const pairs = new PartnershipBook(FITTED_MODEL.rating);
    for (let i = 0; i < 3; i++) pairs.observe(rec(al([1, 2], 50, 120, 20), al([3, 4], 20, 60, 10), 2024, "X"));
    for (let i = 0; i < 6; i++) book.update(rec(al([1, 2], 40, 90, 20), al([3, 4], 30, 60, 10), 2024, "X"));
    const x = explainMatch(book, [1, 2], [3, 4], { noise: FITTED_MODEL.noise, contextual: FITTED_MODEL.contextual, context: { level: "qual", event: "X" }, partnership: { table: pairs, season: 2024 } });
    const h2h = x.factorSheet.reasons.find((f) => f.id === "headToHead")!;
    expect(h2h.label).toBe(x.partnership!.label);
    expect(h2h.logit).toBe(0);
    expect(h2h.weight).toBe(0);
    expect(x.factorSheet.reasons.find((f) => f.id === "schedule")!.weight).toBe(0);
    // Without a pair table there is no history line at all.
    expect(explainMatch(book, [1, 2], [3, 4]).factorSheet.reasons.map((f) => f.id)).toEqual(["schedule"]);
    // With β > 0 the history moves the odds, and the sheet gives it that weight.
    const moved = explainMatch(book, [1, 2], [3, 4], { partnership: { table: pairs, season: 2024, params: { ...PARTNERSHIP_PARAMS, betaTogether: 0.5 } } });
    const h = moved.factorSheet.reasons.find((f) => f.id === "headToHead")!;
    expect(h.logit).toBeGreaterThan(0);
    expect(h.weight).toBeGreaterThan(0);
  });

  it("never changes a served number", () => {
    const book = seasonBook(6);
    const x = explainMatch(book, [1, 2], [3, 4], { noise: FITTED_MODEL.noise, ...ctx });
    const p = predictMatch(book, [1, 2], [3, 4], FITTED_MODEL.noise, undefined, ctx);
    expect(x.winProbA).toBe(p.pRedWin);
    expect(x.predictedScoreA).toBe(Math.round(p.red.mean));
    expect(x.scoreBandA).toEqual(p.red.band);
  });
});
