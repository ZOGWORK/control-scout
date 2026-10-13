// The background data cycle: sync the current season, recompute stats and the
// prediction ledger, and rebuild the offline packs at most daily.
//
// It runs either in the server process (default) or, with DATA_CYCLE=child and
// a local database file, in a separate Node process (scripts/data-cycle.ts). Stats and especially the
// pack build are long synchronous stretches that would otherwise stall every
// request; a child keeps the server answering. The child writes to the same
// SQLite file (WAL), and the server picks the new data up through the data
// version, so nothing else needs to be signalled. Hosts with little memory
// (Render free, 512 MB) keep the default: a second process would not fit.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hasFirst } from "../env.js";
import { kvGet, kvSet } from "../db.js";
import { buildPacks } from "../packs/build.js";
import { packsPresent } from "../packs/routes.js";
import { syncAll } from "../sync.js";
import { runStats, statsRulesStale } from "../stats/job.js";
import { CURRENT_SEASON } from "./seasons.js";

type Log = (m: string) => void;

export async function runCycle(log: Log) {
  if (hasFirst()) await syncAll({ seasons: [CURRENT_SEASON], log: (m) => log(`  ${m}`) });
  else log("  FIRST credentials missing — sync skipped (FTC Scout fallback runs per event only)");
  // Every season once after the stats rules change; otherwise just the current one.
  const all = await statsRulesStale();
  if (all) log("  stats rules changed: recomputing every season");
  await runStats({ seasons: all ? undefined : [CURRENT_SEASON], log: (m) => log(`  ${m}`) });
  // Offline packs: rebuilt at most daily (they're versioned; devices see "new data available").
  // The timestamp alone isn't enough: an imported database carries
  // packs:last without the pack files, so also require a readable manifest.
  // CS_PACKS=off: hosts with a throwaway disk (Render free) skip packs; /download says none are built.
  const lastPacks = await kvGet<string>("packs:last");
  if (process.env.CS_PACKS !== "off" && (!lastPacks || Date.now() - Date.parse(lastPacks) > 23 * 3600_000 || !packsPresent())) {
    try {
      await buildPacks((m) => log(`  ${m}`));
      await kvSet("packs:last", new Date().toISOString());
    } catch (e) { log(`  packs: ${(e as Error).message}`); } // e.g. a manual build holds the lock
  }
}

const SCRIPT = fileURLToPath(new URL("../../scripts/data-cycle.ts", import.meta.url));

/** Run the cycle in a child Node process (same loader flags, same env); resolves when it exits cleanly. */
export function runCycleInChild(timeoutMs = 2 * 3600_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, SCRIPT], { env: process.env, stdio: ["ignore", "inherit", "inherit"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (e) => { clearTimeout(timer); reject(e); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error(`data cycle process exited with ${signal ?? `code ${code}`}`));
    });
  });
}
