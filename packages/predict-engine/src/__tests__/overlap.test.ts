/**
 * Alliance overlap (engine 2.11): in a qualification match, a 2-robot alliance's expectation loses
 * overlap_c × the smaller partner's contribution in each phase. Playoffs, other alliance sizes and
 * the default settings stay additive, and the factor sheet still splits the margin exactly.
 */
import { describe, it, expect } from "vitest";
import { RatingBook, type RatingParams } from "../rating";
import { explainMatch } from "../explain";
import { predictMatch } from "../matchModel";
import type { MatchRecord } from "../types";

const ON: Partial<RatingParams> = { overlapAuto: 0.25, overlapTeleop: 0.15 };
const side = (teams: number[], auto: number, teleop: number, endgame: number) => ({ teams, auto, teleop, endgame, np: auto + teleop + endgame, penCommitted: 2, total: auto + teleop + endgame });
let clock = 0;
const match = (red: ReturnType<typeof side>, blue: ReturnType<typeof side>): MatchRecord => ({ season: 2025, eventCode: "E", level: "qual", series: 0, number: ++clock, time: Date.UTC(2025, 10, 1) + clock * 60_000, red, blue });
function build(params: Partial<RatingParams>) {
  clock = 0;
  const b = new RatingBook(params);
  b.startSeason(2025);
  for (let i = 0; i < 5; i++) {
    b.update(match(side([1, 2], 30, 80, 10), side([3, 4], 10, 40, 20)));
    b.update(match(side([1, 3], 25, 60, 15), side([2, 4], 15, 60, 15)));
  }
  return b;
}

describe("alliance overlap", () => {
  it("is off by default: expectations add", () => {
    const b = build({});
    const sum = (k: "auto" | "teleop" | "endgame") => b.get(1)[k] + b.get(2)[k];
    const e = b.allianceExpectation([1, 2]);
    for (const k of ["auto", "teleop", "endgame"] as const) expect(e[k]).toBeCloseTo(sum(k), 12);
  });

  it("takes overlap × the smaller partner's contribution off a qualification alliance, per phase", () => {
    const b = build(ON);
    const [x, y] = [b.get(1), b.get(2)];
    const e = b.allianceExpectation([1, 2], "qual");
    expect(e.auto).toBeCloseTo(x.auto + y.auto - 0.25 * Math.min(x.auto, y.auto), 12);
    expect(e.teleop).toBeCloseTo(x.teleop + y.teleop - 0.15 * Math.min(x.teleop, y.teleop), 12);
    expect(e.endgame).toBeCloseTo(x.endgame + y.endgame, 12);
    expect(e.np).toBeCloseTo(e.auto + e.teleop + e.endgame, 12);
  });

  it("leaves playoffs and other alliance sizes additive", () => {
    const b = build(ON);
    expect(b.allianceOverlap([1, 2], "playoff")).toEqual({ auto: 0, teleop: 0, endgame: 0 });
    expect(b.allianceOverlap([1, 2, 3], "qual")).toEqual({ auto: 0, teleop: 0, endgame: 0 });
    expect(b.allianceOverlap([1], "qual")).toEqual({ auto: 0, teleop: 0, endgame: 0 });
  });

  it("lowers an alliance's predicted score by its overlap in quals, not in playoffs", () => {
    const b = build(ON);
    const mean = (level: "qual" | "playoff") => predictMatch(b, [1, 2], [3, 4], undefined, undefined, { context: { level } }).red.mean;
    const o = b.allianceOverlap([1, 2], "qual");
    expect(o.auto + o.teleop).toBeGreaterThan(0);
    expect(mean("qual")).toBeCloseTo(mean("playoff") - (o.auto + o.teleop + o.endgame), 9);
  });

  it("keeps the factor sheet an exact split of the predicted margin", () => {
    const b = build(ON);
    const x = explainMatch(b, [1, 2], [3, 4], { context: { level: "qual" } });
    const p = predictMatch(b, [1, 2], [3, 4], undefined, undefined, { context: { level: "qual" } });
    // Factors are rounded to 0.1 and only the largest three are shown; the four parts add up to the margin.
    const margin = p.red.mean - p.blue.mean, shown = x.factors.reduce((a, f) => a + f.points, 0);
    const pen = (b.get(3).pen + b.get(4).pen) - (b.get(1).pen + b.get(2).pen);
    const all = x.factors.some((f) => f.id === "pen") ? shown : shown + pen;
    expect(Math.abs(all - margin)).toBeLessThan(0.35);
  });
});
