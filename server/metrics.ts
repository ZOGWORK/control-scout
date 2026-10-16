// Request metrics for the owner portal's Usage panel: how many API requests per day, how many
// were sync traffic, and which routes are slow.
//
// Each request under /api and /packs adds one to an in-memory counter for its route pattern
// (method + path with ids replaced: "GET /api/teams/:n") and one to that pattern's latency
// histogram. Every minute (and whenever the portal reads them) the counters are added to
// request_metrics_daily, one row per UTC day and pattern. The cost per request is a Map
// lookup and a few additions. /api/health (polled by monitors), the owner portal's own
// calls and static files aren't counted.
//
// Only patterns are kept: never a full URL, query string, IP address or account.
import type { NextFunction, Request, Response } from "express";
import { all, writeBatch } from "./db.js";
import type { OwnerUsage, RouteStats } from "../src/shared/owner.js";

/** Upper bounds of the latency buckets, in ms (the last is open-ended): columns b0..b11. */
export const METRIC_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, Infinity] as const;
const NB = METRIC_BUCKETS_MS.length;

/** At most this many distinct patterns per UTC day (per process); any more count as "(other)". */
export const MAX_ROUTES = 400;
export const OTHER_ROUTE = "(other)";
/** Paths that matched no route (404 on a pattern we can't name) all count here. */
export const NOT_FOUND_ROUTE = "(not found)";

/**
 * The route pattern of a request path: numbers become :n, match keys (qual:0:12) :key, file names
 * :file, and anything else that isn't a plain lowercase word (event codes, ids, hashes) :id.
 * Words are kept, lowercased (Express matches without case).
 */
export function normalizeRoute(path: string): string {
  const parts = path.split("/").filter(Boolean).slice(0, 8);
  const out = parts.map((raw, i) => {
    let s: string;
    try { s = decodeURIComponent(raw); } catch { s = raw; }
    if (i === 0) return s.toLowerCase(); // "api" | "packs"
    if (/^\d+$/.test(s)) return ":n";
    if (s.includes(":")) return ":key";
    if (s.includes(".")) return s.toLowerCase() === "latest.json" ? "latest.json" : ":file";
    if (/^[a-z][a-zA-Z]*(-[a-z]+)*$/.test(s) && s.length <= 24) return s.toLowerCase();
    return ":id";
  });
  return `/${out.join("/")}`;
}

/** Requests that move a person's own data or offline data between device and server. */
export const isSyncRoute = (route: string) =>
  /^[A-Z]+ \/(api\/me\/(state|scout|migrate)|api\/scout\/sync|api\/workspaces\/|packs\/)/.test(route);

interface Tally { count: number; errors: number; total: number; max: number; b: number[] }
let pending = new Map<string, Tally>();
let routesDay = "";
let routesSeen = new Set<string>();

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Count one finished request. */
export function recordRequest(method: string, path: string, status: number, ms: number, now = Date.now()): void {
  let route = `${method.toUpperCase()} ${normalizeRoute(path)}`;
  if (status === 404 && /:id|:file|:key/.test(route)) route = `${method.toUpperCase()} ${NOT_FOUND_ROUTE}`;
  const day = dayOf(now);
  if (day !== routesDay) { routesDay = day; routesSeen = new Set(); }
  if (!routesSeen.has(route)) {
    if (routesSeen.size >= MAX_ROUTES) route = OTHER_ROUTE;
    else routesSeen.add(route);
  }
  const key = `${day}\u0000${route}`;
  let t = pending.get(key);
  if (!t) { t = { count: 0, errors: 0, total: 0, max: 0, b: new Array(NB).fill(0) }; pending.set(key, t); }
  t.count++;
  if (status >= 500) t.errors++;
  t.total += ms;
  if (ms > t.max) t.max = ms;
  let i = 0;
  while (ms > METRIC_BUCKETS_MS[i]) i++;
  t.b[i]++;
}

/**
 * Which paths are counted: /api and /packs, except /api/health (monitors), the owner portal's own calls, and
 * the live stream (/api/scout/stream: its "latency" is how long it stayed open; the Usage panel counts open
 * streams as live connections instead).
 */
export const isMeasured = (path: string) =>
  /^\/(api|packs)\//i.test(path) && !/^\/api\/(health|owner|scout\/stream)(\/|$)/i.test(path);

/** Express middleware: times every request isMeasured() counts. */
export function requestMetrics() {
  return (req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (!isMeasured(p)) return next();
    const t0 = performance.now();
    res.once("close", () => { try { recordRequest(req.method, p, res.statusCode, performance.now() - t0); } catch { /* never break a response */ } });
    next();
  };
}

const BCOLS = Array.from({ length: NB }, (_, i) => `b${i}`);
const UPSERT = `INSERT INTO request_metrics_daily (day, route, count, errors, total_ms, max_ms, ${BCOLS.join(", ")})
  VALUES (?, ?, ?, ?, ?, ?, ${BCOLS.map(() => "?").join(", ")})
  ON CONFLICT (day, route) DO UPDATE SET count = count + excluded.count, errors = errors + excluded.errors,
    total_ms = total_ms + excluded.total_ms, max_ms = MAX(max_ms, excluded.max_ms),
    ${BCOLS.map((c) => `${c} = ${c} + excluded.${c}`).join(", ")}`;

/** Add the counters held in memory to request_metrics_daily. A failed write puts them back for the next try. */
export async function flushMetrics(): Promise<number> {
  if (!pending.size) return 0;
  const batch = pending;
  pending = new Map();
  try {
    await writeBatch([...batch].map(([key, t]) => {
      const [day, route] = key.split("\u0000");
      return { sql: UPSERT, args: [day, route, t.count, t.errors, t.total, t.max, ...t.b] };
    }));
    return batch.size;
  } catch (e) {
    for (const [key, t] of batch) {
      const cur = pending.get(key);
      if (!cur) { pending.set(key, t); continue; }
      cur.count += t.count; cur.errors += t.errors; cur.total += t.total; cur.max = Math.max(cur.max, t.max);
      t.b.forEach((n, i) => { cur.b[i] += n; });
    }
    throw e;
  }
}

/** Tests: drop whatever is held in memory. */
export function resetMetrics(): void { pending = new Map(); routesDay = ""; routesSeen = new Set(); }

/** The latency at quantile q (0–1) from bucket counts: linear within the bucket, the max caps the last one. */
export function percentile(b: number[], q: number, max: number): number | null {
  const n = b.reduce((s, x) => s + x, 0);
  if (!n) return null;
  const want = q * n;
  let seen = 0;
  for (let i = 0; i < b.length; i++) {
    if (!b[i]) continue;
    if (seen + b[i] >= want) {
      const lo = i === 0 ? 0 : METRIC_BUCKETS_MS[i - 1];
      const hi = Math.max(lo, Math.min(Number.isFinite(METRIC_BUCKETS_MS[i]) ? METRIC_BUCKETS_MS[i] : max, max));
      return lo + (hi - lo) * ((want - seen) / b[i]);
    }
    seen += b[i];
  }
  return max;
}

/** The Usage panel's request numbers (it adds live connections and page views). */
export type UsageSummary = Omit<OwnerUsage, "live" | "pageViews">;

/** Requests per day, sync volume and per-route latency over the last `days` UTC days (today included). */
export async function usageSummary(days = 14, now = Date.now()): Promise<UsageSummary> {
  const to = dayOf(now), from = dayOf(now - (days - 1) * 86_400_000);
  const rows = await all<Record<string, unknown>>(`SELECT * FROM request_metrics_daily WHERE day BETWEEN ? AND ?`, [from, to]);
  const byDay = new Map<string, { requests: number; sync: number; errors: number }>();
  for (let i = days - 1; i >= 0; i--) byDay.set(dayOf(now - i * 86_400_000), { requests: 0, sync: 0, errors: 0 });
  const byRoute = new Map<string, { count: number; errors: number; total: number; max: number; b: number[] }>();
  for (const r of rows) {
    const route = String(r.route), count = Number(r.count), errors = Number(r.errors);
    const d = byDay.get(String(r.day));
    if (d) { d.requests += count; d.errors += errors; if (isSyncRoute(route)) d.sync += count; }
    let t = byRoute.get(route);
    if (!t) { t = { count: 0, errors: 0, total: 0, max: 0, b: new Array(NB).fill(0) }; byRoute.set(route, t); }
    t.count += count; t.errors += errors; t.total += Number(r.total_ms); t.max = Math.max(t.max, Number(r.max_ms));
    for (let i = 0; i < NB; i++) t.b[i] += Number(r[`b${i}`] ?? 0);
  }
  const stats: RouteStats[] = [...byRoute].map(([route, t]) => ({
    route, count: t.count, errors: t.errors, avgMs: t.count ? t.total / t.count : 0,
    p50Ms: percentile(t.b, 0.5, t.max), p95Ms: percentile(t.b, 0.95, t.max), maxMs: t.max,
  }));
  const daily = [...byDay].map(([day, v]) => ({ day, ...v }));
  return {
    days, from, to, daily,
    totals: daily.reduce((s, d) => ({ requests: s.requests + d.requests, sync: s.sync + d.sync, errors: s.errors + d.errors }), { requests: 0, sync: 0, errors: 0 }),
    busiest: [...stats].sort((a, b) => b.count - a.count).slice(0, 10),
    // A route needs a few requests before its p95 means anything.
    slowest: stats.filter((s) => s.count >= 5).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0)).slice(0, 10),
  };
}
