// The first-visit onboarding's funnel, from visitors who allowed anonymous usage statistics (the same consent and
// rules as page views, server/analytics.ts). POST /api/collect/onboarding adds 1 to a daily total (day, event, step,
// screen bucket, team picked); there are no raw events, and no IP address, user agent, cookie or ID is stored. The
// owner portal's Usage panel reads the totals (onboardingSummary): how many saw it, reached each step, skipped where,
// finished, and picked a team.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { Client } from "@libsql/client";
import { db } from "./db.js";
import { COLLECT_MAX_BYTES, dayOf, isBot, rateLimiter } from "./analytics.js";
import { parseOnboardingBeacon, type OnboardingBeacon, type OnboardingSummary } from "../src/shared/onboardingStats.js";

/** Add one beacon to its day's total. */
export async function recordOnboarding(b: OnboardingBeacon, now = new Date(), c: Client = db()): Promise<void> {
  await c.execute({
    sql: `INSERT INTO onboarding_daily (day, event, step, screen, team, count) VALUES (?, ?, ?, ?, ?, 1)
          ON CONFLICT (day, event, step, screen, team) DO UPDATE SET count = count + 1`,
    args: [dayOf(now), b.e, b.step, b.screen, b.team ? 1 : 0],
  });
}

/** The funnel over the last `days` UTC days (today included). */
export async function onboardingSummary(days = 14, now = Date.now(), c: Client = db()): Promise<OnboardingSummary> {
  const to = dayOf(new Date(now)), from = dayOf(new Date(now - (days - 1) * 86_400_000));
  const rows = (await c.execute({
    sql: `SELECT event, step, team, SUM(count) AS n FROM onboarding_daily WHERE day BETWEEN ? AND ? GROUP BY event, step, team`,
    args: [from, to],
  })).rows;
  const s: OnboardingSummary = { days, shown: 0, reached: [0, 0, 0, 0], skipped: [0, 0, 0, 0], finished: 0, withTeam: 0 };
  for (const r of rows) {
    const n = Number(r.n ?? 0), step = Number(r.step), i = step - 1;
    if (i < 0 || i > 3) continue;
    if (r.event === "shown") s.shown += n;
    else if (r.event === "reached") s.reached[i] += n;
    else if (r.event === "skipped") s.skipped[i] += n;
    else if (r.event === "finished") { s.finished += n; if (Number(r.team) === 1) s.withTeam += n; }
  }
  s.reached[0] = s.shown;
  return s;
}

export function onboardingStatsRouter(): Router {
  const r = express.Router();
  const allow = rateLimiter(60, 60_000);
  // Beacons arrive as text/plain or application/json: read the raw text whatever the type.
  r.post("/", express.text({ type: () => true, limit: COLLECT_MAX_BYTES }), (req: Request, res: Response, next: NextFunction) => {
    if (!allow(req.ip ?? "")) { res.status(429).end(); return; }
    // Bots, and browsers asking not to be tracked (a second check after the client's): accepted, not counted.
    if (isBot(req.get("user-agent")) || req.get("sec-gpc") === "1" || req.get("dnt") === "1") { res.status(204).end(); return; }
    let body: unknown;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : null; } catch { body = null; }
    const b = parseOnboardingBeacon(body);
    if (!b) { res.status(400).json({ error: "Not an onboarding beacon" }); return; }
    recordOnboarding(b).then(() => res.status(204).end(), next);
  });
  r.use((err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.status === 413 || err?.type === "entity.too.large") { res.status(413).end(); return; }
    if (err?.status === 400) { res.status(400).end(); return; }
    next(err);
  });
  return r;
}
