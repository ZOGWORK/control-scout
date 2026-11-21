// The projections job's simulations run on a worker thread (offThread.ts): the same numbers as on the main thread, and
// the main thread's event loop stays free while a big event simulates. On the main thread (sliced, pausing every
// ~20 ms) the loop was busy ~100% of a run: on the VM's event day, 4–26 s per event, ten-odd events a minute, and
// /api/health took 4–34 s meanwhile.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { PROJECTION_FLOOR, PROJECTION_RUNS } from "../../src/shared/projections";
import { simulateProjection, textSeed } from "./core";
import { deserializeInput, type FixtureEvent } from "./fixture";
import { simulateOffThread, workerEntry } from "./offThread";
import { BUDGET_MS, jobSimulate } from "./job";

const fx = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "midpoint.json"), "utf8")) as { season: number; events: FixtureEvent[] };
// The biggest event in the fixture (a championship division): the slowest run the job makes.
const big = [...fx.events].sort((a, b) => b.input.ratings.length - a.input.ratings.length)[0];
const input = () => deserializeInput(big.input);

describe("simulateOffThread", () => {
  it("gives exactly the main thread's result for the same input and seed", async () => {
    const o = { runs: 600, floor: 600, budgetMs: Infinity, seed: textSeed(`x|${big.code}`) };
    const here = await simulateProjection(input(), o);
    const there = await simulateOffThread(input(), o);
    expect(there.runs).toBe(600);
    expect(there.teams).toEqual(here.teams);
  }, 60_000);

  it("drops to the floor when the run would blow its budget, as on the main thread", async () => {
    const r = await simulateOffThread(input(), { runs: 50_000, floor: 300, budgetMs: 1, seed: 1 });
    expect(r.runs).toBe(300);
  }, 60_000);

  it("rejects with the worker's error", async () => {
    await expect(simulateOffThread({ ...input(), ratings: null as never }, { runs: 10, floor: 10, budgetMs: Infinity, seed: 1 })).rejects.toThrow();
  }, 60_000);

  it("leaves the event loop free while a big event simulates", async () => {
    let gap = 0, last = performance.now();
    const tick = setInterval(() => { const n = performance.now(); gap = Math.max(gap, n - last); last = n; }, 2);
    const elu0 = performance.eventLoopUtilization();
    try {
      // What the job runs (projectEvent → simulateKind): the full count, the job's floor and budget.
      const r = await jobSimulate(input(), { runs: PROJECTION_RUNS, floor: PROJECTION_FLOOR, budgetMs: BUDGET_MS, seed: textSeed(`gap|${big.code}`) });
      expect(r.runs).toBeGreaterThanOrEqual(PROJECTION_FLOOR);
      await new Promise((res) => setTimeout(res, 20)); // the tick that measures a loop held until now
      const elu = performance.eventLoopUtilization(elu0);
      // Sliced on this thread: utilisation ≈ 1 for the whole run (and gaps of a slice or more). Off it: the loop idles.
      expect(elu.utilization).toBeLessThan(0.3);
      expect(gap).toBeLessThan(250); // loose: a loaded CI runner still turns the loop well inside this
    } finally {
      clearInterval(tick);
    }
  }, 120_000);
});

describe("workerEntry", () => {
  it("starts the bundled worker next to the server bundle, with no loader", () => {
    const e = workerEntry(pathToFileURL(join("/app", "build", "server", "index.mjs")).href, ["--enable-source-maps"]);
    expect(e.url.href).toBe(pathToFileURL(join("/app", "build", "server", "projectionWorker.mjs")).href);
    expect(e.execArgv).toBeUndefined(); // the server's own flags carry over
  });

  it("starts the TypeScript source through tsx from the source tree", () => {
    const e = workerEntry(pathToFileURL(join("/app", "server", "projections", "offThread.ts")).href, []);
    expect(e.url.href).toBe(pathToFileURL(join("/app", "server", "projections", "simWorker.ts")).href);
    expect(e.execArgv).toEqual(["--import", "tsx"]);
    expect(workerEntry(pathToFileURL("/app/server/projections/offThread.ts").href, ["--import", "tsx"]).execArgv).toEqual(["--import", "tsx"]);
  });
});
