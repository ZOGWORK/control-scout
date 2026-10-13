// The scheduled data cycle (sync from FIRST → stats + prediction ledger →
// offline packs), run in a worker thread so the heavy CPU work never blocks
// the thread that serves pages. On a small host (Render free: 0.15 CPU) the
// stats job alone took minutes, and the whole site stopped answering.
//
// Messages to the parent: { log: string } while running, then { done: true }
// or { error: string }.
import { parentPort, workerData } from "node:worker_threads";
import "../env.js";
import { hasFirst } from "../env.js";
import { kvGet, kvSet } from "../db.js";
import { syncAll } from "../sync.js";
import { runStats } from "../stats/job.js";
import { buildPacks } from "../packs/build.js";
import { packsPresent } from "../packs/routes.js";
import { CURRENT_SEASON } from "../data/seasons.js";

const log = (m: string) => parentPort?.postMessage({ log: m });

try {
  log(`sync (${(workerData as { reason?: string } | null)?.reason ?? "scheduled"})`);
  if (hasFirst()) await syncAll({ seasons: [CURRENT_SEASON], log: (m) => log(`  ${m}`) });
  else log("  FIRST credentials missing — sync skipped (FTC Scout fallback runs per event only)");
  await runStats({ seasons: [CURRENT_SEASON], log: (m) => log(`  ${m}`) });
  // Offline packs: rebuilt at most daily (they're versioned; devices see "new data available").
  // The timestamp alone isn't enough: an imported database carries packs:last
  // without the pack files, so also require a readable manifest.
  // CS_PACKS=off: hosts with a throwaway disk (Render free) use the shipped packs instead.
  const lastPacks = await kvGet<string>("packs:last");
  if (process.env.CS_PACKS !== "off" && (!lastPacks || Date.now() - Date.parse(lastPacks) > 23 * 3600_000 || !packsPresent())) {
    try {
      await buildPacks((m) => log(`  ${m}`));
      await kvSet("packs:last", new Date().toISOString());
    } catch (e) { log(`  packs: ${(e as Error).message}`); } // e.g. a manual build holds the lock
  }
  parentPort?.postMessage({ done: true });
} catch (e) {
  parentPort?.postMessage({ error: (e as Error).message });
}
