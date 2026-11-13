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
import { matchVideo, parseRule, type ChannelRule, type Verdict, type WatchEvent, type WatchVideo } from "./officialMatch.js";

export const WATCH_EVERY_MS = 6 * 3600_000;
/** Units one run may use at most (YouTube gives 10,000 a day, shared with the timing backfill). */
const MAX_UNITS = 1500;
/** Pages of a channel's uploads read in one run (50 a page, newest first). */
const MAX_PAGES = 3;
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
/** The shipped watchlist (server/data/officialChannels.ts), each channel once: a removed one is never written back. */
export async function seedOfficialChannels(now = Date.now(), again = false): Promise<number> {
  if (channelsSeeded && !again) return 0;
  const at = new Date(now).toISOString();
  const known = new Set((await all<{ channel_id: string }>("SELECT channel_id FROM official_channels")).map((r) => String(r.channel_id)));
  const todo = OFFICIAL_CHANNELS.filter((c) => !known.has(c.channelId));
  if (todo.length) await db().batch(todo.map((c) => ({
    sql: "INSERT INTO official_channels (channel_id, title, region, words, title_pattern, watch_from, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(channel_id) DO NOTHING",
    args: [c.channelId, c.title, c.region, c.words ?? null, c.titlePattern ?? null, at, at],
  })), "write");
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

/** The events whose dates are within a day of a broadcast date (the match applies the channel's region and the venue's date). */
async function eventsAround(day: string): Promise<WatchEvent[]> {
  const t = Date.parse(`${day}T00:00:00Z`);
  const lo = new Date(t - 864e5).toISOString().slice(0, 10), hi = new Date(t + 864e5).toISOString().slice(0, 10);
  const rows = await all<any>(
    `SELECT e.season, e.code, e.name, e.type, e.city, e.state, e.country, e.start, e.end, e.timezone, e.division_code,
            EXISTS (SELECT 1 FROM events c WHERE c.season = e.season AND c.division_code = e.code AND c.code != e.code) AS parent
     FROM events e WHERE e.start IS NOT NULL AND e.start <= ? AND COALESCE(e.end, e.start) >= ?`, [hi, lo]);
  return rows.map((r) => ({
    season: Number(r.season), code: String(r.code), name: String(r.name ?? ""), type: String(r.type ?? ""), city: r.city ?? null, state: r.state ?? null,
    country: r.country ?? null, start: String(r.start).slice(0, 10), end: r.end ? String(r.end).slice(0, 10) : null, timezone: r.timezone ?? null,
    divisionCode: r.division_code ?? null, parent: !!Number(r.parent),
  }));
}

/** An "add" checked against what the event already plays: a day it has a video for, or one whose day isn't known yet, goes to review. */
async function settle(v: Verdict & { kind: "add" }): Promise<Verdict> {
  const has = await eventVideosByDay(v.event.season, v.event.code);
  const at = { event: v.event, day: v.day, part: v.part };
  const same = has.find((h) => h.day === v.day && (h.part ?? null) === (v.part ?? null));
  if (same) return { kind: "review", why: `${v.event.code} already plays ${same.videoId} for ${v.day}`, ...at };
  const unknown = has.find((h) => !h.timed);
  if (unknown) return { kind: "review", why: `${v.event.code} plays ${unknown.videoId}, whose day isn't known yet`, ...at };
  return v;
}

let busy = false;
export interface WatchRun { units: number; channels: number; seen: number; added: number; queued: number; error: string | null }

/**
 * One pass over the watchlist. Without YOUTUBE_API_KEY nothing is read (the owner panel says so). Stops when the run's
 * units are spent or YouTube says the day's quota is.
 */
export async function runOfficialWatch(log: (s: string) => void, opts: { apiKey?: string | null; fetchImpl?: Fetch; now?: () => number; maxUnits?: number } = {}): Promise<WatchRun | null> {
  const key = opts.apiKey === undefined ? env.youtubeApiKey : opts.apiKey;
  if (!key || busy) return null;
  busy = true;
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxUnits = opts.maxUnits ?? MAX_UNITS;
  const out: WatchRun = { units: 0, channels: 0, seen: 0, added: 0, queued: 0, error: null };
  const runId = Number((await get<{ id: number }>("INSERT INTO official_watch_runs (started_at) VALUES (?) RETURNING id", [new Date(now()).toISOString()]))?.id);
  try {
    await seedOfficialChannels(now());
    const channels = (await all<any>("SELECT * FROM official_channels WHERE removed_at IS NULL ORDER BY checked_at IS NOT NULL, checked_at, channel_id")).map(channelOf);
    for (const ch of channels) {
      if (out.units >= maxUnits) { out.error = `stopped at the run's ${maxUnits} units; the rest next run`; break; }
      try {
        const fresh = await newUploads(ch, key, fetchImpl, out, maxUnits);
        out.channels++;
        for (let i = 0; i < fresh.length; i += 50) {
          if (out.units >= maxUnits) break;
          const part = fresh.slice(i, i + 50);
          out.units++;
          const body = await api("videos", { part: "snippet,contentDetails,status,liveStreamingDetails", id: part.map((p) => p.id).join(","), maxResults: "50" }, key, fetchImpl);
          for (const item of Array.isArray(body?.items) ? body.items : []) {
            const live = String(item?.snippet?.liveBroadcastContent ?? "none");
            // Live now or still to come: read again next run, once it's over.
            if (live === "live" || live === "upcoming") continue;
            const v: WatchVideo = {
              videoId: String(item.id), title: String(item?.snippet?.title ?? "").slice(0, 300),
              start: item?.liveStreamingDetails?.actualStartTime ?? null, durationS: isoDuration(item?.contentDetails?.duration),
              privacy: String(item?.status?.privacyStatus ?? "public"), embeddable: item?.status?.embeddable !== false,
              blockedIn: Array.isArray(item?.contentDetails?.regionRestriction?.blocked) ? item.contentDetails.regionRestriction.blocked.length : 0,
            };
            if (!VIDEO_ID.test(v.videoId)) continue;
            out.seen++;
            const verdict = await decide(v, ch);
            const published = part.find((p) => p.id === v.videoId)?.published ?? null;
            await record(v, ch, verdict, published, now());
            if (verdict.kind === "add") out.added++;
            else if (verdict.kind === "review") out.queued++;
          }
        }
        await run("UPDATE official_channels SET checked_at = ?, last_error = NULL WHERE channel_id = ?", [new Date(now()).toISOString(), ch.channelId]);
      } catch (e) {
        if (e instanceof QuotaError) throw e;
        await run("UPDATE official_channels SET checked_at = ?, last_error = ? WHERE channel_id = ?", [new Date(now()).toISOString(), String((e as Error).message).slice(0, 300), ch.channelId]);
      }
    }
  } catch (e) {
    out.error = String((e as Error).message ?? e).slice(0, 300);
  } finally {
    busy = false;
    await run("UPDATE official_watch_runs SET finished_at = ?, units = ?, channels = ?, seen = ?, added = ?, queued = ?, error = ? WHERE id = ?",
      [new Date(now()).toISOString(), out.units, out.channels, out.seen, out.added, out.queued, out.error, runId]).catch(() => {});
  }
  // The event pages read it within a minute (the recordings cache).
  if (out.added) forgetOfficial();
  if (out.seen || out.error) log(`official videos: watched ${out.channels} channels (${out.units} units): ${out.seen} new, ${out.added} added, ${out.queued} to review${out.error ? `; ${out.error}` : ""}`);
  return out;
}

/** The scheduled run: only when the last one started 6 hours ago or more (a restart doesn't add runs). */
export async function watchIfDue(log: (s: string) => void, now = Date.now()): Promise<WatchRun | null> {
  if (!env.youtubeApiKey) return null;
  const last = await get<{ started_at: string }>("SELECT started_at FROM official_watch_runs ORDER BY id DESC LIMIT 1");
  if (last && now - Date.parse(last.started_at) < WATCH_EVERY_MS) return null;
  return runOfficialWatch(log);
}

/** A channel's uploads published since it's been watched and not read before, newest first (one unit a page). */
async function newUploads(ch: ChannelRow, key: string, fetchImpl: Fetch, out: WatchRun, maxUnits: number): Promise<{ id: string; published: string }[]> {
  const fresh: { id: string; published: string }[] = [];
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
      if (i.published < ch.watchFrom) { older = true; continue; }
      if (!known.has(i.id)) fresh.push(i);
    }
    token = String(body?.nextPageToken ?? "");
    if (older || !token) break;
  }
  return fresh;
}

/** The verdict for one video: the match, then (for an add) the event's own videos. */
export async function decide(v: WatchVideo, ch: Pick<ChannelRow, "region" | "words" | "titlePattern">): Promise<Verdict> {
  const rule: ChannelRule = { region: ch.region, words: ch.words, titlePattern: ch.titlePattern };
  const events = v.start ? await eventsAround(v.start.slice(0, 10)) : [];
  const verdict = matchVideo(v, rule, events);
  return verdict.kind === "add" ? settle(verdict) : verdict;
}

async function record(v: WatchVideo, ch: ChannelRow, verdict: Verdict, published: string | null, now: number): Promise<void> {
  const at = new Date(now).toISOString();
  const ev = verdict.kind === "ignore" ? null : verdict.event ?? null;
  const day = verdict.kind === "ignore" ? null : verdict.day ?? null;
  const part = verdict.kind === "ignore" ? null : verdict.part ?? null;
  const status = verdict.kind === "add" ? "added" : verdict.kind === "review" ? "pending" : "ignored";
  const writes = [{
    sql: `INSERT INTO official_watch (video_id, channel_id, title, start, published, duration, status, season, code, day, part, why, seen_at, decided_at, decided_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(video_id) DO NOTHING`,
    args: [v.videoId, ch.channelId, v.title, v.start, published, v.durationS, status, ev?.season ?? null, ev?.code ?? null, day, part, verdict.why, at, verdict.kind === "add" ? at : null, verdict.kind === "add" ? "watcher" : null] as (string | number | null)[],
  }];
  if (verdict.kind === "add") writes.push({
    sql: `INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by)
          VALUES (?, ?, ?, 'recording', ?, ?, ?, ?, 'watcher', ?, ?, NULL) ON CONFLICT(video_id) DO NOTHING`,
    args: [v.videoId, verdict.event.season, verdict.event.code, verdict.day, verdict.part, ch.channelId, v.title, `watcher: ${ch.title}; ${verdict.why}`, at],
  });
  await db().batch(writes, "write");
}

// ---- The owner's side (server/videos/officialOwnerRoutes.ts) ----

export interface WatchRow { videoId: string; channelId: string; channel: string; title: string; start: string | null; published: string | null; durationS: number | null; status: string; season: number | null; code: string | null; day: string | null; part: string | null; why: string; seenAt: string; decidedAt: string | null; decidedBy: string | null }
const watchOf = (r: any): WatchRow => ({
  videoId: String(r.video_id), channelId: String(r.channel_id), channel: String(r.channel ?? r.channel_id), title: String(r.title), start: r.start ?? null, published: r.published ?? null,
  durationS: r.duration == null ? null : Number(r.duration), status: String(r.status), season: r.season == null ? null : Number(r.season), code: r.code ?? null,
  day: r.day ?? null, part: r.part ?? null, why: String(r.why), seenAt: String(r.seen_at), decidedAt: r.decided_at ?? null, decidedBy: r.decided_by ?? null,
});
const WATCH_SELECT = "SELECT w.*, c.title AS channel FROM official_watch w LEFT JOIN official_channels c ON c.channel_id = w.channel_id";

export async function pendingCount(): Promise<number> {
  return Number((await get<{ n: number }>("SELECT COUNT(*) AS n FROM official_watch WHERE status = 'pending'"))?.n ?? 0);
}

export async function ownerOfficial(now = Date.now()) {
  await seedOfficialChannels(now);
  const since = new Date(now).toISOString().slice(0, 10);
  const [pending, ignored, decided, runs, channels, today, list] = await Promise.all([
    all<any>(`${WATCH_SELECT} WHERE w.status = 'pending' ORDER BY w.seen_at DESC LIMIT 200`),
    all<any>(`${WATCH_SELECT} WHERE w.status = 'ignored' ORDER BY w.seen_at DESC LIMIT 50`),
    all<any>(`${WATCH_SELECT} WHERE w.status IN ('added', 'approved', 'rejected') ORDER BY COALESCE(w.decided_at, w.seen_at) DESC LIMIT 50`),
    all<any>("SELECT * FROM official_watch_runs ORDER BY id DESC LIMIT 10"),
    all<any>("SELECT * FROM official_channels WHERE removed_at IS NULL ORDER BY title"),
    get<{ n: number }>("SELECT COALESCE(SUM(units), 0) AS n FROM official_watch_runs WHERE started_at >= ?", [since]),
    get<{ n: number; e: number }>("SELECT COUNT(*) AS n, COUNT(DISTINCT season || '/' || code) AS e FROM official_videos WHERE removed_at IS NULL AND kind = 'recording'"),
  ]);
  const last = runs[0];
  return {
    apiKey: !!env.youtubeApiKey,
    everyHours: WATCH_EVERY_MS / 3600_000,
    nextRunAt: last?.started_at ? new Date(Date.parse(last.started_at) + WATCH_EVERY_MS).toISOString() : null,
    unitsToday: Number(today?.n ?? 0),
    recordings: Number(list?.n ?? 0), events: Number(list?.e ?? 0),
    pending: pending.map(watchOf), ignored: ignored.map(watchOf), decided: decided.map(watchOf),
    runs: runs.map((r) => ({ id: Number(r.id), startedAt: String(r.started_at), finishedAt: r.finished_at ?? null, units: Number(r.units), channels: Number(r.channels), seen: Number(r.seen), added: Number(r.added), queued: Number(r.queued), error: r.error ?? null })),
    channels: channels.map(channelOf),
  };
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** The owner adds a video from the queue (or the set-aside list) to an event: as a day's recording or a highlight. */
export async function approveWatched(videoId: string, body: { season?: unknown; code?: unknown; day?: unknown; part?: unknown; kind?: unknown }, actor: string, now = Date.now()): Promise<Result> {
  const w = await get<any>("SELECT * FROM official_watch WHERE video_id = ?", [videoId]);
  if (!w) return { ok: false, error: "That video isn't in the review queue." };
  if (!["pending", "ignored"].includes(String(w.status))) return { ok: false, error: `Already ${w.status}.` };
  const kind = body.kind === "highlight" ? "highlight" : "recording";
  const season = Number(body.season), code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const ev = Number.isInteger(season) && code ? await get<any>("SELECT season, code, start, end FROM events WHERE season = ? AND upper(code) = ?", [season, code]) : null;
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
  await db().batch([
    { sql: `INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'owner', ?, ?, ?) ON CONFLICT(video_id) DO NOTHING`,
      args: [videoId, Number(ev.season), String(ev.code), kind, kind === "recording" ? day : null, kind === "recording" ? part : null, String(w.channel_id), String(w.title), why.slice(0, 500), at, actor] },
    { sql: "UPDATE official_watch SET status = 'approved', season = ?, code = ?, day = ?, part = ?, decided_at = ?, decided_by = ? WHERE video_id = ?",
      args: [Number(ev.season), String(ev.code), day, part, at, actor, videoId] },
  ], "write");
  forgetOfficial();
  await recordAudit(actor, "officialVideo.approve", { videoId, season: Number(ev.season), code: String(ev.code), kind, day, part, was: String(w.status) });
  return { ok: true };
}

export async function rejectWatched(videoId: string, reason: string | null, actor: string, now = Date.now()): Promise<Result> {
  const w = await get<any>("SELECT status, why FROM official_watch WHERE video_id = ?", [videoId]);
  if (!w) return { ok: false, error: "That video isn't in the review queue." };
  if (!["pending", "ignored"].includes(String(w.status))) return { ok: false, error: `Already ${w.status}.` };
  await run("UPDATE official_watch SET status = 'rejected', decided_at = ?, decided_by = ?, why = ? WHERE video_id = ?",
    [new Date(now).toISOString(), actor, reason ? `${reason.slice(0, 200)} (was: ${w.why})`.slice(0, 500) : String(w.why), videoId]);
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
  forgetOfficial();
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
  const was = await get<any>("SELECT * FROM official_channels WHERE channel_id = ?", [id]);
  // Added (or brought back): watched from now on; edited: the rule changes, what was read stays read.
  await run(`INSERT INTO official_channels (channel_id, title, region, words, title_pattern, watch_from, added_at, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(channel_id) DO UPDATE SET title = excluded.title, region = excluded.region, words = excluded.words, title_pattern = excluded.title_pattern,
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
  const out = await runOfficialWatch(log);
  await recordAudit(actor, "officialVideo.runNow", out ? { ...out } : { busy: true });
  return { ok: true, run: out };
}
