// Each linked official recording checked again against what YouTube says of it today. A link is right when it's
// written (the checked list, the watcher) but a channel can reuse a scheduled stream: FIRST in Missouri's
// qM3qo5rrmyc was listed for Camdenton Meet #1 (2026 USMOKSSWM1, Nov 14) while it was still to come, then never aired
// that day and became "Southwest League Meet #2 … November 21", a different meet. Two facts take such a link off its
// event:
//   - it never aired: YouTube's facts, read after the event's days (a stalled read proves nothing), still list it as
//     to come with no start, and the event played (one postponed, its dates not moved yet, keeps its stream);
//   - its title named the event's meet number when it was linked, and names another now, and it didn't air on the
//     event's days (a stream that aired there and was renamed since is still that day's recording).
// A link from the owner or from frame evidence is a decision someone made on what the video shows: never taken off.
//
// A video taken off is freed, not kept as a removed row (which would hold its id for good). One transaction a video,
// each step only if the one before took effect (rowsAffected):
//   1. its link row goes (one from the list or the watcher, still on: the owner's Remove meanwhile leaves nothing to do);
//   2. the drop is logged (owner_audit, "link check", officialVideo.remove, with its event, day, part and source): the
//      checked list's seed never writes that video back onto that event, whatever is decided of it later;
//   3. it's set aside in the watcher's list (status ignored, decided by "link check"), unless the owner or evidence
//      decided it (approved, rejected): the channel audit decides that list again each run, so once it airs as the
//      meet its title names it's added there, or the owner approves it from the list.
import { all, db } from "../db.js";
import { withDataLock } from "../data/lock.js";
import { localDate } from "../../src/shared/eventDay.js";
import { forgetOfficial } from "./officialVideos.js";
import { EVENT_FIRST_DAY, EVENT_LAST_DAY, EVENT_PLAYED_DAYS } from "./eventDays.js";

/** A day after an event's last day: a stream scheduled for that event and not started by then never aired for it. */
const GRACE_MS = 24 * 3600_000;

/** The actor and action a drop is logged with; the checked list's seed reads them. */
export const DROP_ACTOR = "link check", DROP_ACTION = "officialVideo.remove";

/** The meet numbers a name or title gives ("Meet #2", "Meet 1a" → 1): none, one, or more. A number followed by a
 *  slash or a dash and another ("Meet 3/4", a date "Meet 11/14") names no one meet, nor does a year ("Meet 2026"). */
export function meetNumbers(s: string): number[] {
  return [...new Set([...String(s ?? "").matchAll(/\bmeet\s*#?\s*(\d{1,3})(?!\d)[a-z]?\b(?!\s*[/&-]\s*\d)/gi)].map((m) => Number(m[1])))];
}

export type WrongLink = { videoId: string; season: number; code: string; why: string };
/** A wrong link as read, with what its drop writes. */
export type Candidate = WrongLink & { day: string | null; part: string | null; source: string; channelId: string; title: string };

/** Why a link is wrong today, or null. end: the event's last day; played: whether it played a match; listed: the
 *  title the link was written with; title: the video's title on its channel now; checked: when YouTube's facts were
 *  read; airedOnDays: its broadcast started on one of the event's days at the venue. */
export function linkWrong(l: { end: string; name: string; listed?: string | null; title: string | null; live: number | null; start: string | null; checked?: string | null; played?: boolean; airedOnDays?: boolean }, now: number): string | null {
  const over = Date.parse(`${l.end}T23:59:59Z`) + GRACE_MS;
  if (Number(l.live) === 1 && !l.start && l.played !== false && over < now && !!l.checked && Date.parse(l.checked) > over)
    return `never aired: YouTube still lists it as to come, and the event's days ended ${l.end}`;
  if (l.airedOnDays) return null;
  const t = l.title ? meetNumbers(l.title) : [], e = meetNumbers(l.name), was = meetNumbers(l.listed ?? "");
  if (t.length === 1 && e.length === 1 && was.length === 1 && was[0] === e[0] && t[0] !== e[0])
    return `its title now names meet #${t[0]} ("${l.title!.slice(0, 120)}"), the event is meet #${e[0]}`;
  return null;
}

const placeholder = (t: unknown) => /^(deleted|private) video$/i.test(String(t ?? "").trim());

/** The links wrong today, as read now. */
export async function findWrongLinks(now = Date.now()): Promise<Candidate[]> {
  const rows = await all<any>(`SELECT o.video_id, o.season, o.code, o.day, o.part, o.source, o.channel_id, o.title AS listed, e.name, e.timezone,
      ${EVENT_FIRST_DAY} AS first, ${EVENT_LAST_DAY} AS end, ${EVENT_PLAYED_DAYS} AS played, m.live, m.start, m.checked_at, a.title
    FROM official_videos o JOIN events e ON e.season = o.season AND e.code = o.code
    LEFT JOIN video_meta m ON m.video_id = o.video_id LEFT JOIN official_audit_videos a ON a.video_id = o.video_id
    WHERE o.removed_at IS NULL AND o.kind = 'recording' AND o.source IN ('list', 'watcher')`);
  const out: Candidate[] = [];
  for (const r of rows) {
    const title = r.title && !placeholder(r.title) ? String(r.title) : null;
    // The broadcast's date at the venue. An event with no time zone is read in UTC: a day off at worst, which only
    // brings back the title rule for that stream (the rule as it was before the aired-on-its-days exception).
    const aired = r.start ? localDate(Date.parse(String(r.start)), String(r.timezone ?? "UTC")) : null;
    const airedOnDays = !!aired && aired >= String(r.first) && aired <= String(r.end);
    const why = linkWrong({ end: String(r.end), name: String(r.name), listed: r.listed ?? null, title, live: r.live == null ? null : Number(r.live), start: r.start ?? null, checked: r.checked_at ?? null, played: !!r.played, airedOnDays }, now);
    if (why) out.push({ videoId: String(r.video_id), season: Number(r.season), code: String(r.code), why, day: r.day ?? null, part: r.part ?? null, source: String(r.source), channelId: String(r.channel_id), title: String(title ?? r.listed ?? "") });
  }
  return out;
}

/**
 * Free the links found wrong, one transaction each, every step only if the one before took effect (rowsAffected):
 * a link changed since it was read (the owner's Remove) is left as it is. Returns what came off.
 */
export async function freeLinks(found: Candidate[], at: string, log: (s: string) => void = () => {}): Promise<WrongLink[]> {
  const freed: WrongLink[] = [];
  for (const c of found) {
    // One that fails (a busy database) is rolled back and tried again next check; the rest still go, and what came
    // off is returned, so the caller's cache reset and log lines cover it.
    try { if (await freeOne(c, at)) freed.push({ videoId: c.videoId, season: c.season, code: c.code, why: c.why }); }
    catch (e) { log(`official videos: link check: ${c.videoId} on ${c.season} ${c.code} not freed: ${(e as Error).message}`); }
  }
  return freed;
}

/** One video freed in one transaction; false when its link changed since it was read. */
async function freeOne(c: Candidate, at: string): Promise<boolean> {
  const tx = await db().transaction("write");
  try {
    const del = await tx.execute({ sql: "DELETE FROM official_videos WHERE video_id = ? AND season = ? AND code = ? AND removed_at IS NULL AND source IN ('list', 'watcher')", args: [c.videoId, c.season, c.code] });
    if (!del.rowsAffected) { await tx.rollback(); return false; }
    await tx.execute({ sql: "INSERT INTO owner_audit (at, actor, action, details, result, old_value, new_value) VALUES (?, ?, ?, ?, NULL, NULL, NULL)",
      args: [at, DROP_ACTOR, DROP_ACTION, JSON.stringify({ videoId: c.videoId, season: c.season, code: c.code, day: c.day, part: c.part, source: c.source, why: c.why })] });
    // Set aside unless the owner or evidence decided it (approved, rejected): their decision stands.
    await tx.execute({
      sql: `INSERT INTO official_watch (video_id, channel_id, title, status, season, code, day, part, why, seen_at, decided_at, decided_by)
            VALUES (?, ?, ?, 'ignored', NULL, NULL, NULL, NULL, ?, ?, ?, ?)
            ON CONFLICT(video_id) DO UPDATE SET status = 'ignored', season = NULL, code = NULL, day = NULL, part = NULL,
              why = excluded.why, seen_at = excluded.seen_at, decided_at = excluded.decided_at, decided_by = excluded.decided_by
            WHERE official_watch.status IN ('added', 'pending', 'ignored', 'duplicate')`,
      args: [c.videoId, c.channelId, c.title.slice(0, 300), `taken off ${c.season} ${c.code} ${c.day ?? ""} (${c.source}) by the link check: ${c.why}`.slice(0, 500), at, at, DROP_ACTOR],
    });
    await tx.commit();
    return true;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
}

/** Take wrong links off their events and free them, under the data lock. Returns what came off. */
export async function dropWrongLinks(log: (s: string) => void, now = Date.now()): Promise<WrongLink[]> {
  const at = new Date(now).toISOString();
  const dropped = await withDataLock("official link check", async () => freeLinks(await findWrongLinks(now), at, log), { ttlMs: 60_000, waitMs: 3 * 60_000, pollMs: 1000 });
  if (dropped.length) forgetOfficial();
  for (const w of dropped) log(`official videos: ${w.videoId} taken off ${w.season} ${w.code}: ${w.why}`);
  return dropped;
}
