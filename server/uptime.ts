// The public /status page's checks: every CHECK_EVERY_MIN minutes this server checks each part of Control Scout and
// keeps one row per check in uptime_checks (migration 86) for 90 days. No alerts, no paging: the page only shows them.
//
// - site, api: the public address through Cloudflare, the way a visitor reaches it. The checks are the uptime worker's
//   (deploy/uptime-worker/src/uptime.ts checkSite): GET / must be the app shell, GET /api/health must say ready.
// - controlPoint: its /api/health answers 200 with ok: true.
// - bot: the Discord bot has no address; while connected it writes a heartbeat (bot/index.ts) every minute, and a
//   heartbeat older than BOT_STALE_MS means it's down.
//
// A check this server didn't run (it was restarting, or down itself) is a gap on the page, never counted either way.
import { db, primaryDb } from "./db.js";
import { env } from "./env.js";
import { checkSite, oneLine, type FetchLike } from "../deploy/uptime-worker/src/uptime.js";
import { CHECK_EVERY_MIN, STATUS_BARS, overallOf, type ServiceKey, type ServiceStatus, type StatusBar, type StatusResponse } from "../src/shared/status.js";

export const SERVICES: { key: ServiceKey; label: string; about: string }[] = [
  { key: "site", label: "Website", about: "The pages you browse" },
  { key: "api", label: "Data", about: "Teams, events, search and predictions" },
  { key: "controlPoint", label: "Control Point", about: "The sister app for team workspaces" },
  { key: "bot", label: "Discord bot", about: "Answers and alerts in Discord" },
];

export const BOT_STALE_MS = 3 * 60_000;
const KEEP_MS = 90 * 24 * 3600_000;
const STEP_MS = CHECK_EVERY_MIN * 60_000;

export interface CheckRow { service: ServiceKey; ok: boolean; ms: number | null; reason?: string }

async function checkControlPoint(fetchFn: FetchLike, url: string, timeoutMs: number): Promise<CheckRow> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, headers: { "cache-control": "no-cache", "user-agent": "control-scout-uptime" } });
    const body = await res.text();
    const ms = Date.now() - started;
    if (res.status !== 200) return { service: "controlPoint", ok: false, ms, reason: `HTTP ${res.status}` };
    let ok = false;
    try { ok = (JSON.parse(body) as { ok?: unknown } | null)?.ok === true; } catch { /* not JSON */ }
    return ok ? { service: "controlPoint", ok: true, ms } : { service: "controlPoint", ok: false, ms, reason: "not ok" };
  } catch (e) {
    return { service: "controlPoint", ok: false, ms: null, reason: ctrl.signal.aborted ? "timed out" : oneLine(String((e as Error)?.message ?? e), 120) };
  } finally {
    clearTimeout(timer);
  }
}

async function checkBot(now: number): Promise<CheckRow> {
  // From the primary: the bot writes from another process, and an embedded replica can be minutes behind.
  const r = await primaryDb().execute({ sql: "SELECT at FROM service_heartbeats WHERE service = 'bot'", args: [] });
  const at = r.rows[0] ? Number(r.rows[0].at) : null;
  if (at === null) return { service: "bot", ok: false, ms: null, reason: "no heartbeat yet" };
  return now - at <= BOT_STALE_MS ? { service: "bot", ok: true, ms: null } : { service: "bot", ok: false, ms: null, reason: "heartbeat stale" };
}

/** Every service once. */
export async function runChecks(opts: { fetchFn?: FetchLike; site?: string; controlPointUrl?: string; now?: number; timeoutMs?: number } = {}): Promise<CheckRow[]> {
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const now = opts.now ?? Date.now();
  const [site, cp, bot] = await Promise.all([
    checkSite(fetchFn, (opts.site ?? env.canonicalUrl).replace(/\/$/, ""), { timeoutMs }),
    checkControlPoint(fetchFn, opts.controlPointUrl ?? env.controlPointHealthUrl, timeoutMs),
    checkBot(now).catch((e): CheckRow => ({ service: "bot", ok: false, ms: null, reason: oneLine(String((e as Error)?.message ?? e), 120) })),
  ]);
  const of = (name: "home" | "api", key: ServiceKey): CheckRow => {
    const c = site.checks.find((x) => x.name === name)!;
    return { service: key, ok: c.ok, ms: c.status === null ? null : c.latencyMs, reason: c.reason };
  };
  return [of("home", "site"), of("api", "api"), cp, bot];
}

export async function recordChecks(rows: CheckRow[], at = Date.now()): Promise<void> {
  await db().batch(rows.map((r) => ({
    sql: "INSERT INTO uptime_checks (service, at, ok, ms, reason) VALUES (?, ?, ?, ?, ?)",
    args: [r.service, at, r.ok ? 1 : 0, r.ms, r.reason ?? null],
  })), "write");
  cached = null;
}

export async function pruneChecks(now = Date.now()): Promise<void> {
  await db().execute({ sql: "DELETE FROM uptime_checks WHERE at < ?", args: [now - KEEP_MS] });
}

/** The bot's heartbeat (bot/index.ts). */
export async function beat(service: ServiceKey, at = Date.now()): Promise<void> {
  await db().execute({ sql: "INSERT INTO service_heartbeats (service, at) VALUES (?, ?) ON CONFLICT(service) DO UPDATE SET at = excluded.at", args: [service, at] });
}

/** The page's bars: STATUS_BARS slots of STEP_MS ending now, each the newest check in it, or a gap. */
export function barsOf(checks: { at: number; ok: boolean }[], now: number): StatusBar[] {
  const start = now - STATUS_BARS * STEP_MS;
  const slots: StatusBar[] = Array.from({ length: STATUS_BARS }, (_, i) => ({ at: start + (i + 1) * STEP_MS, ok: null }));
  for (const c of checks) {
    const i = Math.floor((c.at - start) / STEP_MS);
    if (i < 0 || i >= STATUS_BARS) continue;
    // A slot with a failed check stays failed.
    slots[i].ok = slots[i].ok === false ? false : c.ok;
  }
  return slots;
}

let cached: { at: number; value: StatusResponse } | null = null;
const CACHE_MS = 30_000;

export async function statusNow(now = Date.now()): Promise<StatusResponse> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const since30 = now - 30 * 24 * 3600_000;
  const since24 = now - 24 * 3600_000;
  const sinceBars = now - STATUS_BARS * STEP_MS;
  const [agg, recent] = await Promise.all([
    db().execute({
      sql: "SELECT service, COUNT(*) AS n, SUM(ok) AS up, SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS n24, SUM(CASE WHEN at >= ? THEN ok ELSE 0 END) AS up24 FROM uptime_checks WHERE at >= ? GROUP BY service",
      args: [since24, since24, since30],
    }),
    db().execute({ sql: "SELECT service, at, ok FROM uptime_checks WHERE at >= ? ORDER BY at", args: [sinceBars] }),
  ]);
  const pct = (up: number, n: number) => (n ? Math.round((up / n) * 10000) / 100 : null);
  let checkedAt: number | null = null;
  const services: ServiceStatus[] = SERVICES.map((s) => {
    const a = agg.rows.find((r) => r.service === s.key);
    const mine = recent.rows.filter((r) => r.service === s.key).map((r) => ({ at: Number(r.at), ok: Number(r.ok) === 1 }));
    const last = mine[mine.length - 1];
    if (last && (checkedAt === null || last.at > checkedAt)) checkedAt = last.at;
    return {
      ...s,
      up: last ? last.ok : null,
      uptime24h: a ? pct(Number(a.up24), Number(a.n24)) : null,
      uptime30d: a ? pct(Number(a.up), Number(a.n)) : null,
      bars: barsOf(mine, now),
    };
  });
  const value: StatusResponse = { overall: overallOf(services), checkedAt, everyMinutes: CHECK_EVERY_MIN, services };
  cached = { at: now, value };
  return value;
}

/** Starts the checks: one soon after boot, then every CHECK_EVERY_MIN minutes; prunes old rows every 6 hours. */
export function startUptimeChecks(log: (line: string) => void): void {
  if (!env.uptimeChecks) return;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    const at = Date.now();
    runChecks({ now: at })
      .then((rows) => recordChecks(rows, at))
      .catch((e) => log(`uptime: check failed: ${(e as Error)?.message ?? e}`))
      .finally(() => { running = false; });
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, STEP_MS).unref();
  setInterval(() => { pruneChecks().catch((e) => log(`uptime: prune failed: ${(e as Error).message}`)); }, 6 * 3600_000).unref();
}
