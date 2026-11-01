// FIRST's stream link when it isn't a YouTube link itself: a region's short link (ftcwa.live/bardeen) that
// redirects to the meet's YouTube broadcast. Followed in the background only on the event's own dates (at the
// venue) and the video it lands on kept per event (event_stream_links, migration 66), so the event page plays it
// like any other FIRST YouTube link (server/videos/recordings.ts). Only redirects are followed, never a page
// read: the hop that names a YouTube host ends it, and YouTube itself is never fetched. Every connection goes to
// a public address checked at connect time, so a redirect (or a name resolving) to a private one is refused.
// Once the event's dates are over its video stays: the same short link is pointed at the next meet's broadcast.
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import { all, run } from "../db.js";
import { onEventDates } from "../../src/shared/eventDay.js";
import { isYouTubeHost } from "../../src/shared/stream.js";
import { firstVideoId, forgetRecordings } from "./recordings.js";

const MAX_HOPS = 5;
const TIMEOUT_MS = 8000;
/** A link that led to a video is followed again after 15 minutes (a broadcast restarted under a new id); one that led nowhere, after 2 hours. */
const AGAIN_FOUND_MS = 15 * 60_000;
const AGAIN_NONE_MS = 2 * 3600_000;
/** Hosts whose links are the stream itself, never a redirect to YouTube. */
const NOT_SHORT = /(^|\.)(twitch\.tv|facebook\.com|vimeo\.com)$/i;

/** One hop's answer: the redirect's target (null: no redirect), or "error" when the request failed. */
export type Hop = (url: URL) => Promise<string | null | "error">;

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

/** One request, no redirect followed, no body read. */
const netHop: Hop = (u) => new Promise((resolve) => {
  const req = (u.protocol === "https:" ? https : http).request(u, {
    method: "GET", lookup: publicLookup, timeout: TIMEOUT_MS, headers: { "user-agent": "ControlScout/1 (+https://controlscout.org)" },
  }, (res) => {
    res.resume();
    req.destroy();
    const s = res.statusCode ?? 0;
    resolve(s >= 300 && s < 400 ? (res.headers.location ?? null) : s >= 500 ? "error" : null);
  });
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", () => resolve("error"));
  req.end();
});

/**
 * Where a short link leads: the YouTube video id its redirects end at, null when it leads to none (no redirect,
 * not YouTube, a channel page, a private address, a loop), or "error" when a request failed (try again later).
 */
export async function resolveShortLink(link: string, hop: Hop = netHop): Promise<string | null | "error"> {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  for (let i = 0; i < MAX_HOPS; i++) {
    if (!followable(u)) return null;
    const to = await hop(u);
    if (to === "error" || to == null) return to;
    try { u = new URL(to, u); } catch { return null; }
    if (isYouTubeHost(u.hostname)) return firstVideoId(u.href);
  }
  return null;
}

/** Whether an event's link is due a follow: a new or changed link, or the last answer is old enough. */
export function linkDue(row: { url: string | null; video_id: string | null; checked_at: string | null }, link: string, now: number): boolean {
  if (row.url !== link || !row.checked_at) return true;
  return now - Date.parse(row.checked_at) > (row.video_id ? AGAIN_FOUND_MS : AGAIN_NONE_MS);
}

/** A link FIRST gives that may be a short link: http(s), not YouTube's own, not a stream site's. */
function maybeShort(link: string): boolean {
  try {
    const u = new URL(link);
    return (u.protocol === "https:" || u.protocol === "http:") && !isYouTubeHost(u.hostname) && !NOT_SHORT.test(u.hostname);
  } catch { return false; }
}

let busy = false;
/**
 * Follow the short stream links of events on their dates today (at the venue), at most `max` a run. Returns how
 * many events' videos changed (found, replaced or lost). A failed request keeps what was found before. A video
 * an earlier event with the same link already keeps is last meet's broadcast, not yet replaced: never this one's.
 */
export async function resolveStreamLinks(log: (s: string) => void, opts: { max?: number; hop?: Hop; now?: () => number } = {}): Promise<number> {
  if (busy) return 0;
  busy = true;
  try {
    const now = (opts.now ?? Date.now)();
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    // Today somewhere on Earth (a 2-day UTC window); each event's own calendar decides below.
    const rows = await all<{ season: number; code: string; start: string; end: string | null; timezone: string | null; livestream: string; url: string | null; video_id: string | null; checked_at: string | null }>(
      `SELECT e.season, e.code, e.start, e.end, e.timezone, e.livestream, l.url, l.video_id, l.checked_at FROM events e
       LEFT JOIN event_stream_links l ON l.season = e.season AND l.code = e.code
       WHERE e.livestream LIKE 'http%'
         AND substr(e.start, 1, 10) <= ? AND substr(COALESCE(e.end, e.start), 1, 10) >= ?
       ORDER BY e.start`, [day(now + 86_400_000), day(now - 86_400_000)]);
    const todo = rows
      .filter((r) => maybeShort(r.livestream) && onEventDates({ start: r.start.slice(0, 10), end: (r.end ?? r.start).slice(0, 10), timezone: r.timezone }, now))
      .filter((r) => linkDue(r, r.livestream, now)).slice(0, opts.max ?? 60);
    let changed = 0;
    for (const r of todo) {
      let id = await resolveShortLink(r.livestream, opts.hop);
      if (id === "error") continue;
      if (id) {
        const earlier = await all("SELECT 1 FROM event_stream_links l JOIN events e ON e.season = l.season AND e.code = l.code WHERE l.video_id = ? AND l.url = ? AND e.start < ? LIMIT 1", [id, r.livestream, r.start]);
        if (earlier.length) id = null;
      }
      const sameLink = r.url === r.livestream;
      if (!id && sameLink && r.video_id) id = r.video_id; // nothing (or last meet's) now: keep this event's own broadcast
      if (!sameLink || id !== r.video_id) changed++;
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
