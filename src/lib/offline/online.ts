// Is there a connection right now? The browser's own word (navigator.onLine), kept behind this one hook so the
// connection check the offline program is building (src/lib/connection.ts useConnection) is a one-line swap here.
import { useSyncExternalStore } from "react";

function subscribe(fn: () => void) {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => { window.removeEventListener("online", fn); window.removeEventListener("offline", fn); };
}

/** False when the browser knows it has no connection (true when it can't tell). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => typeof navigator === "undefined" || navigator.onLine !== false, () => true);
}

/** Does the device say it has no network? For code outside React (the same word useOnline reads). */
export const deviceOffline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;
