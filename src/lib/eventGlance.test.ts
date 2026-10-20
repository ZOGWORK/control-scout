// Every "At a glance" stat, for an upcoming, a live, a finished and a remote event, and the ones that
// must stay hidden (null / empty) where they don't apply.
import { describe, expect, it } from "vitest";
import { callRecord, glanceStats, phaseOf } from "./eventGlance";
import { detail, finished, live, m, remote, row, upcoming } from "./eventGlance.fixtures";

describe("glanceStats: upcoming event", () => {
  const s = glanceStats(upcoming());
  it("shows the field: team count, strongest by rating, average season OPR", () => {
    expect(s.phase).toBe("upcoming");
    expect(s.teams).toBe(5);
    expect(s.strongest.map((t) => [t.team, t.value])).toEqual([[200, 120], [300, 95], [100, 80]]);
    expect(s.avgSeasonOpr).toBeCloseTo((70 + 110 + 50) / 3);
  });
  it("hides every match stat (no schedule yet)", () => {
    expect(s.progress).toBeNull();
    expect([s.avgScore, s.high, s.avgMargin, s.closest, s.avgPenalty, s.upsets, s.next, s.ended, s.winners, s.inspire]).toEqual(Array(10).fill(null));
    expect(s.record).toEqual([]);
    expect(s.leaders).toEqual({ auto: null, teleop: null, endgame: null });
  });
  it("drops the average season OPR when under half the field has one", () => {
    const d = upcoming();
    d.field = d.field.map((f, i) => (i < 3 ? { ...f, seasonOpr: null } : f));
    expect(glanceStats(d).avgSeasonOpr).toBeNull();
  });
});

describe("glanceStats: live event", () => {
  const s = glanceStats(live());
  it("progress and phase", () => {
    expect(s.progress).toEqual({ played: 3, total: 5 });
    expect(s.phase).toBe("quals");
  });
  it("scoring: average alliance score, high score with alliance, average winning margin", () => {
    expect(s.avgScore).toBeCloseTo((120 + 100 + 90 + 150 + 98 + 100) / 6);
    expect(s.high).toEqual({ key: "qual:0:2", label: "Q2", score: 150, alliance: "blue", teams: [2, 4] });
    expect(s.avgMargin).toBeCloseTo((20 + 60 + 2) / 3);
  });
  it("closest match and penalties per match", () => {
    expect(s.closest).toEqual({ key: "qual:0:3", label: "Q3", margin: 2 });
    expect(s.avgPenalty).toBeCloseTo((16 + 4 + 2) / 3);
  });
  it("calls: live and backtest kept apart; upsets from the live calls", () => {
    expect(s.record).toEqual([{ kind: "live", n: 2, right: 1 }, { kind: "backtest", n: 1, right: 1 }]);
    expect(s.upsets).toEqual({ kind: "live", n: 1, of: 2, biggest: { key: "qual:0:2", label: "Q2", pFav: 0.8, tier: "moderate" } });
  });
  it("category leaders by OPR", () => {
    expect(s.leaders.auto).toMatchObject({ team: 2, value: 30 });
    expect(s.leaders.teleop).toMatchObject({ team: 1, value: 50 });
    expect(s.leaders.endgame).toMatchObject({ team: 3, value: 25 });
  });
  it("next match (schedule order), and nothing about how it ended", () => {
    expect(s.next).toMatchObject({ key: "qual:0:4", label: "Q4", startsAt: "2026-03-14T15:30:00Z" });
    expect(s.ended).toBeNull();
    expect(s.winners).toBeNull();
    expect(s.strongest).toEqual([]);
  });
});

describe("glanceStats: finished event", () => {
  const s = glanceStats(finished());
  it("ended, winners in alliance order, Inspire 1st place", () => {
    expect(s.phase).toBe("done");
    expect(s.ended).toBe("2026-03-15");
    expect(s.winners).toEqual({ alliance: 1, teams: [1, 3] });
    expect(s.inspire).toEqual({ team: 2, name: "Team 2" });
    expect(s.next).toBeNull();
  });
  it("a tie is the closest match; ties count in the average score, not the margin", () => {
    expect(s.closest).toEqual({ key: "qual:0:2", label: "Q2", margin: 0 });
    expect(s.avgScore).toBeCloseTo(780 / 6);
    expect(s.avgMargin).toBeCloseTo(40);
    expect(s.high).toMatchObject({ key: "playoff:1:1", label: "F1", score: 200, alliance: "red", teams: [1, 3] });
    expect(s.avgPenalty).toBeCloseTo(20 / 3);
  });
  it("no upsets: says so (biggest null), ties not counted as calls", () => {
    expect(s.record).toEqual([{ kind: "backtest", n: 2, right: 2 }]);
    expect(s.upsets).toEqual({ kind: "backtest", n: 0, of: 2, biggest: null });
  });
  it("the high score credits only the robots that played (not a benched third member)", () => {
    const d = finished();
    const red = d.matches[2].red;
    red.teams.push({ number: 4, surrogate: false, dq: false, onField: false });
    expect(glanceStats(d).high?.teams).toEqual([1, 3]);
  });
  it("an even (50%) call has no favourite: never an upset, and not counted in the upsets' total", () => {
    const d = live();
    d.matches[1].prediction!.pRed = 0.5; // Q2: red lost; at 80% it was the upset
    expect(glanceStats(d).upsets).toEqual({ kind: "live", n: 0, of: 1, biggest: null });
    d.matches[0].prediction!.pRed = 0.5;
    expect(glanceStats(d).upsets).toBeNull();
  });
  it("winners without alliance data are listed as awarded", () => {
    const d = finished();
    d.alliances = [];
    expect(glanceStats(d).winners).toEqual({ alliance: null, teams: [3, 1] });
  });
});

describe("glanceStats: remote event", () => {
  const s = glanceStats(remote());
  it("scores per team, no head-to-head stats", () => {
    expect(s.avgScore).toBeCloseTo((60 + 85 + 70) / 3);
    expect(s.high).toEqual({ key: "qual:0:2", label: "Q2", score: 85, alliance: "red", teams: [8] });
    expect([s.avgMargin, s.closest, s.avgPenalty, s.upsets]).toEqual([null, null, null, null]);
    expect(s.record).toEqual([]);
  });
});

describe("phaseOf", () => {
  it("playoffs once quals are all played and a playoff is scheduled, or one is played", () => {
    const q = (n: number, played: boolean) => m(n, [1, 2], [3, 4], played ? { red: { total: 1, np: 1, auto: 0, teleop: 0, endgame: 0, pen: 0 }, blue: { total: 0, np: 0, auto: 0, teleop: 0, endgame: 0, pen: 0 } } : {});
    const f = m(1, [1, 2], [3, 4], { level: "playoff" });
    expect(phaseOf(detail({ status: "live", matches: [q(1, true), q(2, true), f] }))).toBe("playoffs");
    expect(phaseOf(detail({ status: "live", matches: [q(1, true), q(2, false), f] }))).toBe("quals");
    expect(phaseOf(detail({ status: "live", matches: [] }))).toBe("upcoming");
    expect(phaseOf(detail({ status: "live", matches: [q(1, true)] }))).toBe("done");
  });
});

describe("callRecord", () => {
  it("only decided matches with a call", () => {
    const d = detail({ status: "finished", field: [row(1)], matches: [m(1, [1], [2], { red: { total: 5, np: 5, auto: 0, teleop: 0, endgame: 0, pen: 0 }, blue: { total: 5, np: 5, auto: 0, teleop: 0, endgame: 0, pen: 0 }, pRed: 0.6 })] });
    expect(callRecord(d.matches)).toEqual([]);
  });
});
