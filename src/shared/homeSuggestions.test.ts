// Home's suggestion pool and the hourly pick: every family of answer is in the pool, each chip fits, and each hour
// gives six of different families, with a leaderboard and a sentence or filtered query, the same in every browser.
import { describe, expect, it } from "vitest";
import { HOME_SUGGESTIONS, SUGGESTION_COUNT, SUGGESTION_HOUR_MS, SUGGESTION_LABEL_MAX, fitChips, placeholderable, suggestionLabel, suggestionTeams, suggestionsAt, type HomeSuggestion, type SuggestionKind } from "./homeSuggestions";

const KINDS: SuggestionKind[] = ["team", "opr", "rating", "record", "matches", "awards", "worlds", "versus", "three", "leaderboard", "winners", "predict", "spelling", "question", "filters"];
const T0 = Date.UTC(2026, 10, 4, 0, 0);
const hours = Array.from({ length: 24 * 60 }, (_, h) => T0 + h * SUGGESTION_HOUR_MS);

describe("home suggestion pool", () => {
  it("holds 40 to 80 queries, each once, covering every family at least twice", () => {
    expect(HOME_SUGGESTIONS.length).toBeGreaterThanOrEqual(40);
    expect(HOME_SUGGESTIONS.length).toBeLessThanOrEqual(80);
    expect(new Set(HOME_SUGGESTIONS.map((s) => s.q.toLowerCase())).size).toBe(HOME_SUGGESTIONS.length);
    for (const k of KINDS) expect(HOME_SUGGESTIONS.filter((s) => s.kind === k).length, k).toBeGreaterThanOrEqual(2);
  });
  it("labels fit a chip, are each different, and are in sentence case", () => {
    for (const s of HOME_SUGGESTIONS) {
      expect(suggestionLabel(s).length, s.q).toBeLessThanOrEqual(SUGGESTION_LABEL_MAX);
      expect(suggestionLabel(s), s.q).toMatch(/^[A-Z0-9]/);
    }
    expect(new Set(HOME_SUGGESTIONS.map(suggestionLabel)).size).toBe(HOME_SUGGESTIONS.length);
  });
  it("names many teams, not one team over and over", () => {
    const counts = new Map<string, number>();
    for (const s of HOME_SUGGESTIONS) for (const t of suggestionTeams(s)) counts.set(t, (counts.get(t) ?? 0) + 1);
    expect(counts.size).toBeGreaterThanOrEqual(12);
    for (const [t, n] of counts) expect(n, t).toBeLessThanOrEqual(8);
  });
});

describe("suggestionsAt", () => {
  it("is the same all hour and the same on every call", () => {
    expect(suggestionsAt(T0 + 5 * 60_000)).toEqual(suggestionsAt(T0 + 59 * 60_000));
    expect(suggestionsAt(T0)).toEqual(suggestionsAt(T0));
  });
  it("gives six of different families, a leaderboard and a sentence or filtered query among them, every hour", () => {
    for (const h of hours) {
      const six = suggestionsAt(h);
      expect(six).toHaveLength(SUGGESTION_COUNT);
      expect(new Set(six.map((s) => s.kind)).size).toBe(SUGGESTION_COUNT);
      expect(six.some((s) => s.kind === "leaderboard")).toBe(true);
      expect(six.some((s) => s.kind === "question" || s.kind === "filters")).toBe(true);
      expect(six.some(placeholderable)).toBe(true);
    }
  });
  it("changes from one hour to the next, and shows every query in the pool within a few weeks", () => {
    for (let i = 1; i < hours.length; i++) expect(suggestionsAt(hours[i]).map((s) => s.q)).not.toEqual(suggestionsAt(hours[i - 1]).map((s) => s.q));
    const seen = new Set(hours.flatMap((h) => suggestionsAt(h).map((s) => s.q)));
    expect(HOME_SUGGESTIONS.filter((s) => !seen.has(s.q)).map((s) => s.q)).toEqual([]);
  });
  it("never names one team twice in an hour", () => {
    const clashes = hours.filter((h) => { const t = suggestionsAt(h).flatMap(suggestionTeams); return new Set(t).size !== t.length; }).length;
    expect(clashes).toBe(0);
  });
});

describe("fitChips", () => {
  const rowsOf = (widths: number[], order: number[], width: number, gap: number) => {
    let rows = 0, used = Infinity;
    for (const i of order) { if (used + gap + widths[i] > width) { rows++; used = widths[i]; } else used += gap + widths[i]; }
    return rows;
  };
  it("keeps every chip, in order, when they all fit", () => {
    expect(fitChips([100, 100, 100, 100], 400, 8, 2)).toEqual([0, 1, 2, 3]);
  });
  it("keeps the most that fit whole, wrapping onto no more than its rows, and drops one too wide for any row", () => {
    const widths = [200, 200, 100, 250, 90, 80, 320];
    const order = fitChips(widths, 300, 0, 2);
    expect(order).toHaveLength(4);
    expect(order).not.toContain(6);
    expect(rowsOf(widths, order, 300, 0)).toBeLessThanOrEqual(2);
  });
  it("packs rows to keep more than the hour's own order would", () => {
    // In order 180, 150, 180 would take three rows; packed (180+100, 150) three fit on two.
    const widths = [180, 150, 180, 100];
    const order = fitChips(widths, 290, 8, 2);
    expect(order).toHaveLength(3);
    expect(rowsOf(widths, order, 290, 8)).toBeLessThanOrEqual(2);
  });
  it("keeps a leaderboard and a sentence query over others of the same width", () => {
    const order = fitChips([150, 150, 150, 150], 310, 8, 1, ["team", "leaderboard", "opr", "question"]);
    expect(order).toEqual([1, 3]);
  });
  it("lays out every hour's six at phone widths on no more than two rows, keeping at least two", () => {
    const w = (s: HomeSuggestion) => 44 + 7.2 * suggestionLabel(s).length;
    for (const h of hours.slice(0, 24 * 7)) {
      const six = suggestionsAt(h);
      const ws = six.map(w);
      for (const width of [288, 358]) {
        const order = fitChips(ws, width, 7, 2, six.map((s) => s.kind));
        expect(rowsOf(ws, order, width, 7)).toBeLessThanOrEqual(2);
        expect(order.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
