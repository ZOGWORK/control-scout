// The welcome card (src/components/layout/WelcomeCard.tsx): shown once to each first-time visitor, then never
// again here. The dismissal is kept in localStorage, and in memory too, so blocked storage (a private window,
// storage off) still holds for this page's lifetime and never throws. Changes are announced (WELCOME_CHANGE, and
// the storage event across tabs), so the card and the install nudge follow a reset without a reload.
import { useSyncExternalStore } from "react";

export const WELCOME_KEY = "cs-welcome";
/** Fired on window when this tab changes it (closed, or reset by "Clear all local data"). */
export const WELCOME_CHANGE = "cs-welcome-change";

/** The searches the card offers: each one answers live with a real card, signed out. */
export const WELCOME_EXAMPLES = ["Worlds highlights decode", "4215 vs 6980 who wins", "4215 record"] as const;

let memory = false;

const announce = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(WELCOME_CHANGE)); };

/** This visitor has already closed it (or used it). */
export function welcomeSeen(): boolean {
  if (memory) return true;
  try { return localStorage.getItem(WELCOME_KEY) !== null; } catch { return false; }
}

/** Closed (X, Esc, a search, an example or Take the tour): not again for this visitor. */
export function dismissWelcome(): void {
  memory = true;
  try { localStorage.setItem(WELCOME_KEY, new Date().toISOString()); } catch { /* memory holds it */ }
  announce();
}

/** Tests, and "Clear all local data": as if new. */
export function resetWelcome(): void {
  memory = false;
  try { localStorage.removeItem(WELCOME_KEY); } catch { /* nothing kept */ }
  announce();
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === WELCOME_KEY) cb(); };
  window.addEventListener(WELCOME_CHANGE, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(WELCOME_CHANGE, cb); window.removeEventListener("storage", onStorage); };
}

/**
 * Signed in, the welcome card waits for this device's first sync to work (until then an empty state isn't proof of
 * a new visitor), so a sync that failed or can't run means it won't come. Anything that waits for the card (the
 * install nudge) waits only while this is true: still loading, or it can still come.
 */
export function welcomeMayCome(a: { providers: unknown; user: unknown; sync: string; syncReady: boolean }): boolean {
  if (a.providers === null || !a.user) return true;
  return a.syncReady || a.sync === "syncing";
}

/** welcomeSeen(), as React state: follows a close here, a reset, or another tab. */
export const useWelcomeSeen = () => useSyncExternalStore(subscribe, welcomeSeen, () => true);
