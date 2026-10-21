// The coin-flip radar (src/shared/coinFlips.ts): every event that's on today at its venue, every match
// on today's schedule there, and the ones whose call sits between 45% and 55%. No new modelling: each
// call is the one the match page shows (matchViews: the live call logged before the match, else the
// call from today's ratings), and a decided match keeps only a call logged before it was played.
//
// Gathered by a job (refreshCoinFlips) after each sync's live calls are logged, after each live result,
// and every few minutes in the server (a venue's date turns over at its own midnight), then stored in
// kv so the server answers from it whichever process gathered it. The home page reads it through
// coinFlips(), which drops rows whose venue has since moved to another day and gathers afresh when the
// stored radar is missing or old.
import { all, kvGet, kvSet } from "../db.js";
import { CURRENT_SEASON, isLegacy } from "../data/seasons.js";
import { localDate } from "../../src/shared/eventDay.js";
import {
  COIN_FLIP_BAND, MAX_DECIDED, MAX_UPCOMING, inBand, matchDay, stillToday,
  type CoinFlipRadar, type CoinFlipRow,
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
export function eventCoinFlips(e: EventRow, matches: MatchView[], now: number): { rows: CoinFlipRow[]; calls: number; thin: number; scheduled: boolean } {
  const zone = e.timezone;
  const today = zone ? localDate(now, zone) : null;
  const out = { rows: [] as CoinFlipRow[], calls: 0, thin: 0, scheduled: false };
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
    const onField = (s: "red" | "blue") => m[s].teams.filter((t) => !m.played || t.onField).map((t) => t.number);
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
  const empty: CoinFlipRadar = { generatedAt: new Date(now).toISOString(), band: { ...COIN_FLIP_BAND }, events: 0, calls: 0, thin: 0, upcoming: [], decided: [] };
  if (isLegacy(season)) return empty;
  const day = (n: number) => new Date(now + n * 864e5).toISOString().slice(0, 10);
  // Cheap pre-filter in SQL (±1 day covers every zone); the exact check is each venue's own date.
  const events = (await all<EventRow>(
    "SELECT code, name, city, state, country, timezone, start, end, type FROM events WHERE season = ? AND start <= ? AND COALESCE(end, start) >= ?",
    [season, day(1), day(-1)],
  )).filter((e) => isEventDay(e, now));
  const rows: CoinFlipRow[] = [];
  let events_ = 0, calls = 0, thin = 0;
  await pool(events, 3, async (e) => {
    const r = eventCoinFlips(e, await matchViews({ season, code: e.code }, { predictUnplayed: true }), now);
    if (r.scheduled) events_++;
    calls += r.calls; thin += r.thin; rows.push(...r.rows);
  });
  return { ...empty, events: events_, calls, thin, ...arrange(rows) };
}

/** The job: gather and store. Never throws (a failure leaves the stored radar as it was). */
export async function refreshCoinFlips(log: (m: string) => void = () => {}, now = Date.now()): Promise<CoinFlipRadar | null> {
  try {
    const r = await buildCoinFlips(now);
    await kvSet(KV_KEY, r);
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

/** Only the rows still on today at their venue (a stored radar outlives a venue's midnight until the next refresh). */
export function current(r: CoinFlipRadar, now = Date.now()): CoinFlipRadar {
  return { ...r, upcoming: r.upcoming.filter((x) => stillToday(x, now)), decided: r.decided.filter((x) => stillToday(x, now)) };
}

/** What GET /api/home/coin-flips answers. */
export async function coinFlips(now = Date.now()): Promise<CoinFlipRadar> {
  const fresh = (r: CoinFlipRadar | null): r is CoinFlipRadar => !!r && now - Date.parse(r.generatedAt) < STALE_MS;
  const stored = await kvGet<CoinFlipRadar>(KV_KEY).catch(() => null);
  if (fresh(stored)) return current(stored, now);
  if (!memo || Date.now() - memo.at >= 60_000) {
    const value = buildCoinFlips(now);
    memo = { at: Date.now(), value };
    value.catch(() => { if (memo?.value === value) memo = null; });
  }
  return current(await memo.value, now);
}
