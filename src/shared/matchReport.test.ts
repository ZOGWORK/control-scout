// v1.6 Task 2: the pre-match report's flag rules, one by one (src/shared/matchReport.ts).
import { describe, expect, it } from "vitest";
import { dataFlags, matchReportHref, topCutoff, watchFlags, type FlagCutoffs, type FlagInput, type TrendPoint, type WatchInput } from "./matchReport";

const base: FlagInput = { penOpr: 2, seasonMatches: 12, npDev: 20, npAvg: 100, qualPlayed: 12, trend: [] };
const cut: FlagCutoffs = { penalties: 10, inconsistent: 0.6, rising: 8 };
const kinds = (x: FlagInput, c = cut) => dataFlags(x, c).map((f) => f.kind);
const ev = (code: string, opr: number): TrendPoint => ({ code, name: `Event ${code}`, start: null, opr });

describe("topCutoff", () => {
  it("is the smallest value inside the top 15%", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(topCutoff(xs)).toBe(86); // 15 values: 86..100
  });
  it("needs enough teams to mean anything", () => {
    expect(topCutoff([1, 2, 3])).toBeNull();
    expect(topCutoff(Array.from({ length: 20 }, (_, i) => i), 0.15, 20)).toBe(17);
  });
  it("ignores values that aren't numbers", () => {
    expect(topCutoff([...Array.from({ length: 20 }, () => 1), NaN, Infinity])).toBe(1);
  });
});

describe("data flags", () => {
  it("none for an ordinary team", () => {
    expect(kinds(base)).toEqual([]);
  });

  it("High penalties: at or over the season's cutoff, with enough matches and at least a point a match", () => {
    expect(kinds({ ...base, penOpr: 10 })).toEqual(["penalties"]);
    expect(dataFlags({ ...base, penOpr: 12.34 }, cut)[0].detail).toMatch(/about 12\.3 penalty points a match/);
    expect(kinds({ ...base, penOpr: 9.9 })).toEqual([]);
    expect(kinds({ ...base, penOpr: 12, seasonMatches: 4 })).toEqual([]); // too few matches
    expect(kinds({ ...base, penOpr: 0.5 }, { ...cut, penalties: 0.2 })).toEqual([]); // under a point a match: never
    expect(kinds({ ...base, penOpr: 50 }, { ...cut, penalties: null })).toEqual([]); // the season can't say yet
    expect(kinds({ ...base, penOpr: null })).toEqual([]);
  });

  it("Inconsistent: its alliances' score spread over average in the season's top share", () => {
    expect(kinds({ ...base, npDev: 60, npAvg: 100 })).toEqual(["inconsistent"]);
    expect(kinds({ ...base, npDev: 59, npAvg: 100 })).toEqual([]);
    expect(kinds({ ...base, npDev: 80, npAvg: 100, qualPlayed: 4 })).toEqual([]);
    expect(kinds({ ...base, npDev: 80, npAvg: 0 })).toEqual([]);
    expect(kinds({ ...base, npDev: 80, npAvg: 100 }, { ...cut, inconsistent: null })).toEqual([]);
  });

  it("Rising: the rise from first event to latest in the season's top share, and at least 15% and 5 points", () => {
    expect(kinds({ ...base, trend: [ev("A", 40), ev("B", 50)] })).toEqual(["rising"]);
    expect(dataFlags({ ...base, trend: [ev("A", 40), ev("B", 44), ev("C", 50)] }, cut)[0].detail).toMatch(/^OPR up from 40\.0 at Event A to 50\.0 at Event C, a steeper climb than 85% of teams/);
    expect(kinds({ ...base, trend: [ev("A", 40), ev("B", 47.9)] })).toEqual([]); // under the season's cutoff (8)
    expect(kinds({ ...base, trend: [ev("A", 40), ev("B", 44.9)] }, { ...cut, rising: 1 })).toEqual([]); // under 5 points
    expect(kinds({ ...base, trend: [ev("A", 100), ev("B", 110)] }, { ...cut, rising: 1 })).toEqual([]); // 10%: under 15%
    expect(kinds({ ...base, trend: [ev("A", 10), ev("B", 90)] }, { ...cut, rising: null })).toEqual([]); // the season can't say yet
    expect(kinds({ ...base, trend: [ev("A", 50), ev("B", 40)] })).toEqual([]); // falling
    expect(kinds({ ...base, trend: [ev("A", 40)] })).toEqual([]); // one event
  });

  it("several at once, in a fixed order", () => {
    expect(kinds({ penOpr: 15, seasonMatches: 10, npDev: 70, npAvg: 100, qualPlayed: 10, trend: [ev("A", 20), ev("B", 40)] }))
      .toEqual(["penalties", "inconsistent", "rising"]);
  });
});

describe("watch flags", () => {
  const none: WatchInput = { myTeam: null, tracked: [], shortlist: [], picklist: [], assigned: [] };
  const k = (team: number, w: Partial<WatchInput>) => watchFlags(team, { ...none, ...w }).map((f) => f.kind);
  it("one per reason, in order: your team, assigned, pick list, tracked", () => {
    expect(k(1, {})).toEqual([]);
    expect(k(1, { myTeam: 1 })).toEqual(["mine"]);
    expect(k(1, { assigned: [1] })).toEqual(["assigned"]);
    expect(k(1, { picklist: [1] })).toEqual(["picklist"]);
    expect(k(1, { shortlist: [1] })).toEqual(["picklist"]);
    expect(k(1, { tracked: [1] })).toEqual(["tracked"]);
    expect(k(1, { myTeam: 1, tracked: [1], shortlist: [1], picklist: [1], assigned: [1] })).toEqual(["mine", "assigned", "picklist", "tracked"]);
    expect(k(2, { myTeam: 1, tracked: [1], assigned: [1] })).toEqual([]);
  });
  it("says which pick list", () => {
    expect(watchFlags(1, { ...none, picklist: [1] })[0].detail).toBe("On your workspace's pick list.");
    expect(watchFlags(1, { ...none, shortlist: [1] })[0].detail).toBe("On your shortlist.");
    expect(watchFlags(1, { ...none, picklist: [1], shortlist: [1] })[0].detail).toMatch(/workspace's pick list and your shortlist/);
  });
});

it("the report's address", () => {
  expect(matchReportHref({ season: 2025, code: "USNJQ1", key: "qual:0:12" })).toBe("/events/2025/USNJQ1/match/qual:0:12");
});
