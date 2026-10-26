// @vitest-environment jsdom
// An event's Rankings and Insights tables colour each number by where a team stands in the field (the text, not the
// cell): the top fifth bold green, the bottom fifth bold red, flipped for lower-is-better stats; counts of matches played aren't coloured.
import { expect, it } from "vitest";
import { HEAT, heatBands } from "./RecordsTable";

const rows = [10, 20, 30, 40, 50].map((v, i) => ({ stats: { totalPointsNpOpr: v, rank: i + 1, qualMatchesPlayed: 5 } }));

it("best fifth green, worst fifth red; rank is coloured the other way round", () => {
  const h = heatBands(rows, ["totalPointsNpOpr", "rank", "qualMatchesPlayed"]);
  expect(rows.map((r) => h.get("totalPointsNpOpr")!(r.stats.totalPointsNpOpr))).toEqual([HEAT[4], HEAT[3], HEAT[2], HEAT[1], HEAT[0]]);
  expect(h.get("rank")!(1)).toBe(HEAT[0]);
  expect(h.get("rank")!(5)).toBe(HEAT[4]);
  expect(h.has("qualMatchesPlayed")).toBe(false);
});

it("equal values share a band; a column that's all one value, or a field under four teams, isn't coloured", () => {
  const tied = [5, 5, 5, 9].map((v) => ({ stats: { totalPointsNpOpr: v } }));
  const h = heatBands(tied, ["totalPointsNpOpr"]).get("totalPointsNpOpr")!;
  expect(new Set(tied.slice(0, 3).map((r) => h(r.stats.totalPointsNpOpr))).size).toBe(1);
  expect(heatBands([1, 1, 1, 1].map((v) => ({ stats: { totalPointsNpOpr: v } })), ["totalPointsNpOpr"]).size).toBe(0);
  expect(heatBands(rows.slice(0, 3), ["totalPointsNpOpr"]).size).toBe(0);
});
