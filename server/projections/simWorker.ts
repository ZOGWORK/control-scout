// The projections job's simulation thread (offThread.ts): one simulateProjection per message, nothing else. Built as
// build/server/projectionWorker.mjs next to the server bundle (scripts/build-server.mjs); run from source through tsx.
import { parentPort } from "node:worker_threads";
import { simulateProjection } from "./core.js";
import type { FromSimWorker, ToSimWorker } from "./offThread.js";

parentPort!.on("message", async (m: ToSimWorker) => {
  try {
    // Nothing else runs on this thread, so the core never needs to pause: its compute time is the thread's wall
    // time, and the budget (compute ms) is enforced against the real time the run takes.
    const result = await simulateProjection({ ...m.input, awards: { mode: "none" }, runs: 1 }, { ...m.options, pause: async () => {} });
    parentPort!.postMessage({ id: m.id, result } satisfies FromSimWorker);
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) } satisfies FromSimWorker);
  }
});
