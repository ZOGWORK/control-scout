// The data cycle as one job per process, whoever starts it: the scheduler (server/index.ts) or the
// owner portal's "Re-sync now". Across processes the writer lease (lock.ts) keeps cycles and the
// live fast lane apart; this flag keeps one process from starting a second cycle while its own runs.
import { childCycle } from "./cadence.js";
import { runCycle, runCycleInChild } from "./cycle.js";

export { childCycle };

let running: { reason: string; since: string } | null = null;

/** The cycle this process is running right now, if any. */
export const cycleRunning = () => running;

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
