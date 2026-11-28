// Likes, emoji reactions and shares on any video in the app (Cycles first: src/pages/CyclesPage.tsx), by its feed key
// ("c:<videoId>", a match clip's "m:…"). A like and a reaction need an account; a share doesn't (it's a count, one per
// person or device per video per day). Counts are public, who did it never is. Each one is a signal the recommendation
// engine learns from (server/videos/recommend.ts). Routes in server/app.ts.
import { all, get, run } from "../db.js";
import { REACTIONS, type Engagement, type Reaction } from "../../src/shared/cycles.js";

const DAY = 86_400_000;

/** What everyone did with each video, and what this person did (signed in). Keys it doesn't know come back as zeros. */
export async function engagementFor(keys: string[], userId: number | null): Promise<Map<string, Engagement>> {
  const ks = [...new Set(keys)].slice(0, 200);
  const out = new Map<string, Engagement>(ks.map((k) => [k, { likes: 0, reactions: {}, shares: 0, ...(userId != null ? { mine: { liked: false, reaction: null } } : {}) }]));
  if (!ks.length) return out;
  const q = ks.map(() => "?").join(",");
  const [likes, reacts, shares, mine, myReact] = await Promise.all([
    all<{ item_key: string; n: number }>(`SELECT item_key, COUNT(*) n FROM video_likes WHERE item_key IN (${q}) GROUP BY item_key`, ks),
    all<{ item_key: string; emoji: string; n: number }>(`SELECT item_key, emoji, COUNT(*) n FROM video_reactions WHERE item_key IN (${q}) GROUP BY item_key, emoji`, ks),
    all<{ item_key: string; n: number }>(`SELECT item_key, COUNT(DISTINCT user_id) + SUM(user_id IS NULL) n FROM video_shares WHERE item_key IN (${q}) GROUP BY item_key`, ks),
    userId == null ? Promise.resolve([]) : all<{ item_key: string }>(`SELECT item_key FROM video_likes WHERE user_id = ? AND item_key IN (${q})`, [userId, ...ks]),
    userId == null ? Promise.resolve([]) : all<{ item_key: string; emoji: string }>(`SELECT item_key, emoji FROM video_reactions WHERE user_id = ? AND item_key IN (${q})`, [userId, ...ks]),
  ]);
  for (const r of likes) { const e = out.get(String(r.item_key)); if (e) e.likes = Number(r.n); }
  for (const r of reacts) {
    const e = out.get(String(r.item_key));
    if (e && (REACTIONS as readonly string[]).includes(r.emoji)) e.reactions[r.emoji as Reaction] = Number(r.n);
  }
  for (const r of shares) { const e = out.get(String(r.item_key)); if (e) e.shares = Number(r.n); }
  for (const r of mine) { const e = out.get(String(r.item_key)); if (e?.mine) e.mine.liked = true; }
  for (const r of myReact) {
    const e = out.get(String(r.item_key));
    if (e?.mine && (REACTIONS as readonly string[]).includes(r.emoji)) e.mine.reaction = r.emoji as Reaction;
  }
  return out;
}

const one = async (key: string, userId: number | null) => (await engagementFor([key], userId)).get(key)!;

/** Like (`on`) or take the like back. Answers the video's engagement after it. */
export async function setLike(userId: number, key: string, on: boolean, now = Date.now()): Promise<Engagement> {
  if (on) await run("INSERT INTO video_likes (user_id, item_key, at) VALUES (?, ?, ?) ON CONFLICT (user_id, item_key) DO NOTHING", [userId, key, new Date(now).toISOString()]);
  else await run("DELETE FROM video_likes WHERE user_id = ? AND item_key = ?", [userId, key]);
  return one(key, userId);
}

/** React with one emoji (one per person per video: a new one replaces it), or none to take it back. */
export async function setReaction(userId: number, key: string, emoji: Reaction | null, now = Date.now()): Promise<Engagement> {
  if (emoji) {
    await run(`INSERT INTO video_reactions (user_id, item_key, emoji, at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, item_key) DO UPDATE SET emoji = excluded.emoji, at = excluded.at`, [userId, key, emoji, new Date(now).toISOString()]);
  } else await run("DELETE FROM video_reactions WHERE user_id = ? AND item_key = ?", [userId, key]);
  return one(key, userId);
}

/** A share: counted once per account per video per day; signed out, each share is a row (the route's rate limit keeps
 *  one device from running it up), counted once per row. The count is accounts that shared plus signed-out rows, kept
 *  apart (an account's id and a row's id are different numbers that can be equal). */
export async function recordShare(userId: number | null, key: string, now = Date.now()): Promise<Engagement> {
  const since = new Date(now - DAY).toISOString();
  const had = userId != null ? await get<{ n: number }>("SELECT COUNT(*) n FROM video_shares WHERE user_id = ? AND item_key = ? AND at >= ?", [userId, key, since]) : undefined;
  if (!had?.n) await run("INSERT INTO video_shares (item_key, user_id, at) VALUES (?, ?, ?)", [key, userId, new Date(now).toISOString()]);
  return one(key, userId);
}
