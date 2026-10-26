// Match scouting helpers: the shared range and overlap rules, applying live changes, the signed-in member's own
// assignment (to prefill the session setup) and who has the other teams in each match (the Matches tab).
import { describe, expect, it } from "vitest";
import { coversMatch, matchAssignmentsOverlap, matchRangeLabel, qualNumber, type MatchAssignment } from "../shared/assignments";
import type { ScheduleMatch, Watching } from "../shared/scoutMatch";
import { applyMatchNotice, myMatchAssignment, othersByMatch } from "./slotAssignments";

let id = 0;
const ma = (over: Partial<MatchAssignment>): MatchAssignment => ({
  id: ++id, workspaceId: "w1", season: 2025, eventCode: "USNJQ1", watching: { kind: "slot", slot: "red1" }, fromMatch: null, toMatch: null,
  assigneeAccountId: 2, assigneeName: "Priya", createdByAccountId: 1, createdByName: "Coach", createdAt: 1, updatedAt: 1, version: 1, ...over,
});
const match = (n: number, red = [11, 12], blue = [21, 22]): ScheduleMatch =>
  ({ key: `q${n}`, label: `Q${n}`, level: "qual", time: null, startsAt: null, played: false, red, blue });

describe("ranges", () => {
  it("reads quals in any spelling and nothing else", () => {
    expect([qualNumber("q12"), qualNumber("Q 012"), qualNumber("7"), qualNumber("F1"), qualNumber("M2-1"), qualNumber(null)]).toEqual([12, 12, 7, null, null, null]);
  });
  it("labels and covers open-ended ranges, quals only", () => {
    expect([matchRangeLabel("Q1", "Q30"), matchRangeLabel("Q15", null), matchRangeLabel(null, "Q40"), matchRangeLabel(null, null), matchRangeLabel("Q5", "Q5")])
      .toEqual(["Q1–Q30", "Q15 on", "Up to Q40", "All quals", "Q5"]);
    const r = { fromMatch: "Q15", toMatch: "Q40" };
    expect([coversMatch(r, "Q14"), coversMatch(r, "q15"), coversMatch(r, "Q40"), coversMatch(r, "Q41"), coversMatch({ fromMatch: null, toMatch: null }, "F1")])
      .toEqual([false, true, true, false, false]);
  });
  it("overlaps only on a shared slot, in shared matches, at the same event", () => {
    const a = ma({ watching: { kind: "alliance", side: "red" }, fromMatch: "Q1", toMatch: "Q30" });
    expect(matchAssignmentsOverlap(a, ma({ watching: { kind: "slot", slot: "red2" }, fromMatch: "Q30" }))).toBe(true);
    expect(matchAssignmentsOverlap(a, ma({ watching: { kind: "slot", slot: "red2" }, fromMatch: "Q31" }))).toBe(false);
    expect(matchAssignmentsOverlap(a, ma({ watching: { kind: "slot", slot: "blue1" } }))).toBe(false);
    expect(matchAssignmentsOverlap(a, ma({ watching: { kind: "all" }, eventCode: "OTHER" }))).toBe(false);
  });
});

describe("applyMatchNotice", () => {
  it("never lets an older copy win, drops deletes for good, and lets an edit move one out of the season", () => {
    const a = ma({ version: 2, toMatch: "Q20" });
    expect(applyMatchNotice([a], { action: "updated", matchAssignments: [{ ...a, version: 1, toMatch: "Q9" }] }, 2025)[0].toMatch).toBe("Q20");
    expect(applyMatchNotice([a], { action: "updated", matchAssignments: [{ ...a, version: 3, toMatch: "Q9" }] }, 2025)[0].toMatch).toBe("Q9");
    expect(applyMatchNotice([a], { action: "deleted", matchAssignments: [a] }, 2025)).toEqual([]);
    expect(applyMatchNotice([], { action: "created", matchAssignments: [a] }, 2025, new Set([a.id]))).toEqual([]);
    expect(applyMatchNotice([a], { action: "updated", matchAssignments: [{ ...a, version: 3, season: 2024 }] }, 2025)).toEqual([]);
  });
});

describe("myMatchAssignment", () => {
  const blue: Watching = { kind: "alliance", side: "blue" };
  const list = [
    ma({ assigneeAccountId: 2, fromMatch: "Q31", toMatch: "Q60", watching: blue }),
    ma({ assigneeAccountId: 2, fromMatch: "Q1", toMatch: "Q30" }),
    ma({ assigneeAccountId: 3, assigneeName: "Sam" }),
    ma({ assigneeAccountId: 2, eventCode: "OTHER", watching: { kind: "all" } }),
  ];
  it("is the member's own at that event, earliest first, or the one covering the match asked about", () => {
    expect(myMatchAssignment(list, 2, "usnjq1", 2025)).toMatchObject({ watching: { kind: "slot", slot: "red1" }, fromMatch: "Q1", toMatch: "Q30" });
    expect(myMatchAssignment(list, 2, "USNJQ1", 2025, "Q45")?.watching).toEqual(blue);
    expect(myMatchAssignment(list, 2, "USNJQ1", 2025, "F1")?.fromMatch).toBe("Q1");
  });
  it("is null signed out, for a member with none, or in another season", () => {
    expect(myMatchAssignment(list, null, "USNJQ1", 2025)).toBeNull();
    expect(myMatchAssignment(list, 9, "USNJQ1", 2025)).toBeNull();
    expect(myMatchAssignment(list, 2, "USNJQ1", 2024)).toBeNull();
  });
});

describe("othersByMatch", () => {
  const schedule = [match(1), match(2), match(31, [11, 12], [21, 23]), { ...match(1), key: "f1", label: "F1", level: "playoff" as const }];
  const list = [
    ma({ assigneeAccountId: 1, assigneeName: "Me", watching: { kind: "alliance", side: "red" } }),
    ma({ assigneeAccountId: 2, assigneeName: "Priya", watching: { kind: "slot", slot: "blue1" }, fromMatch: "Q1", toMatch: "Q30" }),
    ma({ assigneeAccountId: 3, assigneeName: "Marcus", watching: { kind: "alliance", side: "blue" }, fromMatch: "Q15" }),
    ma({ assigneeAccountId: 4, assigneeName: "Quinn", watching: { kind: "all" }, fromMatch: "Q2", toMatch: "Q2" }),
    ma({ assigneeAccountId: 5, assigneeName: "Elsewhere", eventCode: "OTHER" }),
  ];

  it("keys by normalized label, leaves me and playoffs out, and says done when their teams have entries", () => {
    const scouted = new Map([["Q1", new Set([21])], ["Q2", new Set([11, 12])], ["Q31", new Set([21])]]);
    const out = othersByMatch(list, schedule, scouted, 1, { eventCode: "USNJQ1", season: 2025 });
    expect([...out.keys()]).toEqual(["Q1", "Q2", "Q31"]);
    expect(out.get("Q1")).toEqual([{ side: "blue1", name: "Priya", done: true }]);
    // All four teams: one line per alliance, each done on its own.
    expect(out.get("Q2")).toEqual([{ side: "red", name: "Quinn", done: true }, { side: "blue", name: "Quinn", done: false }, { side: "blue1", name: "Priya", done: false }]);
    expect(out.get("Q31")).toEqual([{ side: "blue", name: "Marcus", done: false }]);
  });

  it("without `at` it reads every assignment it's given; nothing to show is an empty map", () => {
    expect(othersByMatch(list, [match(5)], new Map(), 1).get("Q5")?.map((o) => o.name)).toEqual(["Elsewhere", "Priya"]);
    expect(othersByMatch([list[0]], schedule, new Map(), 1).size).toBe(0);
  });
});
