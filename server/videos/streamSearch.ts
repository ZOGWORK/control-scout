// The stream search (docs/official-videos.md, "The stream search"): recordings found without the watched channels.
// Every event with played matches and a day of them no video covers is searched on YouTube by its name and year (the
// public results page, no API quota), 2026 first, then older seasons. Each result goes through the watcher's own
// rules (./officialWatch.ts decide, ./officialMatch.ts) against every event on its date, any region (its channel says
// nothing of where it is), and two more: it must be a finished live broadcast, and its title must say every
// distinctive word of the event's name. One that passes is added as that day's recording (by "stream search"); one the rules fit to a
// day still missing its video but can't settle goes to the owner's review queue, never guessed; the rest are only
// kept as read (stream_search_videos), so they aren't weighed again. A channel found streaming two or more events this
// way is proposed to the owner as a channel to watch (Owner › Official videos).
//
// FIRST's own listing is read already: its liveStreamUrl is the event's livestream (server/sources/first.ts) and is
// followed (./streamLinks.ts, ./channelStreams.ts); the API's webcasts field is null for every event of 2024 to 2026.
import { all, db, get, run } from "../db.js";
import { recordAudit } from "../portal/audit.js";
import { env } from "../env.js";
import { withDataLock, LockBusy, isBusy } from "../data/lock.js";
import { EVENT_FIRST_DAY, EVENT_LAST_DAY, EVENT_PLAYED_DAYS, playedDays } from "./eventDays.js";
import { MIN_RECORDING_S, eventVideosByDay, forgetOfficial } from "./officialVideos.js";
import { NOT_EVENTS, namesAll, notCompetition, type WatchVideo } from "./officialMatch.js";
import { decide, record, type WatchVerdict } from "./officialWatch.js";
import { isoDuration } from "./youtube.js";

/** Events searched in one run (one results page each), a few seconds apart. */
export const SEARCH_PER_RUN = 8;
const SEARCH_GAP_MS = 4000;
/** An event ended this recently is searched again this often (streams are often posted, or made public, late). */
const RECENT_DAYS = 14, RECENT_AGAIN_MS = 2 * 864e5;
/** Any other is searched again after this long. */
const OLD_AGAIN_MS = 180 * 864e5;
/** After YouTube turns the results page away (a consent or bot page), no search for this long. */
const BLOCKED_MS = 6 * 3600_000;
/** Results weighed from one page. */
const MAX_RESULTS = 20;
/** Distinct events a channel must have streamed to be proposed as one to watch. */
export const PROPOSE_AT = 2;
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36", "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1" };
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export interface SearchHit { videoId: string; title: string; channelId: string | null; channel: string | null }
/** A results page's videos, in order; null when the page holds no results data (YouTube turned it away). */
export function resultsOf(html: string): SearchHit[] | null {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) return null;
  let data: unknown;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const walk = (o: any): void => {
    if (!o || typeof o !== "object" || out.length >= MAX_RESULTS) return;
    const v = o.videoRenderer;
    if (v && VIDEO_ID.test(String(v.videoId ?? ""))) {
      if (!seen.has(v.videoId)) {
        seen.add(v.videoId);
        const owner = v.ownerText?.runs?.[0] ?? v.longBylineText?.runs?.[0];
        const ch = String(owner?.navigationEndpoint?.browseEndpoint?.browseId ?? "");
        out.push({ videoId: v.videoId, title: String(v.title?.runs?.map((r: any) => r.text).join("") ?? v.title?.simpleText ?? ""), channelId: CHANNEL_ID.test(ch) ? ch : null, channel: owner?.text ? String(owner.text) : null });
      }
      return;
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(data);
  return out;
}

export type Searcher = (q: string) => Promise<SearchHit[] | "blocked">;
export const pageSearcher = (fetchImpl: typeof fetch = fetch): Searcher => async (q) => {
  const res = await fetchImpl(`https://www.youtube.com/results?${new URLSearchParams({ search_query: q, hl: "en", gl: "US" })}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return "blocked";
  return resultsOf(await res.text()) ?? "blocked";
};

export interface Target { season: number; code: string; name: string; city: string | null; state: string | null; country: string | null; start: string; end: string; missing: string[] }
/** What to search YouTube for: the event's name and the year it's held ("Brisbane North Qualifier 2026"). FIRST's
 *  region prefix ("IA ", "TX-North ") stays: organisers title streams with it as often as not, and YouTube ignores it. */
export const searchQuery = (t: Pick<Target, "name" | "start">) => `${t.name.replace(/\s+/g, " ").trim()} FTC ${t.start.slice(0, 4)}`;

/** The rule a stranger's video is weighed by: every event in the world on its date, not one region's. A watched
 *  channel's region narrows its videos to its own events; a stranger's channel says nothing of where it is, and like
 *  events share names across states ("Carver League Meet 2" in Oklahoma and "ROBOT League Meet 2" in Florida on one
 *  day), so the title must fit one event of them all. */
export const ANY_EVENT = { region: "name=.", words: "", titlePattern: null };

/** The region rule a proposed channel's events share: their state (US), else their country. */
export function regionOf(t: { state: string | null; country: string | null }): string {
  const us = /^(usa|us|united states)$/i.test(t.country ?? "");
  return us && t.state && /^[A-Za-z]{2}$/.test(t.state) ? `state=${t.state}` : `country=${t.country ?? ""}`;
}

/** The events due a search, best first: 2026 first, then each older season; within one, never searched, then the most
 *  recently ended. Each with the days it played that no video covers (empty: covered, nothing to search). */
export async function dueTargets(now: number, limit: number): Promise<Target[]> {
  const today = new Date(now).toISOString().slice(0, 10);
  const recent = new Date(now - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
  const types = [...NOT_EVENTS].map(() => "?").join(",");
  const rows = await all<any>(
    `SELECT season, code, name, city, state, country, start, end FROM (
       SELECT e.season, e.code, e.name, e.city, e.state, e.country, ${EVENT_FIRST_DAY} AS start, ${EVENT_LAST_DAY} AS end, s.searched_at
       FROM events e LEFT JOIN stream_searches s ON s.season = e.season AND s.code = e.code
       WHERE e.season >= 2019 AND e.start IS NOT NULL AND COALESCE(e.remote, 0) = 0 AND e.type NOT IN (${types})
         AND EXISTS (SELECT 1 FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1))
     WHERE end <= ? AND (searched_at IS NULL OR searched_at < CASE WHEN end >= ? THEN ? ELSE ? END)
     ORDER BY season DESC, searched_at IS NOT NULL, end DESC, code LIMIT ?`,
    [...NOT_EVENTS, today, recent, new Date(now - RECENT_AGAIN_MS).toISOString(), new Date(now - OLD_AGAIN_MS).toISOString(), limit]);
  const out: Target[] = [];
  for (const r of rows) {
    const days = playedDays((await get<{ d: string | null }>(`SELECT ${EVENT_PLAYED_DAYS} AS d FROM events e WHERE e.season = ? AND e.code = ?`, [r.season, r.code]))?.d) ?? [];
    const has = (await eventVideosByDay(Number(r.season), String(r.code))).filter((h) => !h.gone);
    // A video whose day isn't read yet may be any of them: nothing is missing until it's timed.
    const missing = has.some((h) => !h.timed) ? [] : days.filter((d) => !has.some((h) => h.day === d));
    out.push({ season: Number(r.season), code: String(r.code), name: String(r.name ?? ""), city: r.city ?? null, state: r.state ?? null, country: r.country ?? null,
      start: String(r.start).slice(0, 10), end: String(r.end ?? r.start).slice(0, 10), missing });
  }
  return out;
}

export interface SearchRun { searched: number; covered: number; results: number; added: number; queued: number; blocked: boolean; units: number }
let blockedUntil = 0;
let busy = false;

/** One run: up to SEARCH_PER_RUN events searched (see above). Needs YOUTUBE_API_KEY for the results' facts. */
export async function searchStreams(log: (s: string) => void, opts: { apiKey?: string | null; fetchImpl?: typeof fetch; search?: Searcher; now?: () => number; gapMs?: number; perRun?: number; lockWaitMs?: number } = {}): Promise<SearchRun | null> {
  const key = opts.apiKey === undefined ? env.youtubeApiKey : opts.apiKey;
  const now = opts.now ?? Date.now;
  if (!key || busy || now() < blockedUntil) return null;
  busy = true;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const search = opts.search ?? pageSearcher(fetchImpl);
  const gap = opts.gapMs ?? SEARCH_GAP_MS;
  const locked = <T>(fn: () => Promise<T>) => withDataLock("stream search", fn, { ttlMs: 60_000, waitMs: opts.lockWaitMs ?? 60_000, pollMs: 1000 });
  const out: SearchRun = { searched: 0, covered: 0, results: 0, added: 0, queued: 0, blocked: false, units: 0 };
  try {
    const perRun = opts.perRun ?? SEARCH_PER_RUN;
    const targets = await dueTargets(now(), perRun * 4);
    const covered = targets.filter((t) => !t.missing.length);
    // Covered now: written as searched, so they wait their turn again.
    if (covered.length) {
      const at = new Date(now()).toISOString();
      await locked(() => db().batch(covered.map((t) => ({ sql: `INSERT INTO stream_searches (season, code, searched_at, query, results, note) VALUES (?, ?, ?, NULL, 0, 'covered')
        ON CONFLICT (season, code) DO UPDATE SET searched_at = excluded.searched_at, note = excluded.note`, args: [t.season, t.code, at] })), "write"));
      out.covered = covered.length;
    }
    for (const t of targets.filter((x) => x.missing.length).slice(0, perRun)) {
      if (out.searched) await new Promise((r) => setTimeout(r, gap));
      const q = searchQuery(t);
      const hits = await search(q);
      if (hits === "blocked") { out.blocked = true; blockedUntil = now() + BLOCKED_MS; log(`stream search: YouTube turned the results page away; no search for ${BLOCKED_MS / 3600_000} h`); break; }
      out.searched++;
      const found = await weigh(t, q, hits, key, fetchImpl, now, locked, out);
      const at = new Date(now()).toISOString();
      await locked(() => run(`INSERT INTO stream_searches (season, code, searched_at, query, results, note) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (season, code) DO UPDATE SET searched_at = excluded.searched_at, query = excluded.query, results = excluded.results, note = excluded.note, tries = stream_searches.tries + 1`,
        [t.season, t.code, at, q, hits.length, found.slice(0, 300) || null]));
    }
  } catch (e) {
    if (!(e instanceof LockBusy) && !isBusy(e)) log(`stream search: ${String((e as Error).message ?? e).slice(0, 300)}`);
  } finally {
    busy = false;
  }
  if (out.added) forgetOfficial();
  if (out.searched) log(`stream search: ${out.searched} events searched (${out.results} new results, ${out.units} units): ${out.added} added, ${out.queued} to review`);
  return out;
}

/** One event's results, each weighed once: added, queued for the owner, or kept as read. Returns what it found. */
async function weigh(t: Target, q: string, hits: SearchHit[], key: string, fetchImpl: typeof fetch, now: () => number, locked: <T>(fn: () => Promise<T>) => Promise<T>, out: SearchRun): Promise<string> {
  const ids = hits.map((h) => h.videoId);
  if (!ids.length) return "";
  const qs = ids.map(() => "?").join(",");
  const known = new Set((await all<{ video_id: string }>(
    `SELECT video_id FROM stream_search_videos WHERE video_id IN (${qs}) UNION SELECT video_id FROM official_watch WHERE video_id IN (${qs}) UNION SELECT video_id FROM official_videos WHERE video_id IN (${qs})`,
    [...ids, ...ids, ...ids])).map((r) => String(r.video_id)));
  // A title that isn't a competition stream needs no facts; nor does one already read.
  const fresh = hits.filter((h) => !known.has(h.videoId));
  const read = fresh.filter((h) => !notCompetition(h.title));
  const facts = new Map<string, any>();
  if (read.length) {
    out.units++;
    const res = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "snippet,contentDetails,status,liveStreamingDetails", id: read.map((h) => h.videoId).join(","), key })}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`YouTube videos answered ${res.status}`);
    for (const it of (await res.json())?.items ?? []) facts.set(String(it.id), it);
  }
  const done: string[] = [];
  const seen: { sql: string; args: (string | number | null)[] }[] = [];
  out.results += fresh.length;
  for (const h of fresh) {
    const it = facts.get(h.videoId);
    const state = String(it?.snippet?.liveBroadcastContent ?? "none");
    // Still to come or on the air: weighed again on the event's next search, once it's over.
    if (it && (state === "live" || state === "upcoming")) continue;
    const channelId = String(it?.snippet?.channelId ?? h.channelId ?? "");
    const channel = String(it?.snippet?.channelTitle ?? h.channel ?? channelId);
    const v: WatchVideo = {
      videoId: h.videoId, title: String(it?.snippet?.title ?? h.title).slice(0, 300), start: it?.liveStreamingDetails?.actualStartTime ?? null,
      published: it?.snippet?.publishedAt ?? null, durationS: it ? isoDuration(it?.contentDetails?.duration) : null,
      privacy: String(it?.status?.privacyStatus ?? "public"), embeddable: it?.status?.embeddable !== false,
      blockedIn: Array.isArray(it?.contentDetails?.regionRestriction?.blocked) ? it.contentDetails.regionRestriction.blocked.length : 0,
    };
    const nc = notCompetition(v.title);
    let verdict: WatchVerdict = nc ? { kind: "ignore", why: nc } : !it ? { kind: "ignore", why: "YouTube gave no facts for it (private or gone)" } : await decide(v, ANY_EVENT);
    const ev = verdict.kind === "add" || verdict.kind === "review" ? verdict.event : undefined;
    // Which of the events this search is for, and a day of it no video covers: the only ones it may add to or queue for.
    const forThis = !!ev && ev.season === t.season && ev.code === t.code && !!(verdict as { day?: string }).day && t.missing.includes((verdict as { day: string }).day);
    const playable = v.privacy === "public" && v.embeddable && v.blockedIn < 50 && (v.durationS ?? 0) >= MIN_RECORDING_S;
    let status: string = verdict.kind;
    if (verdict.kind === "add" && forThis) {
      // A stranger's channel: a finished broadcast only, its title naming the whole event, or the owner decides.
      const why = !v.start ? "an upload, not a live broadcast, on a channel Scout doesn't watch" : !namesAll(v.title, ev!.name) ? `its title doesn't say all of ${ev!.code}'s name, on a channel Scout doesn't watch` : null;
      if (why) verdict = { kind: "review", why: `found by the stream search ("${q}"): ${why}; the rules otherwise fit it to ${ev!.code} ${verdict.day}`, event: verdict.event, day: verdict.day, part: verdict.part };
    } else if (verdict.kind === "add") {
      // Another event's video: not kept as read, so that event's own search weighs it.
      continue;
    } else if (verdict.kind === "review") {
      verdict = { ...verdict, why: `found by the stream search ("${q}"): ${verdict.why}` };
    }
    const ch = { channelId: CHANNEL_ID.test(channelId) ? channelId : "unknown", title: `${channel} (found by the stream search)` };
    // Written to the owner's queue: an add, or a review of this event's missing day that would be a day's recording.
    if (verdict.kind === "add" || (verdict.kind === "review" && forThis && playable)) {
      const w = verdict;
      const put = await locked(() => record(v, ch, w, v.published ?? null, now(), "stream search"));
      // Added; or queued (a review, or an add whose day another recording took meanwhile); or decided meanwhile by the owner.
      if (w.kind === "add" && put === "added") { out.added++; status = "add"; done.push(`added ${v.videoId} (${w.day})`); }
      else if (w.kind === "review" || put === "queued") { out.queued++; status = "review"; done.push(`to review ${v.videoId}`); }
      else status = "kept";
    } else if (verdict.kind === "review") status = "ignore";
    seen.push({ sql: `INSERT INTO stream_search_videos (video_id, season, code, channel_id, channel, title, start, duration, verdict, event_season, event_code, why, seen_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (video_id) DO NOTHING`,
      args: [v.videoId, t.season, t.code, CHANNEL_ID.test(channelId) ? channelId : null, channel.slice(0, 120), v.title, v.start, v.durationS, status,
        ev?.season ?? null, ev?.code ?? null, String(verdict.why).slice(0, 500), new Date(now()).toISOString()] });
  }
  if (seen.length) await locked(() => db().batch(seen, "write"));
  return done.join("; ");
}

export interface ChannelProposal { channelId: string; channel: string; events: { season: number; code: string; videoId: string }[]; region: string }
/** Channels the stream search found streaming two or more events (added, or in review), not watched: proposed to the
 *  owner with the region rule their events share. */
export async function channelProposals(): Promise<ChannelProposal[]> {
  const rows = await all<any>(`SELECT v.channel_id, v.channel, v.event_season, v.event_code, v.video_id, e.state, e.country FROM stream_search_videos v
    JOIN events e ON e.season = v.event_season AND e.code = v.event_code
    WHERE v.verdict IN ('add', 'review') AND v.channel_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM official_channels c WHERE c.channel_id = v.channel_id)
      AND NOT EXISTS (SELECT 1 FROM stream_search_channels d WHERE d.channel_id = v.channel_id)
    ORDER BY v.seen_at`);
  const by = new Map<string, any[]>();
  for (const r of rows) by.set(String(r.channel_id), [...(by.get(String(r.channel_id)) ?? []), r]);
  const out: ChannelProposal[] = [];
  for (const [channelId, rs] of by) {
    // Each event once, with the first of its videos found.
    const first = new Map<string, { season: number; code: string; videoId: string }>();
    for (const r of rs) if (!first.has(`${r.event_season}/${r.event_code}`)) first.set(`${r.event_season}/${r.event_code}`, { season: Number(r.event_season), code: String(r.event_code), videoId: String(r.video_id) });
    const events = [...first.values()];
    if (events.length < PROPOSE_AT) continue;
    const rules = [...new Set(rs.map((r) => regionOf(r)))];
    const states = rs.every((r) => regionOf(r).startsWith("state=")) ? [...new Set(rs.map((r) => String(r.state)))] : null;
    out.push({ channelId, channel: String(rs[rs.length - 1].channel ?? channelId), events, region: rules.length === 1 ? rules[0] : states ? `state=${states.join(",")}` : `country=${[...new Set(rs.map((r) => String(r.country)))].join(",")}` });
  }
  return out;
}

/** The owner's "Not this one" on a proposal: never proposed again. */
export async function dismissProposal(channelId: string, actor: string, now = Date.now()): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!CHANNEL_ID.test(channelId)) return { ok: false, error: "Not a YouTube channel id." };
  const n = await run("INSERT INTO stream_search_channels (channel_id, dismissed_at, dismissed_by) VALUES (?, ?, ?) ON CONFLICT (channel_id) DO NOTHING", [channelId, new Date(now).toISOString(), actor]);
  if (!n) return { ok: false, error: "Already dismissed." };
  await recordAudit(actor, "streamSearch.dismissChannel", { channelId });
  return { ok: true };
}

export interface SearchSummary { events: number; lastAt: string | null; added: number; queued: number; proposals: ChannelProposal[] }
/** Owner › Official videos: events searched so far, the results added and sent to review, and the proposed channels. */
export async function searchSummary(): Promise<SearchSummary> {
  const [ev, vids, proposals] = await Promise.all([
    get<{ n: number; last: string | null }>("SELECT COUNT(*) AS n, MAX(searched_at) AS last FROM stream_searches WHERE query IS NOT NULL"),
    get<{ added: number; queued: number }>("SELECT COALESCE(SUM(verdict = 'add'), 0) AS added, COALESCE(SUM(verdict = 'review'), 0) AS queued FROM stream_search_videos"),
    channelProposals(),
  ]);
  return { events: Number(ev?.n ?? 0), lastAt: ev?.last ?? null, added: Number(vids?.added ?? 0), queued: Number(vids?.queued ?? 0), proposals };
}
