// Search speed and score (the search audit's M6 + M7), from visitors who allowed anonymous usage statistics (the same
// consent and rules as page views, server/analytics.ts) and only from a sample of their page loads (SEARCH_SAMPLE,
// decided in the browser). POST /api/collect/search adds one search to a daily total (day, screen bucket, entry):
// how it ended, whether it was typed again within 30 s, whether a follow-up tap started it, and its time to answer in
// a histogram. There are no raw events, and no query, IP address, user agent, cookie or ID is stored. Test traffic
// (an `X-CS-Test: 1` header: eval scripts, agents, load tests), bots and headless browsers are accepted and not
// counted. The owner console's Server & speed tab reads p50/p95 by phone and desktop and a weekly score (searchScore).
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { Client } from "@libsql/client";
import { db } from "./db.js";
import { COLLECT_MAX_BYTES, dayOf, isBot, rateLimiter } from "./analytics.js";
import { percentile } from "./metrics.js";
import {
  ANSWER_BUCKET_COUNT, ANSWER_BUCKETS_MS, answerBucket, isoWeek, parseSearchBeacon, SEARCH_SAMPLE, weekStart,
  type AnswerSpeed, type SearchBeacon, type SearchScore, type SearchWeek,
} from "../src/shared/searchScore.js";

const BCOLS = Array.from({ length: ANSWER_BUCKET_COUNT }, (_, i) => `b${i}`);
const COUNTS = ["searches", "direct", "results", "page", "sorry", "error", "re_search", "via_related", "via_ask", "timed", "total_ms"] as const;
const UPSERT = `INSERT INTO search_score_daily (day, screen, entry, ${COUNTS.join(", ")}, max_ms, ${BCOLS.join(", ")})
  VALUES (?, ?, ?, ${COUNTS.map(() => "?").join(", ")}, ?, ${BCOLS.map(() => "?").join(", ")})
  ON CONFLICT (day, screen, entry) DO UPDATE SET ${COUNTS.map((c) => `${c} = ${c} + excluded.${c}`).join(", ")},
    max_ms = MAX(max_ms, excluded.max_ms), ${BCOLS.map((c) => `${c} = ${c} + excluded.${c}`).join(", ")}`;

/** Add one search to its day's total. */
export async function recordSearch(s: SearchBeacon, now = new Date(), c: Client = db()): Promise<void> {
  const timed = s.ms != null;
  const b = new Array(ANSWER_BUCKET_COUNT).fill(0);
  if (timed) b[answerBucket(s.ms!)] = 1;
  const counts = [1, +(s.outcome === "direct"), +(s.outcome === "results"), +(s.outcome === "page"), +(s.outcome === "sorry"), +(s.outcome === "error"),
    +s.re, +(s.via === "related"), +(s.via === "ask"), +timed, timed ? s.ms! : 0];
  await c.execute({ sql: UPSERT, args: [dayOf(now), s.screen, s.entry, ...counts, timed ? s.ms! : 0, ...b] });
}

/** Merged time-to-answer histogram → its count, median and 95th percentile (ms). */
export function answerSpeed(b: number[], max: number): AnswerSpeed {
  const n = b.reduce((s, x) => s + x, 0);
  return { n, p50: percentile(b, 0.5, max, ANSWER_BUCKETS_MS), p95: percentile(b, 0.95, max, ANSWER_BUCKETS_MS) };
}

type Row = Record<string, unknown>;
const n = (r: Row, k: string) => Number(r[k] ?? 0);

/** Sums the rows' histograms into one speed. */
function speedOf(rows: Row[]): AnswerSpeed {
  const b = new Array(ANSWER_BUCKET_COUNT).fill(0);
  let max = 0;
  for (const r of rows) { BCOLS.forEach((col, i) => { b[i] += n(r, col); }); max = Math.max(max, n(r, "max_ms")); }
  return answerSpeed(b, max);
}

/** Day rows → one score per ISO week. */
export function weeksOf(rows: Row[]): SearchWeek[] {
  const by = new Map<string, Record<(typeof COUNTS)[number], number>>();
  for (const r of rows) {
    const w = isoWeek(String(r.day));
    const acc = by.get(w) ?? Object.fromEntries(COUNTS.map((c) => [c, 0])) as Record<(typeof COUNTS)[number], number>;
    for (const c of COUNTS) acc[c] += n(r, c);
    by.set(w, acc);
  }
  return [...by].sort((a, b) => b[0].localeCompare(a[0])).map(([week, a]) => {
    const of = (x: number) => (a.searches ? x / a.searches : null);
    const typed = a.searches - a.via_related - a.via_ask;
    return {
      week, from: weekStart(week), searches: a.searches,
      answered: of(a.direct + a.results + a.page), direct: of(a.direct), sorry: of(a.sorry), failed: of(a.error),
      related: of(a.via_related + a.via_ask),
      // Only a typed search can be a re-search: of the typed ones.
      reSearch: typed > 0 ? a.re_search / typed : null,
    };
  });
}

/** Weeks in the score: this one and the seven before it. */
export const SCORE_WEEKS = 8;

/** Time to answer over the last `days` UTC days (today included), and the last SCORE_WEEKS ISO weeks' scores. */
export async function searchScore(days = 14, now = Date.now(), c: Client = db()): Promise<SearchScore> {
  const today = dayOf(new Date(now));
  const from = dayOf(new Date(now - (days - 1) * 86_400_000));
  const first = weekStart(isoWeek(dayOf(new Date(now - (SCORE_WEEKS - 1) * 7 * 86_400_000))));
  const rows = (await c.execute({ sql: `SELECT day, screen, entry, ${COUNTS.join(", ")}, max_ms, ${BCOLS.join(", ")} FROM search_score_daily WHERE day BETWEEN ? AND ?`, args: [first < from ? first : from, today] })).rows as unknown as Row[];
  const inDays = rows.filter((r) => String(r.day) >= from);
  return {
    days, sample: SEARCH_SAMPLE,
    speed: {
      phone: speedOf(inDays.filter((r) => r.screen === "phone")),
      desktop: speedOf(inDays.filter((r) => r.screen !== "phone")),
      load: speedOf(inDays.filter((r) => r.entry === "load")),
      app: speedOf(inDays.filter((r) => r.entry === "app")),
    },
    weeks: weeksOf(rows.filter((r) => String(r.day) >= first)),
  };
}

/** Not counted: test traffic (eval scripts, agents and load tests send `X-CS-Test: 1`), bots and headless browsers, and browsers asking not to be tracked. */
export function notCounted(req: Request): boolean {
  return req.get("x-cs-test") === "1" || isBot(req.get("user-agent")) || req.get("sec-gpc") === "1" || req.get("dnt") === "1";
}

export function searchScoreRouter(): Router {
  const r = express.Router();
  const allow = rateLimiter(60, 60_000);
  // Beacons arrive as text/plain or application/json: read the raw text whatever the type.
  r.post("/", express.text({ type: () => true, limit: COLLECT_MAX_BYTES }), (req: Request, res: Response, next: NextFunction) => {
    if (!allow(req.ip ?? "")) { res.status(429).end(); return; }
    if (notCounted(req)) { res.status(204).end(); return; }
    let body: unknown;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : null; } catch { body = null; }
    const s = parseSearchBeacon(body);
    if (!s) { res.status(400).json({ error: "Not a search beacon" }); return; }
    recordSearch(s).then(() => res.status(204).end(), next);
  });
  // Too big (413) or unreadable: a short answer, never the app's error page.
  r.use((err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.status === 413 || err?.type === "entity.too.large") { res.status(413).end(); return; }
    if (err?.status === 400) { res.status(400).end(); return; }
    next(err);
  });
  return r;
}
