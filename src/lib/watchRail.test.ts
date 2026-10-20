import { describe, expect, it } from "vitest";
import type { EventDetail, MatchView } from "../shared/api";
import { nextFlip, railModel, RESULT_MS, verdict } from "./watchRail";

const T0 = Date.parse("2026-10-24T15:00:00Z");
const t = (n: number) => ({ number: n, surrogate: false, dq: false, onField: true });
const sc = (x: number) => ({ total: x, np: x, auto: 0, teleop: 0, endgame: 0, pen: 0 });
function q(n: number, result?: [number, number], pRed = 0.6): MatchView {
  return {
    season: 2026, code: "X", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null,
    startsAt: new Date(T0 + n * 7 * 60_000).toISOString(), played: !!result,
    red: { teams: [t(n * 10 + 1), t(n * 10 + 2)], score: result ? sc(result[0]) : null },
    blue: { teams: [t(n * 10 + 3), t(n * 10 + 4)], score: result ? sc(result[1]) : null },
    video: null, prediction: { pRed, redMean: 120, blueMean: 100, tier: "confident", kind: "live", predictedAt: null },
  };
}
const ev = (matches: MatchView[], status: "live" | "finished" | "upcoming" = "live") => ({ event: { status } as EventDetail["event"], matches });

describe("railModel", () => {
  it("calls the next unplayed match, with the three after it", () => {
    const r = railModel(ev([q(1, [100, 90]), q(2), q(3), q(4), q(5), q(6)]), T0, null);
    expect(r.current?.number).toBe(2);
    expect(r.upNext.map((m) => m.number)).toEqual([3, 4, 5]);
    expect(r.result).toBeNull();
  });

  it("when the match being called gets its result: the result for a minute, then the next match", () => {
    const before = [q(1, [100, 90]), q(2), q(3), q(4)];
    const after = [q(1, [100, 90]), q(2, [80, 110]), q(3), q(4)];
    const flip = nextFlip("qual:0:2", after, T0, null);
    expect(flip).toEqual({ key: "qual:0:2", until: T0 + RESULT_MS });
    const showing = railModel(ev(after), T0 + 1000, flip);
    expect(showing.result?.number).toBe(2);
    expect(showing.current?.number).toBe(3);
    expect(railModel(ev(after), T0 + RESULT_MS + 1, flip).result).toBeNull();
    // A refresh that changes nothing keeps the flip that's there.
    expect(nextFlip("qual:0:2", before, T0, null)).toBeNull();
  });

  it("hides once the event is finished", () => {
    expect(railModel(ev([q(1, [1, 2])], "finished"), T0, null)).toEqual({ hidden: true, result: null, current: null, upNext: [] });
  });

  it("verdict: called it, upset, or neither", () => {
    expect(verdict(q(1, [100, 90], 0.7))).toBe("called");
    expect(verdict(q(1, [80, 90], 0.7))).toBe("upset");
    expect(verdict(q(1, [90, 90], 0.7))).toBeNull();
    expect(verdict(q(1))).toBeNull();
  });
});
