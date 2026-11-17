// The shutdown message in the app (server/shutdownGate.ts, docs/settings.md "Shutdown message"). The server shows a
// visitor who isn't signed in only "under construction" while the owner has publicAccess off; an installed app
// can still open its cached shell from the service worker, so the app shows the same message when it learns the site
// is closed to it: an API answer of 503 {error: "unavailable"}, or /api/flags saying publicAccess is off while
// /api/auth/me says nobody is signed in (src/components/ShutdownScreen.tsx). Nothing on the device is cleared.
import { useSyncExternalStore } from "react";

/** The error code of the server's 503 while the site is closed to this visitor. */
export const UNAVAILABLE_CODE = "unavailable";

let unavailable = false;
const subs = new Set<() => void>();

/** Is this one of the server's "under construction" answers? */
export const isUnavailableAnswer = (status: number, body: unknown): boolean =>
  status === 503 && (body as { error?: unknown } | null)?.error === UNAVAILABLE_CODE;

/** The server said the site is closed to this visitor. */
export function markUnavailable(): void {
  if (unavailable) return;
  unavailable = true;
  for (const f of subs) f();
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** Has an API answer said the site is closed to this visitor (on this page load)? */
export const useUnavailable = () => useSyncExternalStore(subscribe, () => unavailable, () => false);

/** Tests: back to open. */
export function resetUnavailable(): void { unavailable = false; for (const f of subs) f(); }
