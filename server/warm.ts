// A new process's warm-up (server/index.ts): the ratings, the track record and search's indexes built before the
// server says it's ready and takes the systemd socket, so a deploy's queued requests are answered by a warm process
// instead of one still building them on the same event loop. Each step is timed in the log ("warm: spelling 1.2s"),
// then the whole ("warm in 3.4s"), so a slow deploy shows where its time went (journalctl -u control-scout).

/** How long a deploy holds requests while it warms: well under nginx's proxy_read_timeout (60 s, its default for the
 *  site: deploy/oracle-vm-setup.sh), so a request queued in the socket at the restart is still answered in time.
 *  Steps not done by then go on in the background, as before. */
export const WARM_CAP_MS = 20_000;

/** The first data cycle after a restart (server/index.ts): late enough that a deploy's first minutes are for answering,
 *  not for a stats run and search rebuild on the same small machine. */
export const STARTUP_CYCLE_MS = 10 * 60_000;

export type WarmStep = [name: string, run: () => Promise<unknown>];

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Runs every step at once (each a chain of its own) and waits for all of them, or `cap` ms, whichever is first.
 *  Logs each step's time (or its failure), then the total, each line starting `label`. A failure is logged and never
 *  stops the others. Resolves with whether every step finished in time, and `settled`: when every step has. */
export async function warmUp(steps: WarmStep[], log: (m: string) => void, cap = WARM_CAP_MS, now = () => Date.now(), label = "warm"): Promise<{ inTime: boolean; settled: Promise<void> }> {
  const t0 = now();
  const all = Promise.allSettled(steps.map(async ([name, run]) => {
    const t = now();
    try {
      await run();
      log(`${label}: ${name} ${secs(now() - t)}`);
    } catch (e) {
      log(`${label}: ${name} failed after ${secs(now() - t)}: ${(e as Error).message}`);
    }
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  // No cap (Infinity): wait for all. (setTimeout would fire at once for it.)
  const done = await Promise.race([all.then(() => true), ...(Number.isFinite(cap) ? [new Promise<false>((r) => { timer = setTimeout(() => r(false), cap); })] : [])]);
  clearTimeout(timer);
  const settled = all.then(() => undefined);
  if (done) log(`${label} in ${secs(now() - t0)}`);
  else {
    log(`${label}: still going after ${secs(cap)}, answering anyway (the rest goes on in the background)`);
    void settled.then(() => log(`${label} in ${secs(now() - t0)} (after answering)`));
  }
  return { inTime: done, settled };
}
