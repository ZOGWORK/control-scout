// Fetching: typed JSON calls, an in-memory cache with stale-while-revalidate,
// and a hook that gives every page the same loading / error / data states.
//
// Offline data (the lite pack and saved seasons, lib/packs + lib/offline) only
// ever RUNS with no signal: while the server answers, every read comes from it
// and nothing here opens, decodes or queries a pack (sql.js and the engine
// aren't even loaded; they're dynamic imports). The pack is used only when the
// browser says it's offline, or a request the pack could answer fails for want
// of a network: a network error, or no answer within OFFLINE_TIMEOUT_MS (venue
// wifi that "connects" but carries nothing). An HTTP error from a server that
// answered is never replaced. The first server answer afterwards (or the
// browser coming back online) switches back. Downloading the pack in the
// background (packSync.tsx) is separate: that only stores bytes for later.
import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { offlineSource, savedSeasons } from "./offline/saved";
import { packStatus } from "./packPolicy";
import { FEATURE_DISABLED, featureOffMessage } from "../shared/flags";

/**
 * A failed call. `code`: the answer's `error` when it's a machine code (`feature_disabled`), so callers can tell a
 * feature the owner switched off (paused: keep what's queued, try again later) from a 403 that means no access.
 * `feature`: which feature, for feature_disabled.
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly offline = false, readonly code?: string, readonly feature?: string) { super(message); }
}

/** A 403 feature_disabled: the owner switched this feature off (for now). Never a removal or a lost membership. */
export const isFeatureDisabled = (e: unknown, feature?: string): boolean => {
  const x = e as { status?: unknown; code?: unknown; feature?: unknown } | null;
  return x?.status === 403 && x.code === FEATURE_DISABLED && (feature === undefined || x.feature === feature);
};
/** A 403 that means this account has no access (not a member any more): every 403 but feature_disabled. */
export const isAccessDenied = (e: unknown): boolean => (e as { status?: unknown } | null)?.status === 403 && !isFeatureDisabled(e);

/** The reads a saved season can answer (see lib/offline). */
const OFFLINE_PATHS = /^\/api\/(teams\/\d+(\/matches)?|events\/\d{4}\/[^/?]+|projections\/\d{4}\/[^/?]+|search)(\?|$)/;
/** The read the lite pack can answer (the Predict page runs the engine on it: PredictPage's useOfflineFallback). */
const PACK_PREDICT_PATH = /^\/api\/predict\/match(\?|$)/;
/** No answer in this long, for a read this device could answer itself: treat it as no signal. */
export const OFFLINE_TIMEOUT_MS = 4000;

/**
 * Could data saved on this device answer this read if the server can't be reached? "saved": a saved
 * season covers it (the season asked for, when the path names one); "lite": a prediction for a season
 * the lite pack holds. Only these get the timeout: anything else waits for the server as long as the
 * browser does, so a slow server is never "offline" for it.
 */
function offlineKind(path: string, method: string | undefined): "saved" | "lite" | null {
  if ((method ?? "GET").toUpperCase() !== "GET") return null;
  const url = new URL(path, "http://offline.invalid");
  const asked = Number(url.searchParams.get("season")) || null;
  if (OFFLINE_PATHS.test(path)) {
    const saved = savedSeasons();
    const season = Number(/^\/api\/(?:events|projections)\/(\d{4})\//.exec(url.pathname)?.[1]) || asked;
    return saved.length && (season == null || saved.some((s) => s.season === season)) ? "saved" : null;
  }
  if (!PACK_PREDICT_PATH.test(path)) return null;
  const lite = packStatus();
  // Only a season the pack is known to hold: a pack saved before its seasons were noted (or a request
  // that names no season) waits for the server, as the pack might not answer it.
  return lite?.seasons && asked != null && lite.seasons.includes(asked) ? "lite" : null;
}

// "Offline mode": something on screen came from data saved on this device. The
// header's indicator (OfflineStatus in components/OfflineNote) shows while it's on.
let usingSaved = false;
const modeListeners = new Set<() => void>();
let probe: ReturnType<typeof setInterval> | undefined;
/** While anything on screen is from saved data (or a no-signal error), retry it this often. */
const PROBE_MS = 15_000;

/** No "online" event comes when the network never went down (a request timed out): retry what's on
 *  screen from saved data now and then, until none is left (each entry's own answer replaces it). It
 *  runs for as long as such entries are on screen, whatever else answers meanwhile. */
function stopProbe() { clearInterval(probe); probe = undefined; }
function ensureProbe() {
  if (probe || typeof window === "undefined") return;
  probe = setInterval(() => {
    if (!offlineOnScreen().length) { stopProbe(); return; }
    // Whatever navigator.onLine says (it can be wrong, see apiFetch): one request per entry on screen.
    refetchOffline();
  }, PROBE_MS);
}

function setUsingSaved(on: boolean) {
  if (usingSaved === on) return;
  usingSaved = on;
  modeListeners.forEach((f) => f());
  if (on) ensureProbe();
  else if (offlineOnScreen().length) refetchOffline(); // back: whatever is still on screen from saved data is fetched fresh
  else stopProbe();
}

/** An answer on screen came from data saved on this device (the Predict page's lite-pack fallback calls this too). */
export function noteOfflineAnswer() { setUsingSaved(true); }

function subscribeMode(fn: () => void) { modeListeners.add(fn); return () => { modeListeners.delete(fn); }; }
/** True while something on screen comes from data saved on this device instead of the server. */
export function useOfflineMode(): boolean {
  return useSyncExternalStore(subscribeMode, () => usingSaved, () => false);
}

/** The saved seasons' answer for a read, or null when they can't give one. Loads the offline code. */
function savedAnswer(path: string): Promise<unknown> {
  return import("./offline/answer").then((m) => m.offlineAnswer(path)).catch(() => null);
}

/** No network: answer from the seasons saved on this device when they can,
 *  else fail with the network error. Never used for an HTTP error — the
 *  server's answer stands. */
async function offlineOr<T>(path: string, method: string | undefined, error: ApiError): Promise<T> {
  if ((method ?? "GET").toUpperCase() !== "GET" || !OFFLINE_PATHS.test(path) || !savedSeasons().length) throw error;
  const data = await savedAnswer(path);
  if (data == null) throw error;
  setUsingSaved(true);
  return data as T;
}

const unreachable = () => new ApiError(0, navigator.onLine === false ? "You're offline." : "Can't reach the server right now.", true);
const TIMED_OUT = Symbol("timed out");

/**
 * The response, or no signal. A read saved data could answer gets OFFLINE_TIMEOUT_MS for the server's
 * headers (once they arrive, the server has answered: its status stands however slow the body is).
 * Past that, a prediction counts as no signal at once (the page runs the lite pack); a saved-season read
 * races the server against the saved answer, and keeps waiting for the server if they can't answer.
 */
async function respond<T>(request: Promise<Response>, kind: "saved" | "lite", path: string, ctrl: AbortController): Promise<Response | { saved: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((r) => { timer = setTimeout(() => r(TIMED_OUT), OFFLINE_TIMEOUT_MS); });
  const first = await Promise.race([request, deadline]).finally(() => clearTimeout(timer));
  if (first !== TIMED_OUT) return first;
  if (kind === "lite") { ctrl.abort(); throw unreachable(); }
  const won = await Promise.race([request.then((res) => ({ res })), savedAnswer(path).then((data) => ({ data }))]);
  if ("res" in won) return won.res;
  if (won.data == null) return request;
  ctrl.abort();
  return { saved: won.data as T };
}

export async function apiFetch<T>(path: string, init?: RequestInit & { json?: unknown; _tries?: number }): Promise<T> {
  const { json, _tries = 0, ...rest } = init ?? {};
  // navigator.onLine is only a hint: iOS (above all a home-screen app back from the background) can report
  // false while the phone is online, and never send the "online" event. Skipping the request on it left the
  // whole app stuck on saved data. Always ask: with truly no signal the request fails at once anyway, and
  // that failure falls back to saved data the same way.
  const kind = offlineKind(path, rest.method);
  const ctrl = kind ? new AbortController() : null;
  const outer = rest.signal;
  const forward = () => ctrl?.abort();
  if (ctrl && outer) { if (outer.aborted) ctrl.abort(); else outer.addEventListener("abort", forward, { once: true }); }
  let res: Response;
  try {
    const request = fetch(path, {
      credentials: "same-origin",
      ...rest,
      ...(ctrl ? { signal: ctrl.signal } : {}),
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    request.catch(() => {}); // aborted once a saved answer is used: nobody waits on it then
    const got = kind && ctrl ? await respond<T>(request, kind, path, ctrl) : await request;
    if (!(got instanceof Response)) { setUsingSaved(true); return got.saved; }
    res = got;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return offlineOr<T>(path, rest.method, unreachable());
  } finally {
    outer?.removeEventListener("abort", forward);
  }
  // Server still starting (it opens its port before its data is ready): wait
  // as asked and try again, so a cold start reads as a slow load, not an error.
  // It answered, so this isn't "no signal"; each try gets its own timeout.
  if (res.status === 503 && res.headers.has("Retry-After") && _tries < 8) {
    await new Promise((r) => setTimeout(r, Math.min(15, Number(res.headers.get("Retry-After")) || 5) * 1000));
    return apiFetch<T>(path, { ...(init ?? {}), _tries: _tries + 1 });
  }
  // The server answered: whatever came from saved data goes back to the server's.
  if (res.status < 500) setUsingSaved(false);
  const text = await res.text();
  let body: any = null;
  let unreadable = false;
  try { body = text ? JSON.parse(text) : null; } catch { unreadable = true; }
  if (!res.ok) {
    // Switched off by the owner: the server's own words, and the code that tells it from a lost membership.
    if (res.status === 403 && body?.error === FEATURE_DISABLED) throw new ApiError(403, typeof body.message === "string" ? body.message : featureOffMessage(String(body.feature ?? "")), false, FEATURE_DISABLED, typeof body.feature === "string" ? body.feature : undefined);
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, false, typeof body?.code === "string" ? body.code : undefined);
  }
  // A success whose body can't be read (cut short, or a page from something in between) is a failed
  // answer, not "no data": an empty body (204) or an explicit JSON null still answer null.
  if (unreadable) throw new ApiError(res.status, "The server's answer arrived incomplete. Try again.");
  return body as T;
}

/** `seq`: order of the request (or prime) the data came from; an older reply never replaces newer data. */
interface Entry<T> { at: number; data?: T; error?: ApiError; promise?: Promise<T>; seq?: number }
let seq = 0;
const cache = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const FRESH_MS = 60_000;

function notify(key: string) { listeners.get(key)?.forEach((f) => f()); }

/** The reads this cache holds are all objects (or lists): a page that gets anything else (a 200 with a JSON null, a
 *  number, a string) would wait for its data forever. Such an answer is a failed one the page can try again
 *  (audit PUB3-F04), like a body that arrived cut short. */
export const UNUSABLE_ANSWER = "The server's answer was empty or not in the expected form. Try again.";
function expectObject<T>(data: T): T {
  if (data === null || typeof data !== "object") throw new ApiError(200, UNUSABLE_ANSWER);
  return data;
}

/** Load (deduped). Fresh cached data is returned as-is; stale data revalidates. `quiet`: a background
 *  retry, which keeps an error on screen (e.g. the Predict page's offline fallback) until it's answered. */
export function load<T>(path: string, force = false, quiet = false): Promise<T> {
  const e = cache.get(path) as Entry<T> | undefined;
  if (!force && e?.promise) return e.promise;
  if (!force && e?.data !== undefined && Date.now() - e.at < FRESH_MS) return Promise.resolve(e.data);
  const my = ++seq;
  // Another request for this path still out (not this one) stays the one callers wait on.
  const pending = (cur: Entry<T> | undefined) => (cur?.promise !== promise ? cur?.promise : undefined);
  const promise: Promise<T> = apiFetch<T>(path).then(expectObject).then(
    (data) => {
      const cur = cache.get(path) as Entry<T> | undefined;
      // Newer data arrived while this request was out (a later request, or "Refresh results" priming): keep it.
      if (cur?.data !== undefined && (cur.seq ?? 0) > my) { if (cur.promise === promise) cache.set(path, { ...cur, promise: undefined }); return cur.data; }
      // An offline answer is never fresh: the next look asks the server again.
      cache.set(path, { at: offlineSource(data) ? 0 : Date.now(), data, seq: my, promise: pending(cur) }); notify(path);
      if (offlineSource(data)) ensureProbe();
      return data;
    },
    (error: ApiError) => {
      const cur = cache.get(path) as Entry<T> | undefined;
      cache.set(path, { at: Date.now(), data: cur?.data, seq: cur?.seq, error, promise: pending(cur) }); notify(path);
      if (error?.offline) ensureProbe(); // e.g. the Predict page's lite-pack answer: retried until the server answers
      throw error;
    },
  );
  // A retry clears the old error so the page shows "loading" again (a quiet one doesn't).
  cache.set(path, { at: e?.at ?? 0, data: e?.data, seq: e?.seq, promise, error: quiet ? e?.error : undefined } as Entry<T>);
  notify(path);
  return promise;
}

/** The data cached for a path, if any (fresh or not), without fetching. */
export function peek<T>(path: string): T | undefined { return cache.get(path)?.data as T | undefined; }

/** Put fresh data for a path in the cache (e.g. returned by a POST) and re-render whoever shows it. */
export function prime<T>(path: string, data: T) { cache.set(path, { at: Date.now(), data, seq: ++seq, promise: cache.get(path)?.promise as Promise<T> | undefined }); notify(path); }

/** Paths on screen showing saved data or a no-signal error. */
function offlineOnScreen(): string[] {
  return [...cache].filter(([path, e]) => listeners.get(path)?.size && (offlineSource(e.data) || e.error?.offline)).map(([path]) => path);
}

/** Ask the server again for whatever is on screen from saved data, or showing a no-signal error (not
 *  already being asked; a quiet retry: it stays on screen until answered). */
function refetchOffline() {
  for (const path of offlineOnScreen()) if (!cache.get(path)?.promise) load(path, true, true).catch(() => {});
}

// Back online: whatever is on screen from saved seasons is fetched fresh (its answer switches offline
// mode off); with nothing on screen from them, offline mode simply ends.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { if (offlineOnScreen().length) refetchOffline(); else setUsingSaved(false); });
}

/** Mark cached data under a prefix as out of date without dropping it: what's on screen refetches now
 *  (keeping its data meanwhile), anything else refetches the next time it's shown. */
export function markStale(prefix: string) {
  for (const [k, e] of cache) {
    if (!k.startsWith(prefix)) continue;
    e.at = 0;
    if (listeners.get(k)?.size) load(k, true).catch(() => {});
  }
}

export function invalidate(prefix: string) { for (const k of cache.keys()) if (k.startsWith(prefix)) { cache.delete(k); notify(k); } }

export interface ApiState<T> { data: T | undefined; error: ApiError | undefined; loading: boolean; /** Settles once the fresh answer (or its error) is in. */ reload: () => Promise<void> }

/** The paths read under a route's error boundary (RouteErrorBoundary), so its "Try again" can ask the
 *  server afresh for them instead of re-rendering the same cached answer. */
export const ApiReadsContext = createContext<Set<string> | null>(null);

/** Drop these paths' cached answers, so the next look shows loading and fetches them again. A path still
 *  being asked for keeps that request (its answer is the fresh one: the next look waits for it); one
 *  still on screen elsewhere is asked for now. */
export function forget(paths: Iterable<string>) {
  for (const k of paths) {
    const pending = cache.get(k)?.promise;
    if (pending) { cache.set(k, { at: 0, promise: pending }); notify(k); continue; }
    cache.delete(k);
    if (listeners.get(k)?.size) load(k, true).catch(() => {});
  }
}

const noSubscription = () => () => {};

/** One error per cached answer of the wrong shape (the same object on every render). */
const misshapenErrors = new WeakMap<object, ApiError>();
function misshapen(e: Entry<unknown>): ApiError {
  let err = misshapenErrors.get(e);
  if (!err) { err = new ApiError(200, UNUSABLE_ANSWER); misshapenErrors.set(e, err); }
  return err;
}

/** Data for a path (null = don't fetch yet). Keeps showing the last data while refetching. `valid`: the answer's
 *  shape check; an answer that fails it shows as an error (with Try again), never as data or endless loading. */
export function useApi<T>(path: string | null, valid?: (data: unknown) => data is T): ApiState<T> {
  const reads = useContext(ApiReadsContext);
  if (path) reads?.add(path);
  const pathRef = useRef(path);
  pathRef.current = path;
  // Subscribed through useSyncExternalStore: React re-reads the cache right after subscribing, so an
  // answer (or a prime) that lands between this render and the subscription is never missed.
  const subscribe = useCallback((fn: () => void) => {
    if (!path) return noSubscription();
    let set = listeners.get(path);
    if (!set) { set = new Set(); listeners.set(path, set); }
    set.add(fn);
    return () => { set!.delete(fn); if (probe && !offlineOnScreen().length) stopProbe(); };
  }, [path]);
  const read = () => (path ? (cache.get(path) as Entry<T> | undefined) : undefined);
  const e = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    if (!path) return;
    load<T>(path).catch(() => {});
    // Back on a view still showing saved data or a no-signal error (even one cached as fresh): keep retrying it.
    const cur = cache.get(path);
    if (cur && (offlineSource(cur.data) || cur.error?.offline)) ensureProbe();
  }, [path]);
  const reload = useCallback(() => pathRef.current ? load(pathRef.current, true).then(() => {}, () => {}) : Promise.resolve(), []);
  // An answer of the wrong shape: an error, or loading again while Try again's request is out.
  if (e?.data !== undefined && valid && !valid(e.data)) {
    return { data: undefined, error: e.promise ? undefined : e.error ?? misshapen(e), loading: !!e.promise, reload };
  }
  // Loading until the first answer (data or error) arrives — never a flash of "empty".
  return { data: e?.data, error: e?.data === undefined ? e?.error : undefined, loading: !!path && e?.data === undefined && !e?.error, reload };
}

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
