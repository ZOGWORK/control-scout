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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { offlineSource, savedSeasons } from "./offline/saved";
import { PACK_META_KEY } from "./packPolicy";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly offline = false) { super(message); }
}

/** The reads a saved season can answer (see lib/offline). */
const OFFLINE_PATHS = /^\/api\/(teams\/\d+(\/matches)?|events\/\d{4}\/[^/?]+|search)(\?|$)/;
/** The read the lite pack can answer (the Predict page runs the engine on it: PredictPage's useOfflineFallback). */
const PACK_PREDICT_PATH = /^\/api\/predict\/match(\?|$)/;
/** No answer in this long, for a read this device could answer itself: treat it as no signal. */
export const OFFLINE_TIMEOUT_MS = 4000;

function hasLitePack(): boolean {
  try { return !!localStorage.getItem(PACK_META_KEY); } catch { return false; }
}

/** Could data saved on this device answer this request if the server can't be reached? Only these
 *  get the timeout: anything else waits for the server as long as the browser does. */
function answerableOffline(path: string, method: string | undefined): boolean {
  if ((method ?? "GET").toUpperCase() !== "GET") return false;
  if (OFFLINE_PATHS.test(path)) return savedSeasons().length > 0;
  return PACK_PREDICT_PATH.test(path) && hasLitePack();
}

// "Offline mode": something on screen came from data saved on this device. The
// header's indicator (OfflineStatus in components/OfflineNote) shows while it's on.
let usingSaved = false;
const modeListeners = new Set<() => void>();
let probe: ReturnType<typeof setInterval> | undefined;
/** While offline mode is on and the browser thinks it's online (the timeout case), retry this often. */
const PROBE_MS = 15_000;

function setUsingSaved(on: boolean) {
  if (usingSaved === on) return;
  usingSaved = on;
  modeListeners.forEach((f) => f());
  clearInterval(probe);
  probe = undefined;
  // No "online" event comes when the network never went down (a request timed out): retry what's on
  // screen now and then, and the first answer switches back.
  if (on) probe = setInterval(() => { if (typeof navigator === "undefined" || navigator.onLine !== false) refetchOffline(); }, PROBE_MS);
  else refetchOffline(); // back: whatever is still on screen from saved data is fetched fresh
}

/** An answer on screen came from data saved on this device (the Predict page's lite-pack fallback calls this too). */
export function noteOfflineAnswer() { setUsingSaved(true); }

function subscribeMode(fn: () => void) { modeListeners.add(fn); return () => { modeListeners.delete(fn); }; }
/** True while something on screen comes from data saved on this device instead of the server. */
export function useOfflineMode(): boolean {
  return useSyncExternalStore(subscribeMode, () => usingSaved, () => false);
}

/** No network: answer from the seasons saved on this device when they can,
 *  else fail with the network error. Never used for an HTTP error — the
 *  server's answer stands. */
async function offlineOr<T>(path: string, method: string | undefined, error: ApiError): Promise<T> {
  if ((method ?? "GET").toUpperCase() !== "GET" || !OFFLINE_PATHS.test(path) || !savedSeasons().length) throw error;
  const data = await import("./offline/answer").then((m) => m.offlineAnswer(path)).catch(() => null);
  if (data == null) throw error;
  setUsingSaved(true);
  return data as T;
}

const unreachable = () => new ApiError(0, navigator.onLine === false ? "You're offline." : "Can't reach the server right now.", true);

export async function apiFetch<T>(path: string, init?: RequestInit & { json?: unknown; _tries?: number }): Promise<T> {
  const { json, _tries = 0, ...rest } = init ?? {};
  // Known offline: answer at once (same error the failed fetch would give)
  // instead of firing a request that can only fail at the venue.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return offlineOr<T>(path, rest.method, new ApiError(0, "You're offline.", true));
  // A read this device could answer gets OFFLINE_TIMEOUT_MS to answer (headers and body); past that it
  // counts as no signal. Everything else keeps the browser's own patience, so a slow server isn't "offline".
  const ctrl = answerableOffline(path, rest.method) ? new AbortController() : null;
  let timedOut = false;
  const timer = ctrl ? setTimeout(() => { timedOut = true; ctrl.abort(); }, OFFLINE_TIMEOUT_MS) : undefined;
  const outer = rest.signal;
  const forward = () => ctrl?.abort();
  if (ctrl && outer) { if (outer.aborted) ctrl.abort(); else outer.addEventListener("abort", forward, { once: true }); }
  let res: Response;
  let text: string;
  try {
    try {
      res = await fetch(path, {
        credentials: "same-origin",
        ...rest,
        ...(ctrl ? { signal: ctrl.signal } : {}),
        headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      });
    } catch {
      return await offlineOr<T>(path, rest.method, unreachable());
    }
    // Server still starting (it opens its port before its data is ready): wait
    // as asked and try again, so a cold start reads as a slow load, not an error.
    // It answered, so this isn't "no signal"; each try gets its own timeout.
    if (res.status === 503 && res.headers.has("Retry-After") && _tries < 8) {
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, Math.min(15, Number(res.headers.get("Retry-After")) || 5) * 1000));
      return await apiFetch<T>(path, { ...(init ?? {}), _tries: _tries + 1 });
    }
    try { text = await res.text(); }
    catch (e) { if (timedOut) return await offlineOr<T>(path, rest.method, unreachable()); throw e; }
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
  // The server answered: whatever came from saved data goes back to the server's.
  if (res.status < 500) setUsingSaved(false);
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

/** `seq`: order of the request (or prime) the data came from; an older reply never replaces newer data. */
interface Entry<T> { at: number; data?: T; error?: ApiError; promise?: Promise<T>; seq?: number }
let seq = 0;
const cache = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const FRESH_MS = 60_000;

function notify(key: string) { listeners.get(key)?.forEach((f) => f()); }

/** Load (deduped). Fresh cached data is returned as-is; stale data revalidates. */
export function load<T>(path: string, force = false): Promise<T> {
  const e = cache.get(path) as Entry<T> | undefined;
  if (!force && e?.promise) return e.promise;
  if (!force && e?.data !== undefined && Date.now() - e.at < FRESH_MS) return Promise.resolve(e.data);
  const my = ++seq;
  // Another request for this path still out (not this one) stays the one callers wait on.
  const pending = (cur: Entry<T> | undefined) => (cur?.promise !== promise ? cur?.promise : undefined);
  const promise: Promise<T> = apiFetch<T>(path).then(
    (data) => {
      const cur = cache.get(path) as Entry<T> | undefined;
      // Newer data arrived while this request was out (a later request, or "Refresh results" priming): keep it.
      if (cur?.data !== undefined && (cur.seq ?? 0) > my) { if (cur.promise === promise) cache.set(path, { ...cur, promise: undefined }); return cur.data; }
      // An offline answer is never fresh: the next look asks the server again.
      cache.set(path, { at: offlineSource(data) ? 0 : Date.now(), data, seq: my, promise: pending(cur) }); notify(path); return data;
    },
    (error: ApiError) => {
      const cur = cache.get(path) as Entry<T> | undefined;
      cache.set(path, { at: Date.now(), data: cur?.data, seq: cur?.seq, error, promise: pending(cur) }); notify(path); throw error;
    },
  );
  // A retry clears the old error so the page shows "loading" again.
  cache.set(path, { at: e?.at ?? 0, data: e?.data, seq: e?.seq, promise } as Entry<T>);
  notify(path);
  return promise;
}

/** Put fresh data for a path in the cache (e.g. returned by a POST) and re-render whoever shows it. */
export function prime<T>(path: string, data: T) { cache.set(path, { at: Date.now(), data, seq: ++seq, promise: cache.get(path)?.promise as Promise<T> | undefined }); notify(path); }

/** Ask the server again for whatever is on screen from saved data, or showing a no-signal error (not
 *  already being asked). Returns how many it asked for. */
function refetchOffline(): number {
  let n = 0;
  for (const [path, e] of cache) {
    if (!listeners.get(path)?.size || e.promise || !(offlineSource(e.data) || e.error?.offline)) continue;
    n++;
    load(path, true).catch(() => {});
  }
  return n;
}

// Back online: whatever is on screen from saved seasons is fetched fresh (its answer switches offline
// mode off); with nothing on screen from them, offline mode simply ends.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { if (!refetchOffline()) setUsingSaved(false); });
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

export interface ApiState<T> { data: T | undefined; error: ApiError | undefined; loading: boolean; reload: () => void }

/** Data for a path (null = don't fetch yet). Keeps showing the last data while refetching. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [, bump] = useState(0);
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(() => {
    if (!path) return;
    const fn = () => bump((x) => x + 1);
    let set = listeners.get(path);
    if (!set) { set = new Set(); listeners.set(path, set); }
    set.add(fn);
    load<T>(path).catch(() => {});
    return () => { set!.delete(fn); };
  }, [path]);
  const reload = useCallback(() => { if (pathRef.current) load(pathRef.current, true).catch(() => {}); }, []);
  const e = path ? (cache.get(path) as Entry<T> | undefined) : undefined;
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
