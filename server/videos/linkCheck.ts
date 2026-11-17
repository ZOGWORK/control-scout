// Each linked official recording checked again against what YouTube says of it today. A link is right when it's
// written (the checked list, the watcher) but a channel can reuse a scheduled stream: FIRST in Missouri's
// qM3qo5rrmyc was listed for Camdenton Meet #1 (2026 USMOKSSWM1, Nov 14) while it was still to come, then never aired
// that day and became "Southwest League Meet #2 … November 21", a different meet. Two facts take such a link off its
// event:
//   - it never aired: YouTube still lists it as live or to come with no start, and the event's days are over;
//   - its title now names one meet number, and the event's name another.
// A link from the owner or from frame evidence is a decision someone made on what the video shows: never taken off.
// "Never aired" is told only from YouTube's facts read after the event's days (a stalled read proves nothing). A video
// taken off is freed, not kept as a removed row (which would hold its id for good): its link row goes, and it's set
// aside in the watcher's list (status ignored, decided by "link check"), which the channel audit decides again each
// run, so once it airs as the meet its title names it's added there, or the owner approves it from the list. The
// checked list's seed never writes it back.
import { all, db } from "../db.js";
import { recordAudit } from "../portal/audit.js";
import { withDataLock } from "../data/lock.js";
import { forgetOfficial } from "./officialVideos.js";
import { EVENT_LAST_DAY } from "./eventDays.js";

/** A day after an event's last day: a stream scheduled for that event and not started by then never aired for it. */
const GRACE_MS = 24 * 3600_000;

/** The meet numbers a name or title gives ("Meet #2", "Meet 1a" → 1): none, one, or more ("Meet #3 / Meet #4"). */
export function meetNumbers(s: string): number[] {
  return [...new Set([...String(s ?? "").matchAll(/\bmeet\s*#?\s*(\d+)[a-z]?\b/gi)].map((m) => Number(m[1])))];
}

export type WrongLink = { videoId: string; season: number; code: string; why: string; channelId: string; title: string; day: string | null };

/** Why a link is wrong today, or null. end: the event's last day; title: the video's title on its channel now. */
export function linkWrong(l: { end: string; name: string; title: string | null; live: number | null; start: string | null; checked?: string | null }, now: number): string | null {
  const over = Date.parse(`${l.end}T23:59:59Z`) + GRACE_MS;
  // Facts read after the event's days are over: one read before then (or a read that stalled) says nothing.
  if (Number(l.live) === 1 && !l.start && over < now && !!l.checked && Date.parse(l.checked) > over)
    return `never aired: YouTube still lists it as to come, and the event's days ended ${l.end}`;
  const t = l.title ? meetNumbers(l.title) : [], e = meetNumbers(l.name);
  if (t.length === 1 && e.length === 1 && t[0] !== e[0]) return `its title now names meet #${t[0]} ("${l.title!.slice(0, 120)}"), the event is meet #${e[0]}`;
  return null;
}

/** Take wrong links off their events. Returns what came off. */
export async function dropWrongLinks(log: (s: string) => void, now = Date.now()): Promise<WrongLink[]> {
  const rows = await all<any>(`SELECT o.video_id, o.season, o.code, o.day, o.source, o.channel_id, o.title AS listed, e.name, ${EVENT_LAST_DAY} AS end, m.live, m.start, m.checked_at, a.title
    FROM official_videos o JOIN events e ON e.season = o.season AND e.code = o.code
    LEFT JOIN video_meta m ON m.video_id = o.video_id LEFT JOIN official_audit_videos a ON a.video_id = o.video_id
    WHERE o.removed_at IS NULL AND o.kind = 'recording' AND o.source IN ('list', 'watcher')`);
  const wrong: WrongLink[] = [];
  for (const r of rows) {
    const why = linkWrong({ end: String(r.end), name: String(r.name), title: r.title ?? null, live: r.live == null ? null : Number(r.live), start: r.start ?? null, checked: r.checked_at ?? null }, now);
    const title = String(r.title && !/^(deleted|private) video$/i.test(String(r.title).trim()) ? r.title : r.listed ?? "");
    if (why) wrong.push({ videoId: String(r.video_id), season: Number(r.season), code: String(r.code), why, channelId: String(r.channel_id), title, day: r.day ?? null });
  }
  if (!wrong.length) return [];
  const at = new Date(now).toISOString();
  await withDataLock("official link check", () => db().batch(wrong.flatMap((w) => [
    { sql: "DELETE FROM official_videos WHERE video_id = ? AND removed_at IS NULL", args: [w.videoId] },
    {
      sql: `INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, part, why, seen_at, decided_at, decided_by)
            VALUES (?, ?, ?, 'ignored', NULL, NULL, NULL, NULL, ?, ?, ?, 'link check')
            ON CONFLICT(video_id) DO UPDATE SET status = 'ignored', season = NULL, code = NULL, day = NULL, part = NULL,
              why = excluded.why, decided_at = excluded.decided_at, decided_by = 'link check'`,
      args: [w.videoId, w.channelId, w.title.slice(0, 300), `taken off ${w.season} ${w.code} by the link check: ${w.why}`.slice(0, 500), at, at],
    },
  ]), "write"), { ttlMs: 60_000, waitMs: 3 * 60_000, pollMs: 1000 });
  forgetOfficial();
  for (const w of wrong) {
    await recordAudit("link check", "officialVideo.remove", { videoId: w.videoId, season: w.season, code: w.code, why: w.why });
    log(`official videos: ${w.videoId} taken off ${w.season} ${w.code}: ${w.why}`);
  }
  return wrong;
}
