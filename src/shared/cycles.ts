// Cycles: Control Scout's short videos, one at a time, full screen, swiped up for the next (src/pages/CyclesPage.tsx,
// GET /api/cycles: server/api/cycles.ts). In FTC a cycle is one run to score and back; here it's one short video.
// Today they're the FUN Robotics Network's shorts (3 minutes or less); the item is a creator's video, whoever made it,
// so a team's own socials can join it later without changing the feed. Ranked by the same engine as the long-form
// Videos feed (server/videos/recommend.ts).
//
// Likes, emoji reactions and shares (POST /api/videos/like, /react, /share: server/api/videoReactions.ts) work on any
// feed item's key, short or long.

/** The reactions anyone can leave on a video: one per person per video, changed or taken back any time. No red heart:
 *  the video UI never uses red or orange (they read as a warning here). */
export const REACTIONS = ["🔥", "🤯", "👏", "😂", "🤖", "💜"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const isReaction = (x: unknown): x is Reaction => typeof x === "string" && (REACTIONS as readonly string[]).includes(x);

/** Longest a video can be to count as a Cycle (YouTube's own Shorts limit), and shortest (a 2 s clip is a mistake). */
export const CYCLE_MAX_S = 180;
export const CYCLE_MIN_S = 4;

/** What everyone did with a video, and what this person did. */
export interface Engagement {
  likes: number;
  /** Each reaction's count, only the ones someone left. */
  reactions: Partial<Record<Reaction, number>>;
  shares: number;
  /** Signed in only. */
  mine?: { liked: boolean; reaction: Reaction | null };
}

export interface CycleItem {
  /** "c:<videoId>", the same key the Videos feed and the library use. */
  key: string;
  videoId: string;
  title: string;
  /** The creator: a channel's name today, a team's own account later. */
  creator: { id: string; name: string | null };
  /** "behind-the-bot" and the rest (src/shared/creatorVideos.ts SERIES_LABEL). */
  series: string | null;
  /** Teams in it, with their names when known. */
  teams: { number: number; name: string | null }[];
  published: string | null;
  duration: number | null;
  /** One line on why it's here ("Features 21229", "Behind the Bot", "Loved by people who liked what you like"). */
  reason: string;
  engagement: Engagement;
}

export interface CyclesAnswer {
  items: CycleItem[];
  /** The next page's cursor; null at the end. */
  next: string | null;
}

/** A page's cursor: the session's id and how many it has shown. */
export const CYCLES_CURSOR = /^([A-Za-z0-9_-]{12})\.(\d{1,4})$/;
/** Cycles per page: few, as each page is ranked again from what the person just did. */
export const CYCLES_PAGE = 6;

/** The share link of a Cycle: opens Cycles with that video first. */
export const cycleHref = (videoId: string) => `/cycles/${videoId}`;
