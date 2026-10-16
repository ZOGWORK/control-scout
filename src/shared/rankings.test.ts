// World rankings rules: order and ties, movement against last week, place filters, weeks.
import { describe, expect, it } from "vitest";
import { inPlaces, isWeek, movementOf, parsePlaces, placeKey, rankTeams, weekOf, weekStartMs } from "./rankings";
import { direction } from "./trend";

describe("rankTeams", () => {
  it("orders by rating, high to low; equal ratings by team number; one rank each", () => {
    const r = rankTeams([
      { team: 300, rating: 50 }, { team: 20, rating: 80.25 }, { team: 7, rating: 50 }, { team: 9999, rating: 99.5 }, { team: 15, rating: 50 },
    ]);
    expect(r.map((x) => [x.rank, x.team])).toEqual([[1, 9999], [2, 20], [3, 7], [4, 15], [5, 300]]);
  });
  it("leaves out teams without a usable rating (missing, not finite, below the floor)", () => {
    const r = rankTeams([{ team: 1, rating: null }, { team: 2, rating: NaN }, { team: 3, rating: -1 }, { team: 4, rating: 0 }, { team: 5, rating: 3 }]);
    expect(r.map((x) => x.team)).toEqual([5, 4]);
  });
  it("keeps each row's other fields", () => {
    expect(rankTeams([{ team: 1, rating: 2, name: "A" }])[0]).toEqual({ team: 1, rating: 2, name: "A", rank: 1 });
  });
});

describe("movementOf", () => {
  const last = new Map([[10, { rank: 5, rating: 100 }], [20, { rank: 1, rating: 120 }], [30, { rank: 9, rating: 80 }]]);
  it("rank then minus rank now (up is positive), rating change, trend by the team page's rule", () => {
    expect(movementOf({ rank: 2, rating: 115 }, last, 10)).toEqual({ move: 3, dRating: 15, trend: "up" });
    expect(movementOf({ rank: 3, rating: 108 }, last, 20)).toEqual({ move: -2, dRating: -12, trend: "down" });
    expect(movementOf({ rank: 9, rating: 81.5 }, last, 30)).toEqual({ move: 0, dRating: 1.5, trend: "flat" });
    // Same thresholds as the team page's badge.
    expect(movementOf({ rank: 2, rating: 115 }, last, 10).trend).toBe(direction([100, 115]));
  });
  it("a team that wasn't ranked last week is new", () => {
    expect(movementOf({ rank: 4, rating: 90 }, last, 40)).toEqual({ move: "new", dRating: null, trend: null });
  });
  it("no snapshot to compare with: no movement for anyone", () => {
    expect(movementOf({ rank: 1, rating: 90 }, null, 10)).toEqual({ move: null, dRating: null, trend: null });
  });
  it("rounds the rating change to hundredths", () => {
    expect(movementOf({ rank: 5, rating: 100.3 }, last, 10).dRating).toBe(0.3);
  });
});

describe("place filters", () => {
  const tx = { country: "USA", state: "TX" }, ok = { country: "USA", state: "OK" }, on = { country: "Canada", state: "ON" }, ro = { country: "Romania", state: "B" }, none = { country: null, state: null };
  it("parses countries, states and lists", () => {
    expect(parsePlaces("")).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
    expect(parsePlaces("USA")).toEqual([{ country: "USA", state: null }]);
    expect(parsePlaces("USA:tx")).toEqual([{ country: "USA", state: "TX" }]);
    expect(parsePlaces("USA:TX, Canada,USA:TX")).toEqual([{ country: "USA", state: "TX" }, { country: "Canada", state: null }]);
    expect(parsePlaces("United Kingdom,Türkiye,Côte d'Ivoire")?.map(placeKey)).toEqual(["United Kingdom", "Türkiye", "Côte d'Ivoire"]);
  });
  it("refuses what isn't a place list", () => {
    for (const bad of ["USA:TX:X", "USA:T X", "<script>", "USA:", Array.from({ length: 11 }, (_, i) => `C${"x".repeat(i)}`).join(","), "x".repeat(61)])
      expect(parsePlaces(bad), bad).toBeNull();
  });
  it("country: every team there", () => {
    const p = parsePlaces("USA")!;
    expect([tx, ok, on, ro, none].map((t) => inPlaces(t, p))).toEqual([true, true, false, false, false]);
  });
  it("state: only that state of that country (codes repeat across countries)", () => {
    const p = parsePlaces("USA:TX")!;
    expect([tx, ok, on, { country: "Australia", state: "TX" }, { country: "USA", state: "tx" }].map((t) => inPlaces(t, p))).toEqual([true, false, false, false, true]);
  });
  it("combined: any of the places", () => {
    const p = parsePlaces("USA:TX,Canada,Romania:B")!;
    expect([tx, ok, on, ro, none].map((t) => inPlaces(t, p))).toEqual([true, false, true, true, false]);
  });
  it("no places: everyone", () => {
    expect(inPlaces(none, [])).toBe(true);
  });
});

describe("weeks", () => {
  it("a week is the Monday 00:00 UTC on or before the instant", () => {
    expect(weekOf(Date.parse("2026-10-16T14:00:00Z"))).toBe("2026-10-12"); // Friday
    expect(weekOf(Date.parse("2026-10-12T00:00:00Z"))).toBe("2026-10-12"); // Monday midnight: that week
    expect(weekOf(Date.parse("2026-10-11T23:59:59Z"))).toBe("2026-10-05"); // Sunday night: the week before
    expect(weekOf(Date.parse("2026-01-01T00:00:00Z"))).toBe("2025-12-29"); // across a year
    expect(weekStartMs("2026-10-12")).toBe(Date.parse("2026-10-12T00:00:00Z"));
  });
  it("isWeek: only Mondays as YYYY-MM-DD", () => {
    expect(isWeek("2026-10-12")).toBe(true);
    for (const s of ["2026-10-13", "2026-1-12", "2026-13-01", "12-10-2026", "monday"]) expect(isWeek(s), s).toBe(false);
  });
});
