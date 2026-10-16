// The data cycle as one job per process, whoever starts it: the scheduler (server/index.ts) or the
// owner portal's "Re-sync now". Across processes the writer lease (lock.ts) keeps cycles and the
// live fast lane apart; this flag keeps one process from starting a second cycle while its own runs.
import { env } from "../env.js";
import { isRemote } from "../db.js";
import { runCycle, runCycleInChild } from "./cycle.js";

let running: { reason: string; since: string } | null = null;

/** The cycle this process is running right now, if any. */
export const cycleRunning = () => running;

/** The data cycle runs in a child process (DATA_CYCLE=child), which needs a local database file. */
export function childCycle(): boolean { return process.env.DATA_CYCLE === "child" && !isRemote(env.databaseUrl); }

export class CycleBusy extends Error { constructor(readonly reason: string) { super(`a data update is already running (${reason})`); } }

/** Run one data cycle (sync, stats, packs when due). Throws CycleBusy when this process already runs one. */
export async function runDataCycle(reason: string, log: (m: string) => void): Promise<void> {
  if (running) throw new CycleBusy(running.reason);
  running = { reason, since: new Date().toISOString() };
  try {
    // A child needs the local file; with a remote database (or its embedded replica) the cycle stays here.
    const child = childCycle();
    log(`sync (${reason}${child ? ", in a child process" : ""})`);
    if (child) await runCycleInChild(); else await runCycle(log);
  } finally { running = null; }
}
