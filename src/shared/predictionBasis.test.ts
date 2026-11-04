// The "what it learns from" lines and the by-hand helpers stay true to the engine they describe.
import { describe, expect, it } from "vitest";
import { DEFAULT_BAND, FITTED_MODEL, RatingBook, servedScores } from "@control-scout/predict-engine";
import { BASIS, marginCalibration, marginText, matchBasis, overlapTotal, scoreSum, scoreTotal } from "./predictionBasis";

describe("prediction basis lines", () => {
  it("picks the playoff line only for a playoff match", () => {
    expect(matchBasis("playoff")).toBe("playoff");
    expect(matchBasis("qual")).toBe("qual");
    expect(matchBasis(undefined)).toBe("qual");
  });

  it("says 'counts half' because the engine weights playoff updates by one half", () => {
    expect(FITTED_MODEL.rating.playoffWeight).toBe(0.5);
    for (const k of ["qual", "playoff", "event", "bracket"] as const) expect(BASIS[k]).toMatch(/playoff result counts half/);
  });

  it("says playoff ranges are tighter because the playoff band factor is below 1", () => {
    expect((FITTED_MODEL.band ?? DEFAULT_BAND).playoff).toBeLessThan(1);
  });

  it("says partners add up in full in playoffs: the overlap cut is quals-only", () => {
    const book = new RatingBook(FITTED_MODEL.rating);
    book.startSeason(2025);
    const side = (teams: number[]) => ({ teams, auto: 30, teleop: 60, endgame: 20, np: 110, penCommitted: 0, total: 110 });
    for (let i = 0; i < 5; i++) book.update({ season: 2025, eventCode: "X", level: "qual", series: 0, number: i + 1, time: 1e12 + i, red: side([1, 2]), blue: side([3, 4]) });
    const o = (level: "qual" | "playoff") => overlapTotal(book.allianceOverlap([1, 2], level));
    expect(o("playoff")).toBe(0);
    expect(o("qual")).toBeGreaterThan(0);
  });
});

describe("by-hand helpers", () => {
  it("writes the margin from the two shown scores", () => {
    expect(marginText(118.4, 105.6)).toBe("Red by 12 (118 − 106)");
    expect(marginText(90, 101)).toBe("Blue by 11 (90 − 101)");
    expect(marginText(50.2, 49.8)).toBe("Even (50 − 50)");
  });

  it("writes a score out from its parts", () => {
    expect(scoreSum([{ np: 72.44 }, { np: 51 }], 6.08, [{ pen: 2 }, { pen: 1.46 }])).toBe("(72.4 + 51.0) − 6.1 + (2.0 + 1.5) = 120.8");
    // The sum is of the parts as written, so it always checks out by hand (Greptile on #488: 50.24 + 50.24 + 2.04 + 1.04).
    expect(scoreSum([{ np: 50.24 }, { np: 50.24 }], 0, [{ pen: 2.04 }, { pen: 1.04 }])).toBe("(50.2 + 50.2) − 0.0 + (2.0 + 1.0) = 103.4");
    expect(scoreTotal([{ np: 72.44 }, { np: 51 }], 6.08, [{ pen: 2 }, { pen: 1.46 }])).toBe(120.8);
    expect(overlapTotal({ auto: 1, teleop: 2, endgame: 0 })).toBe(3);
    expect(overlapTotal(undefined)).toBe(0);
  });

  it("writes the margin calibration out step by step (engine 3.5): the margin shrinks, the total stays", () => {
    expect(marginCalibration(120.8, 106, 0.95)).toEqual({ mid: "113.4", half: "7.4", red: "113.4 + 0.95 × 7.4 = 120.4", blue: "113.4 − 0.95 × 7.4 = 106.4" });
    // Blue favoured: blue's line adds, red's subtracts.
    expect(marginCalibration(90, 110, 0.95)).toEqual({ mid: "100.0", half: "10.0", red: "100.0 − 0.95 × 10.0 = 90.5", blue: "100.0 + 0.95 × 10.0 = 109.5" });
    // Matches the engine's served scores to the precision written.
    const s = servedScores(120.8, 106, { scale: 0.95 });
    expect(s.red).toBeCloseTo(120.43, 2);
    expect(s.blue).toBeCloseTo(106.37, 2);
  });
});
