// A league meet ranked on its own matches: the season's ranking points (3 a win, 1 a tie, plus bonus RPs in
// 2025+), averaged per counted match; a no-show or DQ scores 0 RP but the match counts; a surrogate's doesn't;
// ties broken by the season's keys (2026: average non-foul points, TIPS, auto).
import { describe, expect, it } from "vitest";
import { meetStandings, type MeetSide } from "./meetStandings";

const NO = { movement: false, goal: false, pattern: false };
const side = (teams: (number | { team: number; counts?: boolean; zero?: boolean })[], total: number, o: Partial<MeetSide> = {}): MeetSide => ({
  teams: teams.map((t) => (typeof t === "number" ? { team: t, counts: true, zero: false } : { counts: true, zero: false, ...t })),
  total, np: total, auto: 10, endgame: 0, tips: 0, bonus: NO, ...o,
});

describe("league meet standings", () => {
  it("ranking score: 3 a win, 1 a tie, plus bonus RPs, averaged over the meet's matches", () => {
    const rows = meetStandings(2026, [
      { red: side([1, 2], 50, { bonus: { movement: true, goal: false, pattern: false } }), blue: side([3, 4], 40) },
      { red: side([1, 3], 30), blue: side([2, 4], 30) },
    ]);
    const by = new Map(rows.map((r) => [r.team, r]));
    expect(by.get(1)).toMatchObject({ rs: (4 + 1) / 2, wins: 1, losses: 0, ties: 1, played: 2 });
    expect(by.get(4)).toMatchObject({ rs: 0.5, wins: 0, losses: 1, ties: 1 });
    expect(rows[0].team).toBe(1);
  });

  it("a no-show or DQ earns 0 RP there, but the match counts; a surrogate's match doesn't count for it", () => {
    const rows = meetStandings(2026, [
      { red: side([{ team: 1, zero: true }, { team: 2, counts: false }], 50), blue: side([3, 4], 40) },
      { red: side([1, 2], 50), blue: side([3, 4], 40) },
    ]);
    const by = new Map(rows.map((r) => [r.team, r]));
    expect(by.get(1)).toMatchObject({ rs: 1.5, wins: 2, played: 2 });
    expect(by.get(2)).toMatchObject({ rs: 3, wins: 1, played: 1 });
  });

  it("level on ranking score: the season's tiebreakers decide (2026: average non-foul points, then TIPS)", () => {
    const rows = meetStandings(2026, [
      { red: side([1, 2], 60, { np: 55, tips: 1 }), blue: side([3, 4], 20) },
      { red: side([5, 6], 60, { np: 55, tips: 3 }), blue: side([7, 8], 20) },
      { red: side([9, 10], 60, { np: 58 }), blue: side([11, 12], 20) },
    ]);
    expect(rows.slice(0, 6).map((r) => r.team)).toEqual([9, 10, 5, 6, 1, 2]);
    expect(rows[0].tb).toEqual([58, 0, 10]);
  });

  it("before 2025 a win is 2 RP and there are no bonus RPs", () => {
    const [top] = meetStandings(2024, [{ red: side([1, 2], 50, { bonus: { movement: true, goal: true, pattern: true } }), blue: side([3, 4], 40) }]);
    expect(top.rs).toBe(2);
  });
});
