import { describe, expect, it } from "vitest";
import { scheduleDifficulty, scheduleFromRows, scheduleLine, scheduleRankText, scheduleRows, scheduleWord, SCHEDULE_COLUMNS, type ScheduleMatch } from "./scheduleDifficulty";

// Eight teams: 1 and 2 are strong (60), the rest 20.
const rating = new Map([[1, 60], [2, 60], [3, 20], [4, 20], [5, 20], [6, 20], [7, 20], [8, 20]]);
const m = (red: number[], blue: number[], played = true, noRank?: number[]): ScheduleMatch => ({ red, blue, played, ...(noRank ? { noRank } : {}) });

describe("scheduleDifficulty", () => {
  it("rates opponents and partners against the field without the team itself", () => {
    // Team 3 meets both strong teams; team 4 partners one.
    const sd = scheduleDifficulty(rating, [m([3, 5], [1, 2]), m([4, 1], [6, 7]), m([2, 8], [5, 6])])!;
    const t3 = sd.teams.find((t) => t.team === 3)!.full!;
    // Field without team 3: (240 - 20) / 7 = 31.43. Opponents 60 → +28.6; partner 20 → −11.4.
    expect(t3.opponents).toBeCloseTo(28.6, 1);
    expect(t3.partners).toBeCloseTo(-11.4, 1);
    expect(t3.difficulty).toBeCloseTo(40, 1);
    expect(t3.rank).toBe(1);
    const t4 = sd.teams.find((t) => t.team === 4)!.full!;
    expect(t4.partners).toBeCloseTo(28.6, 1);
    expect(t4.difficulty).toBeLessThan(0);
    expect(sd.fieldMean).toBe(30);
    // Every team played, so all eight are ranked.
    expect(sd.teams.find((t) => t.team === 3)!.full!.of).toBe(8);
    expect(sd.teams.every((t) => t.full)).toBe(true);
  });

  it("is zero for everyone when every robot is rated the same", () => {
    const flat = new Map([...rating.keys()].map((t) => [t, 25]));
    const sd = scheduleDifficulty(flat, [m([1, 2], [3, 4]), m([5, 6], [7, 8])])!;
    expect(sd.teams.every((t) => t.full!.difficulty === 0 && t.full!.z === 0 && t.full!.rank === 1)).toBe(true);
  });

  it("splits the remaining schedule out only while quals are under way", () => {
    const quals = [m([3, 4], [1, 2]), m([3, 5], [6, 7], false), m([1, 3], [7, 8], false)];
    const sd = scheduleDifficulty(rating, quals)!;
    expect(sd.played).toBe(1);
    const t3 = sd.teams.find((t) => t.team === 3)!;
    expect(t3.full!.matches).toBe(3);
    expect(t3.remaining!.matches).toBe(2);
    // The hard match is behind it: what's left is easier than the whole.
    expect(t3.remaining!.difficulty).toBeLessThan(t3.full!.difficulty);
    // Before the first result and after the last there's no separate remaining view.
    expect(scheduleDifficulty(rating, quals.map((q) => ({ ...q, played: false })))!.teams.every((t) => t.remaining === null)).toBe(true);
    expect(scheduleDifficulty(rating, quals.map((q) => ({ ...q, played: true })))!.teams.every((t) => t.remaining === null)).toBe(true);
    // Nor once the event is over with matches never played.
    expect(scheduleDifficulty(rating, quals, { over: true })!.teams.every((t) => t.remaining === null && t.full)).toBe(true);
  });

  it("leaves a surrogate appearance out of that team's own schedule", () => {
    const sd = scheduleDifficulty(rating, [m([3, 4], [5, 6]), m([3, 7], [1, 2], true, [3])])!;
    const t3 = sd.teams.find((t) => t.team === 3)!.full!;
    expect(t3.matches).toBe(1);
    expect(t3.opponents).toBeLessThan(0);
    // Its partner there still counts the match.
    expect(sd.teams.find((t) => t.team === 7)!.full!.matches).toBe(1);
  });

  it("gives no figure without a schedule or with a tiny field", () => {
    expect(scheduleDifficulty(rating, [])).toBeNull();
    expect(scheduleDifficulty(new Map([[1, 1], [2, 2], [3, 3], [4, 4]]), [m([1, 2], [3, 4])])).toBeNull();
  });

  it("round-trips through pack rows", () => {
    const sd = scheduleDifficulty(rating, [m([3, 4], [1, 2]), m([3, 5], [6, 7], false), m([1, 8], [2, 6], false)])!;
    const rows = scheduleRows(sd).map((r) => Object.fromEntries([["team", r[0]], ...SCHEDULE_COLUMNS.map((c, i) => [c, r[i + 1]])]));
    expect(scheduleFromRows(rows)).toEqual(sd);
    expect(scheduleFromRows([])).toBeNull();
  });
});

describe("schedule words", () => {
  it("reads the rank from whichever end is shorter", () => {
    expect(scheduleRankText({ rank: 1, of: 24 })).toBe("hardest of 24");
    expect(scheduleRankText({ rank: 3, of: 24 })).toBe("3rd-hardest of 24");
    expect(scheduleRankText({ rank: 22, of: 24 })).toBe("3rd-easiest of 24");
    expect(scheduleRankText({ rank: 24, of: 24 })).toBe("easiest of 24");
    expect(scheduleRankText({ rank: 12, of: 24 })).toBe("12th-hardest of 24");
    expect(scheduleRankText({ rank: 11, of: 21 })).toBe("11th-hardest of 21");
  });

  it("says what the numbers mean in one plain line", () => {
    expect(scheduleLine({ opponents: 38.2, partners: -12.4 }, "your")).toBe("Your opponents average +38 over the field's, your partners −12.");
    expect(scheduleLine({ opponents: -0.3, partners: 4 })).toBe("Opponents average ±0 over the field's, partners +4.");
    expect(scheduleWord(1.2)).toBe("Hard");
    expect(scheduleWord(0)).toBe("Average");
    expect(scheduleWord(-1.5)).toBe("Easy");
  });
});
