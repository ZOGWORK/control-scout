// FIRST's stream link when it's a YouTube channel's page (youtube.com/@funroboticsnetwork/streams), which names no
// video: the channel's broadcasts that started on the event's own dates (at the venue) are its recordings, one a
// day for a meet over two days. With YOUTUBE_API_KEY the channel's whole upload list is read back to the event
// (YouTube Data API: channels, playlistItems, videos; a few quota units an event); without it, only the channel's
// streams page (its latest 30 or so), each one's start read from its watch page: an event of the last weeks, or
// an older one whose broadcasts are still among the latest (it gets one look). Kept in event_broadcasts (migration 77); the first is also the event's event_stream_links
// row, so the page plays it like any other link (server/videos/recordings.ts) and the check is noted.
import { all, run } from "../db.js";
import { env } from "../env.js";
import { onEventDates } from "../../src/shared/eventDay.js";
import { isYouTubeHost, parseStreamUrl } from "../../src/shared/stream.js";
import { forgetRecordings } from "./recordings.js";
import { fetchFromApi, fetchWatchPage, type WatchPageFacts } from "./youtube.js";

const DAY_MS = 86_400_000;
/** Events whose last date is at most this long ago are looked for without the key (the streams page holds only the latest). */
const RECENT_DAYS = 14;
/** How far before an event's first date the upload list is read back (a stream set up ahead of time is listed when it was set up). */
const LISTED_BEFORE_DAYS = 45;
/** At most this many pages of 50 uploads a channel (2,500 videos): a busy channel's older events stay unfound. */
const MAX_PAGES = 50;

/** A channel named by a link: its handle (@name), its id (UC…), or an old-style user or custom name. */
export type ChannelRef = { kind: "handle" | "id" | "user" | "custom"; value: string };

/** A YouTube link to a channel's page (its home, /streams, /live, /videos, /featured), or null for anything else (a video's own link included). */
export function channelRef(link: string): ChannelRef | null {
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`); } catch { return null; }
  if (!isYouTubeHost(u.hostname) || parseStreamUrl(link).ok) return null;
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const rest = parts.slice(parts[0]?.startsWith("@") ? 1 : 2);
  if (rest.length > 1 || (rest[0] && !["streams", "live", "videos", "featured"].includes(rest[0]))) return null;
  if (parts[0]?.startsWith("@") && parts[0].length > 1) return { kind: "handle", value: parts[0] };
  if (parts[0] === "channel" && /^UC[\w-]{22}$/.test(parts[1] ?? "")) return { kind: "id", value: parts[1] };
  if (parts[0] === "user" && parts[1]) return { kind: "user", value: parts[1] };
  if (parts[0] === "c" && parts[1]) return { kind: "custom", value: parts[1] };
  return null;
}

/** A channel's page address, for the streams page read without the key. */
const channelPage = (c: ChannelRef) => `https://www.youtube.com/${c.kind === "handle" ? c.value : `${c.kind === "id" ? "channel" : c.kind}/${c.value}`}/streams`;

/** A broadcast on a channel: its video and when it started (UTC ISO). */
export interface Broadcast { videoId: string; start: string }

/** Reads a channel's broadcasts back to a date: "error" when YouTube couldn't be read (tried again later). */
export type ChannelReader = (c: ChannelRef, since: number) => Promise<Broadcast[] | "error">;

const timeout = () => AbortSignal.timeout(20_000);

/** With the key: the channel's uploads, newest first, back to `since`, and each one's broadcast start. */
export function apiReader(key: string, fetchImpl: typeof fetch = fetch): ChannelReader {
  const get = async (path: string, q: Record<string, string>) => {
    const res = await fetchImpl(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...q, key })}`, { signal: timeout() });
    if (!res.ok) throw new Error(`YouTube ${path}: ${res.status}`);
    return res.json() as Promise<any>;
  };
  return async (c, since) => {
    try {
      let id = c.kind === "id" ? c.value : null;
      if (!id && c.kind !== "custom") {
        const body = await get("channels", { part: "id", ...(c.kind === "handle" ? { forHandle: c.value } : { forUsername: c.value }) });
        id = body?.items?.[0]?.id ?? null;
      }
      // A custom (/c/) name has no lookup in the API: its page is read for the channel's id.
      if (!id && c.kind === "custom") {
        const res = await fetchImpl(`https://www.youtube.com/c/${encodeURIComponent(c.value)}`, { headers: PAGE_HEADERS, signal: timeout() });
        id = res.ok ? /"channelId":"(UC[\w-]{22})"/.exec(await res.text())?.[1] ?? null : null;
      }
      if (!id || !/^UC[\w-]{22}$/.test(id)) return [];
      const ids: string[] = [];
      let page: string | undefined;
      for (let n = 0; n < MAX_PAGES; n++) {
        const body = await get("playlistItems", { part: "contentDetails", playlistId: `UU${id.slice(2)}`, maxResults: "50", ...(page ? { pageToken: page } : {}) });
        const items: any[] = Array.isArray(body?.items) ? body.items : [];
        for (const it of items) if (it?.contentDetails?.videoId) ids.push(String(it.contentDetails.videoId));
        const oldest = items.at(-1)?.contentDetails?.videoPublishedAt;
        page = body?.nextPageToken;
        if (!page || !items.length || (oldest && Date.parse(oldest) < since)) break;
      }
      const out: Broadcast[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const facts = await fetchFromApi(ids.slice(i, i + 50), key, fetchImpl);
        if ([...facts.values()].every((f) => f.status === "error")) return "error";
        for (const [videoId, f] of facts) if (f.status === "ok" && f.start) out.push({ videoId, start: f.start });
      }
      return out;
    } catch {
      return "error";
    }
  };
}

const PAGE_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; ControlScout/1.0; +https://controlscout.org)", "Accept-Language": "en", Cookie: "CONSENT=YES+1" };

/** Without the key: the channel's streams page (its latest streams), each one's start from its watch page. */
export function pageReader(fetchImpl: typeof fetch = fetch, facts: (id: string) => Promise<WatchPageFacts> = (id) => fetchWatchPage(id, fetchImpl), gapMs = 1500): ChannelReader {
  return async (c) => {
    try {
      const res = await fetchImpl(channelPage(c), { headers: PAGE_HEADERS, signal: timeout() });
      if (!res.ok) return res.status === 404 ? [] : "error";
      const ids = [...new Set([...(await res.text()).matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]))].slice(0, 30);
      const out: Broadcast[] = [];
      let errors = 0;
      for (const [i, id] of ids.entries()) {
        if (i && gapMs) await new Promise((r) => setTimeout(r, gapMs));
        const f = await facts(id);
        if (f.status === "error") errors++;
        else if (f.status === "ok" && f.start) out.push({ videoId: id, start: f.start });
      }
      return ids.length && errors === ids.length ? "error" : out;
    } catch {
      return "error";
    }
  };
}

/** The broadcasts that started on an event's dates at the venue, earliest first. */
export function onDates(list: Broadcast[], e: { start: string; end: string | null; timezone: string | null }): Broadcast[] {
  const cal = { start: e.start.slice(0, 10), end: (e.end ?? e.start).slice(0, 10), timezone: e.timezone };
  const seen = new Set<string>();
  return list.filter((b) => !seen.has(b.videoId) && seen.add(b.videoId) && onEventDates(cal, Date.parse(b.start)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * When an event's channel link is due a look: never looked, or the link changed: now. On its dates: every
 * 15 minutes (the day's broadcast starts, or the next day's). Up to RECENT_DAYS after: every 2 hours until one is
 * found, then once its dates are 2 days past. Older, with nothing found: weekly (the key may have been set since).
 */
export function channelDue(row: { url: string | null; video_id: string | null; checked_at: string | null }, link: string, e: { start: string; end: string | null }, now: number): boolean {
  if (row.url !== link || !row.checked_at) return true;
  const age = now - Date.parse(row.checked_at), last = Date.parse(`${(e.end ?? e.start).slice(0, 10)}T00:00:00Z`) + DAY_MS;
  if (now < last + DAY_MS) return age > 15 * 60_000; // its dates (with a day's slack for any zone)
  const checkedAfter = Date.parse(row.checked_at) - last;
  if (row.video_id) return checkedAfter < 2 * DAY_MS && age > 2 * 3600_000;
  if (now - last < RECENT_DAYS * DAY_MS) return age > 2 * 3600_000;
  return age > 7 * DAY_MS;
}

let busy = false;
/**
 * Look for the broadcasts of events whose FIRST link is a YouTube channel's page, at most `max` events a run (on
 * now first, then the most recent). Returns how many events' videos changed. A failed read keeps what was found.
 */
export async function resolveChannelStreams(log: (s: string) => void, opts: { max?: number; now?: () => number; reader?: ChannelReader; withKey?: boolean } = {}): Promise<number> {
  if (busy) return 0;
  busy = true;
  try {
    const now = (opts.now ?? Date.now)();
    const key = env.youtubeApiKey;
    const withKey = opts.withKey ?? !!key;
    const reader = opts.reader ?? (key ? apiReader(key) : pageReader());
    const rows = await all<{ season: number; code: string; start: string; end: string | null; timezone: string | null; livestream: string; url: string | null; video_id: string | null; checked_at: string | null }>(
      `SELECT e.season, e.code, e.start, e.end, e.timezone, e.livestream, l.url, l.video_id, l.checked_at FROM events e
       LEFT JOIN event_stream_links l ON l.season = e.season AND l.code = e.code
       WHERE e.livestream LIKE '%youtu%' AND e.start IS NOT NULL AND substr(e.start, 1, 10) <= ?
       ORDER BY e.start DESC`, [new Date(now + DAY_MS).toISOString().slice(0, 10)]);
    const todo = rows.filter((r) => {
      if (!channelRef(r.livestream)) return false;
      // Without the key the streams page holds only the latest: an older event gets one look (its broadcasts may
      // still be among them), never the weekly ones.
      if (!withKey && now - Date.parse(`${(r.end ?? r.start).slice(0, 10)}T00:00:00Z`) > (RECENT_DAYS + 1) * DAY_MS && r.url === r.livestream && r.checked_at) return false;
      return channelDue(r, r.livestream, r, now);
    }).slice(0, opts.max ?? (withKey ? 10 : 3));
    // One read a channel a run: a league's meets share it.
    const read = new Map<string, Promise<Broadcast[] | "error">>();
    let changed = 0;
    for (const r of todo) {
      const c = channelRef(r.livestream)!;
      const since = Date.parse(`${r.start.slice(0, 10)}T00:00:00Z`) - LISTED_BEFORE_DAYS * DAY_MS;
      // A read for one event serves another of the same channel only if it reached back as far (the streams page
      // read without the key is the same whatever the date).
      const k = `${c.kind}:${c.value.toLowerCase()}${withKey ? `:${since}` : ""}`;
      const got = await (read.get(k) ?? read.set(k, reader(c, since)).get(k)!);
      if (got === "error") continue;
      const found = onDates(got, r);
      const before = (await all<{ video_id: string }>("SELECT video_id FROM event_broadcasts WHERE season = ? AND code = ? AND url = ? ORDER BY start", [r.season, r.code, r.livestream])).map((x) => String(x.video_id));
      // Nothing found now, by a link already looked at: what was found before stays (a video made private for a while).
      const keep = found.length || r.url !== r.livestream ? found : before.map((videoId) => ({ videoId, start: "" }));
      if (keep.map((b) => b.videoId).join() !== before.join() || r.url !== r.livestream) changed++;
      if (found.length || r.url !== r.livestream) {
        await run("DELETE FROM event_broadcasts WHERE season = ? AND code = ?", [r.season, r.code]);
        for (const b of found) await run("INSERT INTO event_broadcasts (season, code, video_id, url, start) VALUES (?, ?, ?, ?, ?)", [r.season, r.code, b.videoId, r.livestream, b.start]);
      }
      await run(
        `INSERT INTO event_stream_links (season, code, url, video_id, checked_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(season, code) DO UPDATE SET url = excluded.url, video_id = excluded.video_id, checked_at = excluded.checked_at`,
        [r.season, r.code, r.livestream, keep[0]?.videoId ?? null, new Date(now).toISOString()]);
    }
    if (changed) { forgetRecordings(); log(`recordings: ${changed} event${changed === 1 ? "" : "s"}' channel broadcasts found or changed`); }
    return changed;
  } finally {
    busy = false;
  }
}
