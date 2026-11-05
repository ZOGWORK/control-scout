// Home's suggestion pool and the hourly pick: every family of answer is in the pool, each chip fits, and each hour
// gives six of different families, with a leaderboard and a sentence or filtered query, the same in every browser.
import { describe, expect, it } from "vitest";
import { HOME_SUGGESTIONS, SUGGESTION_COUNT, SUGGESTION_HOUR_MS, SUGGESTION_LABEL_MAX, placeholderable, suggestionLabel, suggestionsAt, type SuggestionKind } from "./homeSuggestions";

const KINDS: SuggestionKind[] = ["team", "opr", "rating", "record", "matches", "awards", "worlds", "versus", "three", "leaderboard", "winners", "predict", "spelling", "question", "filters"];
const T0 = Date.UTC(2026, 10, 4, 0, 0);
const hours = Array.from({ length: 24 * 60 }, (_, h) => T0 + h * SUGGESTION_HOUR_MS);
const teamsIn = (q: string) => q.match(/\b\d{3,5}\b/g) ?? [];

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
    for (const s of HOME_SUGGESTIONS) for (const t of teamsIn(s.q)) counts.set(t, (counts.get(t) ?? 0) + 1);
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
    const clashes = hours.filter((h) => { const t = suggestionsAt(h).flatMap((s) => teamsIn(s.q)); return new Set(t).size !== t.length; }).length;
    expect(clashes).toBe(0);
  });
});
