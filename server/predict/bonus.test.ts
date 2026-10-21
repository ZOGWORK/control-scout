import { describe, expect, it } from "vitest";
import { FITTED_MODEL, RatingBook, explainMatch } from "@control-scout/predict-engine";
import { bonusArgs, bonusFromRow, bonusView } from "./bonus.js";
import { bonusBlock } from "../api/accuracy.js";

const book = new RatingBook(FITTED_MODEL.rating);
book.startSeason(2025);
const opts = { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration };
const withBonus = explainMatch(book, [1, 2], [3, 4], { ...opts, bonus: { season: 2025, model: { model: FITTED_MODEL.bonus["2025"], source: "fitted", samples: null } } });

describe("bonus odds views", () => {
  it("a call made now and the same call read back from the ledger agree", () => {
    const now = bonusView(2025, withBonus)!;
    const [red, blue, tier, model] = bonusArgs(2025, withBonus);
    expect(model).toBe("fitted:2025");
    const back = bonusFromRow(2025, { p_red: withBonus.winProbA, bonus_red: red, bonus_blue: blue, bonus_tier: tier })!;
    expect(back.red).toEqual(now.red);
    expect(back.blue).toEqual(now.blue);
    expect(back.rpRed).toBe(now.rpRed);
    expect(back.tier).toBe(now.tier);
  });

  it("never shows a flat 0 or 1, and expected RPs are 3 × P(win) + the bonus odds", () => {
    const v = bonusView(2025, withBonus)!;
    for (const p of [...v.red, ...v.blue]) { expect(p).toBeGreaterThan(0); expect(p).toBeLessThan(1); }
    expect(v.rpRed).toBeCloseTo(3 * withBonus.winProbA + v.red.reduce((s, p) => s + p, 0), 2);
  });

  it("is absent without bonus odds (playoffs, seasons before 2025, unreadable rows)", () => {
    const plain = explainMatch(book, [1, 2], [3, 4], opts);
    expect(bonusView(2025, plain)).toBeUndefined();
    expect(bonusArgs(2025, plain)).toEqual([null, null, null, null]);
    expect(bonusFromRow(2025, { p_red: 0.5, bonus_red: null, bonus_blue: null })).toBeUndefined();
    expect(bonusFromRow(2025, { p_red: 0.5, bonus_red: "[0.1,0.2]", bonus_blue: "[0.1,0.2,0.3]" })).toBeUndefined();
  });
});

describe("bonusBlock (track record)", () => {
  it("scores each alliance-bonus call by Brier, per bonus and against the base rate", () => {
    const b = bonusBlock([
      { p: [0.9, 0.2, 0.5], y: [true, false, true] },
      { p: [0.7, 0.1, 0.5], y: [true, false, false] },
    ], ["Movement", "Goal", "Pattern"], 1)!;
    expect(b.n).toBe(6);
    expect(b.matches).toBe(1);
    expect(b.brier).toBeCloseTo((0.01 + 0.04 + 0.25 + 0.09 + 0.01 + 0.25) / 6, 12);
    expect(b.bySlot[0]).toMatchObject({ label: "Movement", n: 2, predicted: 0.8, actual: 1 });
    // Base rates: movement 1 and goal 0 are perfect, pattern 0.5 scores 0.25 on both calls.
    expect(b.baseRateBrier).toBeCloseTo(0.5 / 6, 12);
    expect(b.reliability.reduce((s, r) => s + r.n, 0)).toBe(6);
    expect(bonusBlock([], ["a", "b", "c"], 0)).toBeNull();
  });
});
