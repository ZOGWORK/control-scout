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
import { APP_ROOT, appPath } from "../appRoot.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hasFirst } from "../env.js";
import { all, kvGet, kvSet } from "../db.js";
import { buildPacks } from "../packs/build.js";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { packsEngine, packsPresent } from "../packs/routes.js";
import { syncAll } from "../sync.js";
import { runStats, statsRulesStale } from "../stats/job.js";
import { CURRENT_SEASON, isLegacy } from "./seasons.js";
import { withDataLock } from "./lock.js";
import { unprovenSeasons } from "../api/readiness.js";

type Log = (m: string) => void;

export async function runCycle(log: Log) {
  // Sync + stats hold the writer lease (lock.ts) so the live fast lane never writes at the same time;
  // it waits for a fast-lane tick to finish (seconds), and the fast lane skips its ticks meanwhile.
  // The lease is renewed while held, so a long backfill keeps it.
  await withDataLock("cycle", async () => {
    if (hasFirst()) await syncAll({ seasons: [CURRENT_SEASON], log: (m) => log(`  ${m}`) });
    else log("  FIRST credentials missing — sync skipped (FTC Scout fallback runs per event only)");
    // A past season not fetched in full yet (2019–2022 after they were added): one per cycle, newest
    // first, only in the quiet hours (it takes ~10 min and would hold up live syncs while matches play).
    const backfill = hasFirst() && backfillOn() && quietHours() ? await nextBackfill() : null;
    if (backfill) {
      log(`  backfill: ${backfill}`);
      // Marked before the sync and cleared only once its stats are in: syncing freezes the season, so a cycle
      // stopped between the two would otherwise never come back for the stats.
      await kvSet(STATS_PENDING, [...new Set([...(await statsPending()), backfill])]);
      await syncAll({ seasons: [backfill], log: (m) => log(`  ${m}`) });
    }
    const pending = await statsPending();
    // A past season whose records carry no build time reads as catching up (api/readiness.ts) until it's
    // rebuilt: one per cycle, in the quiet hours (a past season's stats hold the lease for a while).
    const unproven = quietHours() ? (await unprovenSeasons()).find((s) => s !== CURRENT_SEASON) : undefined;
    if (unproven) log(`  ${unproven}: records have no build time, rebuilding`);
    // Every season once after the stats rules change; otherwise just the current one (and a backfilled or unproven one).
    const every = await statsRulesStale();
    if (every) log("  stats rules changed: recomputing every season");
    await runStats({ seasons: every ? undefined : [...new Set([CURRENT_SEASON, ...pending, ...(unproven ? [unproven] : [])])], log: (m) => log(`  ${m}`) });
    if (pending.length) await kvSet(STATS_PENDING, (await statsPending()).filter((s) => !pending.includes(s)));
  }, { ttlMs: 5 * 60_000, waitMs: 5 * 60_000, pollMs: 2000 });
  // Offline packs: rebuilt at most daily (they're versioned; devices see "new data available").
  // The timestamp alone isn't enough: an imported database carries
  // packs:last without the pack files, so also require a readable manifest.
  // CS_PACKS=off: hosts with a throwaway disk (Render free) skip packs; /download says none are built.
  // A new engine version rebuilds them right away: its ratings carry state older packs lack.
  const lastPacks = await kvGet<string>("packs:last");
  if (process.env.CS_PACKS !== "off" && (!lastPacks || Date.now() - Date.parse(lastPacks) > 23 * 3600_000 || !packsPresent() || packsEngine() !== ENGINE_VERSION)) {
    try {
      await buildPacks((m) => log(`  ${m}`));
      await kvSet("packs:last", new Date().toISOString());
    } catch (e) { log(`  packs: ${(e as Error).message}`); } // e.g. a manual build holds the lock
  }
}

/** Backfill runs where the cycle has its own process (the VM); CS_BACKFILL=on|off overrides. */
const backfillOn = () => (process.env.CS_BACKFILL ?? (process.env.DATA_CYCLE === "child" ? "on" : "off")) === "on";

/** A past season is waiting and now is when it may be fetched (the scheduler then starts a cycle for it). */
export async function backfillDue(): Promise<boolean> {
  return hasFirst() && backfillOn() && quietHours() && (await nextBackfill()) != null;
}

/** Backfilled seasons whose stats haven't been computed yet. */
const STATS_PENDING = "backfill:stats-pending";
const statsPending = async () => (await kvGet<number[]>(STATS_PENDING)) ?? [];

/** The next past season to backfill: one not fully fetched, else one fetched whose stats never finished. */
export async function nextBackfill(): Promise<number | null> {
  const rows = await all<{ season: number }>("SELECT season FROM seasons WHERE frozen = 0 AND season < ? ORDER BY season DESC", [CURRENT_SEASON]);
  return rows.map((r) => Number(r.season)).find(isLegacy) ?? (await statsPending())[0] ?? null;
}

/** 06:00–11:59 UTC: night across the Americas (most FTC events), when no matches are being played there.
 *  (Some event is running somewhere almost every day of the season, so "no events today" would never come.) */
export const quietHours = (now = new Date()) => now.getUTCHours() >= 6 && now.getUTCHours() < 12;

const SCRIPT = appPath("scripts", "data-cycle.ts");
const PACKS_SCRIPT = appPath("scripts", "build-packs.ts");

/** Run the cycle in a child Node process (same env, TypeScript through tsx); resolves when it exits cleanly. */
export function runCycleInChild(timeoutMs = 2 * 3600_000): Promise<void> {
  return runScriptInChild(SCRIPT, "data cycle", timeoutMs);
}

/** Build the offline packs in a child Node process (the owner portal's "Rebuild offline packs" where the cycle runs in one). */
export function runPacksInChild(timeoutMs = 3600_000): Promise<void> {
  return runScriptInChild(PACKS_SCRIPT, "pack build", timeoutMs);
}

/**
 * The child's Node arguments for a TypeScript script: through tsx, also when this server runs from its built bundle
 * (scripts/build-server.mjs), whose own flags don't carry the loader; this process's other flags carried over.
 */
export function childArgs(execArgv: readonly string[], script: string): string[] {
  const flags = execArgv.some((a) => a.includes("tsx")) ? [...execArgv] : ["--import", "tsx", ...execArgv];
  return [...flags, script];
}

/** Run a TypeScript script in a child Node process from the app's folder (exported for its test). */
export function runScriptInChild(script: string, what: string, timeoutMs: number, execArgv: readonly string[] = process.execArgv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs(execArgv, script), { cwd: APP_ROOT, env: process.env, stdio: ["ignore", "inherit", "inherit"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (e) => { clearTimeout(timer); reject(e); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error(`${what} process exited with ${signal ?? `code ${code}`}`));
    });
  });
}
