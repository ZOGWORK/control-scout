import { describe, expect, it } from "vitest";
import { defaultSeason, hasResults } from "./myTeamSeason";
import type { TeamProfile } from "../shared/api";

const profile = (season: number, seasons: number[], record: [number, number, number] | null) => ({
  season, seasons,
  stats: record ? { record: { wins: record[0], losses: record[1], ties: record[2], matches: record[0] + record[1] + record[2], events: 1 } } : null,
}) as unknown as Pick<TeamProfile, "season" | "seasons" | "stats">;
const all = () => true;

describe("defaultSeason (My team with no season in the URL)", () => {
  it("stays on the current season once the team has played in it", () => {
    expect(defaultSeason(profile(2026, [2026, 2025], [1, 0, 0]), all)).toBe(2026);
    expect(defaultSeason(profile(2026, [2026, 2025], [0, 0, 1]), all)).toBe(2026);
  });
  it("opens the latest played season while the current one has no results", () => {
    expect(defaultSeason(profile(2026, [2026, 2025, 2024], null), all)).toBe(2025);
    // A stats row with no decided matches counts as no results.
    expect(defaultSeason(profile(2026, [2026, 2024, 2023], [0, 0, 0]), all)).toBe(2024);
  });
  it("skips seasons the toggle doesn't offer, and falls back to the current season", () => {
    expect(defaultSeason(profile(2026, [2026, 2022, 2021], null), (s) => s >= 2023)).toBe(2026);
    expect(defaultSeason(profile(2026, [2026], null), all)).toBe(2026);
  });
  it("hasResults needs a win, loss or tie", () => {
    expect(hasResults(profile(2026, [2026], null))).toBe(false);
    expect(hasResults(profile(2026, [2026], [0, 0, 0]))).toBe(false);
    expect(hasResults(profile(2026, [2026], [0, 2, 0]))).toBe(true);
  });
});
