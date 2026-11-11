// The welcome card (src/components/layout/WelcomeCard.tsx): shown once to each first-time visitor, then never
// again here. The dismissal is kept in localStorage, and in memory too, so blocked storage (a private window,
// storage off) still holds for this page's lifetime and never throws.

export const WELCOME_KEY = "cs-welcome";

/** The searches the card offers: each one answers live with a real card, signed out. */
export const WELCOME_EXAMPLES = ["worlds highlights decode", "4215 vs 6980 who wins", "Bad Wolf record"] as const;

let memory = false;

/** This visitor has already closed it (or used it). */
export function welcomeSeen(): boolean {
  if (memory) return true;
  try { return localStorage.getItem(WELCOME_KEY) !== null; } catch { return false; }
}

/** Closed (X, Esc, a search, an example or Take the tour): not again for this visitor. */
export function dismissWelcome(): void {
  memory = true;
  try { localStorage.setItem(WELCOME_KEY, new Date().toISOString()); } catch { /* memory holds it */ }
}

/** Tests, and "Clear all local data": as if new. */
export function resetWelcome(): void {
  memory = false;
  try { localStorage.removeItem(WELCOME_KEY); } catch { /* nothing kept */ }
}
