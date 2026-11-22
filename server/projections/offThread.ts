// The projections job's simulations on a worker thread, so the web process's event loop never runs them.
//
// The core (core.ts) sliced its work and paused every ~20 ms, but on the server's own thread: every slice was 20 ms
// of a busy event loop, back to back for the whole run (event-loop utilisation ~100% for seconds per event, ten-odd
// events a minute on an event day), with every request, the forecaster rebuild and the garbage collector of a
// multi-gigabyte heap sharing what was left. Requests waited behind it, and the run's own wall time stretched past
// its budget (26 s logged against BUDGET_MS = 10 s: the budget counted only the slices, not the time between them).
// Here each run gets its own thread (and heap): the main thread only builds the input, posts it and waits.
//
// Same code, same seeds, same numbers: the worker runs the very simulateProjection the job ran (simWorker.ts), on the
// structured-cloned input (Maps, Sets and plain data; awards are left out either way). Nothing else runs on that
// thread, so its compute time is its wall time and the budget holds against the real time a run takes.
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { SimInput } from "@control-scout/predict-engine";
import type { CoreOptions, CoreResult } from "./core.js";

/** What the job sets for a run (the rest of CoreOptions are hooks that can't cross a thread). */
export type SimOptions = Pick<CoreOptions, "runs" | "floor" | "budgetMs" | "seed" | "sliceMs">;
export interface ToSimWorker { id: number; input: SimInput; options: SimOptions }
export type FromSimWorker = { id: number; result: CoreResult } | { id: number; error: string };

/** A run still going after this long is stopped (the job retries the event on its next scan). */
export const WORKER_TIMEOUT_MS = 5 * 60_000;

/**
 * The worker's entry: the bundled one next to the server bundle (build/server/projectionWorker.mjs, scripts/build-server.mjs),
 * or the TypeScript source through tsx (npm run dev, scripts, vitest).
 */
export function workerEntry(moduleUrl = import.meta.url, execArgv: readonly string[] = process.execArgv): { url: URL; execArgv?: string[] } {
  return entryFor("./projectionWorker.mjs", "./simWorker.ts", moduleUrl, execArgv);
}

/** A worker's entry: `bundled` next to the server bundle when `moduleUrl` is the bundle (an .mjs), else the TypeScript
 *  `source` (relative to `moduleUrl`) through tsx. The forecaster's rebuild worker starts the same way (predict/offThread.ts). */
export function entryFor(bundled: string, source: string, moduleUrl: string, execArgv: readonly string[] = process.execArgv): { url: URL; execArgv?: string[] } {
  if (fileURLToPath(moduleUrl).endsWith(".mjs")) return { url: new URL(bundled, moduleUrl) };
  const flags = execArgv.some((a) => a.includes("tsx")) ? [...execArgv] : [...execArgv, "--import", "tsx"];
  return { url: new URL(source, moduleUrl), execArgv: flags };
}

let started = 0, live = 0;
/** Worker runs started in this process (tests). */
export const offThreadRuns = () => started;
/** Workers started and not yet finished, stopped or failed (tests). */
export const liveWorkers = () => live;

/** simulateProjection on a worker thread of its own; resolves with the same result it would give here. */
export function simulateOffThread(input: SimInput, options: SimOptions, timeoutMs = WORKER_TIMEOUT_MS): Promise<CoreResult> {
  started++;
  const { url, execArgv } = workerEntry();
  return new Promise<CoreResult>((resolve, reject) => {
    const worker = new Worker(url, execArgv ? { execArgv } : {});
    live++;
    let settled = false;
    const finish = (f: () => void) => {
      if (settled) return;
      settled = true;
      live--;
      clearTimeout(timer);
      void worker.terminate();
      f();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`projection simulation took over ${Math.round(timeoutMs / 1000)} s`))), timeoutMs);
    worker.on("message", (m: FromSimWorker) => finish(() => ("error" in m ? reject(new Error(m.error)) : resolve(m.result))));
    worker.once("error", (e) => finish(() => reject(e)));
    worker.once("exit", (code) => finish(() => reject(new Error(`projection worker exited with code ${code}`))));
    // Awards are a sampling function (it can't be cloned) and the core leaves them out anyway. Anything else that
    // can't be cloned throws here: the worker and the timer go with it.
    try {
      worker.postMessage({ id: 1, input: { ...input, awards: { mode: "none" } }, options } satisfies ToSimWorker);
    } catch (e) {
      finish(() => reject(e));
    }
  });
}
