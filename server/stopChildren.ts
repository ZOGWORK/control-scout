// What a stopping server does with its child processes (server/data/cycle.ts runScriptInChild: the data cycle, the
// live follow-ups, an owner's pack build). The VM's unit stops with KillMode=mixed (deploy/oracle-vm-setup.sh), so
// systemd's SIGTERM reaches the server only and the children are the server's to end.
//
// A zero-gap hand-off (deploy/lanes.sh) tells the outgoing lane first, with SIGUSR2, that a new lane is already
// serving: its data cycle may then finish, for up to CYCLE_FINISH_MS, instead of dying part way through. Lanes were
// handed over every 10 to 20 minutes on busy days, and each hand-off killed the cycle the old lane had started
// (7 of 15 startup cycles on 2026-11-27/28, each 1 to 3 minutes in). The new lane can't start a second cycle
// meanwhile: the cycle holds the data writer lease (server/data/lock.ts), and a second cycle waits for it (up to
// 5 minutes, longer than CYCLE_FINISH_MS) before it runs anything.
// Every other stop (a restart, a rollback, an operator's) ends every child at once, as before.
import type { RunningChild } from "./data/cycle.js";

/** How long a hand-off lets the outgoing lane's data cycle run on before it's ended. Under the unit's TimeoutStopSec. */
export const CYCLE_FINISH_MS = 4 * 60_000;
/** After the stop signal, how long the children get to exit before the server exits anyway. */
const EXIT_WAIT_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

let handoff = false;
/** What this logs at boot: deploy/lanes.sh (LANES_HANDOFF_MARK) sends SIGUSR2 only to a lane that logged it. */
export const HANDOFF_MARK = "hand-off aware";
/** The hand-off's word (SIGUSR2): this lane is being replaced by one already serving. */
export function listenForHandoff(log: (m: string) => void): void {
  log(`stopping: ${HANDOFF_MARK} (SIGUSR2 before a stop lets a running data cycle finish)`);
  process.on("SIGUSR2", () => {
    if (!handoff) log("stopping soon: a new lane is serving (a data cycle running now may finish)");
    handoff = true;
  });
}
export const isHandoff = () => handoff;

/**
 * End the children: each one now (SIGTERM), except, when `finishCycle`, a data cycle, which may run on for `capMs`
 * and is then ended too. Resolves once they've all exited, or EXIT_WAIT_MS after the last was told to stop.
 */
export async function stopChildren(children: RunningChild[], o: { finishCycle: boolean; capMs?: number; log: (m: string) => void; exitWaitMs?: number }): Promise<void> {
  const cycles = o.finishCycle ? children.filter((c) => c.what === "data cycle") : [];
  for (const c of children) if (!cycles.includes(c)) c.stop();
  if (cycles.length) {
    const cap = o.capMs ?? CYCLE_FINISH_MS;
    o.log(`stopping: letting the data cycle finish (up to ${Math.round(cap / 1000)} s)`);
    const finished = await Promise.race([Promise.all(cycles.map((c) => c.done)).then(() => true), sleep(cap).then(() => false)]);
    if (finished) o.log("stopping: the data cycle finished");
    else { o.log(`stopping: the data cycle still ran after ${Math.round(cap / 1000)} s, ending it`); for (const c of cycles) c.stop(); }
  }
  await Promise.race([Promise.all(children.map((c) => c.done)), sleep(o.exitWaitMs ?? EXIT_WAIT_MS)]);
}
