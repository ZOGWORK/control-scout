// The Worlds summary's stats are counted from the records (any team's), never typed in: the acceptance case
// (ENFORCERS 7149) and another team with a gap, a single trip and no division repeats.
import { describe, expect, it } from "vitest";
import type { SearchCard } from "../../../shared/api";
import { appearanceStats, appearances, eventName, isQualityQuestion, percentile, standing, tierOf, winRate } from "./records";

const line = (season: string, div: string, rank: number, rec: string, opr: number) => ({
  text: `FIRST Championship - Houston - World Championship - FIRST Tech Challenge - ${div} Division`,
  detail: `${season} · Apr 19–23, 2022 · Houston, TX`, results: [`Ranked #${rank}`, `${rec} in quals`, `OPR ${opr.toFixed(1)}`], href: "/events/x",
});
const card = (lines: ReturnType<typeof line>[]): SearchCard => ({ kind: "worlds", title: "Worlds appearances", team: { number: 7149, name: "ENFORCERS" }, lines, count: lines.length });

const enforcers = card([
  line("2021–22", "Franklin", 20, "4-4-0", 124.8), line("2022–23", "Ochoa", 3, "9-2-0", 114.8), line("2023–24", "Franklin", 10, "8-2-0", 127.2),
  line("2024–25", "Ochoa", 22, "6-4-0", 148.2), line("2025–26", "Ross", 19, "6-4-0", 115.3),
]);

describe("appearances", () => {
  it("reads each record's season, division, rank, record and OPR, oldest first", () => {
    const a = appearances(enforcers);
    expect(a.map((x) => x.opr)).toEqual([124.8, 114.8, 127.2, 148.2, 115.3]);
    expect(a[0]).toMatchObject({ season: 2021, title: "Franklin Division", badges: ["FIRST Championship"], division: "Franklin", rank: 20, record: "4-4-0", place: "Houston, TX" });
  });
  it("computes the banner for the acceptance case", () => {
    expect(appearanceStats(appearances(enforcers), "Worlds")).toEqual([
      { label: "Total appearances", value: "5" },
      { label: "Consecutive", value: "5", note: "2021–22 to 2025–26" },
      { label: "Best division rank", value: "#3", note: "2022–23" },
      // Every game at Worlds, across the trips (never a peak OPR: each season's game scores on its own scale).
      { label: "Win rate at Worlds", value: "67.3%", note: "33–16–0 in quals" },
      { label: "Most frequent division", value: "Franklin / Ochoa", note: "2× each" },
    ]);
  });
  it("computes it for another team: a gap breaks the streak, no repeated division leaves that stat out", () => {
    const other = card([line("2018–19", "Edison", 7, "6-3-0", 80), line("2021–22", "Jemison", 12, "5-5-0", 95.5), line("2022–23", "Ochoa", 30, "3-7-0", 90)]);
    const stats = appearanceStats(appearances(other));
    expect(stats.find((s) => s.label === "Consecutive")).toEqual({ label: "Consecutive", value: "2", note: "2021–22 to 2022–23" });
    expect(stats.find((s) => s.label === "Best division rank")?.value).toBe("#7");
    expect(stats.some((s) => s.label === "Most frequent division")).toBe(false);
    expect(stats.find((s) => s.label === "Win rate")).toEqual({ label: "Win rate", value: "48.3%", note: "14–15–0 in quals" });
    expect(stats.some((s) => /OPR/.test(s.label))).toBe(false);
  });
  it("reads nothing from a card it can't read whole (the plain card stays)", () => {
    expect(appearances({ ...enforcers, lines: [{ text: "x", detail: "no season" }] })).toEqual([]);
    expect(appearances({ ...enforcers, kind: "awards" })).toEqual([]);
  });
});

describe("eventName", () => {
  it("a division's own name up front, its championship as a badge", () => expect(eventName("FIRST Championship - Houston - World Championship - FIRST Tech Challenge - Franklin Division")).toEqual({ title: "Franklin Division", badges: ["FIRST Championship"] }));
  it("names without a division stay whole", () => expect(eventName("P2-8 Northeast League Meet")).toEqual({ title: "P2-8 Northeast League Meet", badges: [] }));
});

describe("standing", () => {
  it("percentile rounds half up to one decimal (388 of 8,308 is 4.7, not 4.6)", () => expect(percentile(388, 8308)).toBe(4.7));
  it("tiers by band", () => { expect(tierOf(4.7).name).toBe("Elite"); expect(tierOf(5.1).name).toBe("Excellent"); expect(tierOf(99).name).toBe("Developing"); });
  it("win rate counts a tie as half", () => { expect(winRate("20-4-0")).toBe(83.3); expect(winRate("1-1-2")).toBe(50); expect(winRate(null)).toBeNull(); });
  it("acceptance: Simply Complex", () => {
    expect(standing({ team: 18061, name: "Simply Complex", place: "", opr: 119.7, oprRank: 388, of: 8308, rating: null, ratingSd: null, record: "20-4-0", lastEvent: null, nextEvent: null }, 2025))
      .toEqual({ season: 2025, record: "20-4-0", opr: 119.7, rank: 388, of: 8308, pct: 4.7, tier: "Elite", winRate: 83.3 });
  });
  it("a quality question", () => { expect(isQualityQuestion("how good is simply complex")).toBe(true); expect(isQualityQuestion("good teams")).toBe(false); });
});
