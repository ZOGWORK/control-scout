// Keeps the lite pack on the devices of people who come back, without asking
// (who qualifies: packPolicy.ts). It waits until the page has loaded, gone
// idle and stayed quiet for a few seconds, so it never competes with the page
// itself; then it loads packs.ts lazily (the engine stays out of the entry
// bundle) and downloads the pack if it's missing or outdated. Reconnecting or a
// better connection tries again.
import { useEffect, useMemo } from "react";
import { usePersonal } from "./personal";
import { PACK_META_KEY, followsTeams, noteVisit, shouldSyncLite, type ConnectionInfo } from "./packPolicy";

/** After load + idle, this much quiet before the download may start. */
const QUIET_MS = 5000;

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
type Connection = EventTarget & ConnectionInfo;

function storage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try { return window[kind]; } catch { return null; }
}
function hasPack(): boolean {
  try { return !!localStorage.getItem(PACK_META_KEY); } catch { return false; }
}

export function LitePackSync(): null {
  const { state } = usePersonal();
  const follows = followsTeams(state);
  // Once per session (StrictMode's second call reads the verdict the first one stored).
  const returning = useMemo(() => noteVisit(storage("localStorage"), storage("sessionStorage")), []);

  useEffect(() => {
    const w = window as IdleWindow;
    const conn = (navigator as Navigator & { connection?: Connection }).connection;
    let quiet = false, idleId: number | undefined, timer: number | undefined;
    const run = () => {
      if (!quiet) return;
      if (!shouldSyncLite({ online: navigator.onLine !== false, returning, follows, hasPack: hasPack(), connection: conn })) return;
      void import("./packs").then((p) => p.syncLite()).catch(() => {});
    };
    const afterIdle = () => { idleId = undefined; timer = window.setTimeout(() => { quiet = true; run(); }, QUIET_MS); };
    const afterLoad = () => {
      if (w.requestIdleCallback) idleId = w.requestIdleCallback(afterIdle, { timeout: 10_000 });
      else afterIdle();
    };
    if (document.readyState === "complete") afterLoad(); else window.addEventListener("load", afterLoad, { once: true });
    window.addEventListener("online", run);
    conn?.addEventListener?.("change", run);
    return () => {
      window.removeEventListener("load", afterLoad);
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
      clearTimeout(timer);
      window.removeEventListener("online", run);
      conn?.removeEventListener?.("change", run);
    };
  }, [returning, follows]);
  return null;
}
