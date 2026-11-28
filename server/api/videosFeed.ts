// The Videos tab's feed (GET /api/videos/feed, src/pages/VideosPage.tsx): one list of videos that all play in the app,
// different for every person. Following the /api/weekend pattern (server/api/weekend.ts): readings here, the route
// in server/app.ts.
//
// Candidates come from pools kept for POOL_TTL_MS, the same for everyone:
//   weekend   this weekend's events' recordings and live streams (weekendEvents)
//   creator   creator videos (FUN Robotics Network…) with their tagged teams (creatorVideosFor, FTC only: see
//             ./videosFeed.creators.ts); Behind the Bot episodes are their own pool
//   record    the season's top scores, at events whose matches count for records (RECORD_TYPES, as searchHighScores);
//             last season's after them while this one has fewer than 10 with a video
//   close     finishes these 14 days decided by 3 points or fewer
//   upset     matches these 21 days the prediction engine's live call got wrong at 75% or more
//   recent    the season's newest matches with a video, whatever the event
//   popular   what most people watched these 7 days (video_watch); every pool's items are lifted by it too
// and one per person: the clips of the teams they're tied to (on the team, My team, followed, shortlisted, scouted),
// kept per team. A match is a candidate only when it has a video to play (seasonClipKeys, the Play buttons' check).
// Then each person's score and mix (./videosFeed.rank.ts) on top, cheap, lifted by the recommendation engine
// (server/videos/recommend.ts, the same as Cycles): their taste for each team, creator and series in it, what people
// who loved what they loved also loved, Behind the Bot star power, and what everyone did with it (engineLift). Every read selects only its columns and
// goes through db.ts's all(), which lets the event loop turn (#1557).
import { randomBytes } from "node:crypto";
import { all, get, run } from "../db.js";
import { CURRENT_SEASON, SEASON_NUMBERS } from "../data/seasons.js";
import { registerCache } from "../caches.js";
import { eventRecording, seasonClipKeys, seasonRecordings, withClips } from "../videos/recordings.js";
import { withUploads } from "../videos/uploadClips.js";
import { withStills } from "../videos/storyboards.js";
import { membershipOf } from "../videos/membership.js";
import { RECORD_TYPES } from "./searchHighScores.js";
import { weekendEvents } from "./weekend.js";
import { feedCreatorVideos } from "./videosFeed.creators.js";
import { isCold, kindWeights, mixFeed, reasonFor, scoreOf, tieOf, type Candidate, type Profile, type Tie, type WatchRow } from "./videosFeed.rank.js";
import { coScore, qualityOf, starLift, tasteLift, tasteOf, type CoIndex, type RecItem, type Stats, type Taste } from "../videos/recommend.js";
import { btbEpisodes, coEngagement, deviceSignals, digest, personSignals, resolveItems, videoStats } from "../videos/signals.js";
import { CYCLE_MAX_S } from "../../src/shared/cycles.js";
import { linkStart } from "../../src/shared/recording.js";
import { thumbnailUrl, watchHref } from "../../src/shared/stream.js";
import { youtubeId } from "../../src/shared/personal.js";
import { localToUtcMs } from "../../src/shared/time.js";
import type { MatchClip, SearchVideoItem } from "../../src/shared/api.js";
import { FEED_KEY, WATCH_KINDS, watchKindOf, type FeedAnswer, type FeedFilter, type FeedItem, type FeedSource, type HistoryState, type WatchKind, type WatchReport } from "../../src/shared/videosFeed.js";

export const POOL_TTL_MS = 5 * 60_000;
const LIST_TTL_MS = 10 * 60_000;
export const PAGE_SIZE = 12;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Match clips
// ---------------------------------------------------------------------------

export interface MatchRef { season: number; code: string; level: string; series: number; number: number }
const refKey = (r: MatchRef) => `m:${r.season}:${r.code}:${r.level}:${r.series}:${r.number}`;
const clipKeyOf = (r: MatchRef) => `${r.code}|${r.level}|${r.series}|${r.number}`;
const matchHref = (r: MatchRef) => `/events/${r.season}/${encodeURIComponent(r.code)}?match=${r.level}:${r.series}:${r.number}`;

/** An event's played matches' videos by "level:series:number": FIRST's own video first, else its place in the
 *  event's recording (withClips over the whole event, as the event page reads it). Kept POOL_TTL_MS. */
let eventClipCache = new Map<string, { at: number; v: Promise<Map<string, SearchVideoItem>> }>();
async function readEventClips(season: number, code: string): Promise<Map<string, SearchVideoItem>> {
  const rows = await all<{ level: string; series: number; number: number; label: string; time: string | null; video: string | null; timezone: string | null }>(
    `SELECT m.level, m.series, m.number, m.label, m.time, m.video, e.timezone FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
     WHERE m.season = ? AND m.code = ? AND m.played = 1`, [season, code]);
  const rec = (await seasonRecordings(season).catch(() => null))?.get(code) ?? null;
  const views = rows.map((r) => {
    const at = localToUtcMs(r.time, r.timezone);
    return { label: String(r.label), time: r.time, startsAt: at == null ? null : new Date(at).toISOString(), played: true, clip: undefined as MatchClip | undefined, key: `${r.level}:${Number(r.series)}:${Number(r.number)}`, video: r.video };
  });
  const out = new Map<string, SearchVideoItem>();
  for (const v of withUploads(withClips(views, rec), season, code)) {
    const own = v.video ? youtubeId(v.video) : null;
    if (own) out.set(v.key, { videoId: own, t: linkStart(v.video!), kind: "match", match: v.label });
    else if (v.clip) out.set(v.key, { videoId: v.clip.videoId, t: v.clip.t, ...(v.clip.end != null ? { end: v.clip.end } : {}), kind: "recording", match: v.label, ...(rec?.meta?.live ? { live: true } : {}), ...(v.clip.youtubeOnly ? { youtubeOnly: true as const } : {}) });
  }
  return out;
}
function eventClips(season: number, code: string, now = Date.now()): Promise<Map<string, SearchVideoItem>> {
  const k = `${season}:${code}`;
  const hit = eventClipCache.get(k);
  if (hit && now - hit.at < POOL_TTL_MS) return hit.v;
  const v = readEventClips(season, code);
  eventClipCache.set(k, { at: now, v });
  v.catch(() => { if (eventClipCache.get(k)?.v === v) eventClipCache.delete(k); });
  if (eventClipCache.size > 400) eventClipCache = new Map([...eventClipCache].slice(-300));
  return v;
}

interface MatchPick extends MatchRef { source: FeedSource; reason: string; quality: number }

/** The matches as feed candidates: each with its video, title, robots, event and time. One with no video is left out. */
export async function matchCandidates(picks: MatchPick[]): Promise<Candidate[]> {
  if (!picks.length) return [];
  const out: Candidate[] = [];
  const bySeason = new Map<number, MatchPick[]>();
  for (const p of picks) (bySeason.get(p.season) ?? bySeason.set(p.season, []).get(p.season)!).push(p);
  for (const [season, ps] of bySeason) {
    for (let i = 0; i < ps.length; i += 100) {
      const part = ps.slice(i, i + 100);
      const where = part.map(() => "(m.code = ? AND m.level = ? AND m.series = ? AND m.number = ?)").join(" OR ");
      const args = part.flatMap((p) => [p.code, p.level, p.series, p.number]);
      const [rows, lineups] = await Promise.all([
        all<{ code: string; level: string; series: number; number: number; label: string; time: string | null; red_total: number | null; blue_total: number | null; name: string; timezone: string | null; state: string | null; country: string | null }>(
          `SELECT m.code, m.level, m.series, m.number, m.label, m.time, m.red_total, m.blue_total, e.name, e.timezone, e.state, e.country FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
           WHERE m.season = ? AND m.played = 1 AND (${where})`, [season, ...args]),
        all<{ code: string; level: string; series: number; number: number; team: number; alliance: string }>(
          `SELECT m.code, m.level, m.series, m.number, m.team, m.alliance FROM match_teams m WHERE m.season = ? AND (${where}) ORDER BY m.station, m.team`, [season, ...args]),
      ]);
      const k = (r: { code: string; level: string; series: number; number: number }) => `${r.code}|${r.level}|${Number(r.series)}|${Number(r.number)}`;
      const sides = new Map<string, { red: number[]; blue: number[] }>();
      for (const l of lineups) { const s = sides.get(k(l)) ?? sides.set(k(l), { red: [], blue: [] }).get(k(l))!; (l.alliance === "red" ? s.red : s.blue).push(Number(l.team)); }
      const meta = new Map(rows.map((r) => [k(r), r]));
      for (const p of part) {
        const r = meta.get(clipKeyOf(p));
        if (!r) continue;
        const v = (await eventClips(season, p.code)).get(`${p.level}:${p.series}:${p.number}`);
        if (!v) continue;
        const s = sides.get(clipKeyOf(p)) ?? { red: [], blue: [] };
        const score = r.red_total != null && r.blue_total != null ? ` · ${r.red_total}–${r.blue_total}` : "";
        const at = localToUtcMs(r.time, r.timezone);
        out.push({
          item: {
            ...v, key: refKey(p), kind: v.kind, source: p.source, reason: p.reason, title: `${r.label}: ${s.red.join(" & ") || "Red"} vs ${s.blue.join(" & ") || "Blue"}${score}`,
            thumb: thumbnailUrl(v.videoId), teams: [...s.red, ...s.blue], event: { season, code: p.code, name: String(r.name), href: `/events/${season}/${encodeURIComponent(p.code)}` },
            href: matchHref(p), published: at == null ? null : new Date(at).toISOString(), ...(v.end != null && v.end > v.t ? { duration: v.end - v.t } : {}),
          },
          group: `${season}:${p.code}`, at, quality: p.quality, popularity: 0, place: { country: r.country, state: r.state },
        });
      }
    }
  }
  return out;
}

type RefRow = { code: string; level: string; series: number; number: number };
/** Only rows with a video to play (seasonClipKeys), at most `n`. */
async function withVideo<T extends RefRow>(season: number, rows: T[], n: number): Promise<T[]> {
  const keys = await seasonClipKeys(season).catch(() => new Set<string>());
  return rows.filter((r) => keys.has(`${r.code}|${r.level}|${Number(r.series)}|${Number(r.number)}`)).slice(0, n);
}
const ref = (season: number, r: RefRow): MatchRef => ({ season, code: String(r.code), level: String(r.level), series: Number(r.series), number: Number(r.number) });
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Pools (the same for everyone)
// ---------------------------------------------------------------------------

/** The season's top scores; early in a season with few videos yet, last season's after them. */
async function recordPool(season: number): Promise<MatchPick[]> {
  const now = await seasonTop(season, "this season");
  return now.length >= 10 || !SEASON_NUMBERS.includes(season - 1) ? now : [...now, ...(await seasonTop(season - 1, "last season")).slice(0, 25 - now.length)];
}
async function seasonTop(season: number, which: string): Promise<MatchPick[]> {
  const rows = await all<RefRow & { top: number }>(
    `SELECT m.code, m.level, m.series, m.number, MAX(COALESCE(m.red_np, 0), COALESCE(m.blue_np, 0)) top FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
     WHERE m.season = ? AND m.played = 1 AND e.type IN (${RECORD_TYPES.map(() => "?").join(",")}) ORDER BY top DESC LIMIT 200`, [season, ...RECORD_TYPES]);
  const kept = await withVideo(season, rows, 25);
  return kept.map((r, i) => ({ ...ref(season, r), source: "record", quality: i === 0 ? 1.4 : 1.15, reason: i === 0 ? `${which === "this season" ? "Season" : "Last season's"} high: ${r.top} without penalties` : `Top score ${which}: ${r.top} without penalties` }));
}

/** The newest matches of the season with a video, whatever the event: so the feed always has this season's play. */
async function recentPool(season: number, now: number): Promise<MatchPick[]> {
  const rows = await all<RefRow & { time: string | null }>(
    "SELECT code, level, series, number, time FROM matches WHERE season = ? AND played = 1 AND time IS NOT NULL ORDER BY time DESC LIMIT 600", [season]);
  const kept = await withVideo(season, rows, 40);
  return kept.map((r) => ({ ...ref(season, r), source: "recent", quality: 0.9, reason: r.time && Date.parse(`${r.time.slice(0, 10)}T00:00:00Z`) >= now - 3 * DAY ? "Just played" : "Recent match" }));
}

async function closePool(season: number, now: number): Promise<MatchPick[]> {
  const rows = await all<RefRow & { margin: number }>(
    `SELECT code, level, series, number, ABS(red_total - blue_total) margin FROM matches
     WHERE season = ? AND played = 1 AND red_total IS NOT NULL AND blue_total IS NOT NULL AND ABS(red_total - blue_total) <= 3 AND time >= ? ORDER BY time DESC LIMIT 400`, [season, isoDay(now - 14 * DAY)]);
  const kept = await withVideo(season, rows, 30);
  return kept.map((r) => ({ ...ref(season, r), source: "close", quality: r.margin === 0 ? 1.2 : 1.05, reason: r.margin === 0 ? "Ended in a tie" : `Decided by ${r.margin} point${r.margin === 1 ? "" : "s"}` }));
}

/** The live call's chance for the winners, in whole percent, never 0 or 100 (a call is never a certainty). */
export const upsetPercent = (pRed: number, redWon: boolean) => Math.min(99, Math.max(1, Math.round((redWon ? pRed : 1 - pRed) * 100)));

async function upsetPool(season: number, now: number): Promise<MatchPick[]> {
  const rows = await all<RefRow & { p_red: number; red_total: number; blue_total: number }>(
    `SELECT m.code, m.level, m.series, m.number, p.p_red, m.red_total, m.blue_total FROM matches m
     JOIN predictions p ON p.season = m.season AND p.code = m.code AND p.level = m.level AND p.series = m.series AND p.number = m.number AND p.kind = 'live'
     WHERE m.season = ? AND m.played = 1 AND m.time >= ? AND ((p.p_red >= 0.75 AND m.blue_total > m.red_total) OR (p.p_red <= 0.25 AND m.red_total > m.blue_total))
     ORDER BY m.time DESC LIMIT 300`, [season, isoDay(now - 21 * DAY)]);
  const kept = await withVideo(season, rows, 30);
  return kept.map((r) => ({ ...ref(season, r), source: "upset", quality: 1.25, reason: `Upset: our call gave the winners ${upsetPercent(Number(r.p_red), r.red_total > r.blue_total)}%` }));
}

async function weekendPool(now: number): Promise<{ items: Candidate[]; events: Set<string> }> {
  const w = await weekendEvents({ now }).catch(() => null);
  const events = new Set<string>();
  const items: Candidate[] = [];
  for (const e of w?.events ?? []) {
    events.add(`${e.season}:${e.code}`);
    if (e.status === "upcoming") continue;
    const rec = await eventRecording(e.season, e.code).catch(() => null);
    if (!rec || rec.meta?.status === "unavailable") continue;
    const live = e.status === "live" && !!rec.meta?.live;
    items.push({
      item: {
        key: `s:${e.season}:${e.code}`, kind: "stream", source: "weekend", videoId: rec.videoId, t: 0, ...(live ? { live: true } : {}), ...(rec.meta?.embeddable === false ? { youtubeOnly: true as const } : {}),
        title: e.name, thumb: thumbnailUrl(rec.videoId), teams: [], event: { season: e.season, code: e.code, name: e.name, href: watchHref(e.season, e.code, rec.videoId) },
        published: e.start ? `${e.start}T12:00:00Z` : null, reason: live ? "Live now" : e.status === "live" ? "Under way this weekend" : "This weekend",
      },
      group: `${e.season}:${e.code}`, at: e.start ? Date.parse(`${e.start}T12:00:00Z`) : null, quality: live ? 1.3 : 1.1, popularity: 0, place: { country: e.country, state: e.state }, live,
    });
  }
  return { items, events };
}

async function creatorPool(): Promise<Candidate[]> {
  const vids = await feedCreatorVideos({ limit: 200 }).catch(() => []);
  return vids.map((v) => {
    const btb = v.series === "behind-the-bot";
    const at = v.publishedAt ? Date.parse(v.publishedAt) : NaN;
    return {
      item: {
        key: `c:${v.videoId}`, kind: "creator", source: btb ? "behindTheBot" : "creator", videoId: v.videoId, t: 0,
        title: v.title, thumb: thumbnailUrl(v.videoId), teams: v.teams, published: Number.isFinite(at) ? new Date(at).toISOString() : null,
        reason: btb ? "Behind the Bot" : v.channel ? `New from ${v.channel}` : "New creator video", ...(v.channel ? { channel: v.channel } : {}), ...(v.series ? { series: v.series } : {}), ...(v.durationS ? { duration: v.durationS } : {}),
      },
      group: `ch:${v.channelId}`, at: Number.isFinite(at) ? at : null, quality: btb ? 1.2 : 1, popularity: 0,
    } satisfies Candidate;
  });
}

/** What most people watched these 7 days: item key → people. A "more like this" on a card nobody opened isn't a watch. */
async function popularity(now: number): Promise<Map<string, number>> {
  const rows = await all<{ item_key: string; n: number }>("SELECT item_key, COUNT(*) n FROM video_watch WHERE at >= ? AND hidden = 0 AND (watched_s > 0 OR completed = 1) GROUP BY item_key ORDER BY n DESC LIMIT 200", [new Date(now - 7 * DAY).toISOString()]).catch(() => []);
  return new Map(rows.map((r) => [String(r.item_key), Number(r.n)]));
}

const parseMatchKey = (k: string): MatchRef | null => {
  const m = /^m:(\d{4}):([A-Za-z0-9_-]+):(qual|playoff):(\d+):(\d+)$/.exec(k);
  return m && SEASON_NUMBERS.includes(Number(m[1])) ? { season: Number(m[1]), code: m[2], level: m[3], series: Number(m[4]), number: Number(m[5]) } : null;
};

export interface Pools { candidates: Candidate[]; weekend: Set<string>; popular: Map<string, number> }
let poolCache: { at: number; v: Promise<Pools> } | null = null;
async function readPools(now: number): Promise<Pools> {
  const season = CURRENT_SEASON;
  const [records, recent, close, upsets, weekend, creators, popular] = await Promise.all([
    recordPool(season).catch(() => []), recentPool(season, now).catch(() => []), closePool(season, now).catch(() => []), upsetPool(season, now).catch(() => []),
    weekendPool(now), creatorPool(), popularity(now),
  ]);
  // Popular match clips not in another pool, as their own.
  const picked = new Set([...records, ...recent, ...close, ...upsets].map(refKey));
  const popularPicks: MatchPick[] = [];
  for (const [k, n] of popular) {
    const r = parseMatchKey(k);
    if (r && !picked.has(k) && n >= 2 && popularPicks.length < 30) popularPicks.push({ ...r, source: "popular", quality: 1, reason: "Popular this week" });
  }
  const candidates = [...weekend.items, ...creators, ...(await matchCandidates([...records, ...recent, ...close, ...upsets, ...popularPicks]))];
  return { candidates, weekend: weekend.events, popular };
}
export function pools(now = Date.now()): Promise<Pools> {
  if (poolCache && now - poolCache.at < POOL_TTL_MS) return poolCache.v;
  const v = readPools(now);
  poolCache = { at: now, v };
  v.catch(() => { if (poolCache?.v === v) poolCache = null; });
  return v;
}

/** A team's newest matches with a video: this season's, then last season's when it has few. Kept per team. */
let teamCache = new Map<number, { at: number; v: Promise<Candidate[]> }>();
async function readTeamClips(team: number): Promise<Candidate[]> {
  const picks: MatchPick[] = [];
  for (const season of [CURRENT_SEASON, CURRENT_SEASON - 1].filter((s) => SEASON_NUMBERS.includes(s))) {
    if (picks.length >= 6) break;
    const rows = await all<RefRow>(
      `SELECT m.code, m.level, m.series, m.number FROM match_teams t JOIN matches m ON m.season = t.season AND m.code = t.code AND m.level = t.level AND m.series = t.series AND m.number = t.number
       WHERE t.team = ? AND t.season = ? AND m.played = 1 ORDER BY m.time DESC LIMIT 200`, [team, season]);
    for (const r of await withVideo(season, rows, 12 - picks.length)) picks.push({ ...ref(season, r), source: "team", quality: 1, reason: `Team ${team}` });
  }
  return matchCandidates(picks);
}
function teamClips(team: number, now = Date.now()): Promise<Candidate[]> {
  const hit = teamCache.get(team);
  if (hit && now - hit.at < POOL_TTL_MS) return hit.v;
  const v = readTeamClips(team);
  teamCache.set(team, { at: now, v });
  v.catch(() => { if (teamCache.get(team)?.v === v) teamCache.delete(team); });
  if (teamCache.size > 2000) teamCache = new Map([...teamCache].slice(-1500));
  return v;
}

// ---------------------------------------------------------------------------
// The person
// ---------------------------------------------------------------------------

const teamNumber = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 999_999 ? n : null);
const parseJson = (s: string | null | undefined): unknown => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };

/** A signed-out device's own follows and history, as the request carries them. */
export interface DeviceHints { myTeam: number | null; teams: number[]; history: { key: string; state: HistoryState }[] }

const MAX_TEAMS = 12;
/** Who's asking: their ties to teams, region and watch history. Signed in, from the account; signed out, the device's. */
export async function profileOf(userId: number | null, hints: DeviceHints): Promise<Profile> {
  const teams = new Map<number, Tie>();
  const tie = (n: number | null, t: Tie) => { if (n != null && !teams.has(n) && teams.size < MAX_TEAMS) teams.set(n, t); };
  const history = new Map<string, WatchRow>();
  let myTeam: number | null = null;
  if (userId != null) {
    const [state, members, scouted, watched] = await Promise.all([
      all<{ key: string; value: string }>("SELECT key, value FROM user_state WHERE user_id = ? AND key IN ('myTeam', 'tracked', 'bookmarks')", [userId]),
      membershipOf(userId).catch(() => []),
      all<{ team: number }>("SELECT team FROM scout_entries WHERE user_id = ? AND season = ? AND deleted = 0 GROUP BY team ORDER BY MAX(updated_at) DESC LIMIT 10", [userId, CURRENT_SEASON]).catch(() => []),
      all<{ item_key: string; kind: string; watched_s: number; completed: number; hidden: number; more: number }>("SELECT item_key, kind, watched_s, completed, hidden, more FROM video_watch WHERE user_id = ? ORDER BY at DESC LIMIT 500", [userId]),
    ]);
    const st = new Map(state.map((r) => [String(r.key), parseJson(r.value)]));
    myTeam = teamNumber(st.get("myTeam"));
    for (const m of members) tie(m.number, "member");
    tie(myTeam, "myTeam");
    const tracked = st.get("tracked") as { teams?: unknown[] } | null;
    for (const n of Array.isArray(tracked?.teams) ? tracked!.teams : []) tie(teamNumber(n), "tracked");
    const marks = st.get("bookmarks");
    for (const n of Array.isArray(marks) ? marks : []) tie(teamNumber(n), "shortlist");
    for (const s of scouted) tie(teamNumber(Number(s.team)), "scouted");
    for (const w of watched) {
      const kind = WATCH_KINDS.includes(w.kind as WatchKind) ? (w.kind as WatchKind) : "match";
      history.set(String(w.item_key), { kind, watchedS: Number(w.watched_s), completed: !!w.completed, hidden: !!w.hidden, more: !!w.more });
    }
  } else {
    myTeam = hints.myTeam;
    tie(myTeam, "myTeam");
    for (const n of hints.teams) tie(n, "tracked");
    for (const h of hints.history) history.set(h.key, { kind: h.key.startsWith("s:") ? "stream" : h.key.startsWith("c:") ? "creator" : "match", watchedS: h.state[0] === "d" ? 600 : h.state[0] === "p" ? 10 : 0, completed: h.state[0] === "d", hidden: h.state === "x", more: h.state.endsWith("m") });
  }
  // Their region: My team's, else the first team they're on (a team followed from afar says nothing of where they are).
  const home = myTeam ?? [...teams].find(([, t]) => t === "member")?.[0] ?? null;
  const place = home != null ? await get<{ state: string | null; country: string | null }>("SELECT state, country FROM teams WHERE number = ?", [home]).catch(() => undefined) : undefined;
  return { teams, history, region: place?.country ? { country: String(place.country), state: place.state ? String(place.state) : null } : null };
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

export function inFilter(c: Candidate, f: FeedFilter, p: Profile, weekend: Set<string>): boolean {
  switch (f) {
    case "all": return true;
    case "matches": return c.item.kind !== "creator" && c.item.kind !== "stream";
    case "creators": return c.item.kind === "creator";
    case "behindTheBot": return c.item.source === "behindTheBot";
    case "myTeams": return c.item.teams.some((n) => p.teams.has(n));
    case "weekend": return c.item.source === "weekend" || (!!c.item.event && weekend.has(`${c.item.event.season}:${c.item.event.code}`));
  }
}

const EMPTY: Record<FeedFilter, string> = {
  all: "No videos to show yet. Match clips appear here as events post their recordings.",
  matches: "No match clips to show yet.",
  creators: "No creator videos yet.",
  behindTheBot: "No Behind the Bot episodes yet.",
  myTeams: "None of your teams' matches have a video yet. Follow a team, or set My team in Settings.",
  weekend: "No recordings or streams from this weekend's events yet.",
};

/** Each person's mixed list, kept while they page through it (the first page always builds it afresh). */
let lists = new Map<string, { at: number; items: FeedItem[]; cold: boolean }>();
registerCache("Videos feed", () => { poolCache = null; teamCache = new Map(); eventClipCache = new Map(); lists = new Map(); });

/** A page's cursor: the kept list's own id and the offset into it ("<id>.<offset>"). */
export const FEED_CURSOR = /^([A-Za-z0-9_-]{12})\.(\d{1,4})$/;

/** The feed's page from `cursor` (none: the first page, built afresh as a new list with its own id, which the next
 *  cursors carry: two devices with the same follows never page through each other's list). `viewer`: who's asking,
 *  for the explore draw's seed, and bound to the kept list so a cursor is read only by whoever it was given to. */
export async function videoFeed(opts: { viewer: string; userId: number | null; hints: DeviceHints; filter: FeedFilter; cursor: string | null; now?: number }): Promise<FeedAnswer> {
  const now = opts.now ?? Date.now();
  const cur = opts.cursor ? FEED_CURSOR.exec(opts.cursor) : null;
  const at = cur ? Number(cur[2]) : 0;
  let id = cur?.[1] ?? randomBytes(9).toString("base64url");
  const listKey = (x: string) => `${opts.viewer}|${opts.filter}|${x}`;
  let list = cur ? lists.get(listKey(id)) : undefined;
  // A list gone (kept too long, or the server restarted): built afresh under a new id; the app skips repeats.
  if (cur && !list) id = randomBytes(9).toString("base64url");
  if (!list || now - list.at > LIST_TTL_MS) {
    const p = await profileOf(opts.userId, opts.hints);
    const pool = await pools(now);
    const mine = (await Promise.all([...p.teams.keys()].map((n) => teamClips(n, now).catch(() => [])))).flat();
    // One candidate per item: the pool that rates it highest (a tie over a plain close finish, an upset over a top
    // score); a team's own clip still says why for that team (reasonFor).
    const seen = new Map<string, Candidate>();
    for (const c of [...mine, ...pool.candidates]) { const had = seen.get(c.item.key); if (!had || c.quality > had.quality) seen.set(c.item.key, c); }
    const weights = kindWeights(p.history.values());
    const engine = await engineFor(opts.userId, opts.hints, seen, now).catch(() => null);
    const scored: { c: Candidate & { group: string }; score: number }[] = [];
    for (const c of seen.values()) {
      if (!inFilter(c, opts.filter, p, pool.weekend)) continue;
      const base = scoreOf({ ...c, popularity: pool.popular.get(c.item.key) ?? 0 }, p, weights, now);
      if (base == null) continue;
      const score = base * (engine ? engineLift(feedRecItem(c), engine) : 1);
      const reason = reasonFor(c, p);
      scored.push({ c: { ...c, item: { ...c.item, reason, ...(tieOf(c.item, p) ? { personal: true as const } : {}) } }, score });
    }
    const items = mixFeed(scored, `${opts.viewer}|${isoDay(now)}`).map((c) => c.item);
    list = { at: now, items, cold: isCold(p) };
    lists.set(listKey(id), list);
    if (lists.size > 3000) lists = new Map([...lists].slice(-2000));
  }
  const page = list.items.slice(at, at + PAGE_SIZE).map((i) => ({ ...i }));
  await withStills(page as unknown as SearchVideoItem[], now).catch(() => undefined);
  const next = at + PAGE_SIZE < list.items.length ? `${id}.${at + PAGE_SIZE}` : null;
  return { items: page, next, coldStart: list.cold, ...(list.items.length ? {} : { empty: EMPTY[opts.filter] }) };
}

// ---------------------------------------------------------------------------
// The recommendation engine's lift
// ---------------------------------------------------------------------------

/** A feed candidate as the engine sees it. */
export function feedRecItem(c: Candidate): RecItem {
  const i = c.item;
  const creator = i.kind === "creator";
  return {
    key: i.key, kind: watchKindOf(i), format: creator && i.duration != null && i.duration <= CYCLE_MAX_S ? "short" : "long",
    creator: creator ? `yt:${c.group.replace(/^ch:/, "")}` : null, series: i.series ?? null, teams: i.teams,
    event: i.event ? `${i.event.season}:${i.event.code}` : null, at: c.at, durationS: i.duration ?? null,
  };
}

export interface Engine { taste: Taste; loves: string[]; co: CoIndex; stats: Map<string, Stats>; episodes: Map<number, number> }

/** The person's taste and loves, and what everyone did, for this list. */
async function engineFor(userId: number | null, hints: DeviceHints, seen: Map<string, Candidate>, now: number): Promise<Engine> {
  const [raw, co, stats, episodes] = await Promise.all([
    userId != null ? personSignals(userId) : Promise.resolve(deviceSignals(hints.history, now)), coEngagement(now), videoStats(now), btbEpisodes(now),
  ]);
  const keys = [...new Set([...raw.watches, ...raw.likes, ...raw.reactions, ...raw.saves, ...raw.shares].map((x) => x.key))];
  const known = new Map<string, RecItem>();
  for (const k of keys) { const c = seen.get(k); if (c) known.set(k, feedRecItem(c)); }
  const other = await resolveItems(keys.filter((k) => !known.has(k))).catch(() => new Map<string, RecItem>());
  const look = (k: string) => known.get(k) ?? other.get(k);
  const d = digest(raw, look, null);
  return { taste: tasteOf(d.signals, look, now), loves: d.loves, co, stats, episodes };
}

/** How much the engine lifts (or sinks) a feed item for this person: a factor around 1. */
export function engineLift(i: RecItem, e: Engine): number {
  return tasteLift(i, e.taste) * (1 + 1.2 * coScore(i.key, e.loves, e.co)) * starLift(i, e.episodes) * qualityOf(e.stats.get(i.key));
}

// ---------------------------------------------------------------------------
// Watches
// ---------------------------------------------------------------------------

/** A report as sent, checked; null when it isn't one. */
export function cleanWatch(b: unknown): WatchReport | null {
  const o = b as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.key !== "string" || !FEED_KEY.test(o.key)) return null;
  if (!WATCH_KINDS.includes(o.kind as WatchKind)) return null;
  const s = Number(o.watchedS);
  if (!Number.isFinite(s) || s < 0) return null;
  const loops = Number(o.loops);
  return { key: o.key, kind: o.kind as WatchKind, watchedS: Math.min(86_400, Math.round(s)), completed: o.completed === true, hidden: o.hidden === true, more: o.more === true,
    ...(Number.isInteger(loops) && loops > 0 ? { loops: Math.min(5, loops) } : {}) };
}

/** Write a watch: the furthest second, finished, "not interested" and "more like this" kept once set; `loops` (a Cycle
 *  played through again) adds up, to 50 at most. */
export async function recordWatch(userId: number, w: WatchReport, now = Date.now()): Promise<void> {
  await run(`INSERT INTO video_watch (user_id, item_key, kind, watched_s, completed, hidden, more, loops, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, item_key) DO UPDATE SET kind = excluded.kind, watched_s = MAX(video_watch.watched_s, excluded.watched_s),
    completed = MAX(video_watch.completed, excluded.completed), hidden = MAX(video_watch.hidden, excluded.hidden), more = MAX(video_watch.more, excluded.more),
    loops = MIN(50, video_watch.loops + excluded.loops), at = excluded.at`,
  [userId, w.key, w.kind, w.watchedS, w.completed ? 1 : 0, w.hidden ? 1 : 0, w.more ? 1 : 0, w.loops ?? 0, new Date(now).toISOString()]);
}
