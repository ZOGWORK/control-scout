// Event recordings: the YouTube video an event's page plays, and the second each match starts at in it.
// The owner's stream (server/portal/streams.ts) wins; otherwise FIRST's liveStreamUrl when it names a
// YouTube video (a channel page or Twitch doesn't: Twitch keeps past broadcasts for days only). YouTube's
// timing for each video (video_meta, migration 43) is read in the background (backfillVideoMeta) and kept;
// a broadcast still live is read again every few minutes. Reads are a small season map, cached for a minute.
import { all, run } from "../db.js";
import { registerCache } from "../caches.js";
import { seasonStreams } from "../portal/streams.js";
import { embedUrl, parseStreamUrl } from "../../src/shared/stream.js";
import { actualStart, clipSecond, timingTrusted, watchUrl } from "../../src/shared/recording.js";
import { localToUtcMs } from "../../src/shared/time.js";
import type { EventStream, MatchView } from "../../src/shared/api.js";
import { env } from "../env.js";
import { fetchFromApi, fetchWatchPage, type WatchPageFacts } from "./youtube.js";

export interface VideoMeta extends WatchPageFacts { videoId: string; checkedAt: string }
export interface Recording { videoId: string; source: "owner" | "first"; meta: VideoMeta | null }

const TTL_MS = 60_000;
let cache = new Map<number, { at: number; v: Promise<{ first: Map<string, string>; official: Set<string>; meta: Map<string, VideoMeta> }> }>();
registerCache("Event recordings", () => { cache = new Map(); });

/** A FIRST liveStreamUrl → its YouTube video id, or null (a channel page, Twitch, anything else). */
export function firstVideoId(url: string | null | undefined): string | null {
  if (!url || !/youtu/i.test(url)) return null;
  const p = parseStreamUrl(url);
  return p.ok ? p.videoId : null;
}

const metaOf = (r: any): VideoMeta => ({
  videoId: String(r.video_id), status: r.status, start: r.start ?? null, end: r.end ?? null,
  length: r.duration == null ? null : Number(r.duration), live: !!r.live, checkedAt: String(r.checked_at),
});

function seasonData(season: number, now = Date.now()) {
  const hit = cache.get(season);
  if (hit && now - hit.at < TTL_MS) return hit.v;
  const v = (async () => {
    const [links, official] = await Promise.all([
      all<{ code: string; livestream: string }>("SELECT code, livestream FROM events WHERE season = ? AND livestream LIKE '%youtu%'", [season]),
      // Events with FIRST's own per-match videos (championship-level events, mostly).
      all<{ code: string }>("SELECT DISTINCT code FROM matches WHERE season = ? AND video IS NOT NULL AND video != ''", [season]),
    ]);
    const first = new Map<string, string>();
    for (const l of links) { const id = firstVideoId(l.livestream); if (id) first.set(String(l.code), id); }
    const owner = await seasonStreams(season).catch(() => new Map<string, EventStream>());
    const ids = [...new Set([...first.values(), ...[...owner.values()].map((s) => s.videoId)])];
    const meta = new Map<string, VideoMeta>();
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      for (const r of await all<any>(`SELECT * FROM video_meta WHERE video_id IN (${part.map(() => "?").join(",")})`, part)) meta.set(String(r.video_id), metaOf(r));
    }
    return { first, official: new Set(official.map((o) => String(o.code))), meta };
  })();
  cache.set(season, { at: now, v });
  v.catch(() => { if (cache.get(season)?.v === v) cache.delete(season); });
  return v;
}

/** Every event's recording in a season, by event code; a video YouTube says won't play is left out. */
export async function seasonRecordings(season: number): Promise<Map<string, Recording>> {
  const [{ first, meta }, owner] = await Promise.all([seasonData(season), seasonStreams(season).catch(() => new Map<string, EventStream>())]);
  const out = new Map<string, Recording>();
  for (const [code, videoId] of first) out.set(code, { videoId, source: "first", meta: meta.get(videoId) ?? null });
  for (const [code, s] of owner) out.set(code, { videoId: s.videoId, source: "owner", meta: meta.get(s.videoId) ?? null });
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
    const timed = [...recs].filter(([, r]) => r.meta?.status === "ok" && timingTrusted(r.meta));
    const withClip = new Set<string>();
    for (let i = 0; i < timed.length; i += 200) {
      const part = timed.slice(i, i + 200);
      const rows = await all<{ code: string; time: string; timezone: string | null }>(
        `SELECT m.code, m.time, e.timezone FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
         WHERE m.season = ? AND m.played = 1 AND m.time IS NOT NULL AND m.code IN (${part.map(() => "?").join(",")})`, [season, ...part.map(([c]) => c)]);
      const by = new Map(part);
      for (const r of rows) {
        const code = String(r.code);
        if (withClip.has(code) || !actualStart(r.time)) continue;
        const ms = localToUtcMs(r.time, r.timezone);
        if (ms != null && clipSecond(new Date(ms).toISOString(), by.get(code)!.meta!, now) != null) withClip.add(code);
      }
    }
    for (const [code] of recs) out.set(code, withClip.has(code) ? "clips" : "recording");
    for (const code of official) out.set(code, "clips");
    return out;
  })();
  kinds.set(season, { at: now, v });
  v.catch(() => { if (kinds.get(season)?.v === v) kinds.delete(season); });
  return v;
}

/** The page's player for an event, or null. */
export async function eventRecording(season: number, code: string): Promise<Recording | null> {
  return (await seasonRecordings(season)).get(code) ?? null;
}

export const recordingStream = (r: Recording): EventStream => ({ videoId: r.videoId, streamUrl: embedUrl(r.videoId), ...(r.source === "first" ? { source: "first" as const } : {}) });

/** The matches with their place in the recording (clip); the given objects are never changed. */
export function withClips(matches: MatchView[], r: Recording | null, now = Date.now()): MatchView[] {
  const m = r?.meta;
  if (!r || !m || m.status !== "ok" || !timingTrusted(m)) return matches;
  return matches.map((x) => {
    // Played matches with a real start only: an unplayed one's time, or a result posted without a start, is the schedule.
    const t = x.played && actualStart(x.time) ? clipSecond(x.startsAt, m, now) : null;
    return t == null ? x : { ...x, clip: { videoId: r.videoId, t, url: watchUrl(r.videoId, t) } };
  });
}

/** Store one video's facts and drop the season maps that read them. */
async function saveMeta(videoId: string, f: WatchPageFacts, now: number) {
  await run(
    `INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET status = excluded.status, start = excluded.start, end = excluded.end, duration = excluded.duration, live = excluded.live, checked_at = excluded.checked_at`,
    [videoId, f.status, f.start, f.end, f.length, f.live ? 1 : 0, new Date(now).toISOString()]);
}

const DAY = 86_400_000;
/**
 * When a video's facts are due another read: an error after a day; a live broadcast after 5 minutes; a scheduled
 * one not started yet (live, no start: youtube.ts) after an hour; a broadcast archived within 2 days (its length
 * still settling) after 6 hours.
 */
export function due(m: VideoMeta | null, now: number): boolean {
  if (!m) return true;
  const age = now - Date.parse(m.checkedAt);
  if (m.status === "error") return age > DAY;
  if (m.live) return age > (m.start ? 5 * 60_000 : 3600_000);
  if (m.status === "ok" && m.end && now - Date.parse(m.end) < 2 * DAY) return age > 6 * 3600_000;
  return false;
}

let busy = false;
/**
 * Read YouTube's facts for every linked video that has none yet or is due again (newest seasons first),
 * one page at a time, at most `max` per run. Returns how many it read.
 */
export async function backfillVideoMeta(log: (s: string) => void, opts: { max?: number; gapMs?: number; fetchImpl?: typeof fetch; now?: () => number; apiKey?: string | null } = {}): Promise<number> {
  if (busy) return 0;
  busy = true;
  const now = opts.now ?? Date.now;
  try {
    const links = await all<{ season: number; livestream: string }>("SELECT season, livestream FROM events WHERE livestream LIKE '%youtu%' ORDER BY season DESC, start DESC");
    const owned = await all<{ video_id: string }>("SELECT video_id FROM event_streams");
    const ids = [...new Set([...owned.map((o) => String(o.video_id)), ...links.map((l) => firstVideoId(l.livestream)).filter((x): x is string => !!x)])];
    const known = new Map<string, VideoMeta>();
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      for (const r of await all<any>(`SELECT * FROM video_meta WHERE video_id IN (${part.map(() => "?").join(",")})`, part)) known.set(String(r.video_id), metaOf(r));
    }
    const key = opts.apiKey === undefined ? env.youtubeApiKey : opts.apiKey;
    // With the API, 50 a request (1 quota unit each, of 10,000 a day); without it, one watch page at a time.
    const todo = ids.filter((id) => due(known.get(id) ?? null, now())).slice(0, opts.max ?? (key ? 1000 : 120));
    const fromApi = new Map<string, WatchPageFacts>();
    if (key) for (let i = 0; i < todo.length; i += 50) for (const [id, f] of await fetchFromApi(todo.slice(i, i + 50), key, opts.fetchImpl)) fromApi.set(id, f);
    let n = 0, errors = 0;
    for (const id of todo) {
      if (n && !key) await new Promise((r) => setTimeout(r, opts.gapMs ?? 1500));
      const f = fromApi.get(id) ?? await fetchWatchPage(id, opts.fetchImpl);
      if (f.status === "error") errors++;
      // A page that couldn't be read keeps the facts read before, live included (a broadcast's start doesn't change,
      // and one still live is read again on the live beat).
      const before = known.get(id);
      if (f.status === "error" && before?.status === "ok") await saveMeta(id, before, now());
      else await saveMeta(id, f, now());
      n++;
    }
    if (n) { cache = new Map(); kinds = new Map(); log(`recordings: read ${n} YouTube video${n === 1 ? "" : "s"}${key ? " (API)" : ""}${errors ? `, ${errors} not readable now` : ""}`); }
    return n;
  } finally {
    busy = false;
  }
}
