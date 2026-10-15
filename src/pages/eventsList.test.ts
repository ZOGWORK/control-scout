import { describe, expect, it } from "vitest";
import type { EventListItem } from "../shared/api";
import { applyFilters, FIRST_EVENTS, groupWeeks, takeBatch, weekOf } from "./eventsList";

const ev = (code: string, start: string | null, more: Partial<EventListItem> = {}) =>
  ({ code, name: `Event ${code}`, start, end: start, season: 2025, type: "Qualifier", status: "finished", city: "Austin", state: "TX", country: "USA", ...more }) as EventListItem;
const all = { region: null, type: "all", from: null, to: null, q: "" };

describe("Events list filters", () => {
  const events = [
    ev("USTXQ1", "2025-11-08"),
    ev("USNJQ1", "2025-11-09", { city: "Edison", state: "NJ" }),
    ev("MXQ1", "2025-12-06", { city: "Monterrey", state: null, country: "Mexico", type: "LeagueMeet" }),
  ];
  it("matches the text against name, code, city and full place names", () => {
    expect(applyFilters(events, { ...all, q: "texas" }).map((e) => e.code)).toEqual(["USTXQ1"]);
    expect(applyFilters(events, { ...all, q: " New Jersey " }).map((e) => e.code)).toEqual(["USNJQ1"]);
    expect(applyFilters(events, { ...all, q: "mxq" }).map((e) => e.code)).toEqual(["MXQ1"]);
    expect(applyFilters(events, all)).toHaveLength(3);
  });
  it("filters by place (state or whole country), type and dates", () => {
    expect(applyFilters(events, { ...all, region: "USA:NJ" }).map((e) => e.code)).toEqual(["USNJQ1"]);
    expect(applyFilters(events, { ...all, region: "Mexico" }).map((e) => e.code)).toEqual(["MXQ1"]);
    expect(applyFilters(events, { ...all, type: "LeagueMeet" }).map((e) => e.code)).toEqual(["MXQ1"]);
    expect(applyFilters(events, { ...all, from: "2025-11-09", to: "2025-11-30" }).map((e) => e.code)).toEqual(["USNJQ1"]);
  });
});

describe("Events list weeks and batches", () => {
  it("weeks start on Monday", () => {
    expect(weekOf("2025-11-09")).toBe("2025-11-03"); // a Sunday
    expect(weekOf("2025-11-10")).toBe("2025-11-10");
  });

  // 3 past weeks of 10 events, this week (5) and next week (20), plus 2 undated.
  const thisWeek = "2025-11-10";
  const list = [
    ...Array.from({ length: 10 }, (_, i) => ev(`A${i}`, "2025-10-20")),
    ...Array.from({ length: 10 }, (_, i) => ev(`B${i}`, "2025-10-27")),
    ...Array.from({ length: 10 }, (_, i) => ev(`C${i}`, "2025-11-04")),
    ...Array.from({ length: 5 }, (_, i) => ev(`D${i}`, "2025-11-12")),
    ...Array.from({ length: 20 }, (_, i) => ev(`E${i}`, "2025-11-17")),
    ev("T1", null), ev("T2", null),
  ];
  const weeks = groupWeeks(list, thisWeek);

  it("orders this and upcoming weeks first, undated next, then the past newest first", () => {
    expect(weeks.map(([w, evs]) => [w, evs.length])).toEqual([
      ["2025-11-10", 5], ["2025-11-17", 20], ["TBA", 2], ["2025-11-03", 10], ["2025-10-27", 10], ["2025-10-20", 10],
    ]);
  });

  it("renders a bounded first batch: whole weeks in order, the last cut, headers keep the week's full count", () => {
    const { shown, hidden } = takeBatch(weeks, 24);
    expect(shown.map(([w, evs, total]) => [w, evs.length, total])).toEqual([["2025-11-10", 5, 5], ["2025-11-17", 19, 20]]);
    expect(hidden).toBe(list.length - 24);
  });

  it("each further batch adds on until everything is shown", () => {
    const b2 = takeBatch(weeks, 30);
    expect(b2.shown.map(([w, evs]) => [w, evs.length])).toEqual([["2025-11-10", 5], ["2025-11-17", 20], ["TBA", 2], ["2025-11-03", 3]]);
    expect(b2.hidden).toBe(list.length - 30);
    const done = takeBatch(weeks, 1000);
    expect(done.hidden).toBe(0);
    expect(done.shown.reduce((a, [, evs]) => a + evs.length, 0)).toBe(list.length);
  });

  it("a season of 1,344 events renders no more than the first batch", () => {
    const season = Array.from({ length: 1344 }, (_, i) => ev(`S${i}`, `2025-${String(9 + Math.floor(i / 400)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`));
    const { shown, hidden } = takeBatch(groupWeeks(season, thisWeek), FIRST_EVENTS);
    expect(shown.reduce((a, [, evs]) => a + evs.length, 0)).toBe(FIRST_EVENTS);
    expect(hidden).toBe(1344 - FIRST_EVENTS);
  });
});
