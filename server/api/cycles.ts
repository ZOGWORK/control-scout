// Cycles (GET /api/cycles, src/pages/CyclesPage.tsx): short videos, one at a time, ranked for each person by the
// recommendation engine (server/videos/recommend.ts) and ranked again on every page from what they just did, so one
// scroll learns as it goes.
//
// The pool: creator videos (FUN Robotics Network today) between CYCLE_MIN_S and CYCLE_MAX_S long, FTC or unknown
// program, embeddable; kept POOL_TTL_MS. A session is a cursor's id: the videos it already showed (never shown twice in
// one scroll) and when it started (signals since then are this session's, and count more). Each page reads the person's
// signals afresh (signed in: their account; signed out: the device's history the request carries), ranks what's left,
// and takes CYCLES_PAGE in a diverse order that carries on from the last ones shown.
import { randomBytes } from "node:crypto";
import { all } from "../db.js";
import { registerCache } from "../caches.js";
import { creatorVideosFor, creatorVideo } from "../videos/creatorVideos.js";
import { diversify, scoreAll, tasteOf, type Ranked, type RecItem, type Taste } from "../videos/recommend.js";
import { btbEpisodes, coEngagement, deviceSignals, digest, personSignals, resolveItems, videoStats } from "../videos/signals.js";
import { engagementFor } from "./videoReactions.js";
import { profileOf, type DeviceHints } from "./videosFeed.js";
import type { Tie } from "./videosFeed.rank.js";
import { CYCLE_MAX_S, CYCLE_MIN_S, CYCLES_CURSOR, CYCLES_PAGE, type CycleItem, type CyclesAnswer } from "../../src/shared/cycles.js";
import { seriesLabel, type CreatorVideo } from "../../src/shared/creatorVideos.js";

export const POOL_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 2 * 3600_000;
const SESSION_MAX = 600;

/** A creator video as the engine sees it. */
export function recItemOf(v: Pick<CreatorVideo, "videoId" | "channelId" | "series" | "teams" | "publishedAt" | "durationS">): RecItem {
  const at = Date.parse(v.publishedAt);
  return {
    key: `c:${v.videoId}`, kind: v.series === "behind-the-bot" ? "behindTheBot" : "creator",
    format: v.durationS != null && v.durationS <= CYCLE_MAX_S ? "short" : "long", creator: `yt:${v.channelId}`, series: v.series,
    teams: v.teams, event: null, at: Number.isFinite(at) ? at : null, durationS: v.durationS,
  };
}

interface Pool { videos: Map<string, CreatorVideo>; items: RecItem[] }
let poolCache: { at: number; v: Promise<Pool> } | null = null;
async function readPool(): Promise<Pool> {
  const vids = (await creatorVideosFor({ minDurationS: CYCLE_MIN_S, maxDurationS: CYCLE_MAX_S, limit: 1500 })).filter((v) => v.program === "ftc" || v.program === "unknown");
  return { videos: new Map(vids.map((v) => [`c:${v.videoId}`, v])), items: vids.map(recItemOf) };
}
export function cyclePool(now = Date.now()): Promise<Pool> {
  if (poolCache && now - poolCache.at < POOL_TTL_MS) return poolCache.v;
  const v = readPool();
  poolCache = { at: now, v };
  v.catch(() => { if (poolCache?.v === v) poolCache = null; });
  return v;
}

interface Session { viewer: string; started: number; shown: string[] }
let sessions = new Map<string, Session>();
registerCache("Cycles", () => { poolCache = null; sessions = new Map(); });

/** A team the person is tied to leans their taste toward it before they've watched anything of it. */
const TIE_LEAN: Record<Tie, number> = { member: 0.8, myTeam: 0.8, tracked: 0.6, shortlist: 0.4, scouted: 0.3 };
export function withTies(t: Taste, ties: Map<number, Tie>): Taste {
  const lean = new Map(t.lean);
  for (const [n, tie] of ties) lean.set(`team:${n}`, Math.max(lean.get(`team:${n}`) ?? 0, TIE_LEAN[tie]));
  return { lean, seen: t.seen };
}

/** The line under a Cycle on why it's there. */
export function reasonOf(r: Ranked, v: CreatorVideo, names: Map<number, string>, episodes: Map<number, number>): string {
  const named = (n: number) => (names.get(n) ? `${n} ${names.get(n)}` : `${n}`);
  switch (r.why.kind) {
    case "team": return `Because you like ${named(r.why.team)}`;
    case "co": return "Loved by people who like what you like";
    case "series": return `More ${seriesLabel(r.why.series) ?? "like this"}`;
    case "creator": return v.channel ? `More from ${v.channel}` : "More like this";
    case "star": return `${named(r.why.team)} has been on Behind the Bot ${episodes.get(r.why.team)} times`;
    case "none": return seriesLabel(v.series) ?? (v.channel ? `From ${v.channel}` : "New on Clips");
  }
}

async function teamNames(nums: number[]): Promise<Map<number, string>> {
  const ns = [...new Set(nums)].slice(0, 200);
  if (!ns.length) return new Map();
  const rows = await all<{ number: number; name: string | null }>(`SELECT number, name FROM teams WHERE number IN (${ns.map(() => "?").join(",")})`, ns);
  return new Map(rows.filter((r) => r.name).map((r) => [Number(r.number), String(r.name)]));
}

/**
 * A page of Cycles. `cursor`: the last page's next (none: a new session). `start`: a video to show first (a shared
 * link), when it's a Cycle. `viewer` binds a session to whoever it was given to.
 */
export async function cyclesPage(o: { viewer: string; userId: number | null; hints: DeviceHints; cursor: string | null; start?: string | null; now?: number }): Promise<CyclesAnswer> {
  const now = o.now ?? Date.now();
  const cur = o.cursor ? CYCLES_CURSOR.exec(o.cursor) : null;
  let id = cur?.[1] ?? randomBytes(9).toString("base64url");
  let s = cur ? sessions.get(id) : undefined;
  if (!s || s.viewer !== o.viewer || now - s.started > SESSION_TTL_MS) {
    // A session gone (kept too long, a restart): a new one; the app skips any repeat.
    if (cur) id = randomBytes(9).toString("base64url");
    s = { viewer: o.viewer, started: now, shown: [] };
    sessions.set(id, s);
    if (sessions.size > 5000) sessions = new Map([...sessions].slice(-4000));
  }
  const [pool, profile, co, stats, episodes] = await Promise.all([cyclePool(now), profileOf(o.userId, o.hints), coEngagement(now), videoStats(now), btbEpisodes(now)]);
  const raw = o.userId != null ? await personSignals(o.userId) : deviceSignals(o.hints.history, now);
  // Facets of the videos the person did something with: the pool's, else read (an old long video, a match clip).
  const inPool = new Map(pool.items.map((i) => [i.key, i]));
  const keys = [...new Set([...raw.watches, ...raw.likes, ...raw.reactions, ...raw.saves, ...raw.shares].map((x) => x.key))];
  const other = await resolveItems(keys.filter((k) => !inPool.has(k))).catch(() => new Map<string, RecItem>());
  const look = (k: string) => inPool.get(k) ?? other.get(k);
  const d = digest(raw, look, s.started);
  const taste = withTies(tasteOf(d.signals, look, now), profile.teams);

  const shown = new Set(s.shown);
  let first: RecItem | null = null;
  const extra = new Map<string, CreatorVideo>();
  const video = (k: string) => pool.videos.get(k) ?? extra.get(k);
  if (!cur && o.start) {
    const k = `c:${o.start}`;
    first = inPool.get(k) ?? null;
    if (!first) {
      // A shared link to a video that isn't in the pool (posted since, or longer): shown first all the same when it's
      // a creator video that can play here.
      const v = await creatorVideo(o.start).catch(() => undefined);
      if (v) { first = recItemOf(v); extra.set(k, v); }
    }
  }
  const items = pool.items.filter((i) => !shown.has(i.key) && i.key !== first?.key);
  const ranked = scoreAll({ items, taste, loves: d.loves, co, stats, episodes, own: d.own, seed: `${o.viewer}|${id}|${s.shown.length}`, now });
  const prev = s.shown.slice(-4).map((k) => look(k)).filter((i): i is RecItem => !!i).map((item) => ({ item, score: 0, why: { kind: "none" as const } }));
  const pageSize = CYCLES_PAGE - (first ? 1 : 0);
  const picked = diversify(ranked, pageSize, prev);
  const page: Ranked[] = [...(first ? [{ item: first, score: 0, why: { kind: "none" as const } }] : []), ...picked];

  s.shown.push(...page.map((r) => r.item.key));
  if (s.shown.length > SESSION_MAX) s.shown.splice(0, s.shown.length - SESSION_MAX);

  const vids = page.map((r) => video(r.item.key)).filter((v): v is CreatorVideo => !!v);
  const [names, eng] = await Promise.all([teamNames(vids.flatMap((v) => v.teams)), engagementFor(page.map((r) => r.item.key), o.userId)]);
  const out: CycleItem[] = page.flatMap((r) => {
    const v = video(r.item.key);
    if (!v) return [];
    return [{
      key: r.item.key, videoId: v.videoId, title: v.title, creator: { id: r.item.creator ?? "", name: v.channel }, series: v.series,
      teams: v.teams.map((n) => ({ number: n, name: names.get(n) ?? null })), published: v.publishedAt, duration: v.durationS,
      reason: r === page[0] && first ? (seriesLabel(v.series) ?? (v.channel ? `From ${v.channel}` : "Shared with you")) : reasonOf(r, v, names, episodes),
      engagement: eng.get(r.item.key)!,
    }];
  });
  const left = pool.items.length - s.shown.length;
  return { items: out, next: left > 0 && out.length ? `${id}.${s.shown.length}` : null };
}
