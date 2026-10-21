import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RatingBook } from "../rating";
import { explainMatch, CONFIDENCE_RULE } from "../explain";
import { predictMatch } from "../matchModel";
import { FITTED_MODEL } from "../model";
import { ENGINE_VERSION } from "../index";
import type { MatchRecord } from "../types";

const al = (teams: number[], auto: number, teleop: number, endgame: number, pen = 0) => ({
  teams, auto, teleop, endgame, np: auto + teleop + endgame, penCommitted: pen, total: auto + teleop + endgame,
});
let n = 0;
const play = (book: RatingBook, red: ReturnType<typeof al>, blue: ReturnType<typeof al>) => {
  n++;
  const m: MatchRecord = { season: 2025, eventCode: "E", level: "qual", series: 0, number: n, time: Date.UTC(2025, 10, 1) + n * 60_000, red, blue };
  book.update(m);
};

/** A small season: team 1 is an auto specialist, 4 commits lots of penalties. */
function seasonBook(matchesEach: number): RatingBook {
  const book = new RatingBook(FITTED_MODEL.rating);
  for (let i = 0; i < matchesEach; i++) {
    play(book, al([1, 2], 60, 80, 20, 0), al([3, 4], 15, 90, 25, 30));
    play(book, al([1, 3], 55, 85, 22, 0), al([2, 4], 18, 70, 20, 25));
    play(book, al([1, 4], 58, 75, 18, 20), al([2, 3], 20, 85, 24, 0));
  }
  return book;
}

describe("explainMatch", () => {
  it("matches predictMatch's probability and expected scores exactly", () => {
    const book = seasonBook(4);
    const e = explainMatch(book, [1, 2], [3, 4], { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration });
    const p = predictMatch(book, [1, 2], [3, 4], FITTED_MODEL.noise, FITTED_MODEL.calibration);
    expect(e.winProbA).toBe(p.pRedWin);
    expect(e.winProbA + e.winProbB).toBeCloseTo(1, 12);
    expect(e.predictedScoreA).toBe(Math.round(p.red.mean));
    expect(e.predictedScoreB).toBe(Math.round(p.blue.mean));
  });

  it("factors are an exact split of the predicted margin (all four components sum to it)", () => {
    const book = seasonBook(4);
    const e = explainMatch(book, [1, 2], [3, 4]);
    const p = predictMatch(book, [1, 2], [3, 4]);
    const sum = (k: "auto" | "teleop" | "endgame" | "pen", xs: typeof e.teamsA) => xs.reduce((s, t) => s + t[k], 0);
    const comps = (["auto", "teleop", "endgame"] as const).reduce((s, k) => s + sum(k, e.teamsA) - sum(k, e.teamsB), 0) + sum("pen", e.teamsB) - sum("pen", e.teamsA);
    expect(comps).toBeCloseTo(p.red.mean - p.blue.mean, 9);
    expect(e.factors).toHaveLength(3);
    // Ranked by size.
    for (let i = 1; i < e.factors.length; i++) expect(Math.abs(e.factors[i - 1].points)).toBeGreaterThanOrEqual(Math.abs(e.factors[i].points));
  });

  it("names the auto specialist and reads as plain language", () => {
    const book = seasonBook(5);
    const e = explainMatch(book, [1, 2], [3, 4], { nameA: "Red", nameB: "Blue" });
    const auto = e.factors.find((f) => f.id === "auto");
    expect(auto?.favors).toBe("A");
    expect(auto?.label).toMatch(/^Red's autonomous is worth about \d+ more points/);
    expect(auto?.label).toContain("Team 1");
    for (const f of e.factors) expect(f.label).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("explains penalties from the side that benefits", () => {
    const book = seasonBook(5);
    const e = explainMatch(book, [1, 2], [3, 4]);
    const pen = e.factors.find((f) => f.id === "pen");
    if (pen && pen.favors !== "even") expect(pen.label).toMatch(/gives? away about \d+ more penalty points/);
  });

  it("is provisional with no season data, and never claims confidence it doesn't have", () => {
    const empty = new RatingBook(FITTED_MODEL.rating);
    expect(explainMatch(empty, [1, 2], [3, 4]).confidence.tier).toBe("provisional");
    const early = seasonBook(0);
    play(early, al([1, 2], 50, 80, 20), al([3, 4], 20, 80, 20));
    expect(explainMatch(early, [1, 2], [3, 4]).confidence.tier).toBe("provisional");
    const late = seasonBook(Math.ceil(CONFIDENCE_RULE.confidentMinMatches / 1.5) + 2);
    const tier = explainMatch(late, [1, 2], [3, 4]).confidence;
    expect(["moderate", "confident"]).toContain(tier.tier);
    expect(tier.minMatches).toBeGreaterThanOrEqual(CONFIDENCE_RULE.provisionalBelow);
  });

  it("80% score ranges bracket the expected score and never go negative", () => {
    const e = explainMatch(seasonBook(3), [1, 2], [3, 4]);
    expect(e.scoreRangeA[0]).toBeLessThanOrEqual(e.predictedScoreA);
    expect(e.scoreRangeA[1]).toBeGreaterThanOrEqual(e.predictedScoreA);
    expect(e.scoreRangeB[0]).toBeGreaterThanOrEqual(0);
  });
});

describe("package metadata", () => {
  it("model.ts is generated from model.json (no drift)", () => {
    const json = JSON.parse(readFileSync(join(__dirname, "..", "model.json"), "utf8"));
    expect(JSON.parse(JSON.stringify(FITTED_MODEL))).toEqual(json);
  });

  it("ENGINE_VERSION matches package.json", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));
    expect(ENGINE_VERSION).toBe(pkg.version);
  });
});

describe("reasons (2.2.0)", () => {
  it("are words only: every number is identical with or without a recent record", () => {
    const book = seasonBook(4);
    const opts = { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, contextual: FITTED_MODEL.contextual, context: { level: "qual" as const } };
    const plain = explainMatch(book, [1, 2], [3, 4], opts);
    const recent = new Map([[1, { matches: 10, noShows: 2, nearZero: 0 }], [3, { matches: 10, noShows: 0, nearZero: 4 }], [4, { matches: 10, noShows: 1, nearZero: 1 }]]);
    const withR = explainMatch(book, [1, 2], [3, 4], { ...opts, recent: (t) => recent.get(t) ?? null });
    const { reasons: a, ...restPlain } = plain;
    const { reasons: b, ...restWith } = withR;
    expect(restWith).toEqual(restPlain);
    expect(a).toEqual([]);
    expect(b).toEqual([
      "Team 1 was a no-show in 2 of its last 10 matches",
      "Team 3's alliance scored about what its partner alone would in 4 of its last 10 matches (an estimate: defense or a carry looks the same)",
    ]);
  });
});
