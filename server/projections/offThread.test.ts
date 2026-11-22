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
import { liveWorkers, simulateOffThread, workerEntry, workerFlags } from "./offThread";
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

  it("rejects at once, and stops its worker, when the input can't be cloned", async () => {
    const t0 = performance.now();
    await expect(simulateOffThread({ ...input(), pick: (() => 1) as never }, { runs: 10, floor: 10, budgetMs: Infinity, seed: 1 }, 60_000)).rejects.toThrow(/clone/i);
    expect(performance.now() - t0).toBeLessThan(5_000); // not the timeout
    expect(liveWorkers()).toBe(0);
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

  it("leaves out the heap-size flags Node refuses in a worker (the Discord bot runs with --max-old-space-size)", () => {
    const src = pathToFileURL("/app/server/projections/offThread.ts").href;
    expect(workerEntry(src, ["--max-old-space-size=1536", "--import", "tsx"]).execArgv).toEqual(["--import", "tsx"]);
    expect(workerEntry(src, ["--max-old-space-size", "1536", "--enable-source-maps"]).execArgv).toEqual(["--enable-source-maps", "--import", "tsx"]);
    expect(workerFlags(["--max-semi-space-size=64", "--max_old_space_size=900", "--enable-source-maps"])).toEqual(["--enable-source-maps"]);
    expect(workerFlags(["--max_young_generation_size=32", "--max-young-generation-size", "16", "--max_semi-space_size=8", "--max-old-space-sizes=1"])).toEqual(["--max-old-space-sizes=1"]);
  });

  it("a worker started with the bot's flags runs (Node accepts what's left)", async () => {
    const { Worker } = await import("node:worker_threads");
    const { execArgv } = workerEntry(pathToFileURL("/app/server/projections/offThread.ts").href, ["--max-old-space-size=1536", "--enable-source-maps"]);
    const w = new Worker("require('node:worker_threads').parentPort.postMessage('ok')", { eval: true, execArgv: execArgv!.filter((a) => a !== "--import" && a !== "tsx") });
    await expect(new Promise((res, rej) => { w.once("message", res); w.once("error", rej); })).resolves.toBe("ok");
    await w.terminate();
    expect(() => new Worker("0", { eval: true, execArgv: ["--max-old-space-size=1536"] })).toThrow(/invalid execArgv/);
  });
});
