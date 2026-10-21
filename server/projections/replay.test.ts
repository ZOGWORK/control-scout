// Acceptance: four finished 2025–26 championships replayed from their midpoint (ratings frozen at the
// event's start plus the first half's results; the rest, every rank and the alliances stripped —
// scripts/projections-replay.ts built the fixture; rebuilt for engine 2.6, so it carries the per-team
// score variance and the bonus model fitted only on results before each event). The actual final
// quals rank must land inside the projected P10–P90 band for at least 80% of teams. Same seed as the
// script: 133 of 156 (85.3%; 128 with engine 2.5's inputs).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECTION_RUNS } from "../../src/shared/projections";
import { simulateProjection, textSeed } from "./core";
import { deserializeInput, type FixtureEvent } from "./fixture";

const fx = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "midpoint.json"), "utf8")) as { season: number; events: FixtureEvent[] };

describe("midpoint replay of finished events", () => {
  it("puts ≥ 80% of actual final ranks inside the P10–P90 band", async () => {
    let inside = 0, total = 0;
    for (const e of fx.events) {
      const r = await simulateProjection(deserializeInput(e.input), { runs: PROJECTION_RUNS, floor: PROJECTION_RUNS, budgetMs: Infinity, seed: textSeed(`${fx.season}|${e.code}|replay`) });
      const actual = new Map(e.actual);
      for (const t of r.teams) {
        const a = actual.get(t.team);
        if (a == null || !t.rank) continue;
        total++;
        if (a >= t.rank.p10 && a <= t.rank.p90) inside++;
      }
    }
    expect(total).toBe(156);
    expect(inside / total).toBeGreaterThanOrEqual(0.8);
    expect(inside).toBe(133);
  }, 180_000);
});
