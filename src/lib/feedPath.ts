// The Videos feed's address (GET /api/videos/feed: server/api/videosFeed.ts), shared by the Videos tab and the watch
// page's Up next for match clips.
import type { FeedFilter } from "../shared/videosFeed";

/** The feed's address: the filter and cursor; signed out, the device's own teams and history too. */
export function feedPath(filter: FeedFilter, cursor: string | null, device: { myTeam: number | null; teams: number[]; history: string } | null): string {
  const q = new URLSearchParams();
  if (filter !== "all") q.set("filter", filter);
  if (cursor) q.set("cursor", cursor);
  if (device) {
    if (device.myTeam) q.set("my", String(device.myTeam));
    if (device.teams.length) q.set("teams", device.teams.slice(0, 30).join(","));
    if (device.history) q.set("h", device.history);
  }
  const s = q.toString();
  return `/api/videos/feed${s ? `?${s}` : ""}`;
}
