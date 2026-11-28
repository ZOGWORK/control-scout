// The background data cycle: sync the current season, recompute stats and the
// prediction ledger, and rebuild the offline packs once a day — and, on an event
// day, as soon as a sync has brought new data (packs/due.ts).
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
import { CURRENT_PACK_DATA, CURRENT_PACK_LAST, onlySeasons, packsDue } from "../packs/due.js";
import { dataVersion } from "../predict/engine.js";
import { eventDayNow } from "./cadence.js";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { packsEngine, packsPresent } from "../packs/routes.js";
import { syncAll } from "../sync.js";
import { syncCriResults } from "./criResults.js";
import { runStats, statsRulesStale } from "../stats/job.js";
import { CURRENT_SEASON, isLegacy } from "./seasons.js";
import { withDataLock } from "./lock.js";
import { unprovenSeasons } from "../api/readiness.js";
import { refreshTeamLogosIfDue } from "../teamLogos.js";

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
    // The Chicago Robotics Invitational's results from its own site (data/criResults.ts): read weekly; a season it
    // wrote gets its stats rebuilt below. It runs with the sync (FIRST credentials: the real data host, never a
    // test). Its own failure never fails the cycle.
    if (hasFirst()) try {
      const cri = await syncCriResults({ log: (m) => log(`  ${m}`) });
      const wrote = [...new Set(cri.written.map((w) => w.season))];
      if (wrote.length) await kvSet(STATS_PENDING, [...new Set([...(await statsPending()), ...wrote])]);
    } catch (e) { log(`  CRI results failed: ${(e as Error).message.slice(0, 120)}`); }
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
  // Offline packs: rebuilt once a day, and on an event day as soon as a sync has brought new data (packs/due.ts) — a
  // phone at a venue predicts from the lite pack, and a pack built yesterday morning is yesterday's ratings. An
  // event-day build rebuilds the lite pack, and the current season's full pack at most hourly; the other full packs'
  // files are carried forward instead of rewritten.
  // The timestamp alone isn't enough: an imported database carries
  // packs:last without the pack files, so also require a readable manifest.
  // CS_PACKS=off: hosts with a throwaway disk (Render free) skip packs; /download says none are built.
  // A new engine version rebuilds them right away: its ratings carry state older packs lack.
  // Read before the build, and stamped after it: a result that lands while the build runs has to read as new data on the
  // next cycle (one extra build), not as already packed.
  const dataAt = await dataVersion();
  const packs = packsDue({
    lastBuiltAt: await kvGet<string>("packs:last"), builtFrom: await kvGet<string>("packs:data"),
    currentBuiltAt: await kvGet<string>(CURRENT_PACK_LAST), currentFrom: await kvGet<string>(CURRENT_PACK_DATA),
    dataVersion: dataAt, now: Date.now(), eventDay: await eventDayNow(),
    present: packsPresent(), packsEngine: packsEngine(), engine: ENGINE_VERSION,
  });
  if (process.env.CS_PACKS !== "off" && packs.due) {
    try {
      await buildPacks((m) => log(`  ${m}`), { only: onlySeasons(packs.scope, CURRENT_SEASON) });
      await stampPacks(dataAt, packs.scope !== "lite");
    } catch (e) { log(`  packs: ${(e as Error).message}`); } // e.g. a manual build holds the lock
  }
  // Team logos (server/teamLogos.ts): FIRST's pictures, refreshed daily whether or not the owner's switch is on, so
  // turning it on shows them at once. Light: one stylesheet per season, then only pictures that changed.
  await refreshTeamLogosIfDue([CURRENT_SEASON, CURRENT_SEASON - 1], (m) => log(`  ${m}`));
}

/** After a pack build from `dataAt` (read before it started): the lite pack's stamps, and the current season's full
 *  pack's when the build rebuilt it rather than carried it (packs/due.ts reads both). */
export async function stampPacks(dataAt: string, currentRebuilt: boolean): Promise<void> {
  const at = new Date().toISOString();
  await kvSet("packs:data", dataAt);
  await kvSet("packs:last", at);
  if (currentRebuilt) {
    await kvSet(CURRENT_PACK_DATA, dataAt);
    await kvSet(CURRENT_PACK_LAST, at);
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

/**
 * The data cycle child's heap limit (MB). Without one V8 sizes a child's heap for the machine (about 4 GB on the VM)
 * and barely collects before it exits: the 15-minute cycle held 1.77 GB for a heap of 650 MB, on top of the web
 * process (the lane peaked at 4.3 GB). With 1536 it peaked at 1.14 GB and finished sooner (56 s, against 64 s),
 * measured on the VM 2026-11-22 on a copy of its data (the season's stats and records). A backfill or every season's
 * stats again is far more, so it has room to spare, and withHeapCap runs a child that runs out once more without it.
 */
export const CYCLE_HEAP_MB = 1536;

/** A child that ran out of its heap: V8 aborts the process (runScriptInChild: "… exited with SIGABRT"). */
export const outOfMemory = (e: unknown) => /\bSIGABRT$/.test((e as Error)?.message ?? "");

/**
 * Run a child with a heap limit: `start` gets the Node flags to start it with (this process's own, then the limit).
 * A child that runs out of it runs once more without the limit, so the job never stops on it; any other failure,
 * a timeout included, is thrown as it was.
 */
export async function withHeapCap<T>(heapMb: number, what: string, start: (execArgv: readonly string[]) => Promise<T>): Promise<T> {
  try {
    return await start([...process.execArgv, `--max-old-space-size=${heapMb}`]);
  } catch (e) {
    if (!outOfMemory(e)) throw e;
    console.warn(`${what} ran out of its ${heapMb} MB heap: running it again without the limit`);
    return start(process.execArgv);
  }
}

/** Run the cycle in a child Node process (same env, TypeScript through tsx), with CYCLE_HEAP_MB of heap; resolves
 *  when it exits cleanly. */
export function runCycleInChild(timeoutMs = 2 * 3600_000, run: typeof runScriptInChild = runScriptInChild): Promise<void> {
  return withHeapCap(CYCLE_HEAP_MB, "data cycle", (execArgv) => run(SCRIPT, "data cycle", timeoutMs, execArgv));
}

/** Build the offline packs in a child Node process (the owner portal's "Rebuild offline packs" where the cycle runs in one).
 *  `lockHeld`: the caller holds the data lock for the whole build; the child is told (--lock-held) so it doesn't take it. */
export function runPacksInChild(timeoutMs = 3600_000, o: { lockHeld?: boolean } = {}): Promise<void> {
  return runScriptInChild(PACKS_SCRIPT, "pack build", timeoutMs, process.execArgv, o.lockHeld ? ["--lock-held"] : []);
}

/**
 * The child's Node arguments for a TypeScript script: through tsx, also when this server runs from its built bundle
 * (scripts/build-server.mjs), whose own flags don't carry the loader; this process's other flags carried over.
 */
export function childArgs(execArgv: readonly string[], script: string): string[] {
  const flags = execArgv.some((a) => a.includes("tsx")) ? [...execArgv] : ["--import", "tsx", ...execArgv];
  return [...flags, script];
}

/** A child process running now (runScriptInChild): what it is ("data cycle", "live follow-up", …), a promise that
 *  settles when it exits, and a stop (SIGTERM). The server's stop (server/stopChildren.ts) reads these: the unit's
 *  KillMode=mixed leaves the children to the server, so it ends them itself, or lets a data cycle finish. */
export interface RunningChild { what: string; done: Promise<void>; stop: () => void }
const running = new Set<RunningChild>();
/** The child processes running now. */
export const runningChildren = (): RunningChild[] => [...running];

/** Run a TypeScript script in a child Node process from the app's folder (exported for its test).
 *  `onMessage`: the child gets an IPC channel (process.send), and each message it sends is handed over. */
export function runScriptInChild(script: string, what: string, timeoutMs: number, execArgv: readonly string[] = process.execArgv, args: readonly string[] = [],
  o: { onMessage?: (m: unknown) => void } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...childArgs(execArgv, script), ...args], { cwd: APP_ROOT, env: process.env, stdio: o.onMessage ? ["ignore", "inherit", "inherit", "ipc"] : ["ignore", "inherit", "inherit"] });
    if (o.onMessage) child.on("message", o.onMessage);
    const done = new Promise<void>((r) => child.once("exit", () => r()));
    const entry: RunningChild = { what, done, stop: () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); } };
    running.add(entry);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (e) => { clearTimeout(timer); running.delete(entry); reject(e); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      running.delete(entry);
      if (code === 0) resolve(); else reject(new Error(`${what} process exited with ${signal ?? `code ${code}`}`));
    });
  });
}
