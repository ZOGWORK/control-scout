// The forecaster rebuild (every new data version) leaves the web process's event loop free: its replay runs on the
// rebuild worker (offThread.ts). On the server's own thread, pausing every 4,000 matches, the loop was busy for the
// whole rebuild: on the VM 12.9 s a rebuild with gaps up to 670 ms, every request sharing what was left.
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSet } from "../db";
import { CURRENT_SEASON } from "../data/seasons";
import { forecasterFor, liveForecaster, resetForecasters } from "./engine";
import { bigWindowDb } from "./__fixtures__/bigWindow";

const S = CURRENT_SEASON;
let close = () => {};

beforeAll(async () => {
  ({ close } = await bigWindowDb());
  resetForecasters();
  await forecasterFor(S); // the first build (a server start's), and the frozen seasons read
}, 300_000);

afterAll(async () => {
  resetForecasters();
  await import("./offThread").then((m) => m.stopRebuildWorker()).catch(() => {});
  close();
});

describe("a forecaster rebuild on a full-size window", () => {
  it("leaves the event loop free, and pages keep answering from the previous ratings meanwhile", async () => {
    const before = await liveForecaster(S);
    await kvSet("data:version", "v2");
    let gap = 0, last = performance.now();
    const tick = setInterval(() => { const n = performance.now(); gap = Math.max(gap, n - last); last = n; }, 2);
    // Simulated page requests, one every 5 ms: each is answered at once, with the ratings already built.
    let served = 0, stale = 0, going = true;
    const pages = (async () => {
      while (going) {
        if ((await liveForecaster(S)) === before) stale++;
        served++;
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    const elu0 = performance.eventLoopUtilization();
    const t0 = performance.now();
    try {
      const fresh = await forecasterFor(S); // the new version's rebuild
      const ms = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 20)); // the tick that measures a loop held until now
      const elu = performance.eventLoopUtilization(elu0);
      going = false;
      await pages;
      console.log(`rebuild ${Math.round(ms)} ms: loop busy ${Math.round(elu.utilization * 100)}%, max gap ${Math.round(gap)} ms, ${served} requests served (${stale} from the previous ratings)`);
      expect(fresh).not.toBe(before);
      expect(await liveForecaster(S)).toBe(fresh);
      expect(stale).toBeGreaterThan(0); // no page waited for the rebuild
      // On the server's own thread: utilisation ≈ 1 for the whole rebuild. Off it: the loop idles.
      expect(elu.utilization).toBeLessThan(0.3);
      expect(gap).toBeLessThan(250); // loose: a loaded CI runner still turns the loop well inside this
    } finally {
      going = false;
      clearInterval(tick);
    }
  }, 300_000);
});
