import { describe, expect, it } from "vitest";
import { matchProgress, nextMatchIndex, normalizeMatchLabel, parseWatching, scheduleFromMatches, scoutedByMatch, teamsWatched, watchingLabel, type ScheduleMatch } from "./scoutMatch";
import type { MatchView } from "./api";

const sm = (n: number, red: number[], blue: number[]): ScheduleMatch => ({ key: `qual:0:${n}`, label: `Q${n}`, level: "qual", time: null, startsAt: null, played: false, red, blue });
const sched = [sm(1, [1, 2], [3, 4]), sm(2, [5, 6], [7, 8]), sm(3, [1, 5], [2, 6]), sm(4, [3, 7], [4, 8])];
const entry = (team: number, matchLabel: string | null, over: Partial<{ eventCode: string | null; kind: string; deleted: boolean }> = {}) =>
  ({ team, matchLabel, eventCode: "USNJQ1", kind: "match", ...over });

describe("normalizeMatchLabel", () => {
  it("spells every way of typing a qualification match the same", () => {
    for (const s of ["12", "q12", "Q12", " q 12 ", "Q012", "qm12", "QUAL 12"]) expect(normalizeMatchLabel(s)).toBe("Q12");
  });
  it("keeps playoff and other labels, tidied", () => {
    expect(normalizeMatchLabel("m2-1")).toBe("M2-1");
    expect(normalizeMatchLabel("M02-01")).toBe("M2-1");
    expect(normalizeMatchLabel("f 1")).toBe("F1");
    expect(normalizeMatchLabel("Practice")).toBe("PRACTICE");
    expect(normalizeMatchLabel("  ")).toBeNull();
    expect(normalizeMatchLabel(null)).toBeNull();
  });
});

describe("watching", () => {
  it("reads only valid values", () => {
    expect(parseWatching({ kind: "slot", slot: "blue2" })).toEqual({ kind: "slot", slot: "blue2" });
    expect(parseWatching({ kind: "alliance", side: "green" })).toBeNull();
    expect(parseWatching("all")).toBeNull();
    expect(watchingLabel({ kind: "slot", slot: "red2" })).toBe("Red 2");
    expect(watchingLabel({ kind: "alliance", side: "blue" })).toBe("Blue alliance");
  });
  it("picks the watched teams of a match", () => {
    expect(teamsWatched(sched[0], { kind: "all" }).map((t) => t.team)).toEqual([1, 2, 3, 4]);
    expect(teamsWatched(sched[0], { kind: "alliance", side: "blue" })).toEqual([{ team: 3, side: "blue", station: 1 }, { team: 4, side: "blue", station: 2 }]);
    expect(teamsWatched(sched[0], { kind: "slot", slot: "red2" })).toEqual([{ team: 2, side: "red", station: 2 }]);
    expect(teamsWatched({ red: [1], blue: [] }, { kind: "slot", slot: "red2" })).toEqual([]);
  });
});

describe("progress", () => {
  const red = { kind: "alliance", side: "red" } as const;
  it("counts entries by normalized label at the event only", () => {
    const s = scoutedByMatch([entry(1, "q1"), entry(2, "1"), entry(5, "Q2"), entry(6, "Q2", { eventCode: "OTHER" }), entry(7, "Q2", { kind: "pit" }), entry(8, "Q2", { deleted: true })], "usnjq1");
    expect([...s.get("Q1")!]).toEqual([1, 2]);
    expect([...s.get("Q2")!]).toEqual([5]);
    expect(matchProgress(sched[0], red, s)).toBe("done");
    expect(matchProgress(sched[1], red, s)).toBe("partial");
    expect(matchProgress(sched[2], red, s)).toBe("todo");
  });
  it("opens after the last match scouted, leaving a skipped one behind", () => {
    const s = scoutedByMatch([entry(1, "Q1"), entry(2, "Q1"), entry(1, "Q3"), entry(5, "Q3")], "USNJQ1");
    expect(nextMatchIndex(sched, red, s)).toBe(3); // Q2 skipped stays behind
    expect(nextMatchIndex(sched, red, new Map())).toBe(0);
    expect(nextMatchIndex([], red, s)).toBe(-1);
    const all = scoutedByMatch([entry(3, "Q4"), entry(7, "Q4")], "USNJQ1");
    expect(nextMatchIndex(sched, red, all)).toBe(0); // the last match is done: the first still open
  });
});

describe("scheduleFromMatches", () => {
  const mv = (level: "qual" | "playoff", series: number, number: number, label: string): MatchView => ({
    season: 2026, code: "X", key: `${level}:${series}:${number}`, level, series, number, label, time: null, startsAt: null, played: false,
    red: { teams: [{ number: 10, surrogate: false, dq: false, onField: true }, { number: 11, surrogate: true, dq: false, onField: true }], score: null },
    blue: { teams: [{ number: 12, surrogate: false, dq: false, onField: true }, { number: 500, surrogate: false, dq: false, onField: false }], score: null }, video: null, prediction: null,
  });
  it("orders quals before playoffs and keeps the teams on the field", () => {
    const s = scheduleFromMatches([mv("playoff", 1, 1, "M1"), mv("qual", 0, 10, "Q10"), mv("qual", 0, 2, "Q2")]);
    expect(s.map((m) => m.label)).toEqual(["Q2", "Q10", "M1"]);
    expect(s[0].red).toEqual([10, 11]);
    expect(s[0].blue).toEqual([12]); // 500 was listed but didn't play
  });
});
