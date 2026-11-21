// The official-video auto-watcher (docs/official-videos.md): every 6 hours, each watched official channel's newest
// uploads are read with the YouTube Data API (the channel's own uploads list, then the videos' facts; never a search)
// and each new video is matched to Scout's events by the checked list's rules (./officialMatch.ts). A recording that
// passes every check, fits exactly one event and lands on a day the event has no video for is added; everything else
// waits in the owner's review queue (Owner › Official videos), and what isn't a competition stream is set aside there
// too. Each video is read once: added, rejected or set-aside videos are never proposed again. Quota use, each run and
// its errors are logged in official_watch_runs.
import { all, db, get, run } from "../db.js";
import { env } from "../env.js";
import { recordAudit } from "../portal/audit.js";
import { OFFICIAL_CHANNELS } from "../data/officialChannels.js";
import { eventVideosByDay, forgetOfficial } from "./officialVideos.js";
import { isoDuration } from "./youtube.js";
import { STARTUP_CYCLE_MS } from "../warm.js";
import { EVENT_FIRST_DAY, EVENT_LAST_DAY, EVENT_PLAYED_DAYS, playedDays } from "./eventDays.js";
import { LockBusy, isBusy, lockHolder, withDataLock } from "../data/lock.js";
import { bestGuess, matchVideo, parseRule, videoWindow, type ChannelRule, type Verdict, type WatchEvent, type WatchVideo } from "./officialMatch.js";

export const WATCH_EVERY_MS = 6 * 3600_000;
/** The half-hourly check's first one after boot: 2.5 minutes before the startup sync (server/warm.ts STARTUP_CYCLE_MS),
 * so every check lands midway between the sync's 5-minute ticks, never as an event day's 15-minute sync starts and
 * takes the writer lease. Early, because every deploy restarts the server and starts the wait over: on 17 Nov, with a
 * deploy every 4 to 27 minutes, the first check (then 17.5 minutes after boot) came after no run for six hours, and
 * a run due at 10:27 never started. At 7.5 minutes, an overdue run starts after nearly every deploy. */
export const WATCH_FIRST_MS = STARTUP_CYCLE_MS - 2.5 * 60_000;
export const WATCH_CHECK_MS = 30 * 60_000;
const RUN_STALE_MS = 25 * 60_000;
const NEVER_FINISHED = "database busy or a restart: the run never finished, tried again within 30 minutes";
const BUSY_STOP = "database busy (the data sync was writing): stopped, tried again within 30 minutes";
/** The last run that counts for the 6-hour wait: one that finished, and wasn't cut short by a busy database (those are
 * tried again on the next half-hourly check, like a run that never started). */
const LAST_RUN = `SELECT started_at FROM official_watch_runs WHERE finished_at IS NOT NULL AND COALESCE(error, '') NOT LIKE 'database busy%' ORDER BY id DESC LIMIT 1`;
/** Units one run may use at most (YouTube gives 10,000 a day, shared with the timing backfill). */
const MAX_UNITS = 1500;
/** Pages of a channel's uploads read in one run (50 a page, newest first): enough for a season's uploads of the
 * busiest channel (New England FIRST posts ~200 by November), so none falls off the end unread. */
const MAX_PAGES = 10;
/** How far back a channel's uploads are read, however recently it started being watched. A stream is listed when it's
 * scheduled, often a week or more before it airs: from the date it was watched alone, every stream scheduled before
 * that would be skipped for good once it aired (FTC Iowa's league meets, Pennsylvania's championship). */
export const LOOKBACK_MS = 180 * 864e5;
const API = "https://www.googleapis.com/youtube/v3";
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ChannelRow { channelId: string; title: string; region: string; words: string | null; titlePattern: string | null; watchFrom: string; checkedAt: string | null; lastError: string | null; removedAt: string | null }
const channelOf = (r: any): ChannelRow => ({
  channelId: String(r.channel_id), title: String(r.title), region: String(r.region), words: r.words ?? null, titlePattern: r.title_pattern ?? null,
  watchFrom: String(r.watch_from), checkedAt: r.checked_at ?? null, lastError: r.last_error ?? null, removedAt: r.removed_at ?? null,
});

let channelsSeeded = false;
/** The next seed call runs again, as after a restart. */
export const resetChannelsSeeded = () => { channelsSeeded = false; };
/** The shipped watchlist (server/data/officialChannels.ts), each channel once: a removed one is never written back. */
export async function seedOfficialChannels(now = Date.now(), again = false): Promise<number> {
  if (channelsSeeded && !again) return 0;
  const at = new Date(now).toISOString();
  const rows = await all<{ channel_id: string; title_pattern: string | null }>("SELECT channel_id, title_pattern FROM official_channels");
  const known = new Set(rows.map((r) => String(r.channel_id)));
  const current = new Map(rows.map((r) => [String(r.channel_id), r.title_pattern ?? null]));
  const todo = OFFICIAL_CHANNELS.filter((c) => !known.has(c.channelId));
  // A seeded channel's title pattern follows the seed's current one (a new, narrowed or dropped pattern), as long as the
  // row is still the seed's: watched, same region, never saved or removed by the owner (added_by, or an
  // officialChannel.* audit entry). The write itself decides, so an owner save landing after the read above still stands.
  // Only rows whose pattern differs are written (none, once in step), so a start with nothing to change writes nothing.
  const patterns = OFFICIAL_CHANNELS.filter((c) => known.has(c.channelId) && current.get(c.channelId) !== (c.titlePattern ?? null));
  const writes = [
    ...todo.map((c) => ({
      sql: "INSERT INTO official_channels (channel_id, title, region, words, title_pattern, watch_from, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(channel_id) DO NOTHING",
      args: [c.channelId, c.title, c.region, c.words ?? null, c.titlePattern ?? null, at, at],
    })),
    ...patterns.map((c) => ({
      sql: `UPDATE official_channels SET title_pattern = ? WHERE channel_id = ? AND region = ? AND title_pattern IS NOT ? AND removed_at IS NULL AND added_by IS NULL
              AND NOT EXISTS (SELECT 1 FROM owner_audit a WHERE a.action LIKE 'officialChannel.%' AND instr(a.details, official_channels.channel_id) > 0)`,
      args: [c.titlePattern ?? null, c.channelId, c.region, c.titlePattern ?? null],
    })),
  ];
  if (writes.length) await db().batch(writes, "write");
  channelsSeeded = true;
  return todo.length;
}

class QuotaError extends Error {}
type Fetch = typeof fetch;
/** One API call: its answer, or an error naming YouTube's reason (the key never appears in it). */
async function api(path: string, params: Record<string, string>, key: string, fetchImpl: Fetch): Promise<any> {
  const res = await fetchImpl(`${API}/${path}?${new URLSearchParams({ ...params, key })}`, { signal: AbortSignal.timeout(20_000) });
  if (res.ok) return res.json();
  let reason = "";
  try { reason = String((await res.json())?.error?.errors?.[0]?.reason ?? ""); } catch { /* no body */ }
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(reason)) throw new QuotaError(`YouTube quota used up (${reason})`);
  throw new Error(`YouTube ${path} answered ${res.status}${reason ? ` (${reason})` : ""}`);
}

/** The events on any day from lo to hi (YYYY-MM-DD): their listed days and the days they played (eventDays.ts). */
export async function eventsBetween(lo: string, hi: string): Promise<WatchEvent[]> {
  const rows = await all<any>(
    `SELECT season, code, name, type, city, state, country, start, end, timezone, division_code, remote, parent, played_days FROM (SELECT e.season, e.code, e.name, e.type, e.city, e.state, e.country, ${EVENT_FIRST_DAY} AS start, ${EVENT_LAST_DAY} AS end, e.timezone, e.division_code, e.remote, ${EVENT_PLAYED_DAYS} AS played_days,
            EXISTS (SELECT 1 FROM events c WHERE c.season = e.season AND c.division_code = e.code AND c.code != e.code) AS parent
     FROM events e WHERE e.start IS NOT NULL) WHERE start <= ? AND end >= ?`, [hi, lo]);
  return rows.map((r) => ({
    season: Number(r.season), code: String(r.code), name: String(r.name ?? ""), type: String(r.type ?? ""), city: r.city ?? null, state: r.state ?? null,
    country: r.country ?? null, start: String(r.start).slice(0, 10), end: r.end ? String(r.end).slice(0, 10) : null, timezone: r.timezone ?? null,
    divisionCode: r.division_code ?? null, parent: !!Number(r.parent), remote: !!Number(r.remote), playedDays: playedDays(r.played_days),
  }));
}

/** A watcher's verdict: the match's, or a duplicate of a video an event already plays (logged, never added or queued). */
export type WatchVerdict = (Verdict | { kind: "duplicate"; why: string; event?: Pick<WatchEvent, "season" | "code">; day?: string; part?: string | null })
  & { /** For one in review or set aside whose verdict names no event: the event it most likely is, and what that rests on. */ guess?: { event?: Pick<WatchEvent, "season" | "code">; day?: string; why: string } };

/** A recording that just joined an event: by the watcher (every check passed) or by the owner's approval. */
export interface RecordingAdded { season: number; code: string; day: string | null; part: string | null; videoId: string; by: "watcher" | "owner" }
type AfterAdd = (added: RecordingAdded[]) => unknown;
const afterAdd = new Set<AfterAdd>();
/** A hook for what must follow a new recording. Nothing registers on it today: clip coverage is checked by the
 * 5-minute recordings pass once the video's facts are read. Called once per watcher run with everything it added,
 * and once per owner approval; a failing listener is logged, never undoes the add. Returns the unsubscribe. */
export function onRecordingAdded(fn: AfterAdd): () => void {
  afterAdd.add(fn);
  return () => { afterAdd.delete(fn); };
}
async function recordingsAdded(added: RecordingAdded[], log: (s: string) => void): Promise<void> {
  if (!added.length) return;
  for (const fn of afterAdd) {
    try { await fn(added); } catch (e) { log(`official videos: the check after ${added.map((a) => `${a.season} ${a.code}`).join(", ")} was added failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`); }
  }
}

/** An "add" checked against what the event already plays: the same video or day and part is a duplicate; another
 *  video of a day it already plays, unless both name their parts, or one whose day isn't known yet, sends it to review. */
export async function settle(v: Verdict & { kind: "add" }): Promise<WatchVerdict> {
  // A video YouTube no longer plays (deleted or made private: a stream re-uploaded under a new id) holds no day.
  const has = (await eventVideosByDay(v.event.season, v.event.code)).filter((h) => !h.gone);
  const at = { event: v.event, day: v.day, part: v.part };
  const same = has.find((h) => h.day === v.day && (h.part ?? null) === (v.part ?? null));
  if (same) return { kind: "duplicate", why: `duplicate: ${v.event.code} already plays ${same.videoId} for ${v.day}${v.part ? ` (${v.part})` : ""}`, ...at };
  // A second video of a day the event already plays is kept only when both name their parts ("Matches" and
  // "Awards"): a full day's stream beside that day's "matches only" one would play the same matches twice.
  const sameDay = has.find((h) => h.day === v.day && (v.part == null || h.part == null));
  if (sameDay) return { kind: "review", why: `${v.event.code} already plays ${sameDay.videoId} for ${v.day}${sameDay.part ? ` (${sameDay.part})` : ""}: a second video of that day must name its part`, ...at };
  const unknown = has.find((h) => !h.timed);
  if (unknown) return { kind: "review", why: `${v.event.code} plays ${unknown.videoId}, whose day isn't known yet`, ...at };
  return v;
}

let busy = false;
export interface WatchRun { units: number; channels: number; seen: number; added: number; queued: number; duplicates: number; error: string | null }

/**
 * One pass over the watchlist. Without YOUTUBE_API_KEY nothing is read (the owner panel says so). Stops when the run's
 * units are spent or YouTube says the day's quota is.
 */
export async function runOfficialWatch(log: (s: string) => void, opts: { apiKey?: string | null; fetchImpl?: Fetch; now?: () => number; maxUnits?: number; lockWaitMs?: number; scheduled?: boolean } = {}): Promise<WatchRun | null> {
  const key = opts.apiKey === undefined ? env.youtubeApiKey : opts.apiKey;
  if (!key || busy) return null;
  // Reserved before any await: a scheduled check and Run now never both start.
  busy = true;
  const now = opts.now ?? Date.now;
  // Every write of the run under the shared writer lease (server/data/lock.ts): the data sync holds it through long
  // write transactions, which a write here would otherwise wait out and fail on. YouTube's reads stay outside it.
  const locked = <T>(fn: () => Promise<T>) => withDataLock("official videos watcher", fn, { ttlMs: 60_000, waitMs: opts.lockWaitMs ?? 3 * 60_000, pollMs: 1000 });
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxUnits = opts.maxUnits ?? MAX_UNITS;
  const out: WatchRun = { units: 0, channels: 0, seen: 0, added: 0, queued: 0, duplicates: 0, error: null };
  const added: RecordingAdded[] = [];
  // A failed start (a busy database) must not leave the watcher latched off for the rest of the process.
  let runId = 0;
  // The run's claim, under the lease, so it holds across processes too. Not while another run is going: one unfinished
  // that started, or wrote a channel's checked_at (every channel ends with one), in the last 25 minutes; past that it
  // died (a restart), and is closed here as never finished, which doesn't count toward the 6-hour wait. For a scheduled
  // check, also not within 6 hours of the last run that counts. The sync holding the lease now: skip this run (no row,
  // nothing read); the next check tries again.
  const at = now();
  const stale = new Date(at - RUN_STALE_MS).toISOString();
  try {
    runId = await locked(async () => {
      const id = Number((await get<{ id: number }>(
        `INSERT INTO official_watch_runs (started_at) SELECT ?1
         WHERE NOT EXISTS (SELECT 1 FROM official_watch_runs r WHERE r.finished_at IS NULL
                             AND (r.started_at > ?2 OR EXISTS (SELECT 1 FROM official_channels c WHERE c.checked_at > ?2 AND c.checked_at >= r.started_at)))
           AND (?3 IS NULL OR NOT EXISTS (SELECT 1 FROM official_watch_runs WHERE finished_at IS NOT NULL AND COALESCE(error, '') NOT LIKE 'database busy%' AND started_at > ?3))
         RETURNING id`,
        [new Date(at).toISOString(), stale, opts.scheduled ? new Date(at - WATCH_EVERY_MS).toISOString() : null]))?.id ?? 0);
      if (id) await run("UPDATE official_watch_runs SET finished_at = ?, error = ? WHERE finished_at IS NULL AND id < ?", [new Date(at).toISOString(), NEVER_FINISHED, id]);
      return id;
    });
  } catch (e) { busy = false; if (e instanceof LockBusy) return null; throw e; }
  if (!runId) { busy = false; return null; }
  try {
    await locked(() => seedOfficialChannels(now()));
    const channels = (await all<any>("SELECT channel_id, title, region, words, title_pattern, watch_from, checked_at, last_error, removed_at FROM official_channels WHERE removed_at IS NULL ORDER BY checked_at IS NOT NULL, checked_at, channel_id")).map(channelOf);
    for (const ch of channels) {
      if (out.units >= maxUnits) { out.error = `stopped at the run's ${maxUnits} units; the rest next run`; break; }
      try {
        const fresh = await newUploads(ch, key, fetchImpl, out, maxUnits, now());
        out.channels++;
        for (let i = 0; i < fresh.length; i += 50) {
          if (out.units >= maxUnits) break;
          const part = fresh.slice(i, i + 50);
          out.units++;
          const body = await api("videos", { part: "snippet,contentDetails,status,liveStreamingDetails", id: part.map((p) => p.id).join(","), maxResults: "50" }, key, fetchImpl);
          const items: any[] = Array.isArray(body?.items) ? body.items : [];
          // Each verdict reads what the one before it wrote, so deciding and writing go together, under the lease.
          await locked(async () => {
            for (const item of items) {
              const live = String(item?.snippet?.liveBroadcastContent ?? "none");
              // Live now or still to come: read again next run, once it's over.
              if (live === "live" || live === "upcoming") continue;
              const v: WatchVideo = {
                published: part.find((p) => p.id === String(item.id))?.published ?? null,
                videoId: String(item.id), title: String(item?.snippet?.title ?? "").slice(0, 300),
                start: item?.liveStreamingDetails?.actualStartTime ?? null, durationS: isoDuration(item?.contentDetails?.duration),
                privacy: String(item?.status?.privacyStatus ?? "public"), embeddable: item?.status?.embeddable !== false,
                blockedIn: Array.isArray(item?.contentDetails?.regionRestriction?.blocked) ? item.contentDetails.regionRestriction.blocked.length : 0,
              };
              if (!VIDEO_ID.test(v.videoId)) continue;
              out.seen++;
              const verdict = await decide(v, ch);
              const put = await record(v, ch, verdict, v.published ?? null, now());
              if (verdict.kind === "add") {
                // Added; or sent to review, its day taken meanwhile; or decided by the owner meanwhile (neither).
                if (put === "added") { out.added++; added.push({ season: verdict.event.season, code: verdict.event.code, day: verdict.day, part: verdict.part, videoId: v.videoId, by: "watcher" }); }
                else if (put === "queued") out.queued++;
              } else if (verdict.kind === "review") out.queued++;
              else if (verdict.kind === "duplicate") out.duplicates++;
            }
          });
        }
        await locked(() => run("UPDATE official_channels SET checked_at = ?, last_error = NULL WHERE channel_id = ?", [new Date(now()).toISOString(), ch.channelId]));
      } catch (e) {
        if (e instanceof QuotaError || e instanceof LockBusy || isBusy(e)) throw e;
        await locked(() => run("UPDATE official_channels SET checked_at = ?, last_error = ? WHERE channel_id = ?", [new Date(now()).toISOString(), String((e as Error).message).slice(0, 300), ch.channelId]));
      }
    }
  } catch (e) {
    out.error = e instanceof LockBusy || isBusy(e) ? BUSY_STOP : String((e as Error).message ?? e).slice(0, 300);
  } finally {
    busy = false;
    // Not written (still busy): the run stays unfinished, so it doesn't count toward the 6-hour wait.
    await locked(() => run("UPDATE official_watch_runs SET finished_at = ?, units = ?, channels = ?, seen = ?, added = ?, queued = ?, duplicates = ?, error = ? WHERE id = ?",
      [new Date(now()).toISOString(), out.units, out.channels, out.seen, out.added, out.queued, out.duplicates, out.error, runId])).catch(() => {});
  }
  // The event pages read it within a minute (the recordings cache).
  if (out.added) forgetOfficial();
  await recordingsAdded(added, log);
  if (out.seen || out.error) log(`official videos: watched ${out.channels} channels (${out.units} units): ${out.seen} new, ${out.added} added, ${out.queued} to review, ${out.duplicates} duplicates${out.error ? `; ${out.error}` : ""}`);
  return out;
}

/** The scheduled run: only when the last one started 6 hours ago or more (a restart doesn't add runs). */
export async function watchIfDue(log: (s: string) => void, now = Date.now(), opts: { apiKey?: string | null; fetchImpl?: Fetch; clock?: () => number; lockWaitMs?: number } = {}): Promise<WatchRun | null> {
  const key = opts.apiKey === undefined ? env.youtubeApiKey : opts.apiKey;
  if (!key) return null;
  const last = await get<{ started_at: string }>(LAST_RUN);
  if (last && now - Date.parse(last.started_at) < WATCH_EVERY_MS) return null;
  return runOfficialWatch(log, { apiKey: key, fetchImpl: opts.fetchImpl, now: opts.clock, lockWaitMs: opts.lockWaitMs, scheduled: true });
}

/** A channel's uploads not read before, newest first (one unit a page), back to the earlier of the date it started
 * being watched and LOOKBACK_MS ago. */
async function newUploads(ch: ChannelRow, key: string, fetchImpl: Fetch, out: WatchRun, maxUnits: number, now: number): Promise<{ id: string; published: string }[]> {
  const fresh: { id: string; published: string }[] = [];
  const back = new Date(now - LOOKBACK_MS).toISOString();
  const floor = ch.watchFrom < back ? ch.watchFrom : back;
  let token = "";
  for (let page = 0; page < MAX_PAGES && out.units < maxUnits; page++) {
    out.units++;
    const body = await api("playlistItems", { part: "contentDetails", playlistId: `UU${ch.channelId.slice(2)}`, maxResults: "50", ...(token ? { pageToken: token } : {}) }, key, fetchImpl);
    const items = (Array.isArray(body?.items) ? body.items : []).map((i: any) => ({ id: String(i?.contentDetails?.videoId ?? ""), published: String(i?.contentDetails?.videoPublishedAt ?? "") }))
      .filter((i: { id: string; published: string }) => VIDEO_ID.test(i.id) && i.published);
    const ids = items.map((i: { id: string }) => i.id);
    const known = new Set<string>();
    if (ids.length) {
      const q = ids.map(() => "?").join(",");
      for (const r of await all<{ video_id: string }>(`SELECT video_id FROM official_watch WHERE video_id IN (${q}) UNION SELECT video_id FROM official_videos WHERE video_id IN (${q})`, [...ids, ...ids])) known.add(String(r.video_id));
    }
    let older = false;
    for (const i of items) {
      if (i.published < floor) { older = true; continue; }
      if (!known.has(i.id)) fresh.push(i);
    }
    token = String(body?.nextPageToken ?? "");
    if (older || !token) break;
  }
  return fresh;
}

/** The verdict for one video: the match, then (for an add) the event's own videos. */
export async function decide(v: WatchVideo, ch: Pick<ChannelRow, "region" | "words" | "titlePattern">): Promise<WatchVerdict> {
  // Already an event's video another way (FIRST's link, a short link, a channel broadcast, the owner's stream).
  const played = await get<{ season: number; code: string; via: string }>(
    `SELECT season, code, 'the channel broadcasts' AS via FROM event_broadcasts WHERE video_id = ?1
     UNION ALL SELECT season, code, 'its stream link' FROM event_stream_links WHERE video_id = ?1
     UNION ALL SELECT season, code, 'the owner''s stream' FROM event_streams WHERE video_id = ?1
     UNION ALL SELECT season, code, 'FIRST''s event link' FROM events WHERE livestream LIKE '%' || ?1 || '%' LIMIT 1`, [v.videoId]);
  if (played) return { kind: "duplicate", why: `duplicate: already ${played.season} ${played.code}'s video (${played.via})`, event: { season: Number(played.season), code: String(played.code) } };
  const rule: ChannelRule = { region: ch.region, words: ch.words, titlePattern: ch.titlePattern };
  // Around its broadcast date, or (an upload) the one date its title says, or the two weeks before it went up.
  const when = videoWindow(v);
  const events = when ? await eventsBetween(when[0], when[1]) : [];
  const verdict = matchVideo(v, rule, events);
  if (verdict.kind === "add") return settle(verdict);
  return verdict.kind === "review" && verdict.event ? verdict : { ...verdict, guess: await guessFor(v, rule) };
}

/** bestGuess over the events from 21 days before the video's date to the day after. */
export async function guessFor(v: WatchVideo, rule: ChannelRule): Promise<NonNullable<WatchVerdict["guess"]>> {
  const anchor = (v.start ?? v.published ?? "").slice(0, 10);
  const t = Date.parse(`${anchor}T00:00:00Z`);
  const events = Number.isFinite(t) ? await eventsBetween(new Date(t - 21 * 864e5).toISOString().slice(0, 10), new Date(t + 864e5).toISOString().slice(0, 10)) : [];
  return bestGuess(v, rule, events);
}

/** A verdict written: the watcher's row, and for an add the recording on its event. by: who added it (the watcher, or
 *  the channel audit for one older than the watcher's window that passes every check: server/videos/officialAudit.ts).
 *  For an add, what became of it: "added"; "queued" (its day taken meanwhile: in the owner's review, naming the clash);
 *  or "kept" (the owner decided the video meanwhile, and that stands). Any other verdict: "kept". */
export async function record(v: WatchVideo, ch: Pick<ChannelRow, "channelId" | "title">, verdict: WatchVerdict, published: string | null, now: number, by: "watcher" | "channel audit" = "watcher"): Promise<"added" | "queued" | "kept"> {
  const writes = verdictWrites(v, ch, verdict, published, now, by);
  if (verdict.kind !== "add") { await db().batch(writes, "write"); return "kept"; }
  // An add lands whole or not at all: the row claimed as added and its recording in. Another recording that took the
  // day meanwhile (an owner's approval takes no data lock) leaves the insert with nothing to do: undone, and the video
  // goes to the owner's review naming the clash, never counted or kept as added.
  const tx = await db().transaction("write");
  let clash = false, put = false;
  try {
    const results = [];
    for (const s of writes) results.push(await tx.execute(s));
    put = results[results.length - 1].rowsAffected > 0;
    clash = results[0].rowsAffected > 0 && !put;
    if (clash) await tx.rollback(); else await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
  if (!clash) return put ? "added" : "kept";
  const where = `${verdict.event.code}'s ${verdict.day}${verdict.part ? ` (${verdict.part})` : ""}`;
  const review: WatchVerdict = { kind: "review", why: `another recording took ${where} as this one was added: which plays is for the owner (${verdict.why})`.slice(0, 500), event: verdict.event, day: verdict.day, part: verdict.part };
  // Reopened: a row in review or set aside (the audit deciding it again) goes to review too, not left as it was.
  await db().batch(verdictWrites(v, ch, review, published, now, by, true), "write");
  return "queued";
}

/** The rows one verdict writes: the watcher's row, and for an add the dead recordings it replaces and its own. An
 *  existing row in review, set aside or logged as a duplicate is overwritten only by an add (the audit deciding it
 *  again: a duplicate whose day's video has gone), or with reopen (a lost add sent to review). */
function verdictWrites(v: WatchVideo, ch: Pick<ChannelRow, "channelId" | "title">, verdict: WatchVerdict, published: string | null, now: number, by: "watcher" | "channel audit", reopen = false): { sql: string; args: (string | number | null)[] }[] {
  const at = new Date(now).toISOString();
  // An event the verdict names, else (in review or set aside) the best guess: the owner's form starts from it.
  const ev = (verdict.kind === "ignore" ? null : verdict.event ?? null) ?? verdict.guess?.event ?? null;
  const day = (verdict.kind === "ignore" ? null : verdict.day ?? null) ?? verdict.guess?.day ?? null;
  const part = verdict.kind === "ignore" ? null : verdict.part ?? null;
  const status = verdict.kind === "add" ? "added" : verdict.kind === "review" ? "pending" : verdict.kind === "duplicate" ? "duplicate" : "ignored";
  const writes = [{
    sql: `INSERT INTO official_watch (video_id, channel_id, title, start, published, duration, status, season, code, day, part, why, guess_why, seen_at, decided_at, decided_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(video_id) DO UPDATE SET status = excluded.status, season = excluded.season, code = excluded.code, day = excluded.day, part = excluded.part,
            why = excluded.why, start = excluded.start, duration = excluded.duration, decided_at = excluded.decided_at, decided_by = excluded.decided_by
          WHERE ${reopen ? "" : "excluded.status = 'added' AND "}official_watch.status IN ('pending', 'ignored', 'duplicate')`,
    args: [v.videoId, ch.channelId, v.title, v.start, published, v.durationS, status, ev?.season ?? null, ev?.code ?? null, day, part, verdict.why, verdict.guess?.why ?? null, at, verdict.kind === "add" ? at : null, verdict.kind === "add" ? by : null] as (string | number | null)[],
  }];
  // The day's slot held only by recordings YouTube no longer plays (settle let it through): those come off first. Each
  // one this add would have clashed with, were it playable: the same part, or either of them the whole day.
  if (verdict.kind === "add") writes.push({
    sql: `UPDATE official_videos SET removed_at = ? WHERE season = ? AND code = ? AND kind = 'recording' AND removed_at IS NULL AND day = ?
            AND (COALESCE(part, '') = COALESCE(?, '') OR part IS NULL OR ? IS NULL)
            AND video_id IN (SELECT video_id FROM video_meta WHERE status = 'unavailable')
            AND EXISTS (SELECT 1 FROM official_watch WHERE video_id = ? AND status = 'added')`,
    args: [at, verdict.event.season, verdict.event.code, verdict.day, verdict.part, verdict.part, v.videoId],
  }, {
    // Only when its watch row says added (new, or decided again from review or set aside): never over an owner's decision.
    // Any clash (the video on an event already, or its day and part taken: official_videos_day) is nothing to do.
    sql: `INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by)
          SELECT ?, ?, ?, 'recording', ?, ?, ?, ?, 'watcher', ?, ?, NULL WHERE EXISTS (SELECT 1 FROM official_watch WHERE video_id = ? AND status = 'added')
          ON CONFLICT DO NOTHING`,
    args: [v.videoId, verdict.event.season, verdict.event.code, verdict.day, verdict.part, ch.channelId, v.title, `${by}: ${ch.title}; ${verdict.why}`, at, v.videoId],
  });
  return writes;
}

// ---- The owner's side (server/videos/officialOwnerRoutes.ts) ----

export interface WatchRow { videoId: string; channelId: string; channel: string; title: string; start: string | null; published: string | null; durationS: number | null; status: string; season: number | null; code: string | null; day: string | null; part: string | null; why: string; guessWhy: string | null; seenAt: string; decidedAt: string | null; decidedBy: string | null }
const watchOf = (r: any): WatchRow => ({
  videoId: String(r.video_id), channelId: String(r.channel_id), channel: String(r.channel ?? r.channel_id), title: String(r.title), start: r.start ?? null, published: r.published ?? null,
  durationS: r.duration == null ? null : Number(r.duration), status: String(r.status), season: r.season == null ? null : Number(r.season), code: r.code ?? null,
  day: r.day ?? null, part: r.part ?? null, why: String(r.why), guessWhy: r.guess_why ?? null, seenAt: String(r.seen_at), decidedAt: r.decided_at ?? null, decidedBy: r.decided_by ?? null,
});
const WATCH_SELECT = "SELECT w.video_id, w.channel_id, w.title, w.start, w.published, w.duration, w.status, w.season, w.code, w.day, w.part, w.why, w.guess_why, w.seen_at, w.decided_at, w.decided_by, c.title AS channel FROM official_watch w LEFT JOIN official_channels c ON c.channel_id = w.channel_id";

export async function pendingCount(): Promise<number> {
  return Number((await get<{ n: number }>("SELECT COUNT(*) AS n FROM official_watch WHERE status = 'pending'"))?.n ?? 0);
}

export async function ownerOfficial(now = Date.now()) {
  // Under the data lock, like the watcher's seed; while a sync holds it the panel loads without seeding (the next
  // load or watcher run seeds), so it never waits out the database's busy timeout.
  // Once seeded, a load takes no lease (its two writes would also drop the kept search reads).
  if (!channelsSeeded) {
    try { await withDataLock("official videos seed", () => seedOfficialChannels(now), { ttlMs: 60_000, waitMs: 2000, pollMs: 250 }); }
    catch (e) { if (!(e instanceof LockBusy) && !isBusy(e)) throw e; }
  }
  const since = new Date(now).toISOString().slice(0, 10);
  const [pending, ignored, duplicates, decided, runs, channels, today, list] = await Promise.all([
    all<any>(`${WATCH_SELECT} WHERE w.status = 'pending' ORDER BY w.seen_at, COALESCE(w.start, w.published) LIMIT 200`),
    all<any>(`${WATCH_SELECT} WHERE w.status = 'ignored' ORDER BY w.seen_at DESC LIMIT 50`),
    all<any>(`${WATCH_SELECT} WHERE w.status = 'duplicate' ORDER BY w.seen_at DESC LIMIT 50`),
    all<any>(`${WATCH_SELECT} WHERE w.status IN ('added', 'approved', 'rejected') ORDER BY COALESCE(w.decided_at, w.seen_at) DESC LIMIT 50`),
    all<any>("SELECT id, started_at, finished_at, units, channels, seen, added, queued, duplicates, error FROM official_watch_runs ORDER BY id DESC LIMIT 10"),
    all<any>("SELECT channel_id, title, region, words, title_pattern, watch_from, checked_at, last_error, removed_at FROM official_channels WHERE removed_at IS NULL ORDER BY title"),
    get<{ n: number }>("SELECT COALESCE(SUM(units), 0) AS n FROM official_watch_runs WHERE started_at >= ?", [since]),
    get<{ n: number; e: number }>("SELECT COUNT(*) AS n, COUNT(DISTINCT season || '/' || code) AS e FROM official_videos WHERE removed_at IS NULL AND kind = 'recording'"),
  ]);
  const last = await get<{ started_at: string }>(LAST_RUN);
  return {
    apiKey: !!env.youtubeApiKey,
    everyHours: WATCH_EVERY_MS / 3600_000,
    nextRunAt: last?.started_at ? new Date(Date.parse(last.started_at) + WATCH_EVERY_MS).toISOString() : null,
    unitsToday: Number(today?.n ?? 0),
    recordings: Number(list?.n ?? 0), events: Number(list?.e ?? 0),
    pending: pending.map(watchOf), ignored: ignored.map(watchOf), duplicates: duplicates.map(watchOf), decided: decided.map(watchOf),
    runs: runs.map((r) => ({ id: Number(r.id), startedAt: String(r.started_at), finishedAt: r.finished_at ?? null, units: Number(r.units), channels: Number(r.channels), seen: Number(r.seen), added: Number(r.added), queued: Number(r.queued), duplicates: Number(r.duplicates ?? 0), error: r.error ?? null })),
    channels: channels.map(channelOf),
  };
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** The owner adds a video from the queue (or the set-aside list) to an event: as a day's recording or a highlight. */
export async function approveWatched(videoId: string, body: { season?: unknown; code?: unknown; day?: unknown; part?: unknown; kind?: unknown }, actor: string, now = Date.now(), log: (s: string) => void = console.warn): Promise<Result> {
  const w = await get<any>("SELECT channel_id, title, status, why FROM official_watch WHERE video_id = ?", [videoId]);
  if (!w) return { ok: false, error: "That video isn't in the review queue." };
  if (!["pending", "ignored"].includes(String(w.status))) return { ok: false, error: `Already ${w.status}.` };
  const kind = body.kind === "highlight" ? "highlight" : "recording";
  const season = Number(body.season), code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const ev = Number.isInteger(season) && code ? await get<any>(`SELECT e.season, e.code, ${EVENT_FIRST_DAY} AS start, ${EVENT_LAST_DAY} AS end FROM events e WHERE e.season = ? AND upper(e.code) = ?`, [season, code]) : null;
  if (!ev) return { ok: false, error: "No such event: pick the season and the event's code." };
  const day = typeof body.day === "string" && DAY.test(body.day) ? body.day : null;
  const part = typeof body.part === "string" && body.part.trim() ? body.part.trim().slice(0, 60) : null;
  if (kind === "recording") {
    if (!day) return { ok: false, error: "A recording needs its day (YYYY-MM-DD)." };
    const start = String(ev.start).slice(0, 10), end = String(ev.end ?? ev.start).slice(0, 10);
    if (day < start || day > end) return { ok: false, error: `${ev.code} runs ${start} to ${end}: the day must be one of its days.` };
    const same = (await eventVideosByDay(Number(ev.season), String(ev.code))).find((h) => h.day === day && (h.part ?? null) === part);
    if (same) return { ok: false, error: `${ev.code} already plays ${same.videoId} for ${day}${part ? ` (${part})` : ""}. Name a part (e.g. Awards) if this is another part of that day.` };
  }
  const at = new Date(now).toISOString();
  const why = `approved from the watcher's queue: ${w.why}`;
  // One write: the queue row is claimed only while it's still undecided, and the recording goes in only if no other
  // official recording holds that event, day and part (official_videos_day) — or the whole approval is undone.
  const tx = await db().transaction("write");
  try {
    const claimed = await tx.execute({ sql: "UPDATE official_watch SET status = 'approved', season = ?, code = ?, day = ?, part = ?, decided_at = ?, decided_by = ? WHERE video_id = ? AND status IN ('pending', 'ignored')",
      args: [Number(ev.season), String(ev.code), day, part, at, actor, videoId] });
    if (!claimed.rowsAffected) { await tx.rollback(); return { ok: false, error: "Already decided." }; }
    const put = await tx.execute({ sql: `INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'owner', ?, ?, ?) ON CONFLICT DO NOTHING`,
      args: [videoId, Number(ev.season), String(ev.code), kind, kind === "recording" ? day : null, kind === "recording" ? part : null, String(w.channel_id), String(w.title), why.slice(0, 500), at, actor] });
    if (!put.rowsAffected) { await tx.rollback(); return { ok: false, error: `${ev.code} already has an official video for ${day}${part ? ` (${part})` : ""}, or this video is already on an event.` }; }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
  forgetOfficial();
  await recordAudit(actor, "officialVideo.approve", { videoId, season: Number(ev.season), code: String(ev.code), kind, day, part, was: String(w.status) });
  if (kind === "recording") await recordingsAdded([{ season: Number(ev.season), code: String(ev.code), day, part, videoId, by: "owner" }], log);
  return { ok: true };
}

export async function rejectWatched(videoId: string, reason: string | null, actor: string, now = Date.now()): Promise<Result> {
  const w = await get<any>("SELECT status, why FROM official_watch WHERE video_id = ?", [videoId]);
  if (!w) return { ok: false, error: "That video isn't in the review queue." };
  if (!["pending", "ignored"].includes(String(w.status))) return { ok: false, error: `Already ${w.status}.` };
  // Only while it's still undecided: an approval that landed meanwhile stands.
  const changed = await run("UPDATE official_watch SET status = 'rejected', decided_at = ?, decided_by = ?, why = ? WHERE video_id = ? AND status IN ('pending', 'ignored')",
    [new Date(now).toISOString(), actor, reason ? `${reason.slice(0, 200)} (was: ${w.why})`.slice(0, 500) : String(w.why), videoId]);
  if (!changed) return { ok: false, error: "Already decided." };
  await recordAudit(actor, "officialVideo.reject", { videoId, reason, was: String(w.status) });
  return { ok: true };
}

/** Take an official video off its event (any source): it stays in the table, removed, and is never added again. */
export async function removeOfficial(videoId: string, actor: string, now = Date.now()): Promise<Result> {
  const v = await get<any>("SELECT season, code, kind, source FROM official_videos WHERE video_id = ? AND removed_at IS NULL", [videoId]);
  if (!v) return { ok: false, error: "No such official video." };
  const at = new Date(now).toISOString();
  await db().batch([
    { sql: "UPDATE official_videos SET removed_at = ? WHERE video_id = ?", args: [at, videoId] },
    { sql: "UPDATE official_watch SET status = 'rejected', decided_at = ?, decided_by = ? WHERE video_id = ?", args: [at, actor, videoId] },
  ], "write");
  forgetOfficial(); // also reloads the typed match starts: this video's stop playing (kept on record)
  await recordAudit(actor, "officialVideo.remove", { videoId, season: Number(v.season), code: String(v.code), kind: String(v.kind), source: String(v.source) });
  return { ok: true };
}

export async function saveChannel(body: { channelId?: unknown; title?: unknown; region?: unknown; words?: unknown; titlePattern?: unknown }, actor: string, now = Date.now()): Promise<Result> {
  const id = typeof body.channelId === "string" ? body.channelId.trim() : "";
  if (!CHANNEL_ID.test(id)) return { ok: false, error: "A YouTube channel id starts with UC and is 24 characters (it's in the channel's address or About page)." };
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return { ok: false, error: "Name the channel." };
  const region = typeof body.region === "string" ? body.region.trim().slice(0, 300) : "";
  if (!parseRule(region)) return { ok: false, error: "The region rule can't be read: e.g. country=Romania, or state=VA,MD,DC, or country=USA;type=Premier." };
  const words = typeof body.words === "string" && body.words.trim() ? body.words.trim().slice(0, 200) : null;
  const pattern = typeof body.titlePattern === "string" && body.titlePattern.trim() ? body.titlePattern.trim().slice(0, 200) : null;
  if (pattern) { try { new RegExp(pattern, "i"); } catch { return { ok: false, error: "The title pattern isn't a valid regular expression." }; } }
  const at = new Date(now).toISOString();
  const was = await get<any>("SELECT region, removed_at FROM official_channels WHERE channel_id = ?", [id]);
  // Added (or brought back): watched from now on; edited: the rule changes, what was read stays read. A seeded row the
  // owner saves becomes theirs (added_by), in the same write, so the seed never fills a pattern over it.
  await run(`INSERT INTO official_channels (channel_id, title, region, words, title_pattern, watch_from, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(channel_id) DO UPDATE SET title = excluded.title, region = excluded.region, words = excluded.words, title_pattern = excluded.title_pattern,
               added_by = COALESCE(official_channels.added_by, excluded.added_by),
               watch_from = CASE WHEN official_channels.removed_at IS NULL THEN official_channels.watch_from ELSE excluded.watch_from END, removed_at = NULL`,
    [id, title, region, words, pattern, at, at, actor]);
  await recordAudit(actor, was && !was.removed_at ? "officialChannel.edit" : "officialChannel.add", { channelId: id, title, region, words, titlePattern: pattern }, null,
    was ? { from: `${was.region}${was.removed_at ? " (removed)" : ""}`, to: region } : undefined);
  return { ok: true };
}

export async function removeChannel(channelId: string, actor: string, now = Date.now()): Promise<Result> {
  const was = await get<any>("SELECT title FROM official_channels WHERE channel_id = ? AND removed_at IS NULL", [channelId]);
  if (!was) return { ok: false, error: "That channel isn't watched." };
  await run("UPDATE official_channels SET removed_at = ? WHERE channel_id = ?", [new Date(now).toISOString(), channelId]);
  await recordAudit(actor, "officialChannel.remove", { channelId, title: String(was.title) });
  return { ok: true };
}

/** The owner's Run now: not within 10 minutes of the last run (the quota is shared). */
export async function runNow(actor: string, log: (s: string) => void, now = Date.now()): Promise<Result<{ run: WatchRun | null }>> {
  if (!env.youtubeApiKey) return { ok: false, error: "YOUTUBE_API_KEY isn't set on the server, so the watcher can't read channels." };
  const last = await get<{ started_at: string }>("SELECT started_at FROM official_watch_runs ORDER BY id DESC LIMIT 1");
  if (last && now - Date.parse(last.started_at) < 10 * 60_000) return { ok: false, error: "The watcher ran less than 10 minutes ago." };
  const holder = await lockHolder();
  if (holder) return { ok: false, error: `The data sync is writing right now (${holder.what}): try again in a few minutes.` };
  const out = await runOfficialWatch(log);
  if (!out) return { ok: false, error: "The watcher is already running, or the data sync is writing: its results show here when it's done, or try again in a few minutes." };
  await recordAudit(actor, "officialVideo.runNow", { ...out });
  return { ok: true, run: out };
}
