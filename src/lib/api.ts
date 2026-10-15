// Fetching: typed JSON calls, an in-memory cache with stale-while-revalidate,
// and a hook that gives every page the same loading / error / data states.
import { useCallback, useEffect, useRef, useState } from "react";
import { offlineSource, savedSeasons } from "./offline/saved";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly offline = false) { super(message); }
}

/** The reads a saved season can answer (see lib/offline). */
const OFFLINE_PATHS = /^\/api\/(teams\/\d+(\/matches)?|events\/\d{4}\/[^/?]+|search)(\?|$)/;

/** No network: answer from the seasons saved on this device when they can,
 *  else fail with the network error. Never used for an HTTP error — the
 *  server's answer stands. */
async function offlineOr<T>(path: string, method: string | undefined, error: ApiError): Promise<T> {
  if ((method ?? "GET").toUpperCase() !== "GET" || !OFFLINE_PATHS.test(path) || !savedSeasons().length) throw error;
  const data = await import("./offline/answer").then((m) => m.offlineAnswer(path)).catch(() => null);
  if (data == null) throw error;
  return data as T;
}

export async function apiFetch<T>(path: string, init?: RequestInit & { json?: unknown; _tries?: number }): Promise<T> {
  const { json, _tries = 0, ...rest } = init ?? {};
  // Known offline: answer at once (same error the failed fetch would give)
  // instead of firing a request that can only fail at the venue.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return offlineOr<T>(path, rest.method, new ApiError(0, "You're offline.", true));
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    return offlineOr<T>(path, rest.method, new ApiError(0, navigator.onLine === false ? "You're offline." : "Can't reach the server right now.", true));
  }
  // Server still starting (it opens its port before its data is ready): wait
  // as asked and try again, so a cold start reads as a slow load, not an error.
  if (res.status === 503 && res.headers.has("Retry-After") && _tries < 8) {
    await new Promise((r) => setTimeout(r, Math.min(15, Number(res.headers.get("Retry-After")) || 5) * 1000));
    return apiFetch<T>(path, { ...(init ?? {}), _tries: _tries + 1 });
  }
  const text = await res.text();
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

// Back online: whatever is on screen from saved seasons is fetched fresh.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const [path, e] of cache) if (offlineSource(e.data) && listeners.get(path)?.size) load(path, true).catch(() => {});
  });
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
