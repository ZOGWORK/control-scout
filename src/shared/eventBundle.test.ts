import { describe, expect, it } from "vitest";
import type { RatingBookData } from "@control-scout/predict-engine";
import { bundleFinished, sliceBook, snapshotAge, stableJson } from "./eventBundle";

describe("event-day bundle rules", () => {
  it("sliceBook keeps only the event's teams, and the season's baseline whole", () => {
    const r = (n: number) => ({ n } as never);
    const book = {
      params: {}, base: [1], baseSq: [1], baseReady: true, season: 2025, now: 5,
      ratings: [[1, r(1)], [2, r(2)], [3, r(3)]], history: [[1, []], [3, []]], reliability: [[2, {} as never]],
      regions: { lift: [["USTX", { auto: 1, teleop: 1, endgame: 1, n: 3 }]], pending: [[1, { auto: 0, teleop: 0, endgame: 0, region: "USTX" }], [9, { auto: 0, teleop: 0, endgame: 0, region: "USCA" }]] },
    } as unknown as RatingBookData;
    const s = sliceBook(book, [1, 2]);
    expect(s.ratings.map(([t]) => t)).toEqual([1, 2]);
    expect(s.history.map(([t]) => t)).toEqual([1]);
    expect(s.reliability!.map(([t]) => t)).toEqual([2]);
    expect(s.regions!.pending.map(([t]) => t)).toEqual([1]);
    expect(s.regions!.lift).toEqual(book.regions!.lift);
    expect(s.base).toEqual([1]);
  });

  it("stableJson ignores when something was computed, not what", () => {
    expect(stableJson({ a: 1, predictedAt: "x", nested: { checkedAt: "y", b: 2 } })).toBe(stableJson({ a: 1, predictedAt: "z", nested: { checkedAt: "w", b: 2 } }));
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
  });

  it("a bundle is prunable once its event's last day has passed", () => {
    const now = new Date(2026, 10, 2, 9);
    expect(bundleFinished({ end: "2026-11-01" }, now)).toBe(true);
    expect(bundleFinished({ end: "2026-11-02" }, now)).toBe(false);
    expect(bundleFinished({ end: null }, now)).toBe(false);
  });

  it("ages read short", () => {
    const t = Date.parse("2026-11-01T07:12:00Z");
    expect(snapshotAge("2026-11-01T07:12:00Z", t + 20_000)).toBe("just now");
    expect(snapshotAge("2026-11-01T07:12:00Z", t + 25 * 60_000)).toBe("25 min");
    expect(snapshotAge("2026-11-01T07:12:00Z", t + 190 * 60_000)).toBe("3 h 10 min");
    expect(snapshotAge("2026-11-01T07:12:00Z", t + 49 * 3600_000)).toBe("2 days");
  });
});
