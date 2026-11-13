// Event recordings: the YouTube video an event's page plays, and the second each match starts at in it.
// The owner's stream (server/portal/streams.ts) wins; otherwise FIRST's liveStreamUrl when it names a
// YouTube video (a channel page or Twitch doesn't: Twitch keeps past broadcasts for days only), or the video
// a short link there redirects to (server/videos/streamLinks.ts). YouTube's
// timing for each video (video_meta, migration 43) is read in the background (backfillVideoMeta) and kept;
// a broadcast still live is read again every few minutes. A video much shorter than its broadcast also has its
// chapters read (from the watch page) and kept: they can show its seconds still follow the clock (chaptersConfirm).
// Reads are a small season map, cached for a minute.
import { all, run } from "../db.js";
import { registerCache } from "../caches.js";
import { seasonStreams } from "../portal/streams.js";
import { embedUrl, parseStreamUrl } from "../../src/shared/stream.js";
import { CHAPTER_MIN_GAP_S, CLIP_LEAD_S, actualStart, chaptersConfirm, clearOfPrevious, clipSecond, gapSlack, timingTrusted, watchUrl, type Chapter } from "../../src/shared/recording.js";
import { localToUtcMs } from "../../src/shared/time.js";
import type { EventStream, MatchView } from "../../src/shared/api.js";
import { env } from "../env.js";
import { fetchFromApi, fetchWatchPage, type WatchPageFacts } from "./youtube.js";
import { officialRecordingIds, seasonOfficial } from "./officialVideos.js";
import { checkedTo } from "../data/checkedTimings.js";
import { frameStart, hasFrames } from "../data/frameTimings.js";

export interface VideoMeta extends WatchPageFacts { videoId: string; checkedAt: string }
/** One of a recording's videos. day: its broadcast's date at the venue, when an official list gave it; part: a named
 *  part of a day that has more than one video ("Awards"). */
export interface RecordingVideo { videoId: string; meta: VideoMeta | null; day?: string | null; part?: string | null }
/** An event's recording: its video, and, for an event broadcast a day at a time (a channel's broadcasts, or the
 *  organiser's official days), the other days' videos in broadcast order. */
export interface Recording extends RecordingVideo {
  /** owner: the owner's stream; official: an organiser's recording (officialVideos.ts); first: FIRST's link, or the
   *  short link or channel FIRST's event page gives. */
  source: "owner" | "first" | "official"; more?: RecordingVideo[];
  /** The event it's the recording of (its frame-read timings are kept by event: server/data/frameTimings.ts). */
  code?: string;
  /** Broadcast a day at a time (event_broadcasts): each video holds its own day's matches only, even when one day is left. */
  daily?: true;
}

const TTL_MS = 60_000;
type SeasonData = { first: Map<string, string>; more: Map<string, string[]>; daily: Set<string>; official: Set<string>; meta: Map<string, VideoMeta>; extra: Map<string, { day: string | null; part: string | null }> };
let cache = new Map<number, { at: number; v: Promise<SeasonData>; ready?: boolean }>();
registerCache("Event recordings", () => { cache = new Map(); });

/** A FIRST liveStreamUrl → its YouTube video id, or null (a channel page, Twitch, anything else). */
export function firstVideoId(url: string | null | undefined): string | null {
  if (!url || !/youtu/i.test(url)) return null;
  const p = parseStreamUrl(url);
  return p.ok ? p.videoId : null;
}

/** The video_meta columns metaOf reads (all of them). */
const META_COLUMNS = "video_id, status, start, end, duration, live, checked_at, chapters";
const metaOf = (r: any): VideoMeta => ({
  videoId: String(r.video_id), status: r.status, start: r.start ?? null, end: r.end ?? null,
  length: r.duration == null ? null : Number(r.duration), live: !!r.live, checkedAt: String(r.checked_at),
  ...(r.chapters == null ? {} : { chapters: readChapters(r.chapters) }),
});
function readChapters(json: string): Chapter[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((c): c is Chapter => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "string") : [];
  } catch { return []; }
}

/** Whether a finished broadcast's video falls far enough short of it that its chapters are worth reading (chaptersConfirm). */
export function cutShort(f: { status: string; start: string | null; end: string | null; length: number | null; live: boolean }): boolean {
  if (f.status !== "ok" || f.live || !f.start || !f.end || f.length == null) return false;
  return (Date.parse(f.end) - Date.parse(f.start)) / 1000 - f.length > CHAPTER_MIN_GAP_S;
}

function seasonData(season: number, now = Date.now()) {
  const hit = cache.get(season);
  if (hit && now - hit.at < TTL_MS) return hit.v;
  const v = (async () => {
    const [links, short, official, days] = await Promise.all([
      all<{ code: string; livestream: string }>("SELECT code, livestream FROM events WHERE season = ? AND livestream LIKE '%youtu%'", [season]),
      // Short links followed while their event was on, while FIRST still gives the same link.
      all<{ code: string; video_id: string }>(
        `SELECT l.code, l.video_id FROM event_stream_links l JOIN events e ON e.season = l.season AND e.code = l.code
         WHERE l.season = ? AND l.video_id IS NOT NULL AND e.livestream = l.url`, [season]),
      // Events with FIRST's own per-match videos (championship-level events, mostly).
      all<{ code: string }>("SELECT DISTINCT code FROM matches WHERE season = ? AND video IS NOT NULL AND video != ''", [season]),
      // A channel's broadcasts on the event's dates (server/videos/channelStreams.ts), while FIRST still gives that channel.
      all<{ code: string; video_id: string }>(
        `SELECT b.code, b.video_id FROM event_broadcasts b JOIN events e ON e.season = b.season AND e.code = b.code
         WHERE b.season = ? AND e.livestream = b.url ORDER BY b.code, b.start`, [season]),
    ]);
    const first = new Map<string, string>();
    for (const l of links) { const id = firstVideoId(l.livestream); if (id) first.set(String(l.code), id); }
    for (const l of short) first.set(String(l.code), String(l.video_id));
    // The other days' broadcasts of an event whose first one is its video.
    const more = new Map<string, string[]>();
    const daily = new Set(days.map((d) => String(d.code)));
    for (const d of days) {
      const code = String(d.code), id = String(d.video_id);
      if (first.get(code) !== id) (more.get(code) ?? more.set(code, []).get(code)!).push(id);
    }
    // Official recordings (server/videos/officialVideos.ts): an organiser's day broadcasts, checked against the event.
    // An event without a link of FIRST's gets its first day as its video; every other day joins it, a day at a time.
    const extra = new Map<string, { day: string | null; part: string | null }>();
    for (const o of (await seasonOfficial(season).catch(() => [])).filter((x) => x.kind === "recording")) {
      extra.set(o.videoId, { day: o.day ?? null, part: o.part ?? null });
      const list = more.get(o.code) ?? [];
      if (!first.has(o.code)) first.set(o.code, o.videoId);
      else if (first.get(o.code) !== o.videoId && !list.includes(o.videoId)) more.set(o.code, [...list, o.videoId]);
      if (more.get(o.code)?.length) daily.add(o.code);
    }
    const owner = await seasonStreams(season).catch(() => new Map<string, EventStream>());
    const ids = [...new Set([...first.values(), ...[...more.values()].flat(), ...[...owner.values()].map((s) => s.videoId)])];
    const meta = new Map<string, VideoMeta>();
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      for (const r of await all<any>(`SELECT ${META_COLUMNS} FROM video_meta WHERE video_id IN (${part.map(() => "?").join(",")})`, part)) meta.set(String(r.video_id), metaOf(r));
    }
    return { first, more, daily, official: new Set(official.map((o) => String(o.code))), meta, extra };
  })();
  // A map read before keeps being given while its next read runs (search reads these on its answer path: a read
  // costs a season's matches); forgetRecordings drops it at once when the links change.
  const entry = hit?.ready ? { at: now, v: hit.v, ready: true } : { at: now, v };
  cache.set(season, entry);
  v.then(() => { if (cache.get(season) === entry) cache.set(season, { at: now, v, ready: true }); },
    () => { if (cache.get(season) === entry) { if (entry.v === v) cache.delete(season); else entry.at = 0; } });
  return entry.v;
}

/** When a recording's video was broadcast, for ordering its days: the broadcast's start, else the list's day. */
const dayKey = (v: RecordingVideo) => v.meta?.start ?? (v.day ? `${v.day}T12:00:00Z` : "9999");

/** Every event's recording in a season, by event code; a video YouTube says won't play is left out. */
export async function seasonRecordings(season: number): Promise<Map<string, Recording>> {
  const [{ first, more, daily, meta, extra }, owner] = await Promise.all([seasonData(season), seasonStreams(season).catch(() => new Map<string, EventStream>())]);
  const out = new Map<string, Recording>();
  for (const [code, videoId] of first) {
    // Every day YouTube still plays, in order: the first of them is the event's video (a day made private leaves the others).
    const all = [videoId, ...(more.get(code) ?? [])].map((id): RecordingVideo => ({ videoId: id, meta: meta.get(id) ?? null, ...(extra.get(id) ?? {}) })).filter((d) => d.meta?.status !== "unavailable");
    // A day at a time: in the order they were broadcast (FIRST's link can be any of the days).
    if (all.length > 1) all.sort((a, b) => dayKey(a).localeCompare(dayKey(b)));
    const [main, ...days] = all;
    if (main) out.set(code, { ...main, code, source: extra.has(main.videoId) ? "official" : "first", ...(days.length ? { more: days } : {}), ...(daily.has(code) ? { daily: true as const } : {}) });
  }
  for (const [code, s] of owner) out.set(code, { videoId: s.videoId, code, source: "owner", meta: meta.get(s.videoId) ?? null });
  for (const [code, r] of out) if (r.meta?.status === "unavailable") out.delete(code);
  return out;
}

const KINDS_TTL_MS = 10 * 60_000;
let kinds = new Map<number, { at: number; v: Promise<Map<string, "clips" | "recording">> }>();
registerCache("Event video kinds", () => { kinds = new Map(); });

/**
 * What the events list says about an event's video: match clips (FIRST's per-match videos, or a recording
 * at least one played match gets a second in), a recording, or nothing. The clip check reads the played
 * matches of events with a trusted recording (a few hundred a season), so it's kept for 10 minutes.
 */
export function seasonVideoKinds(season: number, now = Date.now()): Promise<Map<string, "clips" | "recording">> {
  const hit = kinds.get(season);
  if (hit && now - hit.at < KINDS_TTL_MS) return hit.v;
  const v = (async () => {
    const [recs, { official }] = await Promise.all([seasonRecordings(season), seasonData(season)]);
    const out = new Map<string, "clips" | "recording">();
    // Every recording with a broadcast start: whether its timing holds can depend on the event's last match (timingTrusted).
    const timed = [...recs].filter(([, r]) => [r.meta, ...(r.more ?? []).map((d) => d.meta)].some((m) => m?.status === "ok" && m.start));
    // A recording with a played match read off its own frames (server/data/frameTimings.ts) has clips.
    const withClip = new Set<string>();
    const framed = [...recs].filter(([code, r]) => [r, ...(r.more ?? [])].some((d) => hasFrames(d.videoId, code)));
    if (framed.length) {
      const rows = await all<{ code: string; label: string }>(`SELECT code, label FROM matches WHERE season = ? AND played = 1 AND code IN (${framed.map(() => "?").join(",")})`, [season, ...framed.map(([c]) => c)]);
      const recOf = new Map(framed);
      for (const r of rows) {
        const rec = recOf.get(String(r.code))!;
        if ([rec, ...(rec.more ?? [])].some((d) => d.meta?.status !== "unavailable" && frameStart(d.videoId, String(r.code), String(r.label)) != null)) withClip.add(String(r.code));
      }
    }
    for (let i = 0; i < timed.length; i += 200) {
      const part = timed.slice(i, i + 200);
      const rows = await all<{ code: string; label: string; time: string; timezone: string | null }>(
        `SELECT m.code, m.label, m.time, e.timezone FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
         WHERE m.season = ? AND m.played = 1 AND m.time IS NOT NULL AND m.code IN (${part.map(() => "?").join(",")})`, [season, ...part.map(([c]) => c)]);
      const starts = new Map<string, (MatchStart & { time: string })[]>();
      for (const r of rows) {
        if (!actualStart(r.time)) continue;
        const ms = localToUtcMs(r.time, r.timezone);
        if (ms == null) continue;
        const code = String(r.code);
        (starts.get(code) ?? starts.set(code, []).get(code)!).push({ label: String(r.label), time: String(r.time), startsAt: new Date(ms).toISOString() });
      }
      for (const [code, rec] of part) {
        const s = starts.get(code);
        if (!s) continue;
        // The same check as the page's (each day's video on its own day's matches).
        const played = s.map((x) => ({ label: x.label, time: x.time, startsAt: x.startsAt ?? null, played: true, clip: undefined }));
        if (withClips(played, rec, now, eventSpan(s.map(({ label, startsAt }) => ({ label, startsAt })))).some((x) => x.clip)) withClip.add(code);
      }
    }
    for (const [code] of recs) out.set(code, withClip.has(code) ? "clips" : "recording");
    for (const code of official) out.set(code, "clips");
    // A championship's divisions are filmed, the event above them rarely is (FIRST links each division's stream): it
    // shows the best of its divisions' video, so the list's Video filter and badge find it (USTXCMP4 2026: its Aero
    // and Terra Divisions had video, it had none).
    const divisions = await all<{ code: string; parent: string }>("SELECT code, division_code AS parent FROM events WHERE season = ? AND division_code IS NOT NULL AND division_code != code", [season]);
    for (const d of divisions) {
      const k = out.get(String(d.code)), parent = String(d.parent);
      if (k && out.get(parent) !== "clips") out.set(parent, k);
    }
    return out;
  })();
  kinds.set(season, { at: now, v });
  v.catch(() => { if (kinds.get(season)?.v === v) kinds.delete(season); });
  return v;
}

/** Drop the season maps, after the links they're read from changed. */
export function forgetRecordings() { cache = new Map(); kinds = new Map(); }

/** The page's player for an event, or null. */
export async function eventRecording(season: number, code: string): Promise<Recording | null> {
  return (await seasonRecordings(season)).get(code) ?? null;
}

export const recordingStream = (r: Recording, timezone?: string | null): EventStream => ({
  videoId: r.videoId, streamUrl: embedUrl(r.videoId), ...(r.source !== "owner" ? { source: r.source } : {}),
  // A day at a time: each day's video, named by its weekday at the venue (the broadcast's start).
  // A day with a second video (the awards) names it: "Sunday · Awards".
  ...(r.more?.length ? { days: [r, ...r.more].map((d) => ({ videoId: d.videoId, label: dayLabel(d.meta?.start ?? (d.day ? `${d.day}T12:00:00Z` : null), d.meta?.start ? timezone : "UTC") + (d.part ? ` · ${d.part}` : "") })) } : {}),
});

/** A broadcast's weekday at the venue ("Saturday"); "Day" when its start isn't known. */
export function dayLabel(start: string | null | undefined, timezone: string | null | undefined): string {
  const t = start ? Date.parse(start) : NaN;
  if (!Number.isFinite(t)) return "Day";
  try { return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone ?? "UTC" }).format(t); } catch { return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(t); }
}

export interface MatchSpan { firstMatch: string | null; lastMatch: string | null }
export interface MatchStart { label: string; startsAt: string | null | undefined }
/** An event's played matches with a real start: their span (timingTrusted), and each one, for its chapter (chaptersConfirm). */
export interface EventSpan extends MatchSpan { starts: MatchStart[] }

const eventSpan = (starts: MatchStart[]): EventSpan => ({ ...matchSpan(starts.map((s) => s.startsAt)), starts });

/** A video's timing for an event: its span, and, when that alone can't be trusted, how far the video's chapters vouch
 *  for it, or else how far its frames were checked by eye (server/data/checkedTimings.ts). */
function withConfirmed(videoId: string, meta: VideoMeta, span: EventSpan) {
  const { starts, ...rest } = span;
  const timing = { ...meta, ...rest };
  return timingTrusted(timing) ? timing : { ...timing, confirmedTo: chaptersConfirm(timing, meta.chapters, starts) ?? checkedTo(videoId) };
}

/** The earliest and latest of some UTC ISO match starts. */
export function matchSpan(times: (string | null | undefined)[]): MatchSpan {
  let first: string | null = null, last: string | null = null;
  for (const t of times) {
    if (!t || !Number.isFinite(Date.parse(t))) continue;
    if (!first || Date.parse(t) < Date.parse(first)) first = t;
    if (!last || Date.parse(t) > Date.parse(last)) last = t;
  }
  return { firstMatch: first, lastMatch: last };
}

/** An event's played matches with a real start, read on their own (for a route that has one match). */
export async function eventMatchSpan(season: number, code: string): Promise<EventSpan> {
  const rows = await all<{ label: string; time: string; timezone: string | null }>(
    `SELECT m.label, m.time, e.timezone FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
     WHERE m.season = ? AND m.code = ? AND m.played = 1 AND m.time IS NOT NULL`, [season, code]);
  return eventSpan(rows.filter((r) => actualStart(r.time)).map((r) => { const ms = localToUtcMs(r.time, r.timezone); return { label: String(r.label), startsAt: ms == null ? null : new Date(ms).toISOString() }; }));
}

/**
 * The matches with their place in the recording (clip); the given objects are never changed. `span`: the event's
 * played matches (timingTrusted, chaptersConfirm), read from `matches` when they're the whole event. A match whose
 * start was read off the recording's frames (server/data/frameTimings.ts) plays from there, whatever YouTube's facts
 * say; `frames: false` leaves those out (the script that reads them, for what the facts alone give).
 */
export function withClips<M extends Pick<MatchView, "label" | "time" | "startsAt" | "played" | "clip">>(matches: M[], r: Recording | null, now = Date.now(), span?: EventSpan, opts: { frames?: boolean } = {}): M[] {
  if (!r) return matches;
  // The recording's videos YouTube still plays, for their frame-read starts.
  const framed = opts.frames === false || !r.code ? [] : [{ videoId: r.videoId, meta: r.meta }, ...(r.more ?? [])].filter((v) => v.meta?.status !== "unavailable" && hasFrames(v.videoId, r.code!));
  const fromFrames = (label: string) => {
    for (const v of framed) {
      const s = frameStart(v.videoId, r.code!, label);
      if (s != null) { const t = Math.max(0, s - CLIP_LEAD_S); return { videoId: v.videoId, t, url: watchUrl(v.videoId, t) }; }
    }
    return null;
  };
  const whole = span ?? eventSpan(matches.filter((x) => x.played && actualStart(x.time)).map((x) => ({ label: x.label, startsAt: x.startsAt })));
  // Each video with its timing, judged on the matches it holds: the event's all for one video, a day's for a day's video.
  const videos = [{ videoId: r.videoId, meta: r.meta }, ...(r.more ?? [])].flatMap((v) => {
    const meta = v.meta;
    if (!meta || meta.status !== "ok") return [];
    const held = r.daily || r.more?.length ? eventSpan(whole.starts.filter((s) => within(s.startsAt, meta, now))) : whole;
    const timing = withConfirmed(v.videoId, meta, held);
    const slack = gapSlack(timing);
    // Its matches' starts in order: an early clip must be clear of the one before (clearOfPrevious).
    const starts = held.starts.map((s) => (s.startsAt ? Date.parse(s.startsAt) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
    return slack == null ? [] : [{ videoId: v.videoId, timing, slack, starts }];
  });
  if (!videos.length && !framed.length) return matches;
  return matches.map((x) => {
    // Seen being played in the recording's own frames.
    const seen = x.played && framed.length ? fromFrames(x.label) : null;
    if (seen) return { ...x, clip: seen };
    // Played matches with a real start only: an unplayed one's time, or a result posted without a start, is the schedule.
    if (!x.played || !actualStart(x.time)) return x;
    for (const v of videos) {
      const t = clipSecond(x.startsAt, v.timing, now);
      if (t == null || !clearOfPrevious(x.startsAt, v.slack ? previousStart(v.starts, x.startsAt) : null, v.slack)) continue;
      return { ...x, clip: { videoId: v.videoId, t, url: watchUrl(v.videoId, t), ...(v.slack ? { early: v.slack } : {}) } };
    }
    return x;
  });
}

/** The latest of some match starts (ms, in order) before a match's start, as UTC ISO; null for none. */
function previousStart(starts: number[], startsAt: string | null | undefined): string | null {
  const at = startsAt ? Date.parse(startsAt) : NaN;
  let prev: number | null = null;
  for (const s of starts) { if (s >= at) break; prev = s; }
  return prev == null ? null : new Date(prev).toISOString();
}

/** The video of a recording that holds a match's start (a day's video, for an event broadcast a day at a time), else
 *  its first one. */
export function recordingAt(r: Recording, startsAt: string | null | undefined, now = Date.now()): { videoId: string; meta: VideoMeta | null } {
  const all = [{ videoId: r.videoId, meta: r.meta }, ...(r.more ?? [])];
  return all.find((v) => v.meta?.status === "ok" && within(startsAt, v.meta, now)) ?? all[0];
}

/** Whether a match start falls inside a broadcast (from its start to its end, or to now while it's live). */
function within(startsAt: string | null | undefined, m: VideoMeta, now: number): boolean {
  const at = startsAt ? Date.parse(startsAt) : NaN, from = m.start ? Date.parse(m.start) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(from) || at < from) return false;
  const to = m.end ? Date.parse(m.end) : m.live ? now : m.length != null ? from + m.length * 1000 : Infinity;
  return at <= to;
}

/** Store one video's facts and drop the season maps that read them. */
async function saveMeta(videoId: string, f: WatchPageFacts, now: number) {
  // Chapters not read this time (the Data API, a watch page that failed), or a page served without them, keep the ones read before.
  await run(
    `INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at, chapters) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET status = excluded.status, start = excluded.start, end = excluded.end, duration = excluded.duration, live = excluded.live, checked_at = excluded.checked_at,
       chapters = COALESCE(NULLIF(excluded.chapters, '[]'), video_meta.chapters, excluded.chapters)`,
    [videoId, f.status, f.start, f.end, f.length, f.live ? 1 : 0, new Date(now).toISOString(), f.chapters ? JSON.stringify(f.chapters) : null]);
}

const DAY = 86_400_000;
/**
 * When a video's facts are due another read: an error after a day (15 minutes with an API key); a live broadcast after 5 minutes; a scheduled
 * one not started yet (live, no start: youtube.ts) after an hour; a broadcast archived within 2 days (its length
 * still settling) after 6 hours. A video cut far short of its broadcast whose chapters were never read: after a day
 * (at once for one read before chapters were kept); one read with none (none yet, or a page served without them): weekly.
 */
export function due(m: VideoMeta | null, now: number, withKey = false): boolean {
  if (!m) return true;
  const age = now - Date.parse(m.checkedAt);
  // With the API key an error is rare (network, quota) and the API answers servers, so it's tried again soon:
  // that also picks up, within minutes, every video the watch page refused before the key was set.
  if (m.status === "error") return age > (withKey ? 15 * 60_000 : DAY);
  if (m.live) return age > (m.start ? 5 * 60_000 : 3600_000);
  if (m.status === "ok" && m.end && now - Date.parse(m.end) < 2 * DAY) return age > 6 * 3600_000;
  if (cutShort(m) && !m.chapters?.length) return age > (m.chapters ? 7 * DAY : DAY);
  return false;
}

/** When the pass in progress began (0: none). One pass at a time, but a pass that never finishes (a read that never
 *  settles) mustn't stop every later one: after STUCK_MS the next run starts anew. */
let busy = 0;
const STUCK_MS = 30 * 60_000;
/**
 * Read YouTube's facts for every linked video that has none yet or is due again (newest seasons first),
 * one page at a time, at most `max` per run. Returns how many it read.
 */
export async function backfillVideoMeta(log: (s: string) => void, opts: { max?: number; gapMs?: number; fetchImpl?: typeof fetch; now?: () => number; apiKey?: string | null; stuckMs?: number } = {}): Promise<number> {
  const began = Date.now();
  if (busy && began - busy < (opts.stuckMs ?? STUCK_MS)) return 0;
  if (busy) log(`recordings: the pass begun ${new Date(busy).toISOString()} never finished; starting anew`);
  busy = began;
  const now = opts.now ?? Date.now;
  try {
    const links = await all<{ season: number; livestream: string }>("SELECT season, livestream FROM events WHERE livestream LIKE '%youtu%' ORDER BY season DESC, start DESC");
    const owned = await all<{ video_id: string }>("SELECT video_id FROM event_streams UNION SELECT video_id FROM event_stream_links WHERE video_id IS NOT NULL UNION SELECT video_id FROM event_broadcasts");
    const ids = [...new Set([...owned.map((o) => String(o.video_id)), ...links.map((l) => firstVideoId(l.livestream)).filter((x): x is string => !!x), ...await officialRecordingIds().catch(() => [])])];
    const known = new Map<string, VideoMeta>();
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      for (const r of await all<any>(`SELECT ${META_COLUMNS} FROM video_meta WHERE video_id IN (${part.map(() => "?").join(",")})`, part)) known.set(String(r.video_id), metaOf(r));
    }
    const key = opts.apiKey === undefined ? env.youtubeApiKey : opts.apiKey;
    // With the API, 50 a request (1 quota unit each, of 10,000 a day); without it, one watch page at a time.
    const todo = ids.filter((id) => due(known.get(id) ?? null, now(), !!key)).slice(0, opts.max ?? (key ? 1000 : 120));
    const fromApi = new Map<string, WatchPageFacts>();
    if (key) for (let i = 0; i < todo.length; i += 50) for (const [id, f] of await fetchFromApi(todo.slice(i, i + 50), key, opts.fetchImpl)) fromApi.set(id, f);
    let n = 0, errors = 0;
    for (const id of todo) {
      if (n && !key) await new Promise((r) => setTimeout(r, opts.gapMs ?? 1500));
      let f = fromApi.get(id) ?? await fetchWatchPage(id, opts.fetchImpl);
      // Cut far short of its broadcast: its chapters, from the watch page (the API doesn't give them), can confirm its
      // timing. YouTube now and then serves the page without them, so a read that finds none is tried once more.
      // A watch page read above counts as the first try.
      for (let tries = fromApi.has(id) ? 0 : 1; cutShort(f) && !f.chapters?.length && tries < 2; tries++) {
        await new Promise((r) => setTimeout(r, opts.gapMs ?? 1500));
        const w = await fetchWatchPage(id, opts.fetchImpl);
        // A sign-in wall's page (an error) still gives the chapters (parseWatchPage); its other facts aren't read.
        if (w.status === "ok" || w.chapters?.length) f = { ...f, chapters: w.chapters ?? [] };
      }
      if (f.status === "error") errors++;
      // A page that couldn't be read keeps the facts read before, live included (a broadcast's start doesn't change,
      // and one still live is read again on the live beat).
      const before = known.get(id);
      // Overtaken while it waited (a newer pass began): what this one read may be older than what that one saves.
      if (busy !== began) break;
      // A sign-in wall's chapters join them.
      if (f.status === "error" && before?.status === "ok") await saveMeta(id, f.chapters?.length ? { ...before, chapters: f.chapters } : before, now());
      else await saveMeta(id, f, now());
      n++;
    }
    if (n) { forgetRecordings(); log(`recordings: read ${n} YouTube video${n === 1 ? "" : "s"}${key ? " (API)" : ""}${errors ? `, ${errors} not readable now` : ""}`); }
    return n;
  } finally {
    // Only this pass's own end frees the way (a stuck pass that ends late leaves the newer one be).
    if (busy === began) busy = 0;
  }
}
