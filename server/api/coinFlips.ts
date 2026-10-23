// The coin-flip radar (src/shared/coinFlips.ts): every event that's on today at its venue, every match
// on today's schedule there, and the ones whose call sits between 45% and 55%. No new modelling: each
// call is the one the match page shows (matchViews: the live call logged before the match, else the
// call from today's ratings), and a decided match keeps only a call logged before it was played.
//
// Gathered by a job (refreshCoinFlips) after each sync's live calls are logged, after each live result,
// and every few minutes in the server (a venue's date turns over at its own midnight), then stored in
// kv so the server answers from it whichever process gathered it. The Events page reads it through
// coinFlips(), which drops rows whose venue has since moved to another day and gathers afresh when the
// stored radar is missing or old.
import { createHash } from "node:crypto";
import { all, kvGet, run } from "../db.js";
import { CURRENT_SEASON, isLegacy } from "../data/seasons.js";
import { localDate } from "../../src/shared/eventDay.js";
import {
  COIN_FLIP_BAND, MAX_DECIDED, MAX_UPCOMING, inBand, matchDay, stillToday,
  type CoinFlipRadar, type CoinFlipRow, type CoinFlipTally,
} from "../../src/shared/coinFlips.js";
import type { MatchView } from "../../src/shared/api.js";
import { matchViews } from "./matches.js";
import { isEventDay } from "../data/live.js";
import { pool } from "../sync.js";

export const KV_KEY = "radar:coin-flips";
/** A stored radar older than this is gathered again on read (the job normally keeps it within minutes). */
export const STALE_MS = 15 * 60_000;
/** The server's own refresh, between syncs: catches each venue's midnight and matches the clock moves past. */
export const REFRESH_EVERY_MS = 5 * 60_000;

interface EventRow { code: string; name: string; city: string | null; state: string | null; country: string | null; timezone: string | null; start: string | null; end: string | null; type: string | null }

const placeOf = (e: EventRow) => {
  const region = e.country && !["USA", "US", "United States"].includes(e.country) ? e.country : e.state;
  return [e.city, region].filter(Boolean).join(", ") || null;
};

/** One event's coin flips from its match views (pure: the rules, tested on their own). */
export function eventCoinFlips(e: EventRow, matches: MatchView[], now: number): { rows: CoinFlipRow[]; calls: number; thin: number; scheduled: boolean; day: string | null } {
  const zone = e.timezone;
  const today = zone ? localDate(now, zone) : null;
  const out = { rows: [] as CoinFlipRow[], calls: 0, thin: 0, scheduled: false, day: today };
  // Without a known zone "today at the venue" can't be told: the event is left out rather than guessed.
  if (!zone || !today) return out;
  for (const m of matches) {
    if (matchDay(m.time, m.startsAt, zone) !== today) continue;
    out.scheduled = true;
    const p = m.prediction;
    if (!p) continue;
    // A decided match keeps only a call made before it (the logged live call), never one made after.
    if (m.played && p.kind !== "live") continue;
    if (!m.played && p.kind !== "live" && p.kind !== "now") continue;
    out.calls++;
    if (!inBand(p.pRed)) continue;
    if (p.tier === "provisional") { out.thin++; continue; }
    // The robots the call is for: on the field (a listed substitute in a playoff alliance isn't in it).
    const onField = (s: "red" | "blue") => m[s].teams.filter((t) => t.onField).map((t) => t.number);
    out.rows.push({
      season: m.season, code: m.code, key: m.key, label: m.label, eventName: e.name, place: placeOf(e), timezone: zone, day: today,
      time: m.time, startsAt: m.startsAt, red: onField("red"), blue: onField("blue"),
      pRed: p.pRed, tier: p.tier, kind: p.kind as "live" | "now", played: m.played,
      result: m.played && m.red.score && m.blue.score ? { red: m.red.score.total, blue: m.blue.score.total } : null,
    });
  }
  return out;
}

const at = (r: CoinFlipRow) => (r.startsAt ? Date.parse(r.startsAt) : NaN);
const soonest = (a: CoinFlipRow, b: CoinFlipRow) => (Number.isFinite(at(a)) ? at(a) : Infinity) - (Number.isFinite(at(b)) ? at(b) : Infinity)
  || Math.abs(a.pRed - 0.5) - Math.abs(b.pRed - 0.5) || a.code.localeCompare(b.code) || a.key.localeCompare(b.key);

/** Order and trim gathered rows: still to play soonest first, decided ones (with a result) latest first. */
export function arrange(rows: CoinFlipRow[]): Pick<CoinFlipRadar, "upcoming" | "decided"> {
  const upcoming = rows.filter((r) => !r.played).sort(soonest).slice(0, MAX_UPCOMING);
  const decided = rows.filter((r) => r.played && r.result).sort((a, b) => soonest(b, a)).slice(0, MAX_DECIDED);
  return { upcoming, decided };
}

/** Gather today's radar from the database (read-only). */
export async function buildCoinFlips(now = Date.now(), season = CURRENT_SEASON): Promise<CoinFlipRadar> {
  const empty: CoinFlipRadar = { generatedAt: new Date(now).toISOString(), band: { ...COIN_FLIP_BAND }, events: 0, calls: 0, thin: 0, tallies: [], upcoming: [], decided: [] };
  if (isLegacy(season)) return empty;
  const day = (n: number) => new Date(now + n * 864e5).toISOString().slice(0, 10);
  // Cheap pre-filter in SQL (±1 day covers every zone); the exact check is each venue's own date.
  const events = (await all<EventRow>(
    "SELECT code, name, city, state, country, timezone, start, end, type FROM events WHERE season = ? AND start <= ? AND COALESCE(end, start) >= ?",
    [season, day(1), day(-1)],
  )).filter((e) => isEventDay(e, now));
  const rows: CoinFlipRow[] = [];
  const tallies: CoinFlipTally[] = [];
  await pool(events, 3, async (e) => {
    const r = eventCoinFlips(e, await matchViews({ season, code: e.code }, { predictUnplayed: true }), now);
    if (r.scheduled && e.timezone && r.day) tallies.push({ timezone: e.timezone, day: r.day, calls: r.calls, thin: r.thin });
    rows.push(...r.rows);
  });
  return totals({ ...empty, tallies, ...arrange(rows) });
}

/**
 * Store a gathered radar unless a newer one is already stored. Gathers overlap (the server's timer, a live
 * result, the stats job in another process, a read's fallback): one that started earlier read older data, so
 * if it finishes last it must not put finished matches back on the list. generatedAt is when the gather
 * started; the check and the write are one statement, so it holds across processes. True when stored.
 */
export async function storeRadar(r: CoinFlipRadar): Promise<boolean> {
  const n = await run(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
     WHERE COALESCE(json_extract(kv.value, '$.generatedAt'), '') < json_extract(excluded.value, '$.generatedAt')`,
    [KV_KEY, JSON.stringify(r), new Date().toISOString()],
  );
  return n > 0;
}

/** The job: gather and store. Never throws (a failure leaves the stored radar as it was). Null when nothing
 *  was stored (a failure, or a newer radar already stored). */
export async function refreshCoinFlips(log: (m: string) => void = () => {}, now = Date.now()): Promise<CoinFlipRadar | null> {
  try {
    const r = await buildCoinFlips(now);
    if (!(await storeRadar(r))) return null;
    memo = { at: Date.now(), value: Promise.resolve(r) };
    if (r.upcoming.length || r.decided.length) log(`coin flips: ${r.upcoming.length} to play, ${r.decided.length} decided, across ${r.events} events`);
    return r;
  } catch (e) {
    log(`coin flips failed: ${(e as Error).message}`);
    return null;
  }
}

/** Read paths share one gathering at a time when the stored radar is missing or old. */
let memo: { at: number; value: Promise<CoinFlipRadar> } | null = null;
/** Tests: forget the in-memory radar. */
export function resetCoinFlips() { memo = null; }

/** The events, calls and thin-data counts, from the tallies. */
function totals(r: CoinFlipRadar): CoinFlipRadar {
  const t = r.tallies ?? [];
  return { ...r, events: t.length, calls: t.reduce((s, x) => s + x.calls, 0), thin: t.reduce((s, x) => s + x.thin, 0) };
}

/** Only what's still on today at its venue, rows and counts alike (a stored radar outlives a venue's midnight
 *  until the next refresh: yesterday's calls must never be described as today's). */
export function current(r: CoinFlipRadar, now = Date.now()): CoinFlipRadar {
  return totals({
    ...r, tallies: (r.tallies ?? []).filter((x) => stillToday(x, now)),
    upcoming: r.upcoming.filter((x) => stillToday(x, now)), decided: r.decided.filter((x) => stillToday(x, now)),
  });
}

/** A read's own gathering (nothing fresh stored): stored like the job's, so later reads in any process reuse
 *  it; when a newer radar was stored meanwhile (by the job, maybe in another process), that one is answered
 *  instead. A failed write never fails the read. */
export async function gatherForRead(now = Date.now()): Promise<CoinFlipRadar> {
  const r = await buildCoinFlips(now);
  if (await storeRadar(r).catch(() => true)) return r;
  return (await kvGet<CoinFlipRadar>(KV_KEY).catch(() => null)) ?? r;
}

/**
 * The ETag of an answer: what it's built from, the stored radar (its generatedAt) and which venue dates are
 * still today (current() keeps rows by them), so it moves when either does, a venue's midnight included.
 */
export function radarEtag(r: CoinFlipRadar): string {
  const days = [...new Set([...(r.tallies ?? []), ...r.upcoming, ...r.decided].map((x) => `${x.timezone}:${x.day}`))].sort();
  return `"cf-${createHash("sha1").update(`${r.generatedAt}|${days.join(",")}`).digest("base64url").slice(0, 20)}"`;
}

/** What GET /api/home/coin-flips answers. */
export async function coinFlips(now = Date.now()): Promise<CoinFlipRadar> {
  const fresh = (r: CoinFlipRadar | null): r is CoinFlipRadar => !!r && now - Date.parse(r.generatedAt) < STALE_MS;
  const stored = await kvGet<CoinFlipRadar>(KV_KEY).catch(() => null);
  if (fresh(stored)) return current(stored, now);
  if (!memo || Date.now() - memo.at >= 60_000) {
    // Stored like the job's, so later reads (in any process) reuse it for STALE_MS; a failed write never fails the read.
    const value = gatherForRead(now);
    memo = { at: Date.now(), value };
    value.catch(() => { if (memo?.value === value) memo = null; });
  }
  return current(await memo.value, now);
}
