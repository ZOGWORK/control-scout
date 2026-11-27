// The watch page (src/pages/WatchPage.tsx, GET /api/videos/up-next/:videoId: server/api/upNext.ts): one video
// playing big, with what to watch next beside it, page after page. For a creator video: the team's own episodes
// first when the page was opened from that team (the team page's Behind the Bot badge), then the rest of the series,
// newest first, endlessly.
import type { CreatorVideo } from "./creatorVideos";

export interface WatchVideo extends CreatorVideo {
  description: string;
}

export interface UpNextAnswer {
  /** The video asked for, when it's a creator video; null for any other id (a match clip: the page has it already). */
  video: WatchVideo | null;
  /** First page only, when ?team= was given: that team's own featured videos (title names it), newest first. */
  team: { number: number; name: string | null; videos: CreatorVideo[] } | null;
  /** More from the series, newest first, the current video and the team's own left out. */
  items: CreatorVideo[];
  /** The next page's cursor; null at the end. */
  next: string | null;
}

/** A page's cursor: the last item's publish time and id ("2026-11-20T15:00:00Z~abcDEF12345"). */
export const UP_NEXT_CURSOR = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)~([A-Za-z0-9_-]{11})$/;
export const upNextCursor = (v: Pick<CreatorVideo, "publishedAt" | "videoId">): string => `${v.publishedAt}~${v.videoId}`;

/** The watch page's address for a video: a creator video, or a clip of one (`t`/`end` in seconds), opened from a team. */
export function watchHref(videoId: string, o: { t?: number; end?: number | null; team?: number | null } = {}): string {
  const q = new URLSearchParams();
  if (o.t) q.set("t", String(Math.max(0, Math.floor(o.t))));
  if (o.end != null && o.end > (o.t ?? 0)) q.set("end", String(Math.floor(o.end)));
  if (o.team) q.set("team", String(o.team));
  const s = q.toString();
  return `/watch/${encodeURIComponent(videoId)}${s ? `?${s}` : ""}`;
}
