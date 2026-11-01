// Real-user speed: web vitals (LCP, INP, CLS, FID, TTFB) from visitors who allowed anonymous usage statistics,
// the same consent and the same rules as page views (server/analytics.ts). POST /api/collect/vitals adds each
// metric of one page load to a daily histogram row (day, route pattern, screen bucket, metric); there are no raw
// events, and no IP address, user agent, cookie or ID is stored. The owner portal's Usage panel reads the 75th
// percentile per page (vitalsSummary).
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { Client, InStatement } from "@libsql/client";
import { db } from "./db.js";
import { COLLECT_MAX_BYTES, dayOf, isBot, rateLimiter } from "./analytics.js";
import { percentile } from "./metrics.js";
import {
  parseVitals, VITAL_BUCKET_COUNT, VITAL_BUCKETS, VITAL_THRESHOLDS, VITALS, vitalBucket,
  type VitalName, type VitalStat, type VitalsBeacon, type VitalsRow,
} from "../src/shared/vitals.js";

const BCOLS = Array.from({ length: VITAL_BUCKET_COUNT }, (_, i) => `b${i}`);
const UPSERT = `INSERT INTO web_vitals_daily (day, path, screen, metric, count, total, max, ${BCOLS.join(", ")})
  VALUES (?, ?, ?, ?, 1, ?, ?, ${BCOLS.map(() => "?").join(", ")})
  ON CONFLICT (day, path, screen, metric) DO UPDATE SET count = count + 1, total = total + excluded.total,
    max = MAX(max, excluded.max), ${BCOLS.map((c) => `${c} = ${c} + excluded.${c}`).join(", ")}`;

/** Add one page load's metrics to their day's histogram rows. */
export async function recordVitals(v: VitalsBeacon, now = new Date(), c: Client = db()): Promise<void> {
  const day = dayOf(now);
  const stmts: InStatement[] = VITALS.flatMap((name) => {
    const value = v.m[name];
    if (value == null) return [];
    const b = new Array(VITAL_BUCKET_COUNT).fill(0);
    b[vitalBucket(name, value)] = 1;
    return [{ sql: UPSERT, args: [day, v.path, v.screen, name, value, value, ...b] }];
  });
  if (stmts.length) await c.batch(stmts, "write");
}

/** One metric's histogram → its p75 and the shares of good and poor loads. */
export function vitalStat(name: VitalName, b: number[], max: number): VitalStat {
  const n = b.reduce((s, x) => s + x, 0);
  const bounds = VITAL_BUCKETS[name];
  const [goodAt, poorAt] = VITAL_THRESHOLDS[name];
  let good = 0, poor = 0;
  b.forEach((x, i) => { if (bounds[i] <= goodAt) good += x; else if ((i === 0 ? 0 : bounds[i - 1]) >= poorAt) poor += x; });
  return { n, p75: percentile(b, 0.75, max, bounds), good: n ? good / n : 0, poor: n ? poor / n : 0 };
}

/** The pages with the most measured loads in the Usage panel; the rest still count toward "all pages". */
export const VITALS_PAGES = 15;

/** Web vitals over the last `days` UTC days (today included): all pages together, then per page (most loads first). */
export async function vitalsSummary(days = 14, now = Date.now(), c: Client = db()): Promise<{ all: VitalsRow; pages: VitalsRow[] }> {
  const to = dayOf(new Date(now)), from = dayOf(new Date(now - (days - 1) * 86_400_000));
  const rows = (await c.execute({
    sql: `SELECT path, metric, SUM(count) AS count, MAX(max) AS max, ${BCOLS.map((b) => `SUM(${b}) AS ${b}`).join(", ")}
          FROM web_vitals_daily WHERE day BETWEEN ? AND ? GROUP BY path, metric`,
    args: [from, to],
  })).rows;
  type Acc = { max: number; b: number[] };
  const byPath = new Map<string, Map<VitalName, Acc>>();
  const total = new Map<VitalName, Acc>();
  const add = (m: Map<VitalName, Acc>, name: VitalName, max: number, b: number[]) => {
    const a = m.get(name) ?? { max: 0, b: new Array(VITAL_BUCKET_COUNT).fill(0) };
    a.max = Math.max(a.max, max);
    b.forEach((x, i) => { a.b[i] += x; });
    m.set(name, a);
  };
  for (const r of rows) {
    const name = String(r.metric) as VitalName;
    if (!VITALS.includes(name)) continue;
    const b = BCOLS.map((col) => Number(r[col] ?? 0)), max = Number(r.max ?? 0);
    const path = String(r.path);
    if (!byPath.has(path)) byPath.set(path, new Map());
    add(byPath.get(path)!, name, max, b);
    add(total, name, max, b);
  }
  const toRow = (path: string, m: Map<VitalName, Acc>): VitalsRow =>
    ({ path, metrics: Object.fromEntries([...m].map(([name, a]) => [name, vitalStat(name, a.b, a.max)])) });
  // A page's loads: its most-measured metric (TTFB is reported on every load, LCP on nearly every one).
  const loads = (r: VitalsRow) => Math.max(0, ...Object.values(r.metrics).map((s) => s!.n));
  const pages = [...byPath].map(([p, m]) => toRow(p, m)).sort((a, b) => loads(b) - loads(a) || a.path.localeCompare(b.path)).slice(0, VITALS_PAGES);
  return { all: toRow("(all pages)", total), pages };
}

export function vitalsRouter(): Router {
  const r = express.Router();
  const allow = rateLimiter(120, 60_000);
  // Beacons arrive as text/plain or application/json: read the raw text whatever the type.
  r.post("/", express.text({ type: () => true, limit: COLLECT_MAX_BYTES }), (req: Request, res: Response, next: NextFunction) => {
    if (!allow(req.ip ?? "")) { res.status(429).end(); return; }
    // Bots, and browsers asking not to be tracked (a second check after the client's): accepted, not counted.
    if (isBot(req.get("user-agent")) || req.get("sec-gpc") === "1" || req.get("dnt") === "1") { res.status(204).end(); return; }
    let body: unknown;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : null; } catch { body = null; }
    const v = parseVitals(body);
    if (!v) { res.status(400).json({ error: "Not a web vitals beacon" }); return; }
    recordVitals(v).then(() => res.status(204).end(), next);
  });
  // Too big (413) or unreadable: a short answer, never the app's error page.
  r.use((err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.status === 413 || err?.type === "entity.too.large") { res.status(413).end(); return; }
    if (err?.status === 400) { res.status(400).end(); return; }
    next(err);
  });
  return r;
}
