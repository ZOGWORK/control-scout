// Creator videos for the Videos feed (FUN Robotics Network and the other channels the owner adds), with the teams
// tagged in each: read through server/videos/creatorVideos.ts creatorVideosFor (embeddable ones only, tags the owner
// removed left out). Only FTC videos, or ones whose program isn't known, go in the feed; FRC and VEX never do.
import { creatorVideosFor } from "../videos/creatorVideos.js";
import type { CreatorVideo } from "../../src/shared/creatorVideos.js";

/** The newest FTC creator videos (posted since `since` when given), newest first, at most `limit`. */
export async function feedCreatorVideos(opts: { since?: string; limit: number }): Promise<CreatorVideo[]> {
  const vids = await creatorVideosFor({ limit: opts.limit, ...(opts.since ? { since: opts.since } : {}) });
  return vids.filter((v) => v.program === "ftc" || v.program === "unknown");
}
