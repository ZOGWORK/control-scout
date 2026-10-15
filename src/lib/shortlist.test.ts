import { describe, expect, it } from "vitest";
import { applyOrder, lastPlayed, moveItem, moveTeam, nearestSlot, predictionSnapshot, setNote, shortlistCsvRows } from "./shortlist";
import { cleanValue, EMPTY_STATE, mergeValue, PERSONAL_KEYS } from "../shared/personal";
import type { MatchView, ShortlistTeam } from "../shared/api";

describe("reorder", () => {
  it("moves an item and clamps the destination", () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveItem([1, 2, 3], 1, 99)).toEqual([1, 3, 2]);
    expect(moveItem([1, 2, 3], 1, -5)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 7, 0)).toEqual([1, 2, 3]);
  });
  it("moves a team by places, ignoring unknown teams", () => {
    expect(moveTeam([10, 20, 30], 30, -1)).toEqual([10, 30, 20]);
    expect(moveTeam([10, 20, 30], 10, -1)).toEqual([10, 20, 30]);
    expect(moveTeam([10, 20, 30], 99, 1)).toEqual([10, 20, 30]);
  });
  it("applies a shown order without losing teams beyond the page or reviving removed ones", () => {
    // 4 is past the shown slice; 9 was removed elsewhere while dragging.
    expect(applyOrder([1, 2, 3, 4], [3, 1, 9, 2])).toEqual([3, 1, 2, 4]);
  });
  it("lands on the slot whose box is nearest the pointer (list and grid)", () => {
    const rows = [0, 1, 2].map((i) => ({ left: 0, top: i * 50, width: 300, height: 50 }));
    expect(nearestSlot(rows, 100, 10)).toBe(0);
    expect(nearestSlot(rows, 100, 120)).toBe(2);
    expect(nearestSlot(rows, 100, 400)).toBe(2);
    const grid = [[0, 0], [200, 0], [0, 150], [200, 150]].map(([left, top]) => ({ left, top, width: 180, height: 140 }));
    expect(nearestSlot(grid, 250, 200)).toBe(3);
    expect(nearestSlot(grid, 195, 10)).toBe(1); // in the gap, nearer the right card
  });
});

describe("notes", () => {
  it("sets and clears a note", () => {
    const a = setNote({}, 18360, "great auto");
    expect(a).toEqual({ "18360": "great auto" });
    expect(setNote(a, 18360, "  ")).toEqual({});
  });
  it("cleans stored notes: bad keys, non-strings, blanks and overlong text", () => {
    const v = cleanValue("shortlistNotes", { "18360": " ok ", abc: "x", "0": "zero", "1": 5, "2": "   ", "3": "y".repeat(900) });
    expect(v).toEqual({ "18360": "ok", "3": "y".repeat(500) });
    expect(cleanValue("shortlistNotes", [1, 2])).toBeNull();
    expect(cleanValue("shortlistNotes", "nope")).toBeNull();
  });
  it("first sign-in merge keeps every team's note; the newer side wins a clash", () => {
    const m = mergeValue("shortlistNotes", { value: { "1": "acct", "2": "acct2" }, updatedAt: 100 }, { value: { "1": "device", "3": "dev3" }, updatedAt: 200 });
    expect(m!.value).toEqual({ "1": "device", "2": "acct2", "3": "dev3" });
    const older = mergeValue("shortlistNotes", { value: { "1": "acct" }, updatedAt: 300 }, { value: { "1": "device" }, updatedAt: 200 });
    expect(older!.value).toEqual({ "1": "acct" });
  });
});

describe("older shortlist data", () => {
  it("an old device or account (bookmarks only, no notes key) still loads, order intact", () => {
    expect(PERSONAL_KEYS).toContain("shortlistNotes");
    expect(EMPTY_STATE.shortlistNotes).toEqual({});
    // Old stored bookmarks keep their order (it is the pick order) and drop junk.
    expect(cleanValue("bookmarks", [30, 10, 20, 10, "x"])).toEqual([30, 10, 20]);
  });
  it("merging an old device's list into the account keeps the account's pick order first", () => {
    const m = mergeValue("bookmarks", { value: [3, 1, 2], updatedAt: 10 }, { value: [2, 5], updatedAt: 20 });
    expect(m!.value).toEqual([3, 1, 2, 5]);
  });
});

const team = (n: number, extra: Partial<ShortlistTeam> = {}): ShortlistTeam => ({
  team: n, name: `T${n}`, place: "Here", opr: 50, oprRank: 10, of: 100, rating: 40, ratingSd: 3, record: "5-1-0", lastEvent: null, nextEvent: null,
  breakdown: { auto: 10, teleop: 30, endgame: 10 }, events: [], ...extra,
});

describe("CSV", () => {
  it("lists picks in order with notes", () => {
    const rows = shortlistCsvRows([team(2), team(1)], { "1": "backup pick" });
    expect(rows.map((r) => [r.Pick, r.Team, r.Note])).toEqual([[1, 2, ""], [2, 1, "backup pick"]]);
  });
});

function match(n: number, opts: { played: boolean; red: number[]; blue: number[]; score?: [number, number]; pRed?: number; kind?: "live" | "backtest" | "now"; onField?: boolean }): MatchView {
  const side = (ts: number[], s: number | undefined) => ({ teams: ts.map((t) => ({ number: t, surrogate: false, dq: false, onField: opts.onField ?? true })), score: s == null ? null : ({ total: s } as any) });
  return {
    season: 2025, code: "E", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: `2025-01-01T10:${String(n).padStart(2, "0")}:00`, startsAt: null,
    played: opts.played, red: side(opts.red, opts.score?.[0]), blue: side(opts.blue, opts.score?.[1]), video: null,
    prediction: opts.pRed == null ? null : { pRed: opts.pRed, redMean: 0, blueMean: 0, tier: "moderate", kind: opts.kind ?? "live", predictedAt: null },
  };
}

describe("prediction snapshot", () => {
  it("next match and upcoming average from today's ratings, the team's side", () => {
    const ms = [
      match(1, { played: true, red: [1, 2], blue: [3, 4], score: [50, 40], pRed: 0.6, kind: "live" }),
      match(2, { played: false, red: [3, 4], blue: [1, 2], pRed: 0.3, kind: "now" }),
      match(3, { played: false, red: [1, 5], blue: [3, 4], pRed: 0.5, kind: "now" }),
    ];
    const s = predictionSnapshot(ms, 1);
    expect(s.next?.m.number).toBe(2);
    expect(s.next?.pWin).toBeCloseTo(0.7);
    expect(s.upcoming?.n).toBe(2);
    expect(s.upcoming?.pWin).toBeCloseTo(0.6);
    expect(s.past).toMatchObject({ n: 1, kind: "live", actual: 1 });
    expect(s.past!.expected).toBeCloseTo(0.6);
  });
  it("never blends live and backtest calls, and skips matches the team sat out", () => {
    const ms = [
      match(1, { played: true, red: [1, 2], blue: [3, 4], score: [10, 40], pRed: 0.2, kind: "backtest" }),
      match(2, { played: true, red: [1, 2], blue: [3, 4], score: [50, 40], pRed: 0.8, kind: "live" }),
      match(3, { played: true, red: [1, 2], blue: [3, 4], score: [50, 40], pRed: 0.9, kind: "live", onField: false }),
    ];
    const s = predictionSnapshot(ms, 1);
    expect(s.past).toMatchObject({ n: 1, kind: "live", actual: 1 });
    expect(s.past!.expected).toBeCloseTo(0.8);
    expect(s.next).toBeNull();
  });
  it("last played: newest first, at most five", () => {
    const ms = [1, 2, 3, 4, 5, 6, 7].map((n) => match(n, { played: n < 7, red: [1, 2], blue: [3, 4], score: [1, 0] }));
    expect(lastPlayed(ms).map((m) => m.number)).toEqual([6, 5, 4, 3, 2]);
  });
});
