// Is there internet right now? One answer for the whole app (api.ts, the top bar's Offline pill, the light-version
// offer), from a real check rather than navigator.onLine alone:
//
//   - online: what the browser says (navigator.onLine). Only a hint: false can be wrong on iOS, true says nothing
//     about whether the Wi-Fi carries anything.
//   - internet: "yes" when GET /api/health came back as this server's own answer ({ ok: true, … }, server/app.ts);
//     "portal" when something else answered (a sign-in page, a redirect to another site, a page that isn't ours: a
//     hotel or venue Wi-Fi that wants you to sign in first); "no" when nothing answered (a network error, or no answer
//     in CHECK_TIMEOUT_MS); "unknown" before the first check.
//   - type: Wi-Fi, mobile data, none (the browser says it's offline) or unknown (most browsers don't say: iPhones,
//     desktop Chrome). saveData: the browser's Data Saver.
//
// When it checks: shortly after start unless a request settled it first (startConnectionWatch, main.tsx), on the browser's online/offline events, when the
// tab comes back into view, soon after any request fails for want of a network (api.ts noteRequestFailed), every
// RETRY_MS while there's no internet, and every IDLE_MS (tab in view) while there is. A server answer anywhere in
// the app counts as "yes" at once (noteServerAnswer), so coming back never waits for the next check.
//
// For screenshots, localStorage `cs-connection-demo` = "offline" | "portal" shows that state (the pill, and the
// light-version offer stays away); requests still go by the real checks, so the page under the pill is real.
import { useSyncExternalStore } from "react";
import type { ConnectionInfo } from "./packPolicy";
import { netKind } from "./offline/updatePolicy";

export type Internet = "yes" | "no" | "portal" | "unknown";
export type ConnectionType = "wifi" | "cellular" | "none" | "unknown";

export interface ConnectionState {
  /** navigator.onLine (a hint only). */
  online: boolean;
  internet: Internet;
  type: ConnectionType;
  saveData: boolean;
  /** When `internet` was last decided (ms since 1970), 0 before the first check. */
  checkedAt: number;
}

/** No answer to the check in this long: no internet. */
export const CHECK_TIMEOUT_MS = 2500;
/** While there's no internet (or a portal): check again this often. */
export const RETRY_MS = 30_000;
/** While there is: check again this often (only with the tab in view). Failures check sooner on their own. */
export const IDLE_MS = 5 * 60_000;
/** A request failure checks after this long, so a burst of failures (a page's requests) costs one check. */
export const FAIL_DEBOUNCE_MS = 250;
export const DEMO_KEY = "cs-connection-demo";
/** The first check at start, when nothing has settled it by then. */
export const FIRST_CHECK_MS = 1500;

const HEALTH = "/api/health";

function info(): ConnectionInfo | null {
  return typeof navigator === "undefined" ? null : ((navigator as Navigator & { connection?: ConnectionInfo }).connection ?? null);
}
const browserOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

function demo(): Internet | null {
  try {
    const v = localStorage.getItem(DEMO_KEY);
    return v === "offline" ? "no" : v === "portal" ? "portal" : null;
  } catch { return null; }
}

function typeNow(online: boolean): ConnectionType {
  if (!online) return "none";
  const k = netKind(info());
  return k === "unknown" ? "unknown" : k;
}

const initial = (): ConnectionState => {
  const online = browserOnline();
  return { online, internet: online ? "unknown" : "no", type: typeNow(online), saveData: info()?.saveData === true, checkedAt: 0 };
};
let state: ConnectionState = initial();
const listeners = new Set<() => void>();
const internetListeners = new Set<(now: Internet, before: Internet) => void>();

function set(next: Partial<ConnectionState>) {
  const online = browserOnline();
  const merged: ConnectionState = { ...state, online, type: typeNow(online), saveData: info()?.saveData === true, ...next };
  const changed = merged.online !== state.online || merged.internet !== state.internet || merged.type !== state.type || merged.saveData !== state.saveData;
  const prev = state.internet;
  if (changed || merged.checkedAt !== state.checkedAt) state = merged;
  if (changed) {
    listeners.forEach((f) => f());
    if (prev !== state.internet) internetListeners.forEach((f) => f(state.internet, prev));
  }
  schedule();
}

/** The demo overlay (cs-connection-demo) on the real state: the same object while neither changes. */
let shown: { from: ConnectionState; forced: Internet; out: ConnectionState } | null = null;
/** The connection now, as the app shows it (the same object until something changes). The demo setting only changes
 *  what's shown (the pill, the light-version offer): reads still go by the real state (offlineNow). */
export function connection(): ConnectionState {
  const forced = demo();
  if (!forced) return state;
  if (shown?.from !== state || shown.forced !== forced) {
    shown = { from: state, forced, out: { ...state, internet: forced, online: forced !== "no", type: forced === "no" ? "none" : "wifi" } };
  }
  return shown.out;
}

/** No internet now: the browser said it went offline, or the last check found none or a sign-in page. Reads the
 *  saved packs can answer are answered from them at once while this holds (api.ts). */
export function offlineNow(): boolean {
  return state.internet === "no" || state.internet === "portal";
}

/** Shown as offline (the pill): offlineNow, or the demo setting. */
export function shownOffline(s: ConnectionState = connection()): boolean {
  return s.internet === "no" || s.internet === "portal";
}

export function subscribeConnection(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Called whenever `internet` changes (api.ts refreshes what's on screen from the packs when it turns "yes"). */
export function onInternetChange(fn: (now: Internet, before: Internet) => void): () => void {
  internetListeners.add(fn);
  return () => { internetListeners.delete(fn); };
}

export function useConnection(): ConnectionState {
  return useSyncExternalStore(subscribeConnection, connection, connection);
}

/** What answered the check, as one of the states. */
export async function classify(res: Response): Promise<Internet> {
  // A redirect (fetched with redirect: "manual", so it isn't followed): our health check never redirects.
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return "portal";
  // Followed anyway (a browser that ignores "manual"): it ended up somewhere else.
  if (res.redirected && typeof location !== "undefined" && res.url && new URL(res.url, location.href).origin !== location.origin) return "portal";
  // 511 is the status made for sign-in pages.
  if (res.status === 511) return "portal";
  // Our own server (or the CDN in front of it) erroring: the internet works, the site is having trouble.
  if (res.status >= 500) return "yes";
  let body: unknown = null;
  try { body = JSON.parse(await res.text()); } catch { return "portal"; }
  return body && typeof body === "object" && (body as { ok?: unknown }).ok === true ? "yes" : "portal";
}

let inflight: Promise<Internet> | null = null;
let started = false;

/** Check now (one at a time: a check already running is shared). Resolves to the answer. */
export function checkInternet(): Promise<Internet> {
  if (inflight) return inflight;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  const since = Date.now();
  const run: Promise<Internet> = (async (): Promise<Internet> => {
    try {
      const res = await fetch(HEALTH, { cache: "no-store", redirect: "manual", credentials: "omit", signal: ctrl.signal, headers: { Accept: "application/json" } });
      return await classify(res);
    } catch {
      return "no";
    } finally {
      clearTimeout(timer);
    }
  })().then((internet) => {
    if (inflight === run) inflight = null;
    // The server answered another request while this check waited: that answer is the newer news.
    if (internet === "no" && answeredAt >= since) return state.internet;
    set({ internet, checkedAt: Date.now() });
    return internet;
  });
  inflight = run;
  return run;
}

/** The last answer when it's no older than `maxAgeMs`, else a new check. */
export function freshInternet(maxAgeMs: number): Promise<Internet> {
  if (inflight) return inflight;
  if (state.internet !== "unknown" && Date.now() - state.checkedAt < maxAgeMs) return Promise.resolve(state.internet);
  return checkInternet();
}

let failTimer: ReturnType<typeof setTimeout> | undefined;
/** A request couldn't reach the server (api.ts): check soon, so the next tap knows. */
export function noteRequestFailed() {
  if (!started || failTimer) return;
  failTimer = setTimeout(() => { failTimer = undefined; void checkInternet(); }, FAIL_DEBOUNCE_MS);
}

/** The server answered a request with its own JSON (api.ts): there's internet, no check needed. */
let answeredAt = 0;
export function noteServerAnswer() {
  answeredAt = Date.now();
  if (state.internet === "yes") return;
  set({ internet: "yes", checkedAt: Date.now() });
}

let next: ReturnType<typeof setTimeout> | undefined;
/** The next periodic check: soon while there's no internet, rarely (tab in view only) while there is. */
function schedule() {
  if (!started) return;
  clearTimeout(next);
  const ok = state.internet === "yes";
  next = setTimeout(() => {
    if (ok && typeof document !== "undefined" && document.visibilityState === "hidden") { schedule(); return; }
    void checkInternet();
  }, ok ? IDLE_MS : RETRY_MS);
}

/** Start watching (main.tsx, once). Returns a stop function (tests). */
export function startConnectionWatch(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;
  // The browser saying it's offline is believed at once (and checked, since iOS can say so wrongly).
  const onOffline = () => { set({ internet: "no", checkedAt: Date.now() }); void checkInternet(); };
  const onOnline = () => { set({}); void checkInternet(); };
  const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - state.checkedAt > 5000) void checkInternet(); };
  const onConn = () => set({});
  const onStorage = (e: StorageEvent) => { if (e.key === DEMO_KEY) listeners.forEach((f) => f()); };
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisible);
  const c = info() as (ConnectionInfo & Partial<EventTarget>) | null;
  c?.addEventListener?.("change", onConn);
  // The page's own first requests usually settle it (an answer is "yes", a failure checks): the first check waits a
  // moment so it doesn't compete with them, unless the browser already says it's offline.
  const first = setTimeout(() => { if (state.internet === "unknown" || !state.checkedAt) void checkInternet(); }, browserOnline() ? FIRST_CHECK_MS : 0);
  return () => {
    clearTimeout(first);
    started = false;
    clearTimeout(next); clearTimeout(failTimer); failTimer = undefined;
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisible);
    c?.removeEventListener?.("change", onConn);
  };
}

/** Tests: back to the start (unknown, not watching). */
export function resetConnection() {
  clearTimeout(next); clearTimeout(failTimer); failTimer = undefined;
  started = false;
  inflight = null;
  shown = null;
  answeredAt = 0;
  state = initial();
  listeners.forEach((f) => f());
}
