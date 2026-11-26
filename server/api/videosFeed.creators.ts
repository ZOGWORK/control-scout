// Creator videos for the Videos feed (FUN Robotics Network and other channels the owner adds), with the teams tagged
// in each. A thin reader of the creator_videos and video_team_tags tables (migration 114, server/videos/creatorVideos.ts
// writes them): until those exist on this database it returns none, so the feed simply has no creator videos.
// Only videos that can play in the app or on YouTube and are FTC (program "ftc" or not known) are read.
import { all } from "../db.js";

export interface FeedCreatorVideo {
  videoId: string; channelId: string; channel: string | null; title: string; publishedAt: string | null;
  durationS: number | null; series: string | null; embeddable: boolean; teams: number[];
}

let present: { at: number; v: boolean } | null = null;
const TABLE_CHECK_MS = 5 * 60_000;

async function tablesPresent(now = Date.now()): Promise<boolean> {
  if (present && now - present.at < TABLE_CHECK_MS) return present.v;
  const rows = await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('creator_videos', 'video_team_tags')").catch(() => []);
  const v = rows.length === 2;
  present = { at: now, v };
  return v;
}

/** The newest creator videos (posted since `since` when given), newest first, at most `limit`. */
export async function feedCreatorVideos(opts: { since?: string; limit: number }): Promise<FeedCreatorVideo[]> {
  if (!(await tablesPresent())) return [];
  const rows = await all<{ video_id: string; channel_id: string; title: string; published_at: string | null; duration_s: number | null; series: string | null; embeddable: number | null }>(
    `SELECT video_id, channel_id, title, published_at, duration_s, series, embeddable FROM creator_videos
     WHERE (program IS NULL OR program IN ('ftc', 'unknown'))${opts.since ? " AND published_at >= ?" : ""} ORDER BY published_at DESC LIMIT ?`,
    [...(opts.since ? [opts.since] : []), opts.limit]).catch(() => []);
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.video_id));
  const tags = await all<{ video_id: string; team_number: number }>(`SELECT video_id, team_number FROM video_team_tags WHERE video_id IN (${ids.map(() => "?").join(",")})`, ids).catch(() => []);
  const byVideo = new Map<string, number[]>();
  for (const t of tags) { const k = String(t.video_id); const l = byVideo.get(k) ?? byVideo.set(k, []).get(k)!; if (!l.includes(Number(t.team_number))) l.push(Number(t.team_number)); }
  // The channel's title, when the channels table has it (creator_channels, migration 114); else none is said.
  const chans = await all<{ channel_id: string; name: string | null }>(`SELECT channel_id, title name FROM creator_channels WHERE channel_id IN (${[...new Set(rows.map((r) => String(r.channel_id)))].map(() => "?").join(",")})`,
    [...new Set(rows.map((r) => String(r.channel_id)))]).catch(() => []);
  const chanName = new Map(chans.map((c) => [String(c.channel_id), c.name ? String(c.name) : null]));
  return rows.map((r) => ({
    videoId: String(r.video_id), channelId: String(r.channel_id), channel: chanName.get(String(r.channel_id)) ?? null, title: String(r.title),
    publishedAt: r.published_at ? String(r.published_at) : null, durationS: r.duration_s == null ? null : Number(r.duration_s),
    series: r.series ? String(r.series) : null, embeddable: r.embeddable !== 0, teams: byVideo.get(String(r.video_id)) ?? [],
  }));
}

/** For tests: check the tables again. */
export const forgetCreatorTables = () => { present = null; };
