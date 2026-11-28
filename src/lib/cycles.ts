// Cycles on the client (src/pages/CyclesPage.tsx): pages of short videos (GET /api/cycles), and the likes, reactions and
// shares on any video (POST /api/videos/like, /react, /share: server/api/videoReactions.ts).
import { apiFetch } from "./api";
import { encodeHistory, type FeedItem } from "../shared/videosFeed";
import type { CycleItem, CyclesAnswer, Engagement, Reaction } from "../shared/cycles";
import { sentHistory } from "./videoHistory";

/** A signed-out device's own teams and history, as the Videos feed sends them. */
export interface DeviceTaste { myTeam: number | null; teams: number[] }

/** The page's address: the cursor, a video to show first, and a signed-out device's own taste. */
export function cyclesPath(cursor: string | null, start: string | null, device: DeviceTaste | null): string {
  const q = new URLSearchParams();
  if (cursor) q.set("cursor", cursor);
  else if (start) q.set("start", start);
  if (device) {
    if (device.myTeam != null) q.set("my", String(device.myTeam));
    if (device.teams.length) q.set("teams", device.teams.slice(0, 30).join(","));
    // Read on every page: what this device did a moment ago counts for the next page.
    const h = encodeHistory(sentHistory());
    if (h) q.set("h", h);
  }
  const s = q.toString();
  return `/api/cycles${s ? `?${s}` : ""}`;
}

export const cyclesPage = (cursor: string | null, start: string | null, device: DeviceTaste | null) => apiFetch<CyclesAnswer>(cyclesPath(cursor, start, device));
export const likeVideo = (key: string, on: boolean) => apiFetch<Engagement>("/api/videos/like", { method: "POST", json: { key, on } });
export const reactToVideo = (key: string, emoji: Reaction | null) => apiFetch<Engagement>("/api/videos/react", { method: "POST", json: { key, emoji } });
export const countShare = (key: string) => apiFetch<Engagement>("/api/videos/share", { method: "POST", json: { key } });

/** A like's count after this person's change, before the server answers (an optimistic step). Pure, for tests. */
export function withLike(e: Engagement, on: boolean): Engagement {
  const was = !!e.mine?.liked;
  if (was === on) return e;
  return { ...e, likes: Math.max(0, e.likes + (on ? 1 : -1)), mine: { liked: on, reaction: e.mine?.reaction ?? null } };
}

/** The reactions after this person picks `emoji` (or none), before the server answers. Pure, for tests. */
export function withReaction(e: Engagement, emoji: Reaction | null): Engagement {
  const had = e.mine?.reaction ?? null;
  if (had === emoji) return e;
  const r = { ...e.reactions };
  if (had) { const n = (r[had] ?? 0) - 1; if (n > 0) r[had] = n; else delete r[had]; }
  if (emoji) r[emoji] = (r[emoji] ?? 0) + 1;
  return { ...e, reactions: r, mine: { liked: !!e.mine?.liked, reaction: emoji } };
}

/** Every reaction left on it. */
export const reactionCount = (e: Engagement) => Object.values(e.reactions).reduce((a, b) => a + (b ?? 0), 0);

/** A count as the rail shows it: 999, 1.2K, 12K, 1.2M. */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toString().replace(/\.0$/, "")}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${(Math.floor(n / 100_000) / 10).toString().replace(/\.0$/, "")}M`;
}

/** A Cycle as a library item (Save, Watch later: src/lib/videoLibrary.ts), the same shape the Videos feed keeps. */
export function feedItemOf(c: CycleItem): FeedItem {
  return {
    key: c.key, kind: "creator", source: c.series === "behind-the-bot" ? "behindTheBot" : "creator", videoId: c.videoId, t: 0, title: c.title,
    thumb: `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg`, teams: c.teams.map((t) => t.number), published: c.published, reason: c.reason,
    ...(c.creator.name ? { channel: c.creator.name } : {}), ...(c.series ? { series: c.series } : {}), ...(c.duration ? { duration: c.duration } : {}),
  };
}
