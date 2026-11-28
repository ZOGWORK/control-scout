// Once a server is stopping, its schedule runs nothing more. A stop used to end the process within 10 s, so the old
// lane's timers (push, digest, the cycle's own schedule, ...) never fired beside the new lane's; a zero-gap hand-off
// now keeps it up while its data cycle finishes (server/stopChildren.ts, up to 4 min), and its jobs mustn't run twice.
//
// guardSchedule() wraps the global timers: every timer callback set while the schedule is being started (until
// scheduleStarted()), or set from inside such a callback, is skipped once markStopping() has been called. A timer a
// request sets is left alone: requests in progress still finish.
let stopping = false;
let starting = false;
let depth = 0;
let installed = false;

export const isStopping = () => stopping;
export function markStopping(): void { stopping = true; }

type Fn = (...a: unknown[]) => unknown;
function guard(cb: Fn): Fn {
  return (...a) => {
    if (stopping) return undefined;
    depth++;
    try { return cb(...a); } finally { depth--; }
  };
}

/** Wrap the global timers (once). The schedule set from here until scheduleStarted() stops with the server. */
export function guardSchedule(): void {
  starting = true;
  if (installed) return;
  installed = true;
  const st = globalThis.setTimeout, si = globalThis.setInterval;
  const wrap = (cb: Fn) => (typeof cb === "function" && (starting || depth > 0) ? guard(cb) : cb);
  const timeout = (cb: Fn, ms?: number, ...a: unknown[]) => st(wrap(cb), ms, ...a);
  const interval = (cb: Fn, ms?: number, ...a: unknown[]) => si(wrap(cb), ms, ...a);
  globalThis.setTimeout = Object.assign(timeout, st) as unknown as typeof setTimeout;
  globalThis.setInterval = Object.assign(interval, si) as unknown as typeof setInterval;
}
export function scheduleStarted(): void { starting = false; }

/** Tests only: back to serving. */
export function resetStopping(): void { stopping = false; }
