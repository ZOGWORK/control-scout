// Is there internet right now? One answer for the whole app (api.ts, the top bar's Offline pill, the light-version
// offer), from a real check rather than navigator.onLine alone:
//
//   - online: what the browser says (navigator.onLine). Only a hint: false can be wrong on iOS, true says nothing
//     about whether the Wi-Fi carries anything.
//   - internet: "yes" when GET /api/health came back as this server's own answer ({ ok: true, … }, server/app.ts);
//     "portal" when something else answered (a sign-in page, a redirect to another site, a page that isn't ours: a
//     hotel or venue Wi-Fi that wants you to sign in first); "no" when nothing answered (a network error, or no answer
//     in CHECK_TIMEOUT_MS: BUSY_TIMEOUT_MS when our server answered moments ago, as it's then more likely busy than
//     the line gone); "unknown" before the first check.
//   - type: Wi-Fi, mobile data, none (the browser says it's offline) or unknown (most browsers don't say: iPhones,
//     desktop Chrome). saveData: the browser's Data Saver.
//
// When it checks: shortly after start unless a request settled it first (startConnectionWatch, main.tsx), on the
// browser's online/offline events (online: at once, every time, then every ONLINE_RETRY_MS for a while), when the
// tab comes back into view or the window gets focus while there's no internet, soon after any request fails for want
// of a network (api.ts noteRequestFailed), after RETRY_STEPS_MS one after another (3 s, 5 s, 10 s, 20 s) and then every
// RETRY_MS while there's no internet (every WAITING_RETRY_MS while a paused download waits for the line), and every
// IDLE_MS (tab in view) while there is. A server answer anywhere in
// the app counts as "yes" at once (noteServerAnswer), so coming back never waits for the next check.
//
// For screenshots, localStorage `cs-connection-demo` = "offline" | "portal" shows that state (the pill, and the
// light-version offer stays away); requests still go by the real checks, so the page under the pill is real.
import { useSyncExternalStore } from "react";
import type { ConnectionInfo } from "./packPolicy";
import { netKind } from "./offline/updatePolicy";

import type { ConnectionType, Internet } from "../shared/networkStatus";
export type { ConnectionType, Internet } from "../shared/networkStatus";

export interface ConnectionState {
  /** navigator.onLine (a hint only). */
  online: boolean;
  internet: Internet;
  type: ConnectionType;
  saveData: boolean;
  /** When `internet` was last decided (ms since 1970), 0 before the first check. */
  checkedAt: number;
}

/** No answer to the check in this long: no internet (but see BUSY_TIMEOUT_MS). */
export const CHECK_TIMEOUT_MS = 2500;
/** No answer in CHECK_TIMEOUT_MS while our server answered this tab within HEARD_MS (the browser saying online, and no
 *  check since finding no internet): more likely our own server busy than the line gone. A long search holds the
 *  server, and /api/health waits behind it with every other request: measured live, 11.8 s behind a 12 s search
 *  (issue #1557: the check called that "no internet", the search was let go as "You're offline", and the verdict was
 *  carried into the reload). The same check keeps waiting, up to this long in all, before it says "no". Reads saved
 *  data can answer don't wait for it: they have their own OFFLINE_TIMEOUT_MS (api.ts). */
export const BUSY_TIMEOUT_MS = 20_000;
/** How recent an answer from our server makes a check that gets no answer "busy" first (BUSY_TIMEOUT_MS). */
export const HEARD_MS = 60_000;
/** While there's no internet (or a portal): check again this often, once RETRY_STEPS_MS are used up. */
export const RETRY_MS = 30_000;
/** While there's no internet (or a portal): the first checks come after these, one after another, so the line coming
 *  back is seen in seconds; then every RETRY_MS. Starts over when there's internet again, and on the browser's online
 *  event, the tab coming back into view, or the window getting focus. */
export const RETRY_STEPS_MS: readonly number[] = [3000, 5000, 10_000, 20_000];
/** Visibility and focus check at once only when the last check is older than this (else soon, by the first step).
 *  The browser's online event always checks at once. */
export const EVENT_GAP_MS = 5000;
/** For ONLINE_WINDOW_MS after the browser's online event, a check that doesn't find internet is tried again after
 *  ONLINE_RETRY_MS, before the back-off (RETRY_STEPS_MS) takes over. Right after a reconnect the first requests can
 *  fail, or hang past CHECK_TIMEOUT_MS, for up to about half a minute (measured live). Waiting 3 s, then 5 s, then 10 s
 *  after each of those kept the Offline pill up for up to 48 s after the line answered again. */
export const ONLINE_RETRY_MS = 500;
export const ONLINE_WINDOW_MS = 30_000;
/** A download the person started is waiting for the line (paused by it: noteDownloadWaiting): while there's no
 *  internet, check this often instead of the back-off, for WAITING_WINDOW_MS, so the download picks up within a
 *  couple of seconds of the line answering again. With the back-off alone a 45 s outage was seen 18–28 s late
 *  (the 20 s and 30 s steps), measured live. The check is one tiny request. */
export const WAITING_RETRY_MS = 2000;
export const WAITING_WINDOW_MS = 10 * 60_000;
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

/** sessionStorage: the last answer in this tab ({ internet, at }). A page opened (or reloaded) soon after one found no
 *  internet starts from that, so its first reads don't try the network first; it's checked again at once. */
export const LAST_KEY = "cs-connection-last";
/** How long a "no internet" answer carries over to the next page load. */
export const CARRY_MS = 2 * 60_000;

function lastAnswer(): { internet?: Internet; at?: number } | null {
  try { return JSON.parse(sessionStorage.getItem(LAST_KEY) ?? "null") as { internet?: Internet; at?: number } | null; } catch { return null; }
}
function remember(internet: Internet, at: number) {
  try { sessionStorage.setItem(LAST_KEY, JSON.stringify({ internet, at })); } catch { /* storage blocked */ }
}

function carried(): Internet | null {
  const v = lastAnswer();
  return v && (v.internet === "no" || v.internet === "portal") && typeof v.at === "number" && Math.abs(Date.now() - v.at) < CARRY_MS ? v.internet : null;
}

/** When our server last answered this tab (a fresh answer to any request, or a check finding internet), carried over
 *  a reload like the last "no" is: a page reloaded while the server is busy waits for it as the page before did. */
function carriedHeard(): number {
  const v = lastAnswer();
  return v?.internet === "yes" && typeof v.at === "number" && Math.abs(Date.now() - v.at) < HEARD_MS ? v.at : 0;
}
let heardAt = carriedHeard();
/** When noteServerAnswer last wrote heardAt to sessionStorage (it writes at most every HEARD_WRITE_MS). */
let heardWrittenAt = 0;
const HEARD_WRITE_MS = 5000;

const initial = (): ConnectionState => {
  const online = browserOnline();
  // checkedAt 0: a carried answer is never fresh, so the first read that needs the server checks first.
  return { online, internet: online ? carried() ?? "unknown" : "no", type: typeNow(online), saveData: info()?.saveData === true, checkedAt: 0 };
};
let state: ConnectionState = initial();
/** Until when a paused download waits for the line (checks every WAITING_RETRY_MS while there's no internet). Over
 *  once there's internet: a try that fails again marks it afresh. */
let waitingUntil = 0;
const waiting = () => Date.now() < waitingUntil;
const listeners = new Set<() => void>();
const internetListeners = new Set<(now: Internet, before: Internet) => void>();

function set(next: Partial<ConnectionState>) {
  const online = browserOnline();
  const merged: ConnectionState = { ...state, online, type: typeNow(online), saveData: info()?.saveData === true, ...next };
  const changed = merged.online !== state.online || merged.internet !== state.internet || merged.type !== state.type || merged.saveData !== state.saveData;
  const prev = state.internet;
  if (changed || merged.checkedAt !== state.checkedAt) state = merged;
  if (state.internet === "yes") { retryStep = 0; onlineUntil = 0; waitingUntil = 0; }
  // No internet after all (the browser's offline event): a check waiting on a busy server stops waiting, so the
  // back-off starts now rather than after BUSY_TIMEOUT_MS.
  else if (state.internet === "no" || state.internet === "portal") stopBusyWait?.();
  if (merged.checkedAt && merged.internet !== "unknown") {
    if (merged.internet === "yes") heardAt = Math.max(heardAt, merged.checkedAt);
    remember(merged.internet, merged.checkedAt);
  }
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
const confirmedListeners = new Set<() => void>();
/** Every check that finds internet, changed or not (onInternetChange only hears changes). */
export function onInternetConfirmed(fn: () => void): () => void {
  confirmedListeners.add(fn);
  return () => { confirmedListeners.delete(fn); };
}

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
  // A body that never arrives (the check's own timeout, a stalled link) is no answer: "no". Only one that arrives and
  // isn't our JSON is a sign-in page.
  let text: string;
  try { text = await res.text(); } catch { return "no"; }
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { return "portal"; }
  return body && typeof body === "object" && (body as { ok?: unknown }).ok === true ? "yes" : "portal";
}

let inflight: Promise<Internet> | null = null;
/** Ends the wait of a check that is waiting on a busy server (BUSY_TIMEOUT_MS), when one is. */
let stopBusyWait: (() => void) | null = null;
let started = false;

/** Check now (one at a time: a check already running is shared). Resolves to the answer. */
export function checkInternet(): Promise<Internet> {
  if (inflight) return inflight;
  const ctrl = new AbortController();
  const since = Date.now();
  // No answer in CHECK_TIMEOUT_MS: no internet, unless our server answered moments ago and nothing since said the
  // line went (then it's more likely busy: the same check waits, up to BUSY_TIMEOUT_MS in all).
  const busy = () => browserOnline() && state.internet !== "no" && state.internet !== "portal" && heardAt > 0 && since - heardAt < HEARD_MS;
  let waited = false;
  const giveUp = () => {
    // The server answered another request while this one waited: that's the answer (it's set aside below), no wait.
    if (!waited && answeredAt < since && busy()) {
      waited = true;
      timer = setTimeout(giveUp, BUSY_TIMEOUT_MS - CHECK_TIMEOUT_MS);
      stopBusyWait = () => { clearTimeout(timer); ctrl.abort(); };
      return;
    }
    ctrl.abort();
  };
  let timer = setTimeout(giveUp, CHECK_TIMEOUT_MS);
  const run: Promise<Internet> = (async (): Promise<Internet> => {
    try {
      const res = await fetch(HEALTH, { cache: "no-store", redirect: "manual", credentials: "omit", signal: ctrl.signal, headers: { Accept: "application/json" } });
      return await classify(res);
    } catch {
      return "no";
    } finally {
      clearTimeout(timer);
      stopBusyWait = null;
    }
  })().then((internet) => {
    if (inflight === run) inflight = null;
    // The server answered another request while this check waited: that answer is the newer news (a late "no" or
    // sign-in page answer never undoes it).
    // set() re-arms the periodic check; this path skips it, so it re-arms here.
    if (internet !== "yes" && answeredAt >= since) { schedule(); return state.internet; }
    set({ internet, checkedAt: Date.now() });
    if (internet === "yes") confirmedListeners.forEach((f) => f());
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

/** A download the person started was paused by the connection and picks up once it's back (resumeWatcher.tsx):
 *  check soon, then every WAITING_RETRY_MS while there's no internet (for WAITING_WINDOW_MS). */
export function noteDownloadWaiting() {
  waitingUntil = Date.now() + WAITING_WINDOW_MS;
  noteRequestFailed();
  schedule();
}

let failTimer: ReturnType<typeof setTimeout> | undefined;
/** A request couldn't reach the server (api.ts): check soon, so the next tap knows. */
export function noteRequestFailed() {
  if (!started || failTimer) return;
  failTimer = setTimeout(() => { failTimer = undefined; void checkInternet(); }, state.internet === "unknown" ? 0 : FAIL_DEBOUNCE_MS);
}

/** The server answered a request with its own JSON (api.ts): there's internet, no check needed. */
let answeredAt = 0;
export function noteServerAnswer() {
  answeredAt = Date.now();
  // Kept for the next page load too (carriedHeard), at most once every few seconds: a page's burst of answers is one write.
  if (answeredAt - heardWrittenAt > HEARD_WRITE_MS) { heardWrittenAt = answeredAt; remember("yes", answeredAt); }
  heardAt = answeredAt;
  if (state.internet === "yes") return;
  set({ internet: "yes", checkedAt: Date.now() });
}

let next: ReturnType<typeof setTimeout> | undefined;
/** Which of RETRY_STEPS_MS the next check while there's no internet waits (past the end: RETRY_MS). */
let retryStep = 0;
/** Until when checks that find no internet are tried again every ONLINE_RETRY_MS (the online event + ONLINE_WINDOW_MS). */
let onlineUntil = 0;
const quickTries = () => Date.now() < onlineUntil;
const retryDelay = () => Math.min(RETRY_STEPS_MS[retryStep] ?? RETRY_MS, waiting() ? WAITING_RETRY_MS : Infinity);
/** The next periodic check: soon while there's no internet (sooner at first), rarely (tab in view only) while there is. */
function schedule() {
  if (!started) return;
  clearTimeout(next);
  const ok = state.internet === "yes";
  // A quick try (just after the online event) uses no back-off step: the steps start from 3 s once the window is over.
  const quick = !ok && quickTries();
  next = setTimeout(() => {
    if (ok && typeof document !== "undefined" && document.visibilityState === "hidden") { schedule(); return; }
    // A check is running: its end re-arms this (set() or the set-aside path), so no step is spent sharing it.
    if (inflight) return;
    if (!ok && !quick && retryStep < RETRY_STEPS_MS.length) retryStep++;
    void checkInternet();
  }, ok ? IDLE_MS : quick ? ONLINE_RETRY_MS : retryDelay());
}

/** Something says the line may be back (the tab in view, the window focused, the online event) while there's no
 *  internet: the back-off starts over, and it checks now (or by the first step, when it checked moments ago). */
function recheckSoon() {
  retryStep = 0;
  if (Date.now() - state.checkedAt > EVENT_GAP_MS) void checkInternet();
  else schedule();
}

/** Start watching (main.tsx, once). Returns a stop function (tests). */
export function startConnectionWatch(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;
  // The browser saying it's offline is believed at once (and checked, since iOS can say so wrongly).
  const onOffline = () => { onlineUntil = 0; set({ internet: "no", checkedAt: Date.now() }); void checkInternet(); };
  // The browser saying it's back online checks at once, every time, however recent the last check. A check already
  // running started before the line came back and will likely fail, so another runs right after it (unless it found
  // internet). Checks that still don't find it are tried again every ONLINE_RETRY_MS for ONLINE_WINDOW_MS, then the
  // back-off.
  const onOnline = () => {
    retryStep = 0;
    onlineUntil = Date.now() + ONLINE_WINDOW_MS;
    set({});
    void (inflight ? inflight.then((r) => (r === "yes" ? r : checkInternet())) : checkInternet());
  };
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (state.internet !== "yes") recheckSoon();
    else if (Date.now() - state.checkedAt > EVENT_GAP_MS) void checkInternet();
  };
  // Focus only matters while there's no internet (with internet, the tab coming into view already checks).
  const onFocus = () => { if (state.internet !== "yes") recheckSoon(); };
  const onConn = () => set({});
  const onStorage = (e: StorageEvent) => { if (e.key === DEMO_KEY) listeners.forEach((f) => f()); };
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  const c = info() as (ConnectionInfo & Partial<EventTarget>) | null;
  c?.addEventListener?.("change", onConn);
  // The page's own first requests usually settle it (an answer is "yes", a failure checks): the first check waits a
  // moment so it doesn't compete with them, unless the browser already says it's offline or this tab's last page
  // found no internet (then at once).
  const first = setTimeout(() => { if (state.internet === "unknown" || !state.checkedAt) void checkInternet(); }, browserOnline() && state.internet === "unknown" ? FIRST_CHECK_MS : 0);
  return () => {
    clearTimeout(first);
    started = false;
    clearTimeout(next); clearTimeout(failTimer); failTimer = undefined;
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
    c?.removeEventListener?.("change", onConn);
  };
}

/** Tests: back to the start (unknown, not watching). */
export function resetConnection() {
  clearTimeout(next); clearTimeout(failTimer); failTimer = undefined;
  started = false;
  retryStep = 0;
  onlineUntil = 0;
  waitingUntil = 0;
  inflight = null;
  stopBusyWait = null;
  shown = null;
  answeredAt = 0;
  try { sessionStorage.removeItem(LAST_KEY); } catch { /* none */ }
  heardAt = 0;
  heardWrittenAt = 0;
  state = initial();
  listeners.forEach((f) => f());
}
