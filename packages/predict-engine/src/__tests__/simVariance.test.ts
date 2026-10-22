// Engine 2.6: the event simulator spreads each alliance score with the score ranges' per-team game
// variance (gameVariance), so erratic or low-sample robots spread wider.
import { describe, expect, it } from "vitest";
import { simulateEvent, type QualMatch, type SimInput } from "../sim";
import { DEFAULT_BAND, DEFAULT_NOISE, gameVariance, type BandParams } from "../matchModel";
import type { TeamRating } from "../types";

const rating = (np: number): TeamRating => ({ auto: np * 0.2, teleop: np * 0.7, endgame: np * 0.1, pen: 2, n: 12, uncertainty: 4 });
const teams = Array.from({ length: 12 }, (_, i) => i + 1);
// Nine rounds: each round shuffles the 12 teams into three 2v2 matches (deterministic).
const quals: QualMatch[] = [];
for (let r = 0; r < 9; r++) {
  const order = [...teams].sort((a, b) => ((a * 7919 + r * 104729) % 97) - ((b * 7919 + r * 104729) % 97));
  for (let k = 0; k < 3; k++) quals.push({ red: [order[k * 4], order[k * 4 + 1]], blue: [order[k * 4 + 2], order[k * 4 + 3]] });
}
const base: SimInput = {
  season: 2025, ratings: new Map(teams.map((t) => [t, rating(140 - t * 6)])), quals, noise: DEFAULT_NOISE,
  awards: { mode: "none" }, prequalified: new Set(), slots: 3, runs: 3000, seed: 11,
};
const steady = (over: Partial<Record<number, { consistency: number; matches: number }>> = {}) =>
  new Map(teams.map((t) => [t, over[t] ?? { consistency: 1, matches: 12 }]));
const width = (sim: Map<number, { rankP10: number; rankP90: number }>, t: number) => sim.get(t)!.rankP90 - sim.get(t)!.rankP10;

describe("simulateEvent per-team score variance", () => {
  it("is gameVariance: a neutral band reproduces the plain σ = a + b·mean draws exactly", () => {
    const neutral: BandParams = { ...DEFAULT_BAND, scale: 1, consistencyPower: 0, smallSample: 0, playoff: 1 };
    expect(Math.sqrt(gameVariance(150, 3, 0, DEFAULT_NOISE, neutral))).toBe(DEFAULT_NOISE.a + DEFAULT_NOISE.b * 150);
    const plain = simulateEvent(base);
    const viaVariance = simulateEvent({ ...base, variance: steady({ 6: { consistency: 5, matches: 0 } }), band: neutral });
    expect([...viaVariance.values()]).toEqual([...plain.values()]);
  });

  it("an erratic robot's finish spreads wider than the same robot playing steadily", () => {
    const calm = simulateEvent({ ...base, variance: steady(), band: DEFAULT_BAND });
    const wild = simulateEvent({ ...base, variance: steady({ 6: { consistency: 25, matches: 12 } }), band: DEFAULT_BAND });
    expect(width(wild, 6)).toBeGreaterThan(width(calm, 6));
  });

  it("a robot with few matches spreads wider than one with many", () => {
    const known = simulateEvent({ ...base, variance: steady(), band: { ...DEFAULT_BAND, smallSample: 6 } });
    const fresh = simulateEvent({ ...base, variance: steady({ 6: { consistency: 1, matches: 0 } }), band: { ...DEFAULT_BAND, smallSample: 6 } });
    expect(width(fresh, 6)).toBeGreaterThan(width(known, 6));
  });

  it("playoff matches use the band's playoff factor: less noise, so the stronger alliance wins more", () => {
    const sel = { ...base, ranks: new Map(teams.map((t) => [t, t])), alliances: [[1, 2], [3, 4], [5, 6], [7, 8]], quals: [] as QualMatch[] };
    const tight = simulateEvent({ ...sel, variance: steady(), band: { ...DEFAULT_BAND, playoff: 0.05 } });
    const loose = simulateEvent({ ...sel, variance: steady(), band: { ...DEFAULT_BAND, playoff: 1 } });
    expect(tight.get(1)!.pWin).toBeGreaterThan(loose.get(1)!.pWin);
  });
});
