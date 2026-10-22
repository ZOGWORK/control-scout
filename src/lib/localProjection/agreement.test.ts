// Agreement: on the replay fixture (four finished 2025–26 championships replayed from their midpoint,
// server/projections/__fixtures__), the device's local estimate (LOCAL_RUNS simulations through the worker's
// handler) lands close to the server's PROJECTION_RUNS run of the same input and seed.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECTION_RUNS } from "../../shared/projections";
import { projectionSeed, simulateProjection, type CoreResult } from "../../shared/projectionCore";
import { deserializeInput, type FixtureEvent } from "../../../server/projections/fixture";
import { LOCAL_RUNS, workerHandler, type FromWorker } from "./protocol";

const fx = JSON.parse(readFileSync(join(__dirname, "../../../server/projections/__fixtures__/midpoint.json"), "utf8")) as { season: number; events: FixtureEvent[] };

async function viaWorker(e: FixtureEvent, seed: number): Promise<CoreResult> {
  let out: CoreResult | null = null;
  const handle = workerHandler((m: FromWorker) => { if (m.type === "done") out = m.result; if (m.type === "error") throw new Error(m.message); }, { pause: () => Promise.resolve() });
  await handle({ type: "run", id: 1, input: deserializeInput(e.input), seed, runs: LOCAL_RUNS, stopAtMs: Infinity });
  return out!;
}

describe("local estimate vs the server's run", () => {
  // Same seed: what really happens (the device derives the server's seed from the same results state, so its
  // runs are the first LOCAL_RUNS of the server's). Independent seed: the tolerance holds on Monte Carlo error alone.
  it.each([["the same seed", 0], ["an independent seed", 0x5bd1e995]])(`${LOCAL_RUNS.toLocaleString("en-US")} local simulations, %s: medians within 1 place of the server's ${PROJECTION_RUNS.toLocaleString("en-US")} for ≥ 95% of teams, never more than 2; playoff odds within 5 points`, async (_label, flip) => {
    const diffs: number[] = [], odds: number[] = [];
    for (const e of fx.events) {
      const seed = projectionSeed(fx.season, e.code, "current", "replay");
      const local = await viaWorker(e, (seed ^ (flip as number)) >>> 0);
      expect(local.runs).toBe(LOCAL_RUNS);
      const server = await simulateProjection(deserializeInput(e.input), { runs: PROJECTION_RUNS, floor: PROJECTION_RUNS, budgetMs: Infinity, seed });
      const by = new Map(server.teams.map((t) => [t.team, t]));
      for (const t of local.teams) {
        const s = by.get(t.team)!;
        if (t.rank && s.rank) diffs.push(Math.abs(t.rank.p50 - s.rank.p50));
        odds.push(Math.abs(t.pPlayoff - s.pPlayoff));
      }
    }
    console.log(`agreement: ${diffs.length} teams, |Δ median| max ${Math.max(...diffs)}, mean ${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(3)}, ≤1 for ${((diffs.filter((d) => d <= 1).length / diffs.length) * 100).toFixed(1)}%; |Δ playoff| max ${Math.max(...odds).toFixed(4)}`);
    expect(diffs).toHaveLength(156);
    expect(diffs.filter((d) => d <= 1).length / diffs.length).toBeGreaterThanOrEqual(0.95);
    expect(Math.max(...diffs)).toBeLessThanOrEqual(2);
    expect(Math.max(...odds)).toBeLessThanOrEqual(0.05);
  }, 240_000);
});
