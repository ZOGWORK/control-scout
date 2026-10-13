// Fetching: typed JSON calls, an in-memory cache with stale-while-revalidate,
// and a hook that gives every page the same loading / error / data states.
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly offline = false) { super(message); }
}

export async function apiFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, navigator.onLine === false ? "You're offline." : "Can't reach the server right now.", true);
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

interface Entry<T> { at: number; data?: T; error?: ApiError; promise?: Promise<T> }
const cache = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const FRESH_MS = 60_000;

function notify(key: string) { listeners.get(key)?.forEach((f) => f()); }

/** Load (deduped). Fresh cached data is returned as-is; stale data revalidates. */
export function load<T>(path: string, force = false): Promise<T> {
  const e = cache.get(path) as Entry<T> | undefined;
  if (!force && e?.promise) return e.promise;
  if (!force && e?.data !== undefined && Date.now() - e.at < FRESH_MS) return Promise.resolve(e.data);
  const promise = apiFetch<T>(path).then(
    (data) => { cache.set(path, { at: Date.now(), data }); notify(path); return data; },
    (error: ApiError) => { const prev = cache.get(path) as Entry<T> | undefined; cache.set(path, { at: Date.now(), data: prev?.data, error }); notify(path); throw error; },
  );
  // A retry clears the old error so the page shows "loading" again.
  cache.set(path, { at: e?.at ?? 0, data: e?.data, promise } as Entry<T>);
  notify(path);
  return promise;
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
