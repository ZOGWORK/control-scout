import { describe, expect, it } from "vitest";
import {
  CONSISTENCY_MIN_MATCHES, CONSISTENCY_PRIOR, averageRobotShare, consistency, consistencyReason, eventConsistency, eventContributions,
  fieldVariance, poolTallies, shownConsistency, tallyContributions,
} from "../consistency.js";
// Control Point's test pins the same fixture and numbers: same inputs, same swing in both apps.
import { ALLIANCES, FIELD_VAR, OPR, PINNED } from "./fixtures/consistencyFixture.js";

describe("consistency (swing)", () => {
  it("share: Σ non-penalty points ÷ Σ robots on the field", () => {
    expect(averageRobotShare(ALLIANCES.map((a) => ({ np: a.np, robots: a.onField.length })))).toBe(511 / 19);
    expect(averageRobotShare([])).toBe(0);
  });

  it("matches the formula worked by hand", () => {
    const share = 511 / 19;
    const { contribs } = eventContributions(ALLIANCES, (t) => OPR[t] ?? null);
    // Team 1: (80−30), (50−20), (60−10), (64−30), (66−20) = 50, 30, 50, 34, 46 points, mean 42, Σ dev² = 352.
    expect(contribs.get(1)).toEqual([50, 30, 50, 34, 46].map((x) => x / share));
    const c = consistency(tallyContributions(contribs.get(1)!), FIELD_VAR);
    const byHand = Math.sqrt((352 / share ** 2 + CONSISTENCY_PRIOR * FIELD_VAR) / (5 + CONSISTENCY_PRIOR));
    expect(c.swing).toBeCloseTo(byHand, 12);
    expect(c.value).toBe(c.swing);
    expect(c.matches).toBe(5);
    expect(c.rawSd).toBeCloseTo(Math.sqrt(352 / 5) / share, 12);
  });

  it("below the minimum: still a swing (for the reliability index), no value, a reason", () => {
    const by = eventConsistency(ALLIANCES, (t) => OPR[t] ?? null, FIELD_VAR);
    expect(by.get(2)!.matches).toBe(4);
    expect(by.get(2)!.value).toBeNull();
    expect(by.get(2)!.reason).toBe(`Only 4 qualification matches with a partner's OPR known (needs ${CONSISTENCY_MIN_MATCHES})`);
    expect(consistency({ n: 0, ss: 0 }, FIELD_VAR)).toEqual({ swing: Math.sqrt(FIELD_VAR), value: null, matches: 0, rawSd: null, reason: consistencyReason(0) });
  });

  it("pinned numbers (Control Point's test asserts the same)", () => {
    const by = eventConsistency(ALLIANCES, (t) => OPR[t] ?? null, FIELD_VAR);
    expect(Object.fromEntries([1, 2, 3, 4].map((t) => [t, [by.get(t)!.matches, by.get(t)!.swing.toFixed(12)]]))).toEqual(PINNED);
  });

  it("unknown partner OPR: no contribution; pooling keeps each event's centring", () => {
    const { contribs } = eventContributions(ALLIANCES, (t) => (t === 2 ? null : OPR[t]));
    expect(contribs.get(1)).toHaveLength(3);
    const a = tallyContributions([1, 2, 3]), b = tallyContributions([10, 11, 12]);
    expect(poolTallies([a, b])).toEqual({ n: 6, ss: 4 });
    expect(fieldVariance(poolTallies([a, b]))).toBeCloseTo(4 / 6, 15);
    expect(fieldVariance({ n: 0, ss: 0 })).toBe(0);
  });

  it("shown from a stored swing and its count", () => {
    expect(shownConsistency(0.31, 5)).toEqual({ value: 0.31, matches: 5, reason: null });
    expect(shownConsistency(0.31, 4).value).toBeNull();
    expect(shownConsistency(null, 9).value).toBeNull();
  });
});
