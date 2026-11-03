// The "what it learns from" lines and the by-hand helpers stay true to the engine they describe.
import { describe, expect, it } from "vitest";
import { DEFAULT_BAND, FITTED_MODEL, RatingBook } from "@control-scout/predict-engine";
import { BASIS, marginText, matchBasis, overlapTotal, scoreSum } from "./predictionBasis";

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
    expect(scoreSum([{ np: 72.44 }, { np: 51 }], 6.08, [{ pen: 2 }, { pen: 1.46 }])).toBe("(72.4 + 51.0) − 6.1 + (2.0 + 1.5)");
    expect(overlapTotal({ auto: 1, teleop: 2, endgame: 0 })).toBe(3);
    expect(overlapTotal(undefined)).toBe(0);
  });
});
