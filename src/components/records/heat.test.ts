// @vitest-environment jsdom
// An event's Rankings and Insights tables shade each number column by where a team stands in the field: the
// top fifth green, the bottom fifth red, flipped for lower-is-better stats; counts of matches played aren't shaded.
import { expect, it } from "vitest";
import { heatBands } from "./RecordsTable";

const rows = [10, 20, 30, 40, 50].map((v, i) => ({ stats: { totalPointsNpOpr: v, rank: i + 1, qualMatchesPlayed: 5 } }));

it("best fifth green, worst fifth red; rank is shaded the other way round", () => {
  const h = heatBands(rows, ["totalPointsNpOpr", "rank", "qualMatchesPlayed"]);
  expect(rows.map((r) => h.get("totalPointsNpOpr")!(r.stats.totalPointsNpOpr))).toEqual(["bg-destructive/20", "bg-destructive/10", "", "bg-success/10", "bg-success/25"]);
  expect(h.get("rank")!(1)).toBe("bg-success/25");
  expect(h.get("rank")!(5)).toBe("bg-destructive/20");
  expect(h.has("qualMatchesPlayed")).toBe(false);
});

it("equal values share a band; a column that's all one value, or a field under four teams, isn't shaded", () => {
  const tied = [5, 5, 5, 9].map((v) => ({ stats: { totalPointsNpOpr: v } }));
  const h = heatBands(tied, ["totalPointsNpOpr"]).get("totalPointsNpOpr")!;
  expect(new Set(tied.slice(0, 3).map((r) => h(r.stats.totalPointsNpOpr))).size).toBe(1);
  expect(heatBands([1, 1, 1, 1].map((v) => ({ stats: { totalPointsNpOpr: v } })), ["totalPointsNpOpr"]).size).toBe(0);
  expect(heatBands(rows.slice(0, 3), ["totalPointsNpOpr"]).size).toBe(0);
});
