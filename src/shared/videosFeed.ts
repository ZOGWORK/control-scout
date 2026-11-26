// The Videos tab's feed (src/pages/VideosPage.tsx, GET /api/videos/feed: server/api/videosFeed.ts): one list of videos
// that all play in the app, different for every person. Its items, its filters, and how a watch is reported back
// (POST /api/videos/watch, the video_watch table; signed out, this device's own capped history: src/lib/videoHistory.ts).
import type { SearchVideoItem } from "./api";

/** What an item is: a match's video (FIRST's own, its place in a recording, or one someone added), an event's
 *  recording or live stream, or a creator's video (server/videos/creatorVideos.ts). */
export type FeedKind = SearchVideoItem["kind"] | "creator";

/** Why an item was picked, the pool it came from; each has its own weight in the ranking (server/api/videosFeed.rank.ts). */
export type FeedSource = "team" | "weekend" | "creator" | "behindTheBot" | "record" | "close" | "upset" | "popular";

/** What a person's finishes and skips are learned per (video_watch.kind): a match, a stream, a creator's video, a
 *  Behind the Bot episode. */
export type WatchKind = "match" | "stream" | "creator" | "behindTheBot";

export interface FeedItem extends Omit<SearchVideoItem, "kind" | "contributor"> {
  /** Stable across reads: "m:season:CODE:level:series:number", "s:season:CODE" (a stream), "c:videoId" (a creator's). */
  key: string;
  kind: FeedKind;
  source: FeedSource;
  title: string;
  /** The video's own thumbnail (a recording's clip also has its own frame: `still`). */
  thumb: string;
  /** Teams in it: a match's robots, a creator video's tagged teams. */
  teams: number[];
  event?: { season: number; code: string; name: string; href: string };
  /** A match's page in the app. */
  href?: string;
  /** When it happened or was posted (ISO); null when unknown. */
  published: string | null;
  /** One line on why it's in this person's feed ("Your team", "Upset", "Behind the Bot"). */
  reason: string;
  /** A creator video's channel name and series ("behind-the-bot"). */
  channel?: string;
  series?: string;
  /** Its length in seconds when known (a creator's video), else the clip's own span. */
  duration?: number;
}

export const FEED_FILTERS = [
  { id: "all", label: "All" },
  { id: "matches", label: "Matches" },
  { id: "creators", label: "Creators" },
  { id: "behindTheBot", label: "Behind the Bot" },
  { id: "myTeams", label: "My teams" },
  { id: "weekend", label: "This weekend" },
] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number]["id"];
export const isFeedFilter = (x: unknown): x is FeedFilter => FEED_FILTERS.some((f) => f.id === x);

export interface FeedAnswer {
  items: FeedItem[];
  /** The next page's cursor; null at the end. */
  next: string | null;
  /** No teams, follows or history to go on: the general feed (this weekend, top plays, Behind the Bot, upsets). */
  coldStart: boolean;
  /** Said when the list is empty, in plain words. */
  empty?: string;
}

/** A watch to report: at 5 s in, at half way, at the end, and "not interested" (`hidden`). */
export interface WatchReport { key: string; kind: WatchKind; watchedS: number; completed?: boolean; hidden?: boolean }

/** The kind a watch of this item is learned as. */
export function watchKindOf(i: Pick<FeedItem, "kind" | "series">): WatchKind {
  if (i.kind === "creator") return i.series === "behind-the-bot" ? "behindTheBot" : "creator";
  return i.kind === "stream" ? "stream" : "match";
}

export const WATCH_KINDS: readonly WatchKind[] = ["match", "stream", "creator", "behindTheBot"];
/** An item key as the feed makes them: letters, digits and : _ - only, at most 120 long. */
export const FEED_KEY = /^[msc]:[A-Za-z0-9:_-]{1,118}$/;

/** A signed-out device's history as the feed request carries it (`h=`): "key~state" joined by commas, newest first,
 *  state "d" (finished), "p" (started), "x" (not interested). At most HISTORY_SENT entries. */
export const HISTORY_SENT = 40;
export type HistoryState = "d" | "p" | "x";
export function encodeHistory(h: { key: string; state: HistoryState }[]): string {
  return h.filter((e) => FEED_KEY.test(e.key)).slice(0, HISTORY_SENT).map((e) => `${e.key}~${e.state}`).join(",");
}
export function decodeHistory(raw: unknown): { key: string; state: HistoryState }[] {
  if (typeof raw !== "string" || !raw) return [];
  const out: { key: string; state: HistoryState }[] = [];
  for (const part of raw.slice(0, 6000).split(",")) {
    const [key, state] = part.split("~");
    if (key && FEED_KEY.test(key) && (state === "d" || state === "p" || state === "x") && !out.some((e) => e.key === key)) out.push({ key, state });
    if (out.length >= HISTORY_SENT) break;
  }
  return out;
}
