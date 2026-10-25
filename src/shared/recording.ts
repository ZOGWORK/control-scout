// Where a match sits in its event's recording: the broadcast's start (from YouTube, server/videos/youtube.ts)
// and the match's real start (MatchView.startsAt, from FIRST) give the second to jump to. Shared by the
// server (which attaches each match's clip) and the app (the player's seek, the link's label).

/** Seconds of lead-in before a match's start: the field reset and the announcer calling it. */
export const CLIP_LEAD_S = 20;

export interface RecordingTiming { start: string | null; end?: string | null; length: number | null; live: boolean }

/** How far the video's length may fall short of the broadcast's start-to-end time before its times can't be trusted. */
export const GAP_TOLERANCE_S = 180;

/**
 * Whether the video's seconds follow the clock: a broadcast that dropped out and came back is archived without
 * the dead air, so after the gap every match would land on a later one. Its length then falls short of its
 * start-to-end time. Still live: trusted up to now. No end: an archive whose end YouTube didn't give, trusted.
 */
export function timingTrusted(rec: RecordingTiming): boolean {
  if (!rec.start) return false;
  if (rec.live || !rec.end || rec.length == null) return true;
  const span = (Date.parse(rec.end) - Date.parse(rec.start)) / 1000;
  return Number.isFinite(span) && span - rec.length <= GAP_TOLERANCE_S;
}

/**
 * The second in the recording to start a match from, or null when the recording doesn't hold it: no
 * broadcast start, no match start, a match before the broadcast began or after the video ends (a long
 * stream's archive keeps its first 12 hours only; another day's stream is another video), or a video with
 * a gap (timingTrusted). While the broadcast is still live, up to now.
 */
export function clipSecond(startsAt: string | null | undefined, rec: RecordingTiming, now = Date.now()): number | null {
  if (!startsAt || !rec.start || !timingTrusted(rec)) return null;
  const from = Date.parse(rec.start), at = Date.parse(startsAt);
  if (!Number.isFinite(from) || !Number.isFinite(at) || at < from) return null;
  const offset = Math.floor((at - from) / 1000);
  const end = rec.live ? Math.floor((now - from) / 1000) : rec.length;
  if (end == null || offset > end) return null;
  return Math.max(0, offset - CLIP_LEAD_S);
}

/**
 * Whether a played match's time is when it really started. FIRST's actual start carries seconds and
 * milliseconds ("2026-05-02T11:55:18.162"); a result posted without one falls back to the schedule, which
 * is on the minute ("09:00:00"). In the 2025 data: 2 of 45,421 played matches are on the minute, 219 of
 * 228 unplayed ones. A schedule would put the Watch on another match, so on-the-minute times get none.
 */
export function actualStart(time: string | null | undefined): boolean {
  const m = time ? /T\d\d:\d\d:(\d\d)(?:\.(\d+))?/.exec(time) : null;
  return !!m && (m[1] !== "00" || /[1-9]/.test(m[2] ?? ""));
}

/** YouTube's own page for the video at a second (the link when the page has no player to seek). */
export const watchUrl = (videoId: string, t?: number | null) => `https://www.youtube.com/watch?v=${videoId}${t ? `&t=${t}s` : ""}`;

/** 3725 → "1:02:05", 125 → "2:05". */
export function clipTime(t: number): string {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
