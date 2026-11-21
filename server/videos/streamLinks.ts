// FIRST's stream link when it isn't a YouTube link itself: a region's short link (ftcwa.live/bardeen) that
// redirects to the meet's YouTube broadcast, or a region's own page for the event that lists its broadcasts, one a
// day (FIRST in Michigan's fimav.us/live/<season>/<code>: "Practice Day", "Day 1", each a youtube.com/watch link).
// Followed in the background only on the event's own dates (at the venue), every 15 minutes (each day can add a
// stream), and the video it lands on kept per event (event_stream_links, migration 66), so the event page plays it
// like any other FIRST YouTube link (server/videos/recordings.ts). A page that lists videos gives all of them, each
// placed on the event day YouTube says its broadcast started on and kept a day at a time in event_broadcasts
// (migration 77, as a channel's broadcasts are), the first of them also the link's row: a practice day's video (its
// title says so) holds no match and is never kept. Only redirects are followed and only the last hop's page read (up
// to PAGE_MAX bytes of HTML); YouTube is asked only for a listed video's broadcast start. Every connection goes to
// a public address checked at connect time, so a redirect (or a name resolving) to a private one is refused.
// Once the event's dates are over its video stays: the same short link is pointed at the next meet's broadcast.
// An event whose dates passed with no video kept (the link wasn't followed then, or led nowhere yet) is followed
// again for LATE_DAYS after, and the video it leads to is kept only when YouTube says that broadcast started on
// the event's own dates: a link already moved on to a later meet's broadcast gives that event nothing. One with a
// video kept is followed once more after its dates, so a page's later days (or a day added late) are found.
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import { all, run, writeBatch } from "../db.js";
import { eventToday, onEventDates } from "../../src/shared/eventDay.js";
import { isYouTubeHost } from "../../src/shared/stream.js";
import { firstVideoId, forgetRecordings } from "./recordings.js";
import { onDates, type Broadcast } from "./channelStreams.js";
import { env } from "../env.js";
import { fetchFromApi, fetchWatchPage, isPlaceholderTitle, type WatchPageFacts } from "./youtube.js";

const MAX_HOPS = 5;
const TIMEOUT_MS = 8000;
/** At most this much of a link's page is read (FIRST in Michigan's is about 1 KB). */
const PAGE_MAX = 256 * 1024;
/** At most this many videos a page: a page listing more is a channel's or a site's, not one event's. */
const PAGE_VIDEOS = 12;
/** On the event's dates a link is followed again after 15 minutes, whatever it gave (a day's stream can be added at
 *  any time); after them, one that led nowhere after 2 hours. */
const AGAIN_FOUND_MS = 15 * 60_000;
const AGAIN_NONE_MS = 2 * 3600_000;
/** How long after an event's last date a link that gave it no video is still followed (its broadcast checked against its dates). */
const LATE_DAYS = 14;
/** Hosts whose links are the stream itself, never a redirect to YouTube. */
const NOT_SHORT = /(^|\.)(twitch\.tv|facebook\.com|vimeo\.com)$/i;

/** One hop's answer: the redirect's target, the page it served (a 200 of HTML), null (neither), or "error" when the request failed. */
export type HopAnswer = string | null | "error" | { page: string };
export type Hop = (url: URL) => Promise<HopAnswer>;

/** A video a link leads to; title: the words a page lists it under (its YouTube title, as the region gives it). */
export interface LinkVideo { videoId: string; title?: string }
/** Where a link led. page: it ended at a page (the videos are the ones it lists), not a redirect to YouTube. */
export interface LinkAnswer { videos: LinkVideo[]; page: boolean }

/** A link this server may ask for: http(s) on the default port to a name (no address literal, localhost or internal name). */
export function followable(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.port || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || net.isIP(h.replace(/^\[|\]$/g, "")) || h.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(h);
}

/** A public unicast address: not loopback, private, link-local, carrier-grade NAT, multicast, reserved or unspecified. */
export function publicAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return publicAddress(mapped[1]);
    return !(x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff") || x.startsWith("64:ff9b") || x.startsWith("2001:db8"));
  }
  return false;
}

/** The address lookup every hop connects through: only public addresses, checked as the connection is made. */
const publicLookup: net.LookupFunction = (host, opts, cb) => {
  dns.lookup(host, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err, "", 0);
    const ok = (list as dns.LookupAddress[]).filter((a) => publicAddress(a.address));
    if (!ok.length) return cb(Object.assign(new Error(`${host} has no public address`), { code: "ENOTFOUND" }), "", 0);
    if ((opts as dns.LookupOptions).all) return (cb as unknown as (e: null, l: dns.LookupAddress[]) => void)(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
};

/** One request, no redirect followed, only an HTML 200's body read (up to PAGE_MAX), answered within TIMEOUT_MS whatever the server does (DNS included). */
const netHop: Hop = (u) => new Promise((resolve) => {
  let done = false;
  const finish = (v: HopAnswer) => { if (done) return; done = true; clearTimeout(deadline); resolve(v); };
  const req = (u.protocol === "https:" ? https : http).request(u, {
    method: "GET", lookup: publicLookup, timeout: TIMEOUT_MS, headers: { "user-agent": "ControlScout/1 (+https://controlscout.org)" },
  }, (res) => {
    const s = res.statusCode ?? 0;
    if (s !== 200 || !/text\/html/i.test(String(res.headers["content-type"] ?? ""))) {
      res.resume();
      req.destroy();
      finish(s >= 300 && s < 400 ? (res.headers.location ?? null) : s >= 500 ? "error" : null);
      return;
    }
    let page = "";
    res.setEncoding("utf8");
    res.on("data", (c: string) => {
      page += c;
      if (page.length >= PAGE_MAX) { finish({ page: page.slice(0, PAGE_MAX) }); req.destroy(); }
    });
    res.on("end", () => finish({ page }));
    res.on("error", () => finish("error"));
  });
  // A deadline for the whole request: the socket timeout alone only catches an idle socket, not a slow trickle.
  const deadline = setTimeout(() => { finish("error"); req.destroy(new Error("deadline")); }, TIMEOUT_MS);
  deadline.unref?.();
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", () => finish("error"));
  req.end();
});

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
  const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
});
const attr = (attrs: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return m ? decode(m[1] ?? m[2] ?? "").trim() : "";
};

/**
 * The YouTube videos a page links to or embeds, in page order: each link's or player's own video (never a channel's
 * page), with the words it's listed under (a link's text, a player's title) less a trailing "(YouTube)".
 */
export function pageVideos(html: string): LinkVideo[] {
  const out = new Map<string, LinkVideo>();
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>|<iframe\b([^>]*)>/gi)) {
    const isLink = m[1] != null;
    const link = isLink ? attr(m[1], "href") : attr(m[3] ?? "", "src");
    let u: URL;
    try { u = new URL(link.startsWith("//") ? `https:${link}` : link); } catch { continue; }
    if (!isYouTubeHost(u.hostname)) continue;
    const id = firstVideoId(u.href);
    if (!id || out.has(id)) continue;
    const words = isLink ? decode(m[2].replace(/<[^>]*>/g, " ")) : attr(m[3] ?? "", "title");
    const title = words.replace(/\s+/g, " ").replace(/\s*\(\s*you\s*tube\s*\)\s*$/i, "").trim().slice(0, 300);
    out.set(id, { videoId: id, ...(title ? { title } : {}) });
    if (out.size >= PAGE_VIDEOS) break;
  }
  return [...out.values()];
}

/** Where a link leads: the YouTube video its redirects end at, or the videos the page they end at lists; "error" when a request failed (try again later). */
export async function resolveLink(link: string, hop: Hop = netHop): Promise<LinkAnswer | "error"> {
  const none: LinkAnswer = { videos: [], page: false };
  let u: URL;
  try { u = new URL(link.trim()); } catch { return none; }
  for (let i = 0; i < MAX_HOPS; i++) {
    if (!followable(u)) return none;
    const to = await hop(u);
    if (to === "error") return to;
    if (to == null) return none;
    if (typeof to === "object") return { videos: pageVideos(to.page), page: true };
    try { u = new URL(to, u); } catch { return none; }
    if (isYouTubeHost(u.hostname)) {
      const id = firstVideoId(u.href);
      return { videos: id ? [{ videoId: id }] : [], page: false };
    }
  }
  return none;
}

/**
 * Where a short link leads: the YouTube video id its redirects end at (or the first its page lists), null when it
 * leads to none (no redirect, not YouTube, a channel page, a private address, a loop), or "error" when a request failed.
 */
export async function resolveShortLink(link: string, hop: Hop = netHop): Promise<string | null | "error"> {
  const r = await resolveLink(link, hop);
  return r === "error" ? r : r.videos[0]?.videoId ?? null;
}

/** A title that marks a practice day or session ("Fruitport Qualifier - Practice Day"): no match is played in it, so
 *  it's no match day's recording. One that names match play too ("Practice and Quals", "Day 1") isn't. */
export function practiceOnly(title: string | null | undefined): boolean {
  const t = String(title ?? "");
  return /\bpractice\b/i.test(t) && !/\b(quals?|qualifications?|playoffs?|elims?|eliminations?|finals?|alliance selection|day\s*#?\s*[1-9])\b/i.test(t);
}

/** Whether an event's link is due a follow: a new or changed link, or the last answer is old enough (`noneMs`: one that led nowhere). */
export function linkDue(row: { url: string | null; video_id: string | null; checked_at: string | null }, link: string, now: number, noneMs = AGAIN_NONE_MS): boolean {
  if (row.url !== link || !row.checked_at) return true;
  return now - Date.parse(row.checked_at) > (row.video_id ? AGAIN_FOUND_MS : noneMs);
}

/** A link FIRST gives that may be a short link: http(s), not YouTube's own, not a stream site's. */
function maybeShort(link: string): boolean {
  try {
    const u = new URL(link);
    return (u.protocol === "https:" || u.protocol === "http:") && !isYouTubeHost(u.hostname) && !NOT_SHORT.test(u.hostname);
  } catch { return false; }
}

/** One video's facts from YouTube (the Data API with the key, else the watch page). */
export type Facts = (videoId: string) => Promise<WatchPageFacts>;
const youtubeFacts: Facts = async (id) => {
  const key = env.youtubeApiKey;
  if (key) return (await fetchFromApi([id], key)).get(id) ?? { status: "error", start: null, end: null, length: null, live: false };
  return fetchWatchPage(id);
};

/** Whether a video's broadcast started on the event's dates (at the venue): "error" when YouTube couldn't be read. */
export async function broadcastOnDates(id: string, e: { start: string; end: string | null; timezone: string | null }, facts: Facts = youtubeFacts): Promise<boolean | "error"> {
  const f = await facts(id);
  if (f.status === "error") return "error";
  const at = f.start ? Date.parse(f.start) : NaN;
  return f.status === "ok" && Number.isFinite(at) && onEventDates({ start: e.start.slice(0, 10), end: (e.end ?? e.start).slice(0, 10), timezone: e.timezone }, at);
}

type LinkRow = { season: number; code: string; start: string; end: string | null; timezone: string | null; livestream: string; url: string | null; video_id: string | null; checked_at: string | null };

/** The titles the channel audit read for these videos (official_audit_videos), for a video a link gives without words of its own. */
async function auditTitles(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await all<{ video_id: string; title: string | null }>(`SELECT video_id, title FROM official_audit_videos WHERE video_id IN (${ids.map(() => "?").join(",")})`, ids);
  return new Map(rows.filter((r) => r.title && !isPlaceholderTitle(r.title)).map((r) => [String(r.video_id), String(r.title)]));
}
const practiceVideo = async (id: string) => practiceOnly((await auditTitles([id])).get(id));

/** Whether another event with the same link keeps this video (its row or one of its days): theirs, never this one's. */
async function keptByOther(id: string, r: LinkRow): Promise<boolean> {
  return (await all(
    `SELECT 1 FROM event_stream_links WHERE video_id = ?1 AND url = ?2 AND NOT (season = ?3 AND code = ?4)
     UNION ALL SELECT 1 FROM event_broadcasts WHERE video_id = ?1 AND url = ?2 AND NOT (season = ?3 AND code = ?4) LIMIT 1`, [id, r.livestream, r.season, r.code])).length > 0;
}

/** The event's row for its link: the video it plays (null: none) and the follow's time. */
const linkRow = (r: LinkRow, id: string | null, now: number) => ({
  sql: `INSERT INTO event_stream_links (season, code, url, video_id, checked_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(season, code) DO UPDATE SET url = excluded.url, video_id = excluded.video_id, checked_at = excluded.checked_at`,
  args: [r.season, r.code, r.livestream, id, new Date(now).toISOString()] as (string | number | null)[],
});
const saveLink = (r: LinkRow, id: string | null, now: number) => { const w = linkRow(r, id, now); return run(w.sql, w.args); };

/**
 * An event's days from the videos its link gives (a page listing them, or a link read a day at a time before): each
 * one not a practice day's (by its title), not another event's with the same link, and whose broadcast YouTube says
 * started on the event's dates, with the days found before by the same link (a page can drop a day). Kept in
 * event_broadcasts, the first also the link's video, so the event's recording holds each day's matches in that day's
 * video (recordings.ts). A video not started yet waits for its start (the next follow); one YouTube couldn't be read
 * for, when no day is found, leaves the event's videos as they were. Returns whether they changed.
 */
async function keepDays(r: LinkRow, videos: LinkVideo[], now: number, facts: Facts): Promise<boolean> {
  const sameLink = r.url === r.livestream;
  const before = sameLink ? await all<{ video_id: string; start: string }>("SELECT video_id, start FROM event_broadcasts WHERE season = ? AND code = ? AND url = ?", [r.season, r.code, r.livestream]) : [];
  const titles = await auditTitles(videos.filter((v) => !v.title).map((v) => v.videoId));
  const days = new Map<string, Broadcast>(before.map((b) => [String(b.video_id), { videoId: String(b.video_id), start: String(b.start) }]));
  let unread = false;
  for (const v of videos) {
    if (practiceOnly(v.title ?? titles.get(v.videoId))) { days.delete(v.videoId); continue; }
    if (days.has(v.videoId) || await keptByOther(v.videoId, r)) continue;
    const f = await facts(v.videoId);
    if (f.status === "error") unread = true;
    else if (f.status === "ok" && f.start) days.set(v.videoId, { videoId: v.videoId, start: f.start });
  }
  // Only those on the event's dates (FIRST can correct them), earliest first.
  const keep = onDates([...days.values()], r);
  if (unread && !keep.length) {
    // Nothing found and a video unread: the event keeps what it had, the try noted.
    await saveLink(r, sameLink ? r.video_id : null, now);
    return !sameLink && !!r.video_id;
  }
  const first = keep[0]?.videoId ?? null;
  const changed = !sameLink || first !== r.video_id || keep.map((b) => b.videoId).sort().join() !== before.map((b) => String(b.video_id)).sort().join();
  // One transaction: an interrupted save keeps the previous days.
  await writeBatch([
    { sql: "DELETE FROM event_broadcasts WHERE season = ? AND code = ?", args: [r.season, r.code] },
    ...keep.map((b) => ({ sql: "INSERT INTO event_broadcasts (season, code, video_id, url, start) VALUES (?, ?, ?, ?, ?)", args: [r.season, r.code, b.videoId, r.livestream, b.start] })),
    linkRow(r, first, now),
  ]);
  return changed;
}

/** Whether the event's link gave it days before (event_broadcasts by this link): it's read a day at a time from then on. */
async function hasDays(r: LinkRow): Promise<boolean> {
  return r.url === r.livestream && (await all("SELECT 1 FROM event_broadcasts WHERE season = ? AND code = ? AND url = ? LIMIT 1", [r.season, r.code, r.livestream])).length > 0;
}
/** A page listing videos, or a link read a day at a time before: each video kept on its own day (keepDays). */
const byDays = async (got: LinkAnswer, r: LinkRow) => (got.page && got.videos.length > 0) || await hasDays(r);

let busy = false;
/**
 * Follow the stream links of events on their dates today (at the venue), at most `max` a run. Returns how many
 * events' videos changed (found, replaced or lost). A failed request keeps what was found before. A video an
 * earlier event with the same link already keeps is last meet's broadcast, not yet replaced: never this one's.
 */
export async function resolveStreamLinks(log: (s: string) => void, opts: { max?: number; hop?: Hop; now?: () => number; facts?: Facts } = {}): Promise<number> {
  if (busy) return 0;
  busy = true;
  try {
    const now = (opts.now ?? Date.now)();
    const facts = opts.facts ?? youtubeFacts;
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    // Today somewhere on Earth (a 2-day UTC window); each event's own calendar decides below.
    const rows = await all<LinkRow>(
      `SELECT e.season, e.code, e.start, e.end, e.timezone, e.livestream, l.url, l.video_id, l.checked_at FROM events e
       LEFT JOIN event_stream_links l ON l.season = e.season AND l.code = e.code
       WHERE e.livestream LIKE 'http%'
         AND substr(e.start, 1, 10) <= ? AND substr(COALESCE(e.end, e.start), 1, 10) >= ?
       ORDER BY e.start`, [day(now + 86_400_000), day(now - 86_400_000)]);
    const todo = rows
      .filter((r) => maybeShort(r.livestream) && onEventDates({ start: r.start.slice(0, 10), end: (r.end ?? r.start).slice(0, 10), timezone: r.timezone }, now))
      // On its dates every 15 minutes, whatever the last follow gave: a day's stream can be added at any time.
      .filter((r) => linkDue(r, r.livestream, now, AGAIN_FOUND_MS)).slice(0, opts.max ?? 60);
    let changed = 0;
    for (const r of todo) {
      const got = await resolveLink(r.livestream, opts.hop);
      if (got === "error") continue;
      if (await byDays(got, r)) {
        if (await keepDays(r, got.videos, now, facts)) changed++;
        continue;
      }
      let id: string | null = got.videos[0]?.videoId ?? null;
      if (id) {
        const earlier = await all("SELECT 1 FROM event_stream_links l JOIN events e ON e.season = l.season AND e.code = l.code WHERE l.video_id = ? AND l.url = ? AND e.start < ? LIMIT 1", [id, r.livestream, r.start]);
        if (earlier.length || await practiceVideo(id)) id = null;
      }
      const sameLink = r.url === r.livestream;
      if (!id && sameLink && r.video_id) id = r.video_id; // nothing (or last meet's) now: keep this event's own broadcast
      if (!sameLink || id !== r.video_id) changed++;
      await saveLink(r, id, now);
    }
    changed += await resolveLate(now, { ...opts, facts });
    if (changed) forgetRecordings();
    if (changed) log(`recordings: ${changed} short stream link${changed === 1 ? "" : "s"} led somewhere new`);
    return changed;
  } finally {
    busy = false;
  }
}

/**
 * Events whose dates ended in the last LATE_DAYS. With no video kept for their link: followed again (every 2 hours,
 * linkDue), the video kept only when its broadcast started on the event's dates. With one kept: followed once more
 * (its last follow was on its dates), so a page's later days are found; a redirect's video stays. Returns how many
 * events' videos changed.
 */
async function resolveLate(now: number, opts: { max?: number; hop?: Hop; facts: Facts }): Promise<number> {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const rows = await all<LinkRow>(
    `SELECT e.season, e.code, e.start, e.end, e.timezone, e.livestream, l.url, l.video_id, l.checked_at FROM events e
     LEFT JOIN event_stream_links l ON l.season = e.season AND l.code = e.code
     WHERE e.livestream LIKE 'http%' AND (l.video_id IS NULL OR l.url != e.livestream OR substr(l.checked_at, 1, 10) <= substr(COALESCE(e.end, e.start), 1, 10))
       AND substr(COALESCE(e.end, e.start), 1, 10) >= ? AND substr(e.start, 1, 10) <= ?
     ORDER BY e.start DESC`, [day(now - (LATE_DAYS + 1) * 86_400_000), day(now)]);
  const todo = rows.filter((r) => {
    if (!maybeShort(r.livestream)) return false;
    const last = (r.end ?? r.start).slice(0, 10);
    // Dates over at the venue (today's events are the pass above's), and not longer ago than LATE_DAYS.
    return last < eventToday(now, r.timezone).from && last >= day(now - LATE_DAYS * 86_400_000) && linkDue(r, r.livestream, now);
  })
    // Never tried first, then the longest since a try: a run of failing links can't hold every slot.
    .sort((a, b) => (a.checked_at ?? "").localeCompare(b.checked_at ?? ""))
    .slice(0, opts.max ?? 20);
  let changed = 0;
  for (const r of todo) {
    // A failed request (the link's or YouTube's) keeps no new video but notes the try, so it waits its turn (linkDue).
    const got = await resolveLink(r.livestream, opts.hop);
    if (got !== "error" && await byDays(got, r)) {
      if (await keepDays(r, got.videos, now, opts.facts)) changed++;
      continue;
    }
    // A video a redirect led to on the event's dates stays: the link has moved on to the next meet's since.
    if (r.url === r.livestream && r.video_id) { await saveLink(r, r.video_id, now); continue; }
    let id: string | null = got === "error" ? null : got.videos[0]?.videoId ?? null;
    if (id && await broadcastOnDates(id, r, opts.facts) !== true) id = null;
    // Another event already keeps this broadcast for the same link (back-to-back meets): theirs, not this one's.
    if (id && (await keptByOther(id, r) || await practiceVideo(id))) id = null;
    if (id) changed++;
    await saveLink(r, id, now);
  }
  return changed;
}
