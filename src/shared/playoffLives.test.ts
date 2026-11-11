import { describe, expect, it } from "vitest";
import { livesLabel, playoffLives, type LivesMatch } from "./playoffLives";

// A 4-alliance double-elimination playoff (2025–26): A1 = 1/11, A2 = 2/22, A3 = 3/33, A4 = 4/44.
const A = { 1: [1, 11], 2: [2, 22], 3: [3, 33], 4: [4, 44] } as const;
const m = (series: number, red: readonly number[], blue: readonly number[], redScore: number | null, blueScore: number | null, number = 1): LivesMatch =>
  ({ series, number, red: [...red], blue: [...blue], played: redScore != null, redScore, blueScore });
// M1 1v4 (A4 loses), M2 2v3 (A3 loses), M3 lower 4v3 (A3 out), M4 upper 1v2 (A2 loses),
// M5 lower final 2v4 (A4 out), M6 grand final 1v2 (A1 loses: replayed), M7 replay 1v2 (A2 out).
const bracket = [
  m(1, A[1], A[4], 200, 100), m(2, A[2], A[3], 180, 120), m(3, A[4], A[3], 150, 90), m(4, A[1], A[2], 210, 170),
  m(5, A[2], A[4], 160, 140), m(6, A[1], A[2], 150, 190), m(7, A[1], A[2], 200, 120),
];

describe("double-elimination lives", () => {
  const lives = playoffLives(2025, bracket);
  it("an upper-bracket loss takes the first life: down to the lower bracket", () => {
    expect(lives.get("1:1")).toEqual({ red: { before: 2, after: 2 }, blue: { before: 2, after: 1 } });
    expect(livesLabel(lives.get("1:1")!.blue)).toBe("Lost a life this match: down to the lower bracket");
    expect(livesLabel(lives.get("1:1")!.red)).toBe("2 lives left");
  });
  it("a lower-bracket loss eliminates", () => {
    expect(lives.get("3:1")).toEqual({ red: { before: 1, after: 1 }, blue: { before: 1, after: 0 } });
    expect(livesLabel(lives.get("3:1")!.blue)).toBe("Lost its last life this match: eliminated");
    expect(livesLabel(lives.get("3:1")!.red)).toBe("1 life left");
  });
  it("the final: the upper-bracket alliance arrives with 2 lives, the lower one with 1; losing it once replays it", () => {
    expect(lives.get("6:1")).toEqual({ red: { before: 2, after: 1, final: true }, blue: { before: 1, after: 1, final: true } });
    expect(livesLabel(lives.get("6:1")!.red)).toBe("Lost a life this match: the final is played again");
    expect(lives.get("7:1")).toEqual({ red: { before: 1, after: 1, final: true }, blue: { before: 1, after: 0, final: true } });
  });
  it("a tie is replayed: nobody loses a life", () => {
    const l = playoffLives(2025, [m(1, A[1], A[4], 100, 100, 1), m(1, A[1], A[4], 120, 100, 2), ...bracket.slice(1)]);
    expect(l.get("1:1")).toEqual({ red: { before: 2, after: 2 }, blue: { before: 2, after: 2 } });
    expect(l.get("1:2")!.blue).toEqual({ before: 2, after: 1 });
  });
  it("an unplayed match shows the lives coming in, none taken", () => {
    const l = playoffLives(2025, [...bracket.slice(0, 5), m(6, A[1], A[2], null, null)]);
    expect(l.get("6:1")).toEqual({ red: { before: 2, after: 2, final: true }, blue: { before: 1, after: 1, final: true } });
  });
  it("alliances are who played together: a third robot joins its alliance", () => {
    const l = playoffLives(2025, [m(1, [1, 11], A[4], 200, 100), m(2, A[2], A[3], 180, 120), m(3, A[4], A[3], 150, 90), m(4, [1, 111], A[2], 210, 170), m(5, A[2], A[4], 160, 140), m(6, [11, 111], A[2], 150, 190)]);
    expect(l.get("6:1")!.red).toEqual({ before: 2, after: 1, final: true });
  });
});

describe("no hearts outside double elimination", () => {
  it("a best-of-3 final (2 alliances) has none", () => {
    expect(playoffLives(2025, [m(1, A[1], A[2], 100, 90, 1), m(1, A[1], A[2], 80, 90, 2), m(1, A[1], A[2], 100, 90, 3)]).size).toBe(0);
  });
  it("the old best-of-3 semifinal bracket (2023–24) has none", () => {
    expect(playoffLives(2023, [m(1, A[1], A[4], 100, 90), m(2, A[2], A[3], 100, 90), m(0, A[1], A[2], 100, 90)]).size).toBe(0);
  });
  it("a bracket that doesn't fit (5 alliances) has none", () => {
    expect(playoffLives(2025, [...bracket, m(8, [5, 55], A[1], 1, 2)]).size).toBe(0);
  });
});
