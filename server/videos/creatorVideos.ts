// Creator videos (migration 114): the public videos of the creator channels the owner watches, FUN Robotics Network
// first, with the FTC teams in them tagged automatically (./creatorTags.ts: nobody confirms a tag; the owner can only
// take a wrong one off, and it never comes back). Read like the official-video watcher (./officialWatch.ts): each
// channel's own uploads list (playlistItems on its UU… list), then the new videos' facts (videos.list), never a search.
// Its playlists give each video's series (Behind the Bot, Pits & Parts, Top 25, FUNalysis) and help say its program;
// a playlist is read again only when YouTube says it changed (its etag). YouTube's terms: what is stored of a video is
// read again within 30 days (a sweep, 50 a unit), and a video deleted, made private or no longer embeddable is dropped.
// Each run's quota and counts are logged in creator_runs. Every write is under the shared writer lease (the #1431
// lesson: the data sync holds it through long transactions).
import { all, db, get, kvGet, kvSet, loopTurn, run } from "../db.js";
import { env } from "../env.js";
import { recordAudit } from "../portal/audit.js";
import { LockBusy, isBusy, withDataLock } from "../data/lock.js";
import { registerCache } from "../caches.js";
import { fold, names } from "../api/query/names.js";
import { apiFacts, isoDuration } from "./youtube.js";
import { programOf, seasonOf, seriesOf, tagsOf, type TagLookups } from "./creatorTags.js";
import type { CreatorProgram, CreatorSeries, CreatorVideo, FeaturedVideo } from "../../src/shared/creatorVideos.js";

/** FUN Robotics Network (youtube.com/@funroboticsnetwork): the first creator channel, written once. */
export const SEED_CHANNELS = [{ channelId: "UCuJUknE5JjilAfNnmbvr22Q", handle: "@funroboticsnetwork", title: "FUN Robotics Network" }];

export const CREATOR_EVERY_MS = 12 * 3600_000;
/** What one run may spend at most (10,000 a day, shared with the official watcher and the timing backfill). A first
 *  backfill of FUN (a few thousand uploads and their playlists) takes a few hundred. */
const MAX_UNITS = 900;
/** Upload pages read in one run (50 a page, newest first). Past the first backfill, reading stops at the first page
 *  holding a video already stored. */
const MAX_PAGES = 120;
/** Pages of one playlist read (50 a page). */
const MAX_PLAYLIST_PAGES = 40;
/** Read again this long after the last read: inside YouTube's 30 days, with room for a missed run or two. */
export const REFRESH_AFTER_MS = 26 * 864e5;
const RUN_STALE_MS = 25 * 60_000;
const API = "https://www.googleapis.com/youtube/v3";
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HANDLE = /^@[A-Za-z0-9._-]{3,30}$/;

type Fetch = typeof fetch;
class QuotaError extends Error {}
async function api(path: string, params: Record<string, string>, key: string, fetchImpl: Fetch): Promise<any> {
  const res = await fetchImpl(`${API}/${path}?${new URLSearchParams({ ...params, key })}`, { signal: AbortSignal.timeout(20_000) });
  if (res.ok) return res.json();
  let reason = "";
  try { reason = String((await res.json())?.error?.errors?.[0]?.reason ?? ""); } catch { /* no body */ }
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(reason)) throw new QuotaError(`YouTube quota used up (${reason})`);
  throw new Error(`YouTube ${path} answered ${res.status}${reason ? ` (${reason})` : ""}`);
}

const uploadsOf = (channelId: string) => `UU${channelId.slice(2)}`;

let seeded = false;
/** The seed channels, each once: a channel the owner deactivated stays so. */
export async function seedCreatorChannels(now = Date.now(), again = false): Promise<void> {
  if (seeded && !again) return;
  const at = new Date(now).toISOString();
  await db().batch(SEED_CHANNELS.map((c) => ({
    sql: "INSERT INTO creator_channels (channel_id, handle, title, uploads_playlist, active, added_by, added_at) VALUES (?, ?, ?, ?, 1, 'seed', ?) ON CONFLICT(channel_id) DO NOTHING",
    args: [c.channelId, c.handle, c.title, uploadsOf(c.channelId), at],
  })), "write");
  seeded = true;
}

// ---- The run ----

interface Channel { channelId: string; title: string; uploads: string; checkedAt: string | null }
/** A channel's playlists as last read: title, YouTube's etag (a playlist whose etag is the same isn't read again) and
 *  its videos. The members are kept, not only applied when read: a video stored on a later run (live then, or past
 *  the run's units) still gets its playlists, and so its series. */
type PlaylistInfo = Record<string, { title: string; etag: string; members?: string[] }>;
const playlistKey = (channelId: string) => `creator:playlists:${channelId}`;

export interface CreatorRun { units: number; channels: number; seen: number; refreshed: number; dropped: number; tagged: number; error: string | null }
interface Ctx { key: string; fetchImpl: Fetch; out: CreatorRun; maxUnits: number; locked: <T>(fn: () => Promise<T>) => Promise<T>; now: () => number }

/** A videos.list item → its row, or null when it can't be kept (gone, private, blocked everywhere, not embeddable). */
function rowOf(item: any, channelId: string, now: number) {
  const id = String(item?.id ?? "");
  if (!VIDEO_ID.test(id)) return null;
  const facts = apiFacts(item);
  if (facts.status !== "ok" || facts.embeddable === false) return null;
  if (String(item?.status?.privacyStatus ?? "public") === "private") return null;
  return {
    videoId: id, channelId,
    title: String(item?.snippet?.title ?? "").slice(0, 300),
    description: String(item?.snippet?.description ?? "").slice(0, 5000),
    publishedAt: String(item?.snippet?.publishedAt ?? new Date(now).toISOString()),
    durationS: isoDuration(item?.contentDetails?.duration),
    at: new Date(now).toISOString(),
  };
}
const live = (item: any) => ["live", "upcoming"].includes(String(item?.snippet?.liveBroadcastContent ?? "none"));

/** The channel's playlists, each one that changed since it was last read read again (its videos). An unchanged one
 *  keeps the videos it had; one cut short (the run's units spent) keeps them too, with what was read added, and no
 *  etag, so the next run reads it whole. */
async function readPlaylists(ch: Channel, c: Ctx): Promise<PlaylistInfo> {
  const before = (await kvGet<PlaylistInfo>(playlistKey(ch.channelId))) ?? {};
  const info: PlaylistInfo = {};
  let token = "";
  for (let page = 0; page < 10; page++) {
    c.out.units++;
    const body = await api("playlists", { part: "snippet", channelId: ch.channelId, maxResults: "50", ...(token ? { pageToken: token } : {}) }, c.key, c.fetchImpl);
    for (const p of Array.isArray(body?.items) ? body.items : []) {
      const id = String(p?.id ?? "");
      if (id) info[id] = { title: String(p?.snippet?.title ?? "").slice(0, 200), etag: String(p?.etag ?? ""), members: before[id]?.members ?? [] };
    }
    token = String(body?.nextPageToken ?? "");
    if (!token) break;
  }
  for (const [id, p] of Object.entries(info)) {
    if (before[id]?.etag && before[id].etag === p.etag && before[id].members) continue;
    if (c.out.units >= c.maxUnits) { info[id] = { ...p, etag: "" }; continue; }
    const ids = new Set<string>();
    let t = "";
    let whole = false;
    for (let page = 0; page < MAX_PLAYLIST_PAGES && c.out.units < c.maxUnits; page++) {
      c.out.units++;
      const body = await api("playlistItems", { part: "contentDetails", playlistId: id, maxResults: "50", ...(t ? { pageToken: t } : {}) }, c.key, c.fetchImpl);
      for (const i of Array.isArray(body?.items) ? body.items : []) { const v = String(i?.contentDetails?.videoId ?? ""); if (VIDEO_ID.test(v)) ids.add(v); }
      t = String(body?.nextPageToken ?? "");
      if (!t) { whole = true; break; }
    }
    info[id] = whole ? { ...p, members: [...ids] } : { ...p, etag: "", members: [...new Set([...(p.members ?? []), ...ids])] };
  }
  return info;
}

/** The channel's uploads not stored yet, newest first. The first full read goes back to its oldest upload; after it,
 *  reading stops at the first page holding a stored video. */
async function newUploads(ch: Channel, c: Ctx): Promise<string[]> {
  const fresh: string[] = [];
  let token = "";
  for (let page = 0; page < MAX_PAGES && c.out.units < c.maxUnits; page++) {
    c.out.units++;
    const body = await api("playlistItems", { part: "contentDetails", playlistId: ch.uploads, maxResults: "50", ...(token ? { pageToken: token } : {}) }, c.key, c.fetchImpl);
    const ids = (Array.isArray(body?.items) ? body.items : []).map((i: any) => String(i?.contentDetails?.videoId ?? "")).filter((v: string) => VIDEO_ID.test(v));
    const known = new Set<string>();
    if (ids.length) for (const r of await all<{ video_id: string }>(`SELECT video_id FROM creator_videos WHERE video_id IN (${ids.map(() => "?").join(",")})`, ids)) known.add(String(r.video_id));
    for (const id of ids) if (!known.has(id)) fresh.push(id);
    token = String(body?.nextPageToken ?? "");
    if (!token || (ch.checkedAt && known.size)) break;
  }
  return fresh;
}

const INSERT_VIDEO = `INSERT INTO creator_videos (video_id, channel_id, title, description, published_at, duration_s, playlist_ids, series, program, season, embeddable, last_refreshed)
  VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, 'unknown', NULL, 1, ?)
  ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, description = excluded.description, published_at = excluded.published_at,
    duration_s = excluded.duration_s, embeddable = 1, last_refreshed = excluded.last_refreshed`;
const dropWrites = (id: string) => [
  { sql: "DELETE FROM video_team_tags WHERE video_id = ?", args: [id] },
  { sql: "DELETE FROM creator_videos WHERE video_id = ?", args: [id] },
];

/** videos.list for these ids (50 a unit): stored or refreshed when they play, dropped when they don't. Live and
 *  upcoming ones are left for a later run. */
async function readVideos(ids: string[], ch: Channel, c: Ctx, refresh: boolean): Promise<void> {
  for (let i = 0; i < ids.length; i += 50) {
    if (c.out.units >= c.maxUnits) return;
    const part = ids.slice(i, i + 50);
    c.out.units++;
    const body = await api("videos", { part: "snippet,contentDetails,status", id: part.join(","), maxResults: "50" }, c.key, c.fetchImpl);
    if (!Array.isArray(body?.items)) continue; // not a well-formed answer: nothing is dropped on it
    const byId = new Map<string, any>(body.items.map((it: any) => [String(it?.id ?? ""), it]));
    const writes: { sql: string; args: (string | number | null)[] }[] = [];
    for (const id of part) {
      const item = byId.get(id);
      if (item && live(item)) continue;
      const row = item ? rowOf(item, ch.channelId, c.now()) : null;
      if (!row) {
        if (refresh) { writes.push(...dropWrites(id)); c.out.dropped++; }
        continue;
      }
      writes.push({ sql: INSERT_VIDEO, args: [row.videoId, row.channelId, row.title, row.description, row.publishedAt, row.durationS, row.at] });
      if (refresh) c.out.refreshed++; else c.out.seen++;
    }
    if (writes.length) await c.locked(() => db().batch(writes, "write"));
  }
}

/** Each stored video of the channel given the playlists that hold it now (the kept members of every playlist the
 *  channel has): new videos, playlists read again, and playlists gone all land here. Only changes are written. */
async function writeMemberships(ch: Channel, info: PlaylistInfo, c: Ctx): Promise<void> {
  const holds = new Map<string, string[]>();
  for (const [p, x] of Object.entries(info)) for (const v of x.members ?? []) (holds.get(v) ?? holds.set(v, []).get(v)!).push(p);
  const rows = await all<{ video_id: string; playlist_ids: string | null }>("SELECT video_id, playlist_ids FROM creator_videos WHERE channel_id = ?", [ch.channelId]);
  const writes: { sql: string; args: (string | number | null)[] }[] = [];
  for (const r of rows) {
    const now = [...(holds.get(String(r.video_id)) ?? [])].sort();
    if (now.join(",") !== parseIds(r.playlist_ids).sort().join(",")) writes.push({ sql: "UPDATE creator_videos SET playlist_ids = ? WHERE video_id = ?", args: [JSON.stringify(now), String(r.video_id)] });
  }
  for (let i = 0; i < writes.length; i += 200) { const chunk = writes.slice(i, i + 200); await c.locked(() => db().batch(chunk, "write")); }
}

function parseIds(s: string | null): string[] {
  try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

/** The team look-ups for tagging: the names index (server/api/query/names.ts) and the seasons each team was registered
 *  or played in (team_seasons), for the teams these texts could name. */
export async function lookupsFor(texts: string[]): Promise<TagLookups> {
  const idx = await names();
  const named = (f: string) => idx.teamsNamed(f).map((t) => t.number);
  const want = new Set<number>();
  for (const t of texts) {
    for (const m of t.matchAll(/\d{1,5}/g)) { const n = Number(m[0]); if (n && idx.team(n)) want.add(n); }
  }
  // Teams a title part could name whole (the name-only rule).
  for (const t of texts) for (const part of t.split(/\s*[|•·\n]\s*/)) for (const n of named(fold(part))) want.add(n);
  const seasons = new Map<number, number[]>();
  const list = [...want];
  for (let i = 0; i < list.length; i += 500) {
    const ph = list.slice(i, i + 500);
    for (const r of await all<{ team: number; season: number }>(`SELECT team, season FROM team_seasons WHERE team IN (${ph.map(() => "?").join(",")})`, ph)) {
      (seasons.get(Number(r.team)) ?? seasons.set(Number(r.team), []).get(Number(r.team))!).push(Number(r.season));
    }
    await loopTurn();
  }
  return {
    team: (n) => { const t = idx.team(n); return t ? { name: t.name } : undefined; },
    active: (n, s) => { const at = seasons.get(n); return !!at?.length && (s == null || at.some((x) => Math.abs(x - s) <= 1)); },
    named,
  };
}

/** Every stored video's series, program, season and tags derived again from its words and playlists (a fixed title
 *  fixes its tag; a team renamed or newly registered is found), the owner's removals left out. Only what changed is
 *  written. Answers how many tags there are. */
export async function retagAll(c: Pick<Ctx, "locked">, look?: TagLookups): Promise<number> {
  const rows = await all<{ video_id: string; channel_id: string; title: string; description: string | null; published_at: string; playlist_ids: string | null; series: string | null; program: string; season: number | null }>(
    "SELECT video_id, channel_id, title, description, published_at, playlist_ids, series, program, season FROM creator_videos");
  const lookups = look ?? await lookupsFor(rows.flatMap((r) => [r.title, r.description ?? ""]));
  const playlists = new Map<string, PlaylistInfo>();
  for (const ch of new Set(rows.map((r) => String(r.channel_id)))) playlists.set(ch, (await kvGet<PlaylistInfo>(playlistKey(ch))) ?? {});
  const removed = new Set((await all<{ video_id: string; team_number: number }>("SELECT video_id, team_number FROM video_tag_removals")).map((r) => `${r.video_id}|${r.team_number}`));
  const have = new Map<string, string>();
  for (const r of await all<{ video_id: string; team_number: number; rule: string }>("SELECT video_id, team_number, rule FROM video_team_tags")) have.set(`${r.video_id}|${r.team_number}`, String(r.rule));
  const want = new Map<string, string>();
  const writes: { sql: string; args: (string | number | null)[] }[] = [];
  let step = 0;
  for (const r of rows) {
    if (++step % 200 === 0) await loopTurn();
    const info = playlists.get(String(r.channel_id)) ?? {};
    const titles = parseIds(r.playlist_ids).map((p) => info[p]?.title).filter((t): t is string => !!t);
    const series = seriesOf(r.title, titles);
    const seriesTitles = series ? titles.filter((t) => seriesOf("", [t]) === series) : [];
    const program = programOf(r.title, r.description ?? "", titles, seriesTitles);
    const season = seasonOf(r.title, r.description ?? "", r.published_at);
    if (series !== (r.series ?? null) || program !== r.program || season !== (r.season == null ? null : Number(r.season))) {
      writes.push({ sql: "UPDATE creator_videos SET series = ?, program = ?, season = ? WHERE video_id = ?", args: [series, program, season, String(r.video_id)] });
    }
    for (const t of tagsOf({ title: r.title, description: r.description, program, season }, lookups)) {
      const k = `${r.video_id}|${t.team}`;
      if (!removed.has(k)) want.set(k, t.rule);
    }
  }
  for (const [k, rule] of want) {
    if (have.get(k) === rule) continue;
    const [v, n] = k.split("|");
    writes.push({ sql: "INSERT INTO video_team_tags (video_id, team_number, rule) VALUES (?, ?, ?) ON CONFLICT(video_id, team_number) DO UPDATE SET rule = excluded.rule", args: [v, Number(n), rule] });
  }
  for (const k of have.keys()) {
    if (want.has(k)) continue;
    const [v, n] = k.split("|");
    writes.push({ sql: "DELETE FROM video_team_tags WHERE video_id = ? AND team_number = ?", args: [v, Number(n)] });
  }
  for (let i = 0; i < writes.length; i += 200) { const chunk = writes.slice(i, i + 200); await c.locked(() => db().batch(chunk, "write")); }
  if (writes.length) forgetFeatured();
  return want.size;
}

let busy = false;
/**
 * One pass over the active creator channels: their playlists, new uploads, the 30-day refresh, then every video's
 * tags derived again. Without YOUTUBE_API_KEY nothing is read. Stops when the run's units are spent or YouTube says
 * the day's quota is (what was read is kept; the rest next run).
 */
export async function runCreatorIntake(log: (s: string) => void, opts: { apiKey?: string | null; fetchImpl?: Fetch; now?: () => number; maxUnits?: number; lockWaitMs?: number; lookups?: TagLookups } = {}): Promise<CreatorRun | null> {
  const key = opts.apiKey === undefined ? env.youtubeApiKey : opts.apiKey;
  if (!key || busy) return null;
  busy = true;
  const now = opts.now ?? Date.now;
  const locked = <T>(fn: () => Promise<T>) => withDataLock("creator videos", fn, { ttlMs: 60_000, waitMs: opts.lockWaitMs ?? 3 * 60_000, pollMs: 1000 });
  const out: CreatorRun = { units: 0, channels: 0, seen: 0, refreshed: 0, dropped: 0, tagged: 0, error: null };
  const c: Ctx = { key, fetchImpl: opts.fetchImpl ?? fetch, out, maxUnits: opts.maxUnits ?? MAX_UNITS, locked, now };
  let runId = 0;
  const at = now();
  try {
    // The run's claim: not while another started in the last 25 minutes and never finished (past that it died, and
    // is closed here).
    runId = await locked(async () => {
      const id = Number((await get<{ id: number }>(
        "INSERT INTO creator_runs (started_at) SELECT ?1 WHERE NOT EXISTS (SELECT 1 FROM creator_runs WHERE finished_at IS NULL AND started_at > ?2) RETURNING id",
        [new Date(at).toISOString(), new Date(at - RUN_STALE_MS).toISOString()]))?.id ?? 0);
      if (id) await run("UPDATE creator_runs SET finished_at = ?, error = 'never finished (a restart or a busy database)' WHERE finished_at IS NULL AND id < ?", [new Date(at).toISOString(), id]);
      return id;
    });
  } catch (e) { busy = false; if (e instanceof LockBusy) return null; throw e; }
  if (!runId) { busy = false; return null; }
  try {
    await locked(() => seedCreatorChannels(now()));
    const channels = (await all<any>("SELECT channel_id, title, uploads_playlist, checked_at FROM creator_channels WHERE active = 1 ORDER BY checked_at IS NOT NULL, checked_at, channel_id"))
      .map((r): Channel => ({ channelId: String(r.channel_id), title: String(r.title), uploads: String(r.uploads_playlist), checkedAt: r.checked_at ?? null }));
    for (const ch of channels) {
      if (out.units >= c.maxUnits) { out.error = `stopped at the run's ${c.maxUnits} units; the rest next run`; break; }
      try {
        const pl = await readPlaylists(ch, c);
        const fresh = await newUploads(ch, c);
        await readVideos(fresh, ch, c, false);
        // The 30-day refresh: the oldest reads first, as many as the run's units allow.
        const stale = await all<{ video_id: string }>("SELECT video_id FROM creator_videos WHERE channel_id = ? AND last_refreshed < ? ORDER BY last_refreshed LIMIT ?",
          [ch.channelId, new Date(now() - REFRESH_AFTER_MS).toISOString(), Math.max(0, c.maxUnits - out.units) * 50]);
        await readVideos(stale.map((r) => String(r.video_id)), ch, c, true);
        await writeMemberships(ch, pl, c);
        await locked(() => kvSet(playlistKey(ch.channelId), pl));
        out.channels++;
        // A full read stands only when every upload page was read (the units didn't run out first).
        const whole = out.units < c.maxUnits;
        await locked(() => run("UPDATE creator_channels SET checked_at = CASE WHEN ? THEN ? ELSE checked_at END, last_error = NULL WHERE channel_id = ?", [whole ? 1 : 0, new Date(now()).toISOString(), ch.channelId]));
      } catch (e) {
        if (e instanceof QuotaError || e instanceof LockBusy || isBusy(e)) throw e;
        await locked(() => run("UPDATE creator_channels SET last_error = ? WHERE channel_id = ?", [String((e as Error).message).slice(0, 300), ch.channelId]));
      }
    }
  } catch (e) {
    out.error = e instanceof LockBusy || isBusy(e) ? "database busy (the data sync was writing): stopped, tried again next check" : String((e as Error).message ?? e).slice(0, 300);
  }
  try {
    out.tagged = await retagAll(c, opts.lookups);
  } catch (e) {
    out.error = [out.error, `tags: ${String((e as Error).message ?? e).slice(0, 200)}`].filter(Boolean).join("; ");
  } finally {
    busy = false;
    await locked(() => run("UPDATE creator_runs SET finished_at = ?, units = ?, channels = ?, seen = ?, refreshed = ?, dropped = ?, tagged = ?, error = ? WHERE id = ?",
      [new Date(now()).toISOString(), out.units, out.channels, out.seen, out.refreshed, out.dropped, out.tagged, out.error, runId])).catch(() => {});
  }
  forgetFeatured();
  log(`creator videos: ${out.channels} channel${out.channels === 1 ? "" : "s"} (${out.units} units): ${out.seen} new, ${out.refreshed} refreshed, ${out.dropped} dropped, ${out.tagged} tags${out.error ? `; ${out.error}` : ""}`);
  return out;
}

/** The scheduled run: when the last finished one started CREATOR_EVERY_MS ago or more. */
export async function creatorIfDue(log: (s: string) => void, now = Date.now(), opts: Parameters<typeof runCreatorIntake>[1] = {}): Promise<CreatorRun | null> {
  const key = opts.apiKey === undefined ? env.youtubeApiKey : opts.apiKey;
  if (!key) return null;
  const last = await get<{ started_at: string }>("SELECT started_at FROM creator_runs WHERE finished_at IS NOT NULL AND COALESCE(error, '') NOT LIKE 'database busy%' ORDER BY id DESC LIMIT 1");
  if (last && now - Date.parse(last.started_at) < CREATOR_EVERY_MS) return null;
  return runCreatorIntake(log, { ...opts, apiKey: key });
}

// ---- Reads (the team page, the Videos tab, Control Point) ----

const SERIES = new Set<string>(["behind-the-bot", "pits-and-parts", "top-25", "funalysis"]);
const asSeries = (s: unknown): CreatorSeries | null => (typeof s === "string" && SERIES.has(s) ? s as CreatorSeries : null);
const asProgram = (s: unknown): CreatorProgram => (s === "ftc" || s === "frc" || s === "vex" ? s : "unknown");

/** Creator videos, newest first: embeddable ones only, each with its tagged teams. `teams`: only those tagged with any
 *  of them; `series`: only that series; `since`: published at or after (ISO). */
export async function creatorVideosFor(opts: { teams?: number[]; series?: string; since?: string; limit: number }): Promise<CreatorVideo[]> {
  const where = ["v.embeddable = 1"];
  const args: (string | number)[] = [];
  const teams = (opts.teams ?? []).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
  if (opts.teams) {
    if (!teams.length) return [];
    where.push(`EXISTS (SELECT 1 FROM video_team_tags t WHERE t.video_id = v.video_id AND t.team_number IN (${teams.map(() => "?").join(",")}))`);
    args.push(...teams);
  }
  if (opts.series) { where.push("v.series = ?"); args.push(opts.series); }
  if (opts.since) { where.push("v.published_at >= ?"); args.push(opts.since); }
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit) || 1));
  const rows = await all<any>(
    `SELECT v.video_id, v.channel_id, c.title AS channel, v.title, v.published_at, v.duration_s, v.series, v.program, v.season,
            (SELECT group_concat(t.team_number) FROM video_team_tags t WHERE t.video_id = v.video_id) AS teams
     FROM creator_videos v LEFT JOIN creator_channels c ON c.channel_id = v.channel_id
     WHERE ${where.join(" AND ")} ORDER BY v.published_at DESC, v.video_id LIMIT ${limit}`, args);
  return rows.map((r) => ({
    videoId: String(r.video_id), channelId: String(r.channel_id), channel: r.channel ?? null, title: String(r.title), publishedAt: String(r.published_at),
    durationS: r.duration_s == null ? null : Number(r.duration_s), series: asSeries(r.series), program: asProgram(r.program),
    season: r.season == null ? null : Number(r.season),
    teams: r.teams ? String(r.teams).split(",").map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [],
  }));
}

/** A team's featured videos, newest first: the creator videos whose title names it (a description's passing mention
 *  is a tag, not a feature). */
export async function featuredFor(team: number): Promise<FeaturedVideo[]> {
  if (!Number.isInteger(team) || team <= 0) return [];
  const rows = await all<any>(
    `SELECT v.video_id, v.series, v.season, v.title FROM video_team_tags t JOIN creator_videos v ON v.video_id = t.video_id
     WHERE t.team_number = ? AND t.rule LIKE 'title:%' AND v.embeddable = 1
       AND NOT EXISTS (SELECT 1 FROM video_tag_removals r WHERE r.video_id = t.video_id AND r.team_number = t.team_number)
     ORDER BY v.published_at DESC LIMIT 50`, [team]);
  return rows.map((r) => ({ series: asSeries(r.series), videoId: String(r.video_id), season: r.season == null ? null : Number(r.season), title: String(r.title) }));
}

const FEATURED_TTL_MS = 60_000;
let featuredSet: { at: number; value: Promise<Set<number>> } | null = null;
/** Every team featured on Behind the Bot (its title names the team), for the chip on team rows. Cached a minute,
 *  and dropped after every run and tag removal. */
export function featuredTeamSet(): Promise<Set<number>> {
  if (featuredSet && Date.now() - featuredSet.at < FEATURED_TTL_MS) return featuredSet.value;
  const value = all<{ team_number: number }>(
    `SELECT DISTINCT t.team_number FROM video_team_tags t JOIN creator_videos v ON v.video_id = t.video_id
     WHERE v.series = 'behind-the-bot' AND v.embeddable = 1 AND t.rule LIKE 'title:%'`).then((rows) => new Set(rows.map((r) => Number(r.team_number))));
  featuredSet = { at: Date.now(), value };
  value.catch(() => { if (featuredSet?.value === value) featuredSet = null; });
  return value;
}
export function forgetFeatured(): void { featuredSet = null; }
registerCache("Featured teams (creator videos)", forgetFeatured, { clipFree: true });

// ---- The owner's side (Owner › Creator videos, /api/owner/creators) ----

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function ownerCreators() {
  const since = new Date(Date.now()).toISOString().slice(0, 10);
  const [channels, runs, counts, today] = await Promise.all([
    all<any>(`SELECT c.channel_id, c.handle, c.title, c.uploads_playlist, c.active, c.added_by, c.added_at, c.checked_at, c.last_error,
                (SELECT COUNT(*) FROM creator_videos v WHERE v.channel_id = c.channel_id) AS videos
              FROM creator_channels c ORDER BY c.active DESC, c.title`),
    all<any>("SELECT id, started_at, finished_at, units, channels, seen, refreshed, dropped, tagged, error FROM creator_runs ORDER BY id DESC LIMIT 10"),
    get<any>(`SELECT (SELECT COUNT(*) FROM creator_videos) AS videos, (SELECT COUNT(*) FROM video_team_tags) AS tags,
                (SELECT COUNT(DISTINCT team_number) FROM video_team_tags) AS teams, (SELECT COUNT(*) FROM video_tag_removals) AS removals`),
    get<{ n: number }>("SELECT COALESCE(SUM(units), 0) AS n FROM creator_runs WHERE started_at >= ?", [since]),
  ]);
  return {
    apiKey: !!env.youtubeApiKey,
    everyHours: CREATOR_EVERY_MS / 3600_000,
    unitsToday: Number(today?.n ?? 0),
    counts: { videos: Number(counts?.videos ?? 0), tags: Number(counts?.tags ?? 0), teams: Number(counts?.teams ?? 0), removals: Number(counts?.removals ?? 0) },
    channels: channels.map((r) => ({ channelId: String(r.channel_id), handle: r.handle ?? null, title: String(r.title), active: !!Number(r.active), addedBy: r.added_by ?? null,
      addedAt: String(r.added_at), checkedAt: r.checked_at ?? null, lastError: r.last_error ?? null, videos: Number(r.videos ?? 0) })),
    runs: runs.map((r) => ({ id: Number(r.id), startedAt: String(r.started_at), finishedAt: r.finished_at ?? null, units: Number(r.units), channels: Number(r.channels), seen: Number(r.seen),
      refreshed: Number(r.refreshed), dropped: Number(r.dropped), tagged: Number(r.tagged), error: r.error ?? null })),
  };
}

export interface OwnerTag { videoId: string; title: string; series: string | null; program: string; season: number | null; publishedAt: string; team: number; teamName: string | null; rule: string }

/** The tags, newest video first; `team` or `q` (words of the title) narrow it. */
export async function ownerTags(o: { team?: number; q?: string; limit?: number } = {}): Promise<OwnerTag[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (o.team) { where.push("t.team_number = ?"); args.push(o.team); }
  if (o.q) { where.push("v.title LIKE ?"); args.push(`%${o.q.replace(/[%_]/g, "")}%`); }
  const limit = Math.max(1, Math.min(1000, o.limit ?? 300));
  const rows = await all<any>(
    `SELECT t.video_id, v.title, v.series, v.program, v.season, v.published_at, t.team_number, tm.name AS team_name, t.rule
     FROM video_team_tags t JOIN creator_videos v ON v.video_id = t.video_id LEFT JOIN teams tm ON tm.number = t.team_number
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY v.published_at DESC, t.team_number LIMIT ${limit}`, args);
  return rows.map((r) => ({ videoId: String(r.video_id), title: String(r.title), series: r.series ?? null, program: String(r.program), season: r.season == null ? null : Number(r.season),
    publishedAt: String(r.published_at), team: Number(r.team_number), teamName: r.team_name ?? null, rule: String(r.rule) }));
}

/** A channel from its id ("UC…"), its handle ("@name") or its address. Without the API key only an id can be added
 *  (a handle needs YouTube to say whose it is). */
export async function addCreatorChannel(input: unknown, actor: string, opts: { apiKey?: string | null; fetchImpl?: Fetch; now?: number } = {}): Promise<Result<{ channelId: string }>> {
  const raw = typeof input === "string" ? input.trim() : "";
  const fromUrl = /youtube\.com\/(?:channel\/(UC[A-Za-z0-9_-]{22})|(@[A-Za-z0-9._-]{3,30}))/i.exec(raw);
  const id = CHANNEL_ID.test(raw) ? raw : fromUrl?.[1] ?? null;
  const handle = HANDLE.test(raw) ? raw : fromUrl?.[2] ?? null;
  if (!id && !handle) return { ok: false, error: "Paste the channel's address, its @handle or its id (UC… , 24 characters)." };
  const key = opts.apiKey === undefined ? env.youtubeApiKey : opts.apiKey;
  let channelId = id, title = handle ?? id!, uploads = id ? uploadsOf(id) : "", resolvedHandle = handle;
  if (key) {
    try {
      const body = await api("channels", { part: "snippet,contentDetails", ...(id ? { id } : { forHandle: handle! }) }, key, opts.fetchImpl ?? fetch);
      const item = Array.isArray(body?.items) ? body.items[0] : null;
      if (!item) return { ok: false, error: "YouTube has no such channel." };
      channelId = String(item.id);
      title = String(item?.snippet?.title ?? title).slice(0, 120);
      resolvedHandle = item?.snippet?.customUrl ? String(item.snippet.customUrl) : resolvedHandle;
      uploads = String(item?.contentDetails?.relatedPlaylists?.uploads ?? uploadsOf(channelId));
    } catch (e) { return { ok: false, error: `Couldn't ask YouTube: ${(e as Error).message}` }; }
  } else if (!id) return { ok: false, error: "YOUTUBE_API_KEY isn't set on the server: add the channel by its id (UC…)." };
  if (!channelId || !CHANNEL_ID.test(channelId)) return { ok: false, error: "That isn't a YouTube channel id." };
  const at = new Date(opts.now ?? Date.now()).toISOString();
  const was = await get<{ active: number }>("SELECT active FROM creator_channels WHERE channel_id = ?", [channelId]);
  await run(`INSERT INTO creator_channels (channel_id, handle, title, uploads_playlist, active, added_by, added_at) VALUES (?, ?, ?, ?, 1, 'owner', ?)
             ON CONFLICT(channel_id) DO UPDATE SET active = 1, handle = COALESCE(excluded.handle, creator_channels.handle), title = excluded.title, uploads_playlist = excluded.uploads_playlist`,
    [channelId, resolvedHandle, title, uploads, at]);
  await recordAudit(actor, was ? "creatorChannel.reactivate" : "creatorChannel.add", { channelId, handle: resolvedHandle, title }, null, was ? { from: !!Number(was.active), to: true } : undefined);
  return { ok: true, channelId };
}

/** Stop watching a channel: its videos stay (and keep being refreshed or dropped) until it's watched again. */
export async function deactivateCreatorChannel(channelId: string, actor: string): Promise<Result> {
  const was = await get<{ title: string }>("SELECT title FROM creator_channels WHERE channel_id = ? AND active = 1", [channelId]);
  if (!was) return { ok: false, error: "That channel isn't watched." };
  await run("UPDATE creator_channels SET active = 0 WHERE channel_id = ?", [channelId]);
  await recordAudit(actor, "creatorChannel.deactivate", { channelId, title: String(was.title) }, null, { from: true, to: false });
  return { ok: true };
}

/** Take a wrong tag off: it's remembered, so the next derivation never adds it again. */
export async function removeCreatorTag(videoId: string, team: number, actor: string, now = Date.now()): Promise<Result> {
  if (!VIDEO_ID.test(videoId) || !Number.isInteger(team) || team <= 0) return { ok: false, error: "Not a tag." };
  const tag = await get<{ rule: string }>("SELECT rule FROM video_team_tags WHERE video_id = ? AND team_number = ?", [videoId, team]);
  if (!tag) return { ok: false, error: "That tag isn't there (already removed, or derived away)." };
  await db().batch([
    { sql: "INSERT INTO video_tag_removals (video_id, team_number, removed_by, removed_at) VALUES (?, ?, 'owner', ?) ON CONFLICT(video_id, team_number) DO NOTHING", args: [videoId, team, new Date(now).toISOString()] },
    { sql: "DELETE FROM video_team_tags WHERE video_id = ? AND team_number = ?", args: [videoId, team] },
  ], "write");
  forgetFeatured();
  await recordAudit(actor, "creatorTag.remove", { videoId, team, rule: String(tag.rule) });
  return { ok: true };
}

/** The owner's Run now: not within 10 minutes of the last run. */
export async function runCreatorNow(actor: string, log: (s: string) => void, now = Date.now()): Promise<Result<{ run: CreatorRun | null }>> {
  if (!env.youtubeApiKey) return { ok: false, error: "YOUTUBE_API_KEY isn't set on the server, so channels can't be read." };
  const last = await get<{ started_at: string }>("SELECT started_at FROM creator_runs ORDER BY id DESC LIMIT 1");
  if (last && now - Date.parse(last.started_at) < 10 * 60_000) return { ok: false, error: "The intake ran less than 10 minutes ago." };
  const out = await runCreatorIntake(log);
  if (!out) return { ok: false, error: "The intake is already running, or the data sync is writing: try again in a few minutes." };
  await recordAudit(actor, "creatorVideos.runNow", { ...out });
  return { ok: true, run: out };
}
