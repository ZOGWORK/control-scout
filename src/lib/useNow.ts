// One shared clock for relative times ("2m ago"): a single timer for the
// whole app, running only while something on screen reads it, so a list of
// entries re-renders its times every half minute without a timer per row.
import { useSyncExternalStore } from "react";

export const NOW_TICK_MS = 30_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => { now = Date.now(); for (const l of [...listeners]) l(); }, NOW_TICK_MS);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) { clearInterval(timer); timer = null; }
  };
}

/** The current time, refreshed every NOW_TICK_MS for everything that uses it at once. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now, () => now);
}

/** Tests: how many components hold the clock (and whether its one timer runs). */
export const nowClock = () => ({ listeners: listeners.size, running: timer != null });
