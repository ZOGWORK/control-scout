import { describe, expect, it } from "vitest";
import { callTally, pct } from "./seasonSoFar";
import type { MatchView } from "../shared/api";

const t = (number: number) => ({ number, onField: true, surrogate: false });
const match = (score: [number, number] | null, pRed: number | null, kind: "live" | "backtest" | "now" = "live", red = [1, 2], blue = [3, 4]) => ({
  played: !!score,
  red: { teams: red.map(t), score: score ? { total: score[0] } : null },
  blue: { teams: blue.map(t), score: score ? { total: score[1] } : null },
  prediction: pRed == null ? null : { pRed, kind },
}) as unknown as MatchView;

describe("callTally", () => {
  it("counts right calls per kind and never blends live with replayed", () => {
    const r = callTally([
      match([100, 50], 0.7), // live, right
      match([40, 50], 0.6), // live, upset
      match([40, 50], 0.3, "backtest"), // replayed, right
      match([60, 60], 0.8), // tie: no right or wrong
      match(null, 0.8), // not played
      match([90, 10], null), // no call
      match([90, 10], 0.9, "now"), // not a logged or replayed call
      match([90, 10], 0.9, "live", [5, 6], [7, 8]), // the team isn't in it
    ], 1);
    expect(r).toEqual({ live: { right: 1, of: 2 }, backtest: { right: 1, of: 1 } });
  });
});

describe("pct", () => {
  it("rounds and has no answer for nothing", () => {
    expect(pct(26, 32)).toBe(81);
    expect(pct(0, 0)).toBeNull();
  });
});
