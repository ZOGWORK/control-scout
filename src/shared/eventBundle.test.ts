import { describe, expect, it } from "vitest";
import type { RatingBookData } from "@control-scout/predict-engine";
import { bundleFinished, matchClock, sliceBook, snapshotAge, snapshotClock, stableJson, zoneAbbr } from "./eventBundle";

describe("times on the bundle page: 12-hour with AM/PM", () => {
  it("snapshotClock says 7:23 PM, with the day when it isn't today", () => {
    const at = new Date(2026, 9, 31, 19, 23).toISOString();
    expect(snapshotClock(at, new Date(2026, 9, 31, 20, 0))).toBe("7:23 PM");
    expect(snapshotClock(at, new Date(2026, 10, 1, 9, 0))).toBe("Oct 31, 7:23 PM");
    expect(snapshotClock(new Date(2026, 9, 31, 0, 5).toISOString(), new Date(2026, 9, 31, 1, 0))).toBe("12:05 AM");
  });

  it("matchClock reads FIRST's event-local time", () => {
    expect(matchClock("2025-11-16T11:58:48.832")).toBe("11:58 AM");
    expect(matchClock("2025-11-16T12:04:00")).toBe("12:04 PM");
    expect(matchClock("2025-11-16T00:30:00")).toBe("12:30 AM");
    expect(matchClock("2025-11-16T19:23:00")).toBe("7:23 PM");
    expect(matchClock(null)).toBeNull();
  });

  it("zoneAbbr gives a short zone name, never a raw IANA id or a GMT offset", () => {
    const pt = zoneAbbr("America/Los_Angeles", new Date("2026-11-01T12:00:00Z"));
    expect(["PT", "PDT", "PST"]).toContain(pt);
    expect(zoneAbbr(null)).toBeNull();
    expect(zoneAbbr("Not/A_Zone")).toBeNull();
  });
});

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
