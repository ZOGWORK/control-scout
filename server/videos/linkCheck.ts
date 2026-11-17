// Each linked official recording checked again against what YouTube says of it today. A link is right when it's
// written (the checked list, the watcher) but a channel can reuse a scheduled stream: FIRST in Missouri's
// qM3qo5rrmyc was listed for Camdenton Meet #1 (2026 USMOKSSWM1, Nov 14) while it was still to come, then never aired
// that day and became "Southwest League Meet #2 … November 21", a different meet. Two facts take such a link off its
// event:
//   - it never aired: YouTube's facts, read after the event's days (a stalled read proves nothing), still list it as
//     to come with no start, and the event played (one postponed, its dates not moved yet, keeps its stream);
//   - its title named the event's meet number when it was linked, and names another now.
// A link from the owner or from frame evidence is a decision someone made on what the video shows: never taken off.
//
// A video taken off is freed, not kept as a removed row (which would hold its id for good). In one write, each step
// only if the one before took effect:
//   1. its link row goes (one from the list or the watcher, still on);
//   2. the drop is logged (owner_audit, "link check", officialVideo.remove, with its event, day, part and source): the
//      checked list's seed never writes a video so logged back, whatever is decided of it later;
//   3. it's set aside in the watcher's list (status ignored, decided by "link check"), unless the owner or evidence
//      decided it (approved, rejected): the channel audit decides that list again each run, so once it airs as the
//      meet its title names it's added there, or the owner approves it from the list.
import { all, db } from "../db.js";
import { withDataLock } from "../data/lock.js";
import { forgetOfficial } from "./officialVideos.js";
import { EVENT_LAST_DAY, EVENT_PLAYED_DAYS } from "./eventDays.js";

/** A day after an event's last day: a stream scheduled for that event and not started by then never aired for it. */
const GRACE_MS = 24 * 3600_000;

/** The actor and action a drop is logged with; the checked list's seed reads them. */
export const DROP_ACTOR = "link check", DROP_ACTION = "officialVideo.remove";

/** The meet numbers a name or title gives ("Meet #2", "Meet 1a" → 1): none, one, or more. A number followed by a
 *  slash or a dash and another ("Meet 3/4", a date "Meet 11/14") names no one meet. */
export function meetNumbers(s: string): number[] {
  return [...new Set([...String(s ?? "").matchAll(/\bmeet\s*#?\s*(\d+)[a-z]?\b(?!\s*[/&-]\s*\d)/gi)].map((m) => Number(m[1])))];
}

export type WrongLink = { videoId: string; season: number; code: string; why: string };

/** Why a link is wrong today, or null. end: the event's last day; played: whether it played a match; listed: the
 *  title the link was written with; title: the video's title on its channel now; checked: when YouTube's facts were read. */
export function linkWrong(l: { end: string; name: string; listed?: string | null; title: string | null; live: number | null; start: string | null; checked?: string | null; played?: boolean }, now: number): string | null {
  const over = Date.parse(`${l.end}T23:59:59Z`) + GRACE_MS;
  if (Number(l.live) === 1 && !l.start && l.played !== false && over < now && !!l.checked && Date.parse(l.checked) > over)
    return `never aired: YouTube still lists it as to come, and the event's days ended ${l.end}`;
  const t = l.title ? meetNumbers(l.title) : [], e = meetNumbers(l.name), was = meetNumbers(l.listed ?? "");
  if (t.length === 1 && e.length === 1 && was.length === 1 && was[0] === e[0] && t[0] !== e[0])
    return `its title now names meet #${t[0]} ("${l.title!.slice(0, 120)}"), the event is meet #${e[0]}`;
  return null;
}

const placeholder = (t: unknown) => /^(deleted|private) video$/i.test(String(t ?? "").trim());

/** Take wrong links off their events and free them. Returns what came off. */
export async function dropWrongLinks(log: (s: string) => void, now = Date.now()): Promise<WrongLink[]> {
  const at = new Date(now).toISOString();
  // Read and written under the data lock, and every write guarded again in SQL: a link the owner changes meanwhile
  // (Remove, Approve) is left as they set it.
  const dropped = await withDataLock("official link check", async () => {
    const rows = await all<any>(`SELECT o.video_id, o.season, o.code, o.day, o.part, o.source, o.channel_id, o.title AS listed, e.name,
        ${EVENT_LAST_DAY} AS end, ${EVENT_PLAYED_DAYS} AS played, m.live, m.start, m.checked_at, a.title
      FROM official_videos o JOIN events e ON e.season = o.season AND e.code = o.code
      LEFT JOIN video_meta m ON m.video_id = o.video_id LEFT JOIN official_audit_videos a ON a.video_id = o.video_id
      WHERE o.removed_at IS NULL AND o.kind = 'recording' AND o.source IN ('list', 'watcher')`);
    const writes: { sql: string; args: (string | number | null)[] }[] = [];
    const wrong: WrongLink[] = [];
    for (const r of rows) {
      const title = r.title && !placeholder(r.title) ? String(r.title) : null;
      const why = linkWrong({ end: String(r.end), name: String(r.name), listed: r.listed ?? null, title, live: r.live == null ? null : Number(r.live), start: r.start ?? null, checked: r.checked_at ?? null, played: !!r.played }, now);
      if (!why) continue;
      const w: WrongLink = { videoId: String(r.video_id), season: Number(r.season), code: String(r.code), why };
      wrong.push(w);
      const details = JSON.stringify({ videoId: w.videoId, season: w.season, code: w.code, day: r.day ?? null, part: r.part ?? null, source: String(r.source), why });
      writes.push(
        { sql: "DELETE FROM official_videos WHERE video_id = ? AND season = ? AND code = ? AND removed_at IS NULL AND source IN ('list', 'watcher')", args: [w.videoId, w.season, w.code] },
        { sql: "INSERT INTO owner_audit (at, actor, action, details, result, old_value, new_value) SELECT ?, ?, ?, ?, NULL, NULL, NULL WHERE changes() = 1", args: [at, DROP_ACTOR, DROP_ACTION, details] },
        {
          sql: `INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, part, why, seen_at, decided_at, decided_by)
                SELECT ?, ?, ?, 'ignored', NULL, NULL, NULL, NULL, ?, ?, ?, ? WHERE changes() = 1
                ON CONFLICT(video_id) DO UPDATE SET status = 'ignored', season = NULL, code = NULL, day = NULL, part = NULL,
                  why = excluded.why, seen_at = excluded.seen_at, decided_at = excluded.decided_at, decided_by = excluded.decided_by
                WHERE official_watch.status IN ('added', 'pending', 'ignored', 'duplicate')`,
          args: [w.videoId, String(r.channel_id), String(title ?? r.listed ?? "").slice(0, 300), `taken off ${w.season} ${w.code} ${r.day ?? ""} (${r.source}) by the link check: ${why}`.slice(0, 500), at, at, DROP_ACTOR],
        },
      );
    }
    if (writes.length) await db().batch(writes, "write");
    // What came off: the drops this write logged (a link changed meanwhile wasn't).
    const logged = new Set((await all<{ v: string }>("SELECT json_extract(details, '$.videoId') AS v FROM owner_audit WHERE actor = ? AND action = ? AND at = ?", [DROP_ACTOR, DROP_ACTION, at])).map((r) => String(r.v)));
    return wrong.filter((w) => logged.has(w.videoId));
  }, { ttlMs: 60_000, waitMs: 3 * 60_000, pollMs: 1000 });
  if (dropped.length) forgetOfficial();
  for (const w of dropped) log(`official videos: ${w.videoId} taken off ${w.season} ${w.code}: ${w.why}`);
  return dropped;
}
