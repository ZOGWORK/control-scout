// The live fast lane: results on the site within about a minute of FIRST
// publishing them.
//
// The background cycle (server/data/cycle.ts) syncs the whole season and
// recomputes every stat: right for schedules, awards and the ledger, too heavy
// to run every minute (a full season's stats + backtest is ~20 s of CPU at the
// end of a season). This lane runs in the server process every LIVE_SYNC_SECONDS
// (default 60) and touches only events that are on today in their own time
// zone. Per event and tick it asks FIRST three conditional questions (results,
// qual schedule, playoff schedule — 304 when nothing moved); only when one of
// them changed, or every few minutes for rankings/alliances/awards (no
// Last-Modified there), does it fetch the event in full. Then the minimum
// follow-up: that event's OPR and its teams' season rows, a new data version
// (pages and ratings pick it up), results attached to logged live calls, and
// pre-match calls logged for newly scheduled matches.
//
// It shares the writer lease (lock.ts) with the cycle: when the cycle holds it,
// a tick is skipped (the cycle is syncing these events anyway).
import { all, get, kvSet, run } from "../db.js";
import { hasFirst } from "../env.js";
import { NO_MATCH_TYPES, pool, syncEvent } from "../sync.js";
import { firstProbe } from "../sources/first.js";
import { refreshEventStats, logLivePredictions, scoreLivePredictions } from "../stats/job.js";
import type { EventRow } from "./bundle.js";
import { CURRENT_SEASON } from "./seasons.js";
import { LockBusy, withDataLock } from "./lock.js";

type Log = (m: string) => void;

/** Seconds between fast-lane ticks: LIVE_SYNC_SECONDS (default 60, at least 20). */
export function liveSyncSeconds(): number {
  const v = Number(process.env.LIVE_SYNC_SECONDS);
  return Number.isFinite(v) && v > 0 ? Math.max(20, Math.round(v)) : 60;
}

/** A full fetch at least this often while live: rankings, alliances and awards have no change marker. */
export const FULL_EVERY_MS = 5 * 60_000;
/** One real "Refresh results" per event this often, however many people click. */
export const MANUAL_REFRESH_MS = 20_000;

// ---------------------------------------------------------------------------
// Which events are live
// ---------------------------------------------------------------------------

/** The calendar date (YYYY-MM-DD) at `now` in an IANA zone; null for an unknown zone. */
export function localDate(now: number, zone: string): string | null {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  } catch { return null; }
}

export interface EventDates { type: string | null; start: string | null; end: string | null; timezone: string | null }

/**
 * Is today (in the event's own time zone) one of the event's days? An event
 * without a known zone counts while its dates are today anywhere on Earth
 * (UTC−12 … UTC+14). Event types that never have matches never count.
 */
export function isEventDay(e: EventDates, now = Date.now()): boolean {
  if (!e.start || (e.type && NO_MATCH_TYPES.has(e.type))) return false;
  const end = e.end ?? e.start;
  const d = e.timezone ? localDate(now, e.timezone) : null;
  if (d) return e.start <= d && d <= end;
  const earliest = new Date(now - 12 * 3600_000).toISOString().slice(0, 10);
  const latest = new Date(now + 14 * 3600_000).toISOString().slice(0, 10);
  return e.start <= latest && end >= earliest;
}

export interface LiveEvent extends EventRow { total: number; played: number; awards: number }

/**
 * Events the fast lane polls now: on today in their zone, and not over (an
 * event is over once every scheduled match has a result and its awards are
 * out; with all quals played but no awards, playoffs may still be coming).
 */
export async function liveEvents(now = Date.now(), season = CURRENT_SEASON): Promise<LiveEvent[]> {
  const day = (n: number) => new Date(now + n * 864e5).toISOString().slice(0, 10);
  // Cheap pre-filter in SQL (±1 day covers every zone); the exact check is per zone below.
  const rows = await all<any>(
    `SELECT e.*,
       (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code) total,
       (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1) played,
       (SELECT COUNT(*) FROM awards a WHERE a.season = e.season AND a.code = e.code) awards
     FROM events e WHERE e.season = ? AND e.start <= ? AND COALESCE(e.end, e.start) >= ?`,
    [season, day(1), day(-1)],
  );
  return rows
    .filter((r) => isEventDay(r, now))
    .filter((r) => !(Number(r.total) > 0 && Number(r.played) >= Number(r.total) && Number(r.awards) > 0))
    .map((r) => ({ ...rowToEvent(r), total: Number(r.total), played: Number(r.played), awards: Number(r.awards) }));
}

function rowToEvent(r: any): EventRow {
  return {
    season: Number(r.season), code: r.code, name: r.name, type: r.type, divisionCode: r.division_code, region: r.region, league: r.league, venue: r.venue,
    city: r.city, state: r.state, country: r.country, start: r.start, end: r.end, timezone: r.timezone, remote: !!r.remote, hybrid: !!r.hybrid,
    website: r.website, livestream: r.livestream, source: r.source, upstreamUpdated: r.upstream_updated,
  };
}

// ---------------------------------------------------------------------------
// Refreshing events
// ---------------------------------------------------------------------------

/** Per event: the change markers FIRST last gave us, and when we last fetched it in full. */
interface ProbeState { marks: Map<string, string>; fullAt: number }
const probes = new Map<string, ProbeState>();
const keyOf = (e: { season: number; code: string }) => `${e.season}:${e.code}`;

/** Change marker for one endpoint: Last-Modified when FIRST sends it, else the body itself (short "nothing yet" lists). */
async function probeEvent(e: EventRow, st: ProbeState): Promise<boolean> {
  const c = encodeURIComponent(e.code);
  const paths = [`/${e.season}/matches/${c}`, `/${e.season}/schedule/${c}?tournamentLevel=qual`, `/${e.season}/schedule/${c}?tournamentLevel=playoff`];
  const seen = await Promise.all(paths.map(async (p) => {
    const prev = st.marks.get(p) ?? null;
    const since = prev?.startsWith("lm:") ? prev.slice(3) : null;
    const r = await firstProbe(p, since);
    if (!r.changed) return false;
    const mark = r.lastModified ? `lm:${r.lastModified}` : `body:${r.body.length}:${hashText(r.body)}`;
    st.marks.set(p, mark);
    return mark !== prev;
  }));
  return seen.some(Boolean);
}

function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export interface RefreshReport { checked: string[]; fetched: string[]; failed: { code: string; error: string }[]; logged: number; scored: number }

/** Test seams: the network side of a refresh. */
export const liveIo = {
  canProbe: () => hasFirst(),
  probe: probeEvent,
  fetch: (e: EventRow, log: Log) => syncEvent(e, log),
};

/**
 * Check these events against FIRST and apply whatever changed. Caller holds
 * the writer lease. `minFullMs`: fetch in full when the last full fetch is at
 * least this old even if nothing changed (0 = always).
 */
export async function refreshEvents(events: EventRow[], o: { minFullMs?: number; log?: Log; now?: () => number } = {}): Promise<RefreshReport> {
  const log = o.log ?? (() => {});
  const now = o.now ?? Date.now;
  const minFull = o.minFullMs ?? FULL_EVERY_MS;
  const report: RefreshReport = { checked: [], fetched: [], failed: [], logged: 0, scored: 0 };
  await pool(events, 3, async (e) => {
    const k = keyOf(e);
    let st = probes.get(k);
    if (!st) { st = { marks: new Map(), fullAt: 0 }; probes.set(k, st); }
    // The markers only move on once the change is stored: a failed fetch rolls them back, so the next
    // tick sees the change again (not a 304 for results we never saved).
    const before = new Map(st.marks);
    try {
      // Without FIRST credentials there is nothing to probe: FTC Scout (the fallback) gets the slow rate only.
      // A failed probe doesn't block the rest: the full fetch still runs when it's due.
      let changed = false, probed = false, probeError: unknown = null;
      if (liveIo.canProbe()) {
        try { changed = await liveIo.probe(e, st); probed = true; }
        catch (err) { st.marks = new Map(before); probeError = err; }
      }
      let fetched = false;
      if (changed || now() - st.fullAt >= minFull) {
        await liveIo.fetch(e, log);
        st.fullAt = now();
        fetched = true;
        report.fetched.push(e.code);
      }
      if (!probed && !fetched) { if (probeError) throw probeError; return; } // nothing was asked: "updated" stays put
      await run("UPDATE events SET live_checked_at = ? WHERE season = ? AND code = ?", [new Date(now()).toISOString(), e.season, e.code]);
      report.checked.push(e.code);
    } catch (err) {
      st.marks = before;
      report.failed.push({ code: e.code, error: (err as Error).message.slice(0, 200) });
    }
  });
  if (report.fetched.length) {
    // New data version first: the season rows read ratings, and the live calls must use the newest ones.
    await kvSet("data:version", new Date(now()).toISOString());
    const bySeason = new Map<number, string[]>();
    for (const e of events) if (report.fetched.includes(e.code)) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e.code]);
    for (const [s, codes] of bySeason) await refreshEventStats(s, codes, log);
    report.scored = await scoreLivePredictions(log);
    report.logged = await logLivePredictions(log);
  }
  return report;
}

/** Forget probe state (tests). */
export function resetLiveState(): void { probes.clear(); lastManual.clear(); inflight.clear(); }

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

let ticking: Promise<RefreshReport | null> | null = null;

/** One fast-lane pass: live events only, skipped while another writer holds the lease. */
export async function liveTick(log: Log = () => {}, now = Date.now()): Promise<RefreshReport | null> {
  if (ticking) return ticking;
  ticking = (async () => {
    const events = await liveEvents(now);
    if (!events.length) return null;
    try {
      const r = await withDataLock("live", () => refreshEvents(events, { log }), { ttlMs: 120_000 });
      if (r.fetched.length || r.failed.length) {
        log(`live: ${r.checked.length}/${events.length} events checked, ${r.fetched.length} fetched${r.failed.length ? `, ${r.failed.length} failed (${r.failed.map((f) => f.code).join(", ")})` : ""}${r.logged ? `, ${r.logged} live calls logged` : ""}`);
      }
      return r;
    } catch (e) {
      if (e instanceof LockBusy) return null; // the cycle is writing (and syncing these events too)
      throw e;
    }
  })();
  try { return await ticking; } finally { ticking = null; }
}

/** Is the fast lane running on this server (LIVE_SYNC=off or CS_NO_SCHEDULER turn it off)? */
export const liveSyncOn = () => !(process.env.LIVE_SYNC === "off" || process.env.CS_NO_SCHEDULER);

/** Start the fast lane (server process). Off with LIVE_SYNC=off. */
export function startLiveSync(log: Log): void {
  if (!liveSyncOn()) return;
  const every = liveSyncSeconds() * 1000;
  log(`live sync: every ${every / 1000} s for events on today`);
  setInterval(() => { liveTick(log).catch((e) => log(`live sync failed: ${(e as Error).message}`)); }, every).unref();
}

// ---------------------------------------------------------------------------
// "Refresh results" (manual)
// ---------------------------------------------------------------------------

const lastManual = new Map<string, number>();
const inflight = new Map<string, Promise<ManualOutcome>>();

export type ManualOutcome =
  | { status: "refreshed"; fetched: boolean }
  /** Someone refreshed this event under MANUAL_REFRESH_MS ago: their result is the latest. */
  | { status: "recent" }
  /** The background cycle is writing right now; it is syncing this event too. */
  | { status: "busy" }
  | { status: "failed"; error: string }
  | { status: "not-live" }
  | { status: "not-found" };

/**
 * A visitor asked for the latest results. At most one real refresh per event
 * every MANUAL_REFRESH_MS (everyone else shares it); only for events on today.
 * A refresh probes FIRST and fetches in full when something changed or the
 * last full fetch is over a minute old.
 */
export async function manualRefresh(season: number, code: string, o: { log?: Log; now?: number; waitMs?: number } = {}): Promise<ManualOutcome> {
  const now = o.now ?? Date.now();
  const row = await get<any>("SELECT * FROM events WHERE season = ? AND code = ?", [season, code]);
  if (!row) return { status: "not-found" };
  if (!isEventDay(row, now)) return { status: "not-live" };
  const k = `${season}:${code}`;
  const running = inflight.get(k);
  if (running) return running;
  if (now - (lastManual.get(k) ?? -Infinity) < MANUAL_REFRESH_MS) return { status: "recent" };
  lastManual.set(k, now);
  const p = (async (): Promise<ManualOutcome> => {
    try {
      // A fast-lane tick takes seconds: wait it out. The cycle can take minutes: don't.
      const r = await withDataLock("manual", () => refreshEvents([rowToEvent(row)], { log: o.log, minFullMs: 60_000 }), { ttlMs: 120_000, waitMs: o.waitMs ?? 10_000, pollMs: 500 });
      if (r.failed.length) return { status: "failed", error: r.failed[0].error };
      return { status: "refreshed", fetched: r.fetched.length > 0 };
    } catch (e) {
      if (e instanceof LockBusy) { lastManual.delete(k); return { status: "busy" }; }
      return { status: "failed", error: (e as Error).message.slice(0, 200) };
    }
  })();
  inflight.set(k, p);
  try { return await p; } finally { inflight.delete(k); }
}
