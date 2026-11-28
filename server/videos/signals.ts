// The reads behind the recommendation engine (./recommend.ts): one person's signals, everyone's loves for co-engagement,
// what everyone did with each video, Behind the Bot episodes per team, and any video's facets by its key. Shared by
// Cycles (server/api/cycles.ts) and the Videos feed (server/api/videosFeed.ts). Every read selects only its columns and
// goes through db.ts's all(), which lets the event loop turn (#1557).
import { all } from "../db.js";
import { registerCache } from "../caches.js";
import { coIndex, type CoIndex, type RecItem, type Signal, type Stats } from "./recommend.js";
import { CYCLE_MAX_S } from "../../src/shared/cycles.js";
import type { HistoryState } from "../../src/shared/videosFeed.js";

const DAY = 86_400_000;
const ms = (iso: unknown) => { const t = Date.parse(String(iso)); return Number.isFinite(t) ? t : 0; };

// ---------------------------------------------------------------------------
// One person
// ---------------------------------------------------------------------------

export interface OwnRow { key: string; watchedS: number; completed: boolean; hidden: boolean; more: boolean; loops: number; at: number }
export interface PersonSignals {
  /** Every signal, with `part` on views once the item's length is known (personSignalsWith). */
  watches: OwnRow[];
  likes: { key: string; at: number }[];
  reactions: { key: string; at: number }[];
  saves: { key: string; at: number }[];
  shares: { key: string; at: number }[];
}

/** A signed-in person's own signals, newest first (at most 500 watches and 300 of each other). */
export async function personSignals(userId: number): Promise<PersonSignals> {
  const [w, l, r, s, sh] = await Promise.all([
    all<{ item_key: string; watched_s: number; completed: number; hidden: number; more: number; loops: number; at: string }>(
      "SELECT item_key, watched_s, completed, hidden, more, loops, at FROM video_watch WHERE user_id = ? ORDER BY at DESC LIMIT 500", [userId]),
    all<{ item_key: string; at: string }>("SELECT item_key, at FROM video_likes WHERE user_id = ? ORDER BY at DESC LIMIT 300", [userId]),
    all<{ item_key: string; at: string }>("SELECT item_key, at FROM video_reactions WHERE user_id = ? ORDER BY at DESC LIMIT 300", [userId]),
    all<{ item_key: string; at: string }>("SELECT item_key, at FROM video_library WHERE user_id = ? AND list IN ('saved', 'later') ORDER BY at DESC LIMIT 300", [userId]),
    all<{ item_key: string; at: string }>("SELECT item_key, MAX(at) at FROM video_shares WHERE user_id = ? GROUP BY item_key ORDER BY MAX(at) DESC LIMIT 300", [userId]),
  ]);
  const kv = (rows: { item_key: string; at: string }[]) => rows.map((x) => ({ key: String(x.item_key), at: ms(x.at) }));
  return {
    watches: w.map((x) => ({ key: String(x.item_key), watchedS: Number(x.watched_s), completed: !!x.completed, hidden: !!x.hidden, more: !!x.more, loops: Number(x.loops ?? 0), at: ms(x.at) })),
    likes: kv(l), reactions: kv(r), saves: kv(s), shares: kv(sh),
  };
}

/** A signed-out device's history as signals: no times kept, so each counts as now. */
export function deviceSignals(history: { key: string; state: HistoryState }[], now: number): PersonSignals {
  const watches: OwnRow[] = history.map((h, i) => ({
    key: h.key, watchedS: h.state[0] === "d" ? 600 : h.state[0] === "p" ? 10 : 0, completed: h.state[0] === "d", hidden: h.state === "x",
    more: h.state.endsWith("m"), loops: 0, at: now - i * 60_000,
  }));
  return { watches, likes: [], reactions: [], saves: [], shares: [] };
}

export interface Digested {
  signals: (Signal & { part?: number })[];
  /** Loves, newest first: for co-engagement. */
  loves: string[];
  own: Map<string, { completed: boolean; skipped: boolean; loved: boolean; hidden: boolean }>;
}

/** The person's rows as the engine's signals. `items` gives a video's length (for how much of it was seen) and format
 *  (a short left in under 3 s is a skip); `sessionFrom`: signals since then are this session's. */
export function digest(p: PersonSignals, items: (key: string) => RecItem | undefined, sessionFrom: number | null): Digested {
  const signals: (Signal & { part?: number })[] = [];
  const own = new Map<string, { completed: boolean; skipped: boolean; loved: boolean; hidden: boolean }>();
  const loveAt = new Map<string, number>();
  const love = (k: string, at: number) => loveAt.set(k, Math.max(loveAt.get(k) ?? 0, at));
  const mark = (k: string) => own.get(k) ?? own.set(k, { completed: false, skipped: false, loved: false, hidden: false }).get(k)!;
  const session = (at: number) => sessionFrom != null && at >= sessionFrom;
  for (const w of p.watches) {
    const it = items(w.key);
    const o = mark(w.key);
    const s = { key: w.key, at: w.at, session: session(w.at) };
    if (w.hidden) { signals.push({ ...s, type: "hide" }); o.hidden = true; continue; }
    if (w.more) { signals.push({ ...s, type: "more" }); love(w.key, w.at); }
    if (w.completed) { signals.push({ ...s, type: "complete" }); o.completed = true; love(w.key, w.at); }
    else if (it?.format === "short" && w.watchedS < 3 && !w.more) { signals.push({ ...s, type: "skip" }); o.skipped = true; }
    else if (w.watchedS > 0) {
      const len = it?.durationS && it.durationS > 0 ? it.durationS : 180;
      signals.push({ ...s, type: "view", part: Math.min(1, w.watchedS / len) });
    }
    if (w.loops > 0) { signals.push({ ...s, type: "loop" }); love(w.key, w.at); }
  }
  for (const [rows, type] of [[p.likes, "like"], [p.reactions, "react"], [p.saves, "save"], [p.shares, "share"]] as const) {
    for (const r of rows) { signals.push({ key: r.key, type, at: r.at, session: session(r.at) }); love(r.key, r.at); mark(r.key).loved = true; }
  }
  for (const k of loveAt.keys()) mark(k).loved = true;
  const loves = [...loveAt].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { signals, loves, own };
}

// ---------------------------------------------------------------------------
// Everyone (cached)
// ---------------------------------------------------------------------------

const EVERYONE_TTL_MS = 10 * 60_000;
let coCache: { at: number; v: Promise<CoIndex> } | null = null;
let statsCache: { at: number; v: Promise<Map<string, Stats>> } | null = null;
let episodesCache: { at: number; v: Promise<Map<number, number>> } | null = null;
registerCache("Video recommendations", () => { coCache = null; statsCache = null; episodesCache = null; });

const cached = <T,>(slot: () => { at: number; v: Promise<T> } | null, set: (x: { at: number; v: Promise<T> } | null) => void, read: () => Promise<T>, now: number): Promise<T> => {
  const hit = slot();
  if (hit && now - hit.at < EVERYONE_TTL_MS) return hit.v;
  const v = read();
  set({ at: now, v });
  v.catch(() => { if (slot()?.v === v) set(null); });
  return v;
};

/** Everyone's loves these 90 days (finished, replayed, more like this, liked, reacted, saved), one basket per person:
 *  the co-engagement index. */
export function coEngagement(now = Date.now()): Promise<CoIndex> {
  return cached(() => coCache, (x) => { coCache = x; }, async () => {
    const since = new Date(now - 90 * DAY).toISOString();
    const rows = await all<{ user_id: number; item_key: string }>(
      `SELECT user_id, item_key FROM video_watch WHERE at >= ?1 AND hidden = 0 AND (completed = 1 OR loops > 0 OR more = 1)
       UNION SELECT user_id, item_key FROM video_likes WHERE at >= ?1
       UNION SELECT user_id, item_key FROM video_reactions WHERE at >= ?1
       UNION SELECT user_id, item_key FROM video_library WHERE at >= ?1 AND list = 'saved'
       LIMIT 60000`, [since]);
    const baskets = new Map<number, string[]>();
    for (const r of rows) (baskets.get(Number(r.user_id)) ?? baskets.set(Number(r.user_id), []).get(Number(r.user_id))!).push(String(r.item_key));
    return coIndex(baskets.values());
  }, now);
}

/** What everyone did with each video: views (seen for any time), finishes, likes, reactions and shares. */
export function videoStats(now = Date.now()): Promise<Map<string, Stats>> {
  return cached(() => statsCache, (x) => { statsCache = x; }, async () => {
    const [w, l, r, s] = await Promise.all([
      all<{ item_key: string; v: number; c: number }>("SELECT item_key, COUNT(*) v, SUM(completed) c FROM video_watch WHERE hidden = 0 AND (watched_s > 0 OR completed = 1) GROUP BY item_key"),
      all<{ item_key: string; n: number }>("SELECT item_key, COUNT(*) n FROM video_likes GROUP BY item_key"),
      all<{ item_key: string; n: number }>("SELECT item_key, COUNT(*) n FROM video_reactions GROUP BY item_key"),
      all<{ item_key: string; n: number }>("SELECT item_key, COUNT(DISTINCT user_id) + SUM(user_id IS NULL) n FROM video_shares GROUP BY item_key"),
    ]);
    const out = new Map<string, Stats>();
    const of = (k: string) => out.get(k) ?? out.set(k, { views: 0, completes: 0, likes: 0, reactions: 0, shares: 0 }).get(k)!;
    for (const x of w) { const o = of(String(x.item_key)); o.views = Number(x.v); o.completes = Number(x.c ?? 0); }
    for (const x of l) of(String(x.item_key)).likes = Number(x.n);
    for (const x of r) of(String(x.item_key)).reactions = Number(x.n);
    for (const x of s) of(String(x.item_key)).shares = Number(x.n);
    return out;
  }, now);
}

/** How many Behind the Bot episodes each team is in (tags the owner removed left out). */
export function btbEpisodes(now = Date.now()): Promise<Map<number, number>> {
  return cached(() => episodesCache, (x) => { episodesCache = x; }, async () => {
    const rows = await all<{ team_number: number; n: number }>(
      `SELECT t.team_number, COUNT(*) n FROM video_team_tags t JOIN creator_videos v ON v.video_id = t.video_id
       WHERE v.series = 'behind-the-bot' AND v.embeddable = 1
         AND NOT EXISTS (SELECT 1 FROM video_tag_removals r WHERE r.video_id = t.video_id AND r.team_number = t.team_number)
       GROUP BY t.team_number`);
    return new Map(rows.map((r) => [Number(r.team_number), Number(r.n)]));
  }, now);
}

/** Forget what's kept (tests; a like or a share is in the next read 10 minutes later at most). */
export function forgetEveryone(): void { coCache = null; statsCache = null; episodesCache = null; }

// ---------------------------------------------------------------------------
// Any video's facets
// ---------------------------------------------------------------------------

/** The facets of videos by key, for signals on videos that aren't in the list being ranked (an old watch): creator
 *  videos from creator_videos and their tags, match clips from their robots. Streams and unknown keys are left out. */
export async function resolveItems(keys: string[]): Promise<Map<string, RecItem>> {
  const out = new Map<string, RecItem>();
  const vids = [...new Set(keys.filter((k) => k.startsWith("c:")).map((k) => k.slice(2)))].slice(0, 600);
  for (let i = 0; i < vids.length; i += 200) {
    const part = vids.slice(i, i + 200);
    const q = part.map(() => "?").join(",");
    const rows = await all<{ video_id: string; channel_id: string; series: string | null; duration_s: number | null; published_at: string; teams: string | null }>(
      `SELECT v.video_id, v.channel_id, v.series, v.duration_s, v.published_at,
              (SELECT group_concat(t.team_number) FROM video_team_tags t WHERE t.video_id = v.video_id) teams
       FROM creator_videos v WHERE v.video_id IN (${q})`, part);
    for (const r of rows) {
      const d = r.duration_s == null ? null : Number(r.duration_s);
      out.set(`c:${r.video_id}`, {
        key: `c:${r.video_id}`, kind: r.series === "behind-the-bot" ? "behindTheBot" : "creator", format: d != null && d <= CYCLE_MAX_S ? "short" : "long",
        creator: `yt:${r.channel_id}`, series: r.series ?? null, teams: r.teams ? String(r.teams).split(",").map(Number).filter(Number.isFinite) : [],
        event: null, at: ms(r.published_at) || null, durationS: d,
      });
    }
  }
  const matches = keys.map((k) => /^m:(\d{4}):([A-Za-z0-9_-]+):(qual|playoff):(\d+):(\d+)$/.exec(k)).filter((m): m is RegExpExecArray => !!m).slice(0, 300);
  for (let i = 0; i < matches.length; i += 100) {
    const part = matches.slice(i, i + 100);
    const where = part.map(() => "(season = ? AND code = ? AND level = ? AND series = ? AND number = ?)").join(" OR ");
    const rows = await all<{ season: number; code: string; level: string; series: number; number: number; team: number }>(
      `SELECT season, code, level, series, number, team FROM match_teams WHERE ${where}`, part.flatMap((m) => [Number(m[1]), m[2], m[3], Number(m[4]), Number(m[5])]));
    for (const r of rows) {
      const key = `m:${r.season}:${r.code}:${r.level}:${Number(r.series)}:${Number(r.number)}`;
      const it = out.get(key) ?? out.set(key, { key, kind: "match", format: "long", creator: null, series: null, teams: [], event: `${r.season}:${r.code}`, at: null, durationS: null }).get(key)!;
      it.teams.push(Number(r.team));
    }
  }
  return out;
}
