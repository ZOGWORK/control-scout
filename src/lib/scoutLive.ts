// Live workspace entries on the device: while a workspace's scout space is on
// screen, an EventSource on /api/scout/stream merges each entry another member
// writes (newer wins, like a pull) and moves the pull cursor along, so the list
// updates without a refresh and a later pull starts where the stream stopped.
//
// - Reconnects with backoff (1 s … 20 s, from the device's cursor). When the
//   stream keeps failing, or EventSource isn't there, or the server has live
//   updates switched off (503), it polls the cursor pull every 15 s instead,
//   and tries the stream again every 2 minutes.
// - Personal never streams. The stream closes on a space change, on sign-out
//   (the hook unmounts or `signedIn` goes false), and after the tab has been
//   hidden for a minute; it reopens (catching up from the cursor) when the tab
//   is visible again.
import { useEffect, useState } from "react";
import { applyLiveEntries, notifyScoutChanged, pullScouting, scoutCursor, type ScoutEntry, type ScoutSpace } from "./scouting";

/** off: Personal, signed out or hidden · connecting · live · polling (the fallback) · revoked: the server ended it (no access). */
export type LiveMode = "off" | "connecting" | "live" | "polling" | "revoked";

export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000];
export const POLL_MS = 15_000;
export const STREAM_RETRY_WHILE_POLLING_MS = 120_000;
export const HIDDEN_CLOSE_MS = 60_000;

interface Deps {
  EventSource?: typeof EventSource;
  pull?: (space: string) => Promise<unknown>;
  random?: () => number;
}

/** Follow one workspace live until the returned stop() is called. `onMode` hears every change of mode. */
export function followWorkspace(space: string, onMode: (m: LiveMode) => void, deps: Deps = {}): () => void {
  const ES = "EventSource" in deps ? deps.EventSource : (globalThis as { EventSource?: typeof EventSource }).EventSource;
  const pull = deps.pull ?? ((s: string) => pullScouting(s));
  const random = deps.random ?? Math.random;
  let es: EventSource | null = null;
  let stopped = false;
  let failures = 0;
  let mode: LiveMode | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;
  let pending: { entry: ScoutEntry; seq: number }[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const setMode = (m: LiveMode) => { if (m !== mode) { mode = m; onMode(m); } };
  const close = () => { if (es) { es.close(); es = null; } };
  const clearRetry = () => { if (retry) { clearTimeout(retry); retry = null; } };
  const poll = () => { pull(space).catch(() => { /* offline or refused: the next tick tries again */ }); };
  const startPolling = () => {
    setMode("polling");
    if (poller) return;
    poll();
    poller = setInterval(poll, POLL_MS);
  };
  const stopPolling = () => { if (poller) { clearInterval(poller); poller = null; } };

  // Merges are batched into one list refresh per burst (a catch-up can bring hundreds).
  const flush = () => {
    flushTimer = null;
    const batch = pending; pending = [];
    if (!batch.length || stopped) return;
    try { applyLiveEntries(space, batch); }
    catch { failed(); } // couldn't save on the device: the cursor stayed put, so a reconnect brings them again
    notifyScoutChanged();
  };
  const queue = (entry: ScoutEntry, seq: number) => {
    pending.push({ entry, seq });
    flushTimer ??= setTimeout(flush, 50);
  };

  function failed() {
    close();
    if (stopped) return;
    failures++;
    clearRetry();
    if (failures > BACKOFF_MS.length) {
      startPolling();
      retry = setTimeout(connect, STREAM_RETRY_WHILE_POLLING_MS);
    } else {
      const base = BACKOFF_MS[failures - 1];
      retry = setTimeout(connect, base + Math.floor(random() * base * 0.3));
    }
  }

  function connect() {
    retry = null;
    if (stopped) return;
    if (!ES) { startPolling(); return; }
    if (!poller) setMode("connecting");
    flushPendingNow();
    const s = new ES(`/api/scout/stream?workspaceId=${encodeURIComponent(space)}&since=${scoutCursor(space)}`, { withCredentials: true });
    es = s;
    const onEntry = (ev: Event) => {
      if (es !== s) return;
      const m = ev as MessageEvent<string>;
      const seq = Number(m.lastEventId);
      let entry: ScoutEntry;
      try { entry = JSON.parse(m.data); } catch { return; }
      if (!Number.isSafeInteger(seq) || !entry || typeof entry.uuid !== "string") return;
      queue(entry, seq);
    };
    s.addEventListener("upsert", onEntry);
    s.addEventListener("delete", onEntry);
    s.addEventListener("ready", () => {
      if (es !== s) return;
      failures = 0;
      stopPolling(); clearRetry();
      setMode("live");
    });
    s.addEventListener("resync", () => {
      // Too far behind for the stream: pull (pages through), then stream from the new cursor.
      if (es !== s) return;
      close(); flushPendingNow();
      setMode("connecting");
      pull(space).catch(() => undefined).finally(() => { if (!stopped && !es && !retry) connect(); });
    });
    s.addEventListener("membership_revoked", () => {
      if (es !== s) return;
      close(); stopPolling(); clearRetry();
      setMode("revoked");
    });
    s.onerror = () => { if (es === s) { flushPendingNow(); failed(); } };
  }

  function flushPendingNow() { if (flushTimer) { clearTimeout(flushTimer); flush(); } }

  const online = () => { if (!stopped && !es) { failures = 0; clearRetry(); connect(); } };
  window.addEventListener("online", online);
  connect();
  return () => {
    stopped = true;
    window.removeEventListener("online", online);
    flushPendingNow();
    close(); clearRetry(); stopPolling();
    setMode("off");
  };
}

/** A tab hidden longer than HIDDEN_CLOSE_MS lets go of the stream; visible again: back. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const change = () => {
      if (t) { clearTimeout(t); t = null; }
      if (document.visibilityState === "hidden") t = setTimeout(() => setVisible(false), HIDDEN_CLOSE_MS);
      else setVisible(true);
    };
    document.addEventListener("visibilitychange", change);
    return () => { document.removeEventListener("visibilitychange", change); if (t) clearTimeout(t); };
  }, []);
  return visible;
}

/** Keep a workspace space live while it's on screen and signed in. Personal (null): always "off". */
export function useScoutLive(space: ScoutSpace, signedIn: boolean): LiveMode {
  const visible = useVisible();
  const [mode, setMode] = useState<LiveMode>("off");
  useEffect(() => {
    if (space == null || !signedIn || !visible) { setMode("off"); return; }
    return followWorkspace(space, setMode);
  }, [space, signedIn, visible]);
  return mode;
}
