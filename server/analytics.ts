// First-party, cookieless usage statistics (only sent by browsers whose visitor
// said yes, see src/lib/analytics.tsx). POST /api/collect adds one page view to
// a daily aggregate row (day, route pattern, referrer host, screen size, language);
// there are no raw events, and no IP address, user agent, cookie or ID is
// stored. The IP is held in memory for a minute for the rate limit only.
// GET /api/stats/summary (STATS_TOKEN) and `npm run stats:report` read the totals.
// GET /api/public-usage publishes two of them (page views, sessions started, per
// day for 30 days) and nothing else, only when the owner publishes them (the console's Analytics tab;
// until chosen there, PUBLIC_USAGE_ENABLED decides).
import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { Client } from "@libsql/client";
import { db } from "./db.js";
import { env } from "./env.js";
import { registerCache } from "./caches.js";
import { publishUsageSetting } from "./ownerSettings.js";
import { parsePageView, type PageView } from "../src/shared/analytics.js";
import { PUBLIC_USAGE_DAYS, type PublicUsage } from "../src/shared/home.js";

/** Crawlers, link previews, monitors, scripts and automated browsers. */
export const BOT_UA = /bot|crawl|spider|slurp|archiver|scrape|headless|lighthouse|pagespeed|gtmetrix|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|curl|wget|python|httpclient|okhttp|axios|node-fetch|undici|go-http|java\/|libwww|phantom|puppeteer|playwright|selenium|uptime|monitor|pingdom/i;

export const isBot = (ua: string | undefined) => !ua || ua.length < 20 || BOT_UA.test(ua);

/** The UTC day a view counts toward. */
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Add one page view to its day's aggregate row. */
export async function recordPageView(v: PageView, now = new Date(), c: Client = db()): Promise<void> {
  await c.execute({
    sql: `INSERT INTO analytics_daily (day, path, referrer_host, screen, lang, views, sessions) VALUES (?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT (day, path, referrer_host, screen, lang) DO UPDATE SET views = views + 1, sessions = sessions + excluded.sessions`,
    args: [dayOf(now), v.path, v.ref, v.screen, v.lang, v.session ? 1 : 0],
  });
}

export type StatsSummary = {
  days: number; from: string; to: string;
  totals: { views: number; sessions: number };
  daily: { day: string; views: number; sessions: number }[];
  topPaths: { path: string; views: number }[];
  topReferrers: { host: string; sessions: number }[];
  screens: { screen: string; views: number }[];
  languages: { lang: string; views: number }[];
};

/** Totals for the last `days` UTC days (today included). */
export async function statsSummary(days = 30, now = new Date(), c: Client = db()): Promise<StatsSummary> {
  const to = dayOf(now);
  const from = dayOf(new Date(now.getTime() - (days - 1) * 86_400_000));
  const q = async <T>(sql: string) => (await c.execute({ sql, args: [from, to] })).rows.map((r) => ({ ...r }) as T);
  const where = "WHERE day BETWEEN ? AND ?";
  const [tot] = await q<{ views: number | null; sessions: number | null }>(`SELECT SUM(views) AS views, SUM(sessions) AS sessions FROM analytics_daily ${where}`);
  return {
    days, from, to,
    totals: { views: Number(tot?.views ?? 0), sessions: Number(tot?.sessions ?? 0) },
    daily: await q(`SELECT day, SUM(views) AS views, SUM(sessions) AS sessions FROM analytics_daily ${where} GROUP BY day ORDER BY day`),
    topPaths: await q(`SELECT path, SUM(views) AS views FROM analytics_daily ${where} GROUP BY path ORDER BY views DESC, path LIMIT 20`),
    topReferrers: await q(`SELECT referrer_host AS host, SUM(sessions) AS sessions FROM analytics_daily ${where} AND referrer_host <> '' GROUP BY referrer_host ORDER BY sessions DESC, host LIMIT 20`),
    screens: await q(`SELECT screen, SUM(views) AS views FROM analytics_daily ${where} GROUP BY screen ORDER BY views DESC`),
    languages: await q(`SELECT lang, SUM(views) AS views FROM analytics_daily ${where} AND lang <> '' GROUP BY lang ORDER BY views DESC, lang LIMIT 20`),
  };
}

/**
 * What the home page shows about Control Scout's own use: page views and sessions
 * started per UTC day for the last `days` days (today, still partial, included).
 * Allowlisted by construction: only those two sums are read, never the paths,
 * referrers, screens or languages the owner's summary breaks them down by.
 *
 * Unavailable (totals null, never a stand-in zero) when publishing is off, when
 * nothing has ever been recorded, or when the table can't be read. A zero is
 * shown only when it was measured: days before the first recorded day are left
 * out (measuredFrom), days after it with no views are real zeroes.
 */
export async function publicUsage(enabled: boolean, now = new Date(), c: Client = db(), days = PUBLIC_USAGE_DAYS): Promise<PublicUsage> {
  const to = dayOf(now);
  const from = dayOf(new Date(now.getTime() - (days - 1) * 86_400_000));
  const base = { from, to, generatedAt: now.toISOString(), coverage: "opt-in" as const };
  const unavailable = (reason: PublicUsage["reason"]): PublicUsage => ({ ...base, status: "unavailable", reason, measuredFrom: null, measuredThrough: null, totals: null, daily: [] });
  if (!enabled) return unavailable("not-published");
  let first: string | null, rows: { day: string; views: number; sessions: number }[];
  try {
    const f = await c.execute("SELECT MIN(day) AS day FROM analytics_daily");
    first = (f.rows[0]?.day as string | null) ?? null;
    rows = (await c.execute({ sql: "SELECT day, SUM(views) AS views, SUM(sessions) AS sessions FROM analytics_daily WHERE day BETWEEN ? AND ? GROUP BY day", args: [from, to] }))
      .rows.map((r) => ({ day: String(r.day), views: Number(r.views ?? 0), sessions: Number(r.sessions ?? 0) }));
  } catch (e) {
    console.warn(`[analytics] public usage unavailable: ${(e as Error)?.message ?? e}`);
    return unavailable("error");
  }
  if (!first || first > to) return unavailable("no-data");
  const start = first > from ? first : from;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const daily: PublicUsage["daily"] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const day = dayOf(new Date(t));
    const r = byDay.get(day);
    daily.push({ day, pageViews: r?.views ?? 0, sessionStarts: r?.sessions ?? 0 });
  }
  return {
    ...base, status: "available", reason: null,
    measuredFrom: first > from ? first : null,
    measuredThrough: now.toISOString(),
    totals: { pageViews: daily.reduce((a, d) => a + d.pageViews, 0), sessionStarts: daily.reduce((a, d) => a + d.sessionStarts, 0) },
    daily,
  };
}

/** Public usage is read at most once a minute (shared by every visitor; it's a daily aggregate). */
export const PUBLIC_USAGE_TTL_MS = 60_000;
/** How long browsers and shared caches may keep a /api/public-usage answer (no stale serving): with the owner
 *  setting's 10 s cache, hiding the figures reaches every visitor within a minute. */
export const PUBLIC_USAGE_MAX_AGE_S = 45;
let usageCache: { enabled: boolean; at: number; value: Promise<PublicUsage> } | null = null;
registerCache("Public usage", () => { usageCache = null; });

/** `enabled`: whether to publish; by default the owner's console choice (server/ownerSettings.ts), else PUBLIC_USAGE_ENABLED. */
export async function cachedPublicUsage(enabled?: boolean): Promise<PublicUsage> {
  enabled ??= (await publishUsageSetting()).enabled;
  const now = Date.now();
  if (usageCache && usageCache.enabled === enabled && now - usageCache.at < PUBLIC_USAGE_TTL_MS) return usageCache.value;
  const value = publicUsage(enabled);
  // An error answer isn't kept: the next request tries the table again.
  value.then((u) => { if (u.reason === "error" && usageCache?.value === value) usageCache = null; });
  usageCache = { enabled, at: now, value };
  return value;
}

/** Per-IP limiter held in memory only (never written anywhere). Expired keys are
 *  swept at most once per window, so an IP is gone within two windows of its last request. */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; at: number }>();
  let swept = 0;
  const allow = (key: string, now = Date.now()): boolean => {
    if (now - swept >= windowMs) {
      for (const [k, h] of hits) if (now - h.at >= windowMs) hits.delete(k);
      swept = now;
    }
    const h = hits.get(key);
    if (h && now - h.at < windowMs) { h.n++; return h.n <= max; }
    if (hits.size > 50_000) hits.clear();
    hits.set(key, { n: 1, at: now });
    return true;
  };
  return Object.assign(allow, { size: () => hits.size });
}

/** The body limit: a page view is ~100 bytes. */
export const COLLECT_MAX_BYTES = 1024;

export function collectRouter(): Router {
  const r = express.Router();
  const allow = rateLimiter(120, 60_000);
  // Beacons arrive as text/plain or application/json: read the raw text whatever the type.
  r.post("/", express.text({ type: () => true, limit: COLLECT_MAX_BYTES }), (req: Request, res: Response, next: NextFunction) => {
    if (!allow(req.ip ?? "")) { res.status(429).end(); return; }
    // Bots, and browsers asking not to be tracked (a second check after the client's): accepted, not counted.
    if (isBot(req.get("user-agent")) || req.get("sec-gpc") === "1" || req.get("dnt") === "1") { res.status(204).end(); return; }
    let body: unknown;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : null; } catch { body = null; }
    const view = parsePageView(body);
    if (!view) { res.status(400).json({ error: "Not a page view" }); return; }
    recordPageView(view).then(() => res.status(204).end(), next);
  });
  // Too big (413) or unreadable: a short answer, never the app's error page.
  r.use((err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.status === 413 || err?.type === "entity.too.large") { res.status(413).end(); return; }
    if (err?.status === 400) { res.status(400).end(); return; }
    next(err);
  });
  return r;
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** GET /api/stats/summary?days=30 for the owner: needs `Authorization: Bearer <STATS_TOKEN>`. 404 when no token is set. */
export function statsRouter(): Router {
  const r = express.Router();
  r.get("/summary", (req: Request, res: Response, next: NextFunction) => {
    const token = env.statsToken;
    if (!token) { res.status(404).json({ error: "Not found" }); return; }
    const given = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "")?.[1]?.trim();
    if (!tokenMatches(given, token)) { res.status(401).json({ error: "Unauthorized" }); return; }
    const days = Math.min(366, Math.max(1, Math.floor(Number(req.query.days ?? 30)) || 30));
    statsSummary(days).then((s) => res.json(s), next);
  });
  return r;
}
