// Abuse signals for the owner console's Moderation tab: how often requests were turned away (429) and how
// often traffic looked like scraping, per UTC day and coarse network range. Aggregates only.
//
// What is counted, per API request (/api and /packs, as server/metrics.ts measures them):
//   rate_limited  the answer was 429 (any limiter: the heavy-endpoint buckets, sign-in, contact, reports…)
//   bot_ua        the user agent is a crawler, script or automated browser (analytics.ts isBot)
//   burst         one range sent more than BURST_PER_MINUTE requests in a minute (counted once per minute)
//
// Privacy: an address is cut down to its range the moment the request is seen: IPv4 to its /16
// ("203.0.0.0/16"), IPv6 to its /32 ("2001:db8::/32"). Only the range and a count are held in memory or
// written to abuse_daily; no full address, user agent, path or account is kept anywhere. Rows older than
// RETENTION_DAYS are removed when the counters are flushed.
import type { NextFunction, Request, Response } from "express";
import { all, run, writeBatch } from "./db.js";
import { isBot } from "./analytics.js";
import { isMeasured } from "./metrics.js";
import type { AbuseKind, OwnerModeration } from "../src/shared/owner.js";

export const ABUSE_KINDS: AbuseKind[] = ["rate_limited", "bot_ua", "burst"];
/** Requests a minute from one range above which that minute counts as a burst. */
export const BURST_PER_MINUTE = 600;
/** How long daily rows are kept. */
export const RETENTION_DAYS = 90;
/** At most this many ranges per UTC day (per process); any more count as "(other)". */
export const MAX_RANGES = 2000;
export const OTHER_RANGE = "(other)";
export const UNKNOWN_RANGE = "(unknown)";

/** The coarse range of an address: IPv4 /16, IPv6 /32. Never returns the address itself. */
export function ipRange(ip: string | undefined | null): string {
  if (!ip) return UNKNOWN_RANGE;
  let s = ip.trim().toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct); // zone index (fe80::1%eth0)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) s = mapped[1];
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(s);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    return a <= 255 && b <= 255 ? `${a}.${b}.0.0/16` : UNKNOWN_RANGE;
  }
  if (!s.includes(":") || !/^[0-9a-f:.]+$/.test(s)) return UNKNOWN_RANGE;
  const halves = s.split("::");
  if (halves.length > 2) return UNKNOWN_RANGE;
  const head = halves[0] ? halves[0].split(":") : [];
  // With "::" the groups before it are all there is of the head; the first two groups are what counts.
  const groups = halves.length === 2 ? [...head, "0", "0"] : head;
  const [g1, g2] = groups;
  if (g1 == null || g2 == null || !/^[0-9a-f]{1,4}$/.test(g1) || !/^[0-9a-f]{1,4}$/.test(g2)) return UNKNOWN_RANGE;
  const h = (g: string) => parseInt(g, 16).toString(16);
  return `${h(g1)}:${h(g2)}::/32`;
}

let pending = new Map<string, number>();
let rangesDay = "";
let rangesSeen = new Set<string>();
// The current minute's requests per range (for bursts): only this minute is ever held.
let minute = -1;
let perMinute = new Map<string, number>();

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function bump(day: string, range: string, kind: AbuseKind): void {
  const key = `${day}\u0000${range}\u0000${kind}`;
  pending.set(key, (pending.get(key) ?? 0) + 1);
}

/** Count one finished request from `ip` (cut to its range here) that answered `status`. */
export function recordAbuseSignal(ip: string | undefined, status: number, userAgent: string | undefined, now = Date.now()): void {
  recordRangeSignal(ipRange(ip), status, userAgent, now);
}

/** Count one finished request from a range ipRange() already cut it to. */
function recordRangeSignal(range: string, status: number, userAgent: string | undefined, now: number): void {
  const day = dayOf(now);
  if (day !== rangesDay) { rangesDay = day; rangesSeen = new Set(); }
  const m = Math.floor(now / 60_000);
  if (m !== minute) { minute = m; perMinute = new Map(); }
  const n = (perMinute.get(range) ?? 0) + 1;
  if (perMinute.size < MAX_RANGES || perMinute.has(range)) perMinute.set(range, n);
  const burst = n === BURST_PER_MINUTE + 1;
  const flagged = status === 429 || isBot(userAgent) || burst;
  if (!flagged) return;
  if (!rangesSeen.has(range)) {
    if (rangesSeen.size >= MAX_RANGES) range = OTHER_RANGE;
    else rangesSeen.add(range);
  }
  if (status === 429) bump(day, range, "rate_limited");
  if (isBot(userAgent)) bump(day, range, "bot_ua");
  if (burst) bump(day, range, "burst");
}

/** Express middleware: watches every request metrics.ts measures (the API and offline packs). */
export function abuseMonitor() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isMeasured(req.path)) return next();
    // Cut to the range now: the full address isn't kept even until the response ends.
    const range = ipRange(req.ip);
    const ua = req.get("user-agent");
    res.once("finish", () => { try { recordRangeSignal(range, res.statusCode, ua, Date.now()); } catch { /* never break a response */ } });
    next();
  };
}

const UPSERT = `INSERT INTO abuse_daily (day, ip_range, kind, count) VALUES (?, ?, ?, ?)
  ON CONFLICT (day, ip_range, kind) DO UPDATE SET count = count + excluded.count`;
let prunedDay = "";

/** Add the counters held in memory to abuse_daily (and drop rows past retention once a day). A failed write keeps them for the next try. */
export async function flushAbuse(now = Date.now()): Promise<number> {
  const today = dayOf(now);
  if (prunedDay !== today) {
    await run("DELETE FROM abuse_daily WHERE day < ?", [dayOf(now - (RETENTION_DAYS - 1) * 86_400_000)]);
    prunedDay = today;
  }
  if (!pending.size) return 0;
  const batch = pending;
  pending = new Map();
  try {
    await writeBatch([...batch].map(([key, n]) => {
      const [day, range, kind] = key.split("\u0000");
      return { sql: UPSERT, args: [day, range, kind, n] };
    }));
    return batch.size;
  } catch (e) {
    for (const [key, n] of batch) pending.set(key, (pending.get(key) ?? 0) + n);
    throw e;
  }
}

/** Tests: drop whatever is held in memory. */
export function resetAbuse(): void {
  pending = new Map(); rangesDay = ""; rangesSeen = new Set(); minute = -1; perMinute = new Map(); prunedDay = "";
}
/** Tests: what is held in memory right now (keys hold day, range and kind only). */
export const pendingAbuseKeys = () => [...pending.keys()];

/** Per-day totals and the busiest ranges over the last `days` UTC days (today included). */
export async function abuseSummary(days = 14, now = Date.now()): Promise<OwnerModeration["abuse"]> {
  const to = dayOf(now), from = dayOf(now - (days - 1) * 86_400_000);
  const rows = await all<{ day: string; ip_range: string; kind: string; count: number }>(
    "SELECT day, ip_range, kind, count FROM abuse_daily WHERE day BETWEEN ? AND ?", [from, to]);
  const zero = (): Record<AbuseKind, number> => ({ rate_limited: 0, bot_ua: 0, burst: 0 });
  const byDay = new Map<string, Record<AbuseKind, number>>();
  for (let i = days - 1; i >= 0; i--) byDay.set(dayOf(now - i * 86_400_000), zero());
  const byRange = new Map<string, { counts: Record<AbuseKind, number>; days: Set<string> }>();
  const totals = zero();
  for (const r of rows) {
    const kind = r.kind as AbuseKind;
    if (!ABUSE_KINDS.includes(kind)) continue;
    const n = Number(r.count);
    const d = byDay.get(String(r.day));
    if (d) d[kind] += n;
    totals[kind] += n;
    let g = byRange.get(r.ip_range);
    if (!g) { g = { counts: zero(), days: new Set() }; byRange.set(r.ip_range, g); }
    g.counts[kind] += n;
    g.days.add(String(r.day));
  }
  const ranges = [...byRange].map(([range, g]) => ({ range, ...g.counts, days: g.days.size }))
    .sort((a, b) => (b.rate_limited + b.burst * 10 + b.bot_ua) - (a.rate_limited + a.burst * 10 + a.bot_ua) || a.range.localeCompare(b.range))
    .slice(0, 25);
  return { days, from, to, retentionDays: RETENTION_DAYS, burstPerMinute: BURST_PER_MINUTE, totals, daily: [...byDay].map(([day, c]) => ({ day, ...c })), ranges };
}
