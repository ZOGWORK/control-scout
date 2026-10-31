// FIRST's stream link when it isn't a YouTube link itself: a region's short link (ftcwa.live/bardeen) that
// redirects to the meet's YouTube broadcast. Followed in the background while the event is on (a day either
// side of its dates) and the video it lands on kept per event (event_stream_links, migration 66), so the
// event page plays it like any other FIRST YouTube link (server/videos/recordings.ts). Only redirects are
// followed, never a page read: the hop that names a YouTube host ends it, and YouTube itself is never fetched.
// Once the event is over its video stays: the same short link is pointed at the next meet's broadcast.
import { all, run } from "../db.js";
import { firstVideoId, forgetRecordings } from "./recordings.js";

const MAX_HOPS = 5;
const TIMEOUT_MS = 8000;
/** A link that led to a video is followed again after 15 minutes (a broadcast restarted under a new id); one that led nowhere, after 2 hours. */
const AGAIN_FOUND_MS = 15 * 60_000;
const AGAIN_NONE_MS = 2 * 3600_000;
/** Hosts whose links are the stream itself, never a redirect to YouTube. */
const NOT_SHORT = /(^|\.)(twitch\.tv|youtube\.com|youtu\.be|youtube-nocookie\.com|facebook\.com|vimeo\.com)$/i;

/** A link this server may fetch: http(s) on the default port to a public name (no address literal, localhost or internal name). */
export function followable(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.port || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(h);
}

/** Where a short link leads: the YouTube video id its redirects end at, or null (no redirect, not YouTube, a channel page, an error). */
export async function resolveShortLink(link: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!followable(u)) return null;
    let res: Response;
    try {
      res = await fetchImpl(u.href, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "ControlScout/1 (+https://controlscout.org)" } });
    } catch { return null; }
    await res.body?.cancel().catch(() => {});
    const to = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!to) return null;
    try { u = new URL(to, u); } catch { return null; }
    if (/youtu/i.test(u.hostname)) return firstVideoId(u.href);
  }
  return null;
}

/** Whether an event's link is due a follow: a new or changed link, or the last answer is old enough. */
export function linkDue(row: { url: string | null; video_id: string | null; checked_at: string | null }, link: string, now: number): boolean {
  if (row.url !== link || !row.checked_at) return true;
  return now - Date.parse(row.checked_at) > (row.video_id ? AGAIN_FOUND_MS : AGAIN_NONE_MS);
}

let busy = false;
/**
 * Follow the short stream links of events on now (from the day before their start to the day after their end),
 * at most `max` a run. Returns how many links led somewhere new (a video found, changed or lost).
 */
export async function resolveStreamLinks(log: (s: string) => void, opts: { max?: number; fetchImpl?: typeof fetch; now?: () => number } = {}): Promise<number> {
  if (busy) return 0;
  busy = true;
  try {
    const now = (opts.now ?? Date.now)();
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const rows = await all<{ season: number; code: string; livestream: string; url: string | null; video_id: string | null; checked_at: string | null }>(
      `SELECT e.season, e.code, e.livestream, l.url, l.video_id, l.checked_at FROM events e
       LEFT JOIN event_stream_links l ON l.season = e.season AND l.code = e.code
       WHERE e.livestream LIKE 'http%' AND e.livestream NOT LIKE '%youtu%'
         AND substr(e.start, 1, 10) <= ? AND substr(COALESCE(e.end, e.start), 1, 10) >= ?
       ORDER BY e.start`, [day(now + 86_400_000), day(now - 86_400_000)]);
    const todo = rows.filter((r) => {
      try { return !NOT_SHORT.test(new URL(r.livestream).hostname); } catch { return false; }
    }).filter((r) => linkDue(r, r.livestream, now)).slice(0, opts.max ?? 60);
    let changed = 0;
    for (const r of todo) {
      const id = await resolveShortLink(r.livestream, opts.fetchImpl);
      if (r.url !== r.livestream || id !== r.video_id) changed++;
      await run(
        `INSERT INTO event_stream_links (season, code, url, video_id, checked_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(season, code) DO UPDATE SET url = excluded.url, video_id = excluded.video_id, checked_at = excluded.checked_at`,
        [r.season, r.code, r.livestream, id, new Date(now).toISOString()]);
    }
    if (changed) forgetRecordings();
    if (changed) log(`recordings: ${changed} short stream link${changed === 1 ? "" : "s"} led somewhere new`);
    return changed;
  } finally {
    busy = false;
  }
}
