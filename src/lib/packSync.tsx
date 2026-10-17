// Keeps the lite pack on the devices of people who come back, without asking
// (who qualifies: packPolicy.ts). It waits until the page has loaded, gone
// idle and stayed quiet (no new requests, no route change) for a few seconds,
// so it never competes with the page itself; then it loads packs.ts lazily (the engine stays out of the entry
// bundle) and downloads the pack if it's missing or outdated. Reconnecting or a
// better connection tries again.
//
// The rule is "download online, never RUN online": this only fetches the file,
// checks its SHA-256 and stores the bytes (no gunzip, no JSON.parse: see
// downloadLite). The pack is decoded and used only with no signal (lib/api.ts).
import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { usePersonal } from "./personal";
import { useFlag } from "./flags";
import { PACK_META_KEY, followsTeams, noteVisit, shouldSyncLite, type ConnectionInfo } from "./packPolicy";

/** After load + idle, this much quiet (no new requests, no route change) before the download may start. */
const QUIET_MS = 5000;
/** New page work restarts the quiet period only this long after load (a polling page can't defer it forever). */
const MAX_WAIT_MS = 60_000;

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
  // Switched off by the owner (the offlinePacks flag): no background downloads at all.
  const packsOn = useFlag("offlinePacks");
  // Once per session (StrictMode's second call reads the verdict the first one stored).
  const returning = useMemo(() => noteVisit(storage("localStorage"), storage("sessionStorage")), []);

  const { pathname } = useLocation();
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    const w = window as IdleWindow;
    const conn = (navigator as Navigator & { connection?: Connection }).connection;
    let quiet = false, loaded = false, startedAt = 0, idleId: number | undefined, timer: number | undefined;
    const run = () => {
      if (!quiet || !packsOn) return;
      if (!shouldSyncLite({ online: navigator.onLine !== false, returning, follows, hasPack: hasPack(), connection: conn })) return;
      void import("./packs").then((p) => p.syncLite()).catch(() => {});
    };
    const idle = (cb: () => void) => {
      if (w.requestIdleCallback) idleId = w.requestIdleCallback(() => { idleId = undefined; cb(); }, { timeout: 10_000 });
      else cb();
    };
    const cancel = () => {
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
      idleId = undefined;
      clearTimeout(timer);
      timer = undefined;
    };
    // Idle, QUIET_MS with no new page work, idle again: then the page is done and the pack may start.
    const schedule = () => {
      cancel();
      idle(() => { timer = window.setTimeout(() => { timer = undefined; idle(() => { quiet = true; run(); }); }, QUIET_MS); });
    };
    // New page work (a route change, a request) restarts the quiet period, so the pack never
    // competes with it, but only for MAX_WAIT_MS after load: a page that polls can't put it off forever.
    const kick = () => {
      if (!loaded || quiet || Date.now() - startedAt > MAX_WAIT_MS) return;
      schedule();
    };
    kickRef.current = kick;
    const afterLoad = () => { loaded = true; startedAt = Date.now(); schedule(); };
    if (document.readyState === "complete") afterLoad(); else window.addEventListener("load", afterLoad, { once: true });
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => { if (list.getEntries().some((e) => !e.name.includes("/packs/"))) kick(); });
      observer.observe({ type: "resource" });
    } catch { /* no PerformanceObserver: route changes still restart the wait */ }
    window.addEventListener("online", run);
    conn?.addEventListener?.("change", run);
    return () => {
      kickRef.current = () => {};
      window.removeEventListener("load", afterLoad);
      cancel();
      observer?.disconnect();
      window.removeEventListener("online", run);
      conn?.removeEventListener?.("change", run);
    };
  }, [returning, follows, packsOn]);

  // A route change is new page work too (its code and data may come from cache, unseen by the observer).
  useEffect(() => { kickRef.current(); }, [pathname]);
  return null;
}
