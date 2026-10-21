// The Monte Carlo core: deterministic per seed however it's sliced, the engine's own outcomes, and
// the 5,000-simulation floor when an event blows the time budget.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { simulateEvent } from "@control-scout/predict-engine";
import { quantile, runSeed, simulateProjection, textSeed } from "./core";
import { deserializeInput, type FixtureEvent } from "./fixture";

const fx = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "midpoint.json"), "utf8")) as { events: FixtureEvent[] };
const input = deserializeInput(fx.events.find((e) => e.code === "USMOKSCMP")!.input);

describe("quantile of a rank histogram", () => {
  it("matches sorted[floor(q·n)], the engine's P10/P90", () => {
    const ranks = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5];
    const counts = new Array(10).fill(0);
    for (const r of ranks) counts[r]++;
    const sorted = [...ranks].sort((a, b) => a - b);
    for (const q of [0, 0.1, 0.5, 0.9, 0.99]) expect(quantile(counts, ranks.length, q)).toBe(sorted[Math.floor(q * ranks.length)]);
  });
});

describe("simulateProjection", () => {
  it("gives the same numbers for the same seed, whatever the slicing", async () => {
    const a = await simulateProjection(input, { runs: 300, floor: 300, budgetMs: Infinity, seed: 7, sliceMs: 1 });
    const b = await simulateProjection(input, { runs: 300, floor: 300, budgetMs: Infinity, seed: 7, sliceMs: 1000 });
    expect(a.teams).toEqual(b.teams);
    const c = await simulateProjection(input, { runs: 300, floor: 300, budgetMs: Infinity, seed: 8 });
    expect(c.teams).not.toEqual(a.teams);
  });

  it("each simulation is the engine's own run (same seed, same outcome)", async () => {
    const one = await simulateProjection(input, { runs: 1, floor: 1, budgetMs: Infinity, seed: 42 });
    const eng = simulateEvent({ ...input, awards: { mode: "none" }, runs: 1, seed: runSeed(42, 0) });
    for (const t of one.teams) {
      const e = eng.get(t.team)!;
      expect(t.rank?.p50).toBe(e.meanRank);
      expect(t.pCaptain).toBe(e.pCaptain);
      expect(t.pPicked).toBe(e.pPicked);
      expect(t.pAdvance).toBe(e.pAdvance);
    }
  });

  it("bands are ordered and odds are probabilities", async () => {
    const r = await simulateProjection(input, { runs: 500, floor: 500, budgetMs: Infinity, seed: 1 });
    expect(r.runs).toBe(500);
    for (const t of r.teams) {
      expect(t.rank!.p10).toBeLessThanOrEqual(t.rank!.p50);
      expect(t.rank!.p50).toBeLessThanOrEqual(t.rank!.p90);
      expect(t.pPlayoff).toBeCloseTo(t.pCaptain + t.pPicked, 10);
      for (const p of [t.pPlayoff, t.pWin, t.pFinalist, t.pAdvance ?? 0]) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1); }
    }
    // Every alliance has a captain: expected captains = alliances formed (6 for 36 teams).
    expect(r.teams.reduce((s, t) => s + t.pCaptain, 0)).toBeCloseTo(6, 6);
  });

  it("drops to the floor when the full count would blow the budget, and says how many it ran", async () => {
    let t = 0;
    const clock = () => (t += 1); // every clock read is 1 ms: ~2 ms per simulation → 10,000 would take ~20 s
    const r = await simulateProjection(input, { runs: 10_000, floor: 5_000, budgetMs: 10_000, seed: 1, clock, pause: async () => {} });
    expect(r.runs).toBe(5_000);
    let u = 0;
    const fast = await simulateProjection(input, { runs: 400, floor: 200, budgetMs: 1e9, seed: 1, clock: () => (u += 1), pause: async () => {} });
    expect(fast.runs).toBe(400);
  });

  it("seeds from text are stable", () => {
    expect(textSeed("2025|USMOKSCMP|current|abc")).toBe(textSeed("2025|USMOKSCMP|current|abc"));
    expect(textSeed("a")).not.toBe(textSeed("b"));
  });
});
