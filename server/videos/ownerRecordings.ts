// The owner's corrections to an event's recordings, made on the event page itself (components/owner/EventRecordingsOwner.tsx,
// /api/owner/event-recordings/*): Replace a day's video, Remove one, Add one for a day. Kept in official_videos as
// source 'owner-page' rows, so no new store: an added video is a kept row (it joins the event's player for its day, as an
// official recording does), a removed one is a row with removed_at set, which no automatic pass writes over.
//
// Why the owner's choice wins (server/videos/recordings.ts, ownerPicks):
//   - a removed video is left out of the event's player whichever source gave it (FIRST's link, a short link's video, a
//     channel's broadcasts, the watcher, the owner portal's stream), on every read, so the next automatic pass can't
//     bring it back; the row's video_id key keeps the seed, the watcher and the evidence links from writing it again;
//   - an added video holds its day: any automatic video read for that day (by YouTube's broadcast start at the venue,
//     or its listed day) is left out, so the day plays the owner's video, never two;
//   - the link check and the channel audit only take off 'list' and 'watcher' rows, never these.
// Every change is audited (owner_audit) and every cache is dropped, so the page shows it on its next read.
import { all, db, get } from "../db.js";
import { clearClipCaches } from "../caches.js";
import { recordAudit } from "../portal/audit.js";
import { parseStreamUrl } from "../../src/shared/stream.js";
import { EVENT_FIRST_DAY, EVENT_LAST_DAY } from "./eventDays.js";
import { forgetOfficial, localDate } from "./officialVideos.js";
import { forgetRecordings, seasonRecordings } from "./recordings.js";
import type { OwnerEventRecordings } from "../../src/shared/api.js";

export const OWNER_PAGE = "owner-page";
const ID = /^[A-Za-z0-9_-]{11}$/;

type Out = { ok: true } | { ok: false; error: string };
type Write = { sql: string; args: (string | number | null)[] };
type Writes = { error: string; was?: undefined; writes?: undefined } | { error?: undefined; was: string | null; writes: Write[] };

/** A pasted YouTube link or a bare 11-character video id → the id, or why not. */
export function videoIdOf(input: unknown): { ok: true; videoId: string } | { ok: false; error: string } {
  const raw = typeof input === "string" ? input.trim() : "";
  if (ID.test(raw)) return { ok: true, videoId: raw };
  const p = parseStreamUrl(raw);
  return p.ok ? { ok: true, videoId: p.videoId } : { ok: false, error: p.error };
}

/** Every day from `from` to `to` (YYYY-MM-DD), at most 14. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end && out.length < 14; t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

async function eventOf(season: number, code: string): Promise<{ season: number; code: string; timezone: string | null; days: string[] } | null> {
  if (!Number.isInteger(season) || !code) return null;
  const ev = await get<any>(`SELECT e.season, e.code, e.timezone, ${EVENT_FIRST_DAY} AS start, ${EVENT_LAST_DAY} AS end FROM events e WHERE e.season = ? AND upper(e.code) = upper(?)`, [season, code]);
  if (!ev?.start) return null;
  return { season: Number(ev.season), code: String(ev.code), timezone: ev.timezone ?? null, days: daysBetween(String(ev.start).slice(0, 10), String(ev.end ?? ev.start).slice(0, 10)) };
}

/** What the owner's controls show: the event's days, each video its player plays (with its day when known, and
 *  whether it's the owner's own pick), and the videos the owner took off. */
export async function ownerEventRecordings(season: number, code: string): Promise<OwnerEventRecordings | null> {
  const ev = await eventOf(season, code);
  if (!ev) return null;
  const [rec, rows] = await Promise.all([
    seasonRecordings(ev.season).then((m) => m.get(ev.code) ?? null),
    all<{ video_id: string; day: string | null; removed_at: string | null }>("SELECT video_id, day, removed_at FROM official_videos WHERE season = ? AND code = ? AND source = ?", [ev.season, ev.code, OWNER_PAGE]),
  ]);
  const mine = new Set(rows.filter((r) => !r.removed_at).map((r) => String(r.video_id)));
  const videos = rec ? [rec, ...(rec.more ?? [])].map((v) => ({
    videoId: v.videoId, day: v.day ?? (v.meta?.start ? localDate(v.meta.start, ev.timezone) : null), part: v.part ?? null, owner: mine.has(v.videoId),
  })) : [];
  return { season: ev.season, code: ev.code, days: ev.days, videos, removed: rows.filter((r) => r.removed_at).map((r) => ({ videoId: String(r.video_id), day: r.day ?? null })) };
}

/** The writes that take `videoId` off the event for good: an owner-page row with removed_at (one already there for
 *  this event, any source, is turned into it), its watcher row rejected, and the owner portal's stream cleared when it's
 *  that video. null with why when the video is on another event's official list (one row a video). */
async function removeWrites(ev: { season: number; code: string }, videoId: string, day: string | null, actor: string, at: string): Promise<Writes> {
  const row = await get<any>("SELECT season, code, removed_at, source FROM official_videos WHERE video_id = ?", [videoId]);
  if (row && (Number(row.season) !== ev.season || String(row.code) !== ev.code) && !row.removed_at) return { error: `That video is on ${row.season} ${row.code}'s official list: take it off there.` };
  return { was: row ? String(row.source) : null, writes: [
    { sql: `INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by, removed_at)
            VALUES (?, ?, ?, 'recording', ?, NULL, '', '', ?, ?, ?, ?, ?)
            ON CONFLICT(video_id) DO UPDATE SET season = excluded.season, code = excluded.code, source = excluded.source, why = excluded.why,
              day = COALESCE(official_videos.day, excluded.day), removed_at = excluded.removed_at`,
      args: [videoId, ev.season, ev.code, day, OWNER_PAGE, `removed by ${actor} on the event page`, at, actor, at] },
    { sql: "UPDATE official_watch SET status = 'rejected', decided_at = ?, decided_by = ? WHERE video_id = ?", args: [at, actor, videoId] },
    { sql: "DELETE FROM event_streams WHERE season = ? AND code = ? AND video_id = ?", args: [ev.season, ev.code, videoId] },
  ] };
}

/** The writes that put `videoId` on the event for `day`: an owner-page row, kept (one there before for this event, or
 *  removed from any, is turned into it), and its watcher row marked approved so no audit takes it off. */
async function addWrites(ev: { season: number; code: string }, videoId: string, day: string, part: string | null, actor: string, at: string): Promise<Writes> {
  const row = await get<any>("SELECT season, code, removed_at FROM official_videos WHERE video_id = ?", [videoId]);
  if (row && (Number(row.season) !== ev.season || String(row.code) !== ev.code) && !row.removed_at) return { error: `That video is already ${row.season} ${row.code}'s recording.` };
  return { was: row ? "kept" : null, writes: [
    { sql: `INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by, removed_at)
            VALUES (?, ?, ?, 'recording', ?, ?, '', '', ?, ?, ?, ?, NULL)
            ON CONFLICT(video_id) DO UPDATE SET season = excluded.season, code = excluded.code, kind = 'recording', day = excluded.day, part = excluded.part,
              source = excluded.source, why = excluded.why, added_at = excluded.added_at, added_by = excluded.added_by, removed_at = NULL`,
      args: [videoId, ev.season, ev.code, day, part, OWNER_PAGE, `added by ${actor} on the event page`, at, actor] },
    { sql: "UPDATE official_watch SET status = 'approved', season = ?, code = ?, day = ?, part = ?, decided_at = ?, decided_by = ? WHERE video_id = ?", args: [ev.season, ev.code, day, part, at, actor, videoId] },
  ] };
}

/** The kept official recordings (any source) that hold `day` on the event, or only that day's `part` when one is given
 *  (null: the whole-day slot): the slot (official_videos_day) must be free before an add, so a Replace takes its holders
 *  off in the same write, and never the day's other parts. */
const dayHolders = (ev: { season: number; code: string }, day: string, part?: string | null) =>
  all<{ video_id: string }>(`SELECT video_id FROM official_videos WHERE season = ? AND code = ? AND kind = 'recording' AND removed_at IS NULL AND day = ?${part !== undefined ? " AND COALESCE(part, '') = COALESCE(?, '')" : ""}`,
    [ev.season, ev.code, day, ...(part !== undefined ? [part] : [])]).then((r) => r.map((x) => String(x.video_id)));

function done() { forgetOfficial(); forgetRecordings(); clearClipCaches(); }

function validDay(ev: { code: string; days: string[] }, day: unknown): { ok: true; day: string } | { ok: false; error: string } {
  const d = typeof day === "string" ? day.trim() : "";
  if (!ev.days.includes(d)) return { ok: false, error: `Pick one of ${ev.code}'s days (${ev.days[0]}${ev.days.length > 1 ? ` to ${ev.days.at(-1)}` : ""}).` };
  return { ok: true, day: d };
}

/** Add a recording for one of the event's days. A day that already has one is a Replace. */
export async function addEventRecording(season: number, code: string, body: { video?: unknown; day?: unknown }, actor: string, now = Date.now()): Promise<Out> {
  const ev = await eventOf(season, code);
  if (!ev) return { ok: false, error: "No such event." };
  const id = videoIdOf(body.video);
  if (!id.ok) return id;
  const day = validDay(ev, body.day);
  if (!day.ok) return day;
  const held = (await ownerEventRecordings(ev.season, ev.code))?.videos.filter((v) => v.day === day.day && v.videoId !== id.videoId) ?? [];
  if (held.length) return { ok: false, error: `${ev.code} already plays ${held[0].videoId} for ${day.day}: replace it instead.` };
  const holders = (await dayHolders(ev, day.day)).filter((v) => v !== id.videoId);
  if (holders.length) return { ok: false, error: `${ev.code} already has ${holders[0]} for ${day.day}: replace it instead.` };
  const at = new Date(now).toISOString();
  const add = await addWrites(ev, id.videoId, day.day, null, actor, at);
  if (!add.writes) return { ok: false, error: add.error };
  await db().batch([...add.writes], "write");
  done();
  await recordAudit(actor, "eventRecording.add", { season: ev.season, code: ev.code, videoId: id.videoId, day: day.day });
  return { ok: true };
}

/** Replace the video `from` (one the event plays) with another for that day, in one write. */
export async function replaceEventRecording(season: number, code: string, body: { from?: unknown; video?: unknown; day?: unknown }, actor: string, now = Date.now()): Promise<Out> {
  const ev = await eventOf(season, code);
  if (!ev) return { ok: false, error: "No such event." };
  const from = typeof body.from === "string" && ID.test(body.from) ? body.from : null;
  if (!from) return { ok: false, error: "Not a YouTube video id." };
  const id = videoIdOf(body.video);
  if (!id.ok) return id;
  if (id.videoId === from) return { ok: false, error: "That's the video it plays already." };
  const day = validDay(ev, body.day);
  if (!day.ok) return day;
  const at = new Date(now).toISOString();
  // The replacement takes the replaced video's part of the day ("Part 1", "Awards"; none: the whole day), and only
  // that part's holders come off with it (the slot must be free): the day's other parts stay.
  const kept = await get<{ part: string | null }>("SELECT part FROM official_videos WHERE video_id = ? AND season = ? AND code = ? AND removed_at IS NULL", [from, ev.season, ev.code]);
  const part = kept ? kept.part ?? null : (await ownerEventRecordings(ev.season, ev.code))?.videos.find((v) => v.videoId === from)?.part ?? null;
  const others = (await dayHolders(ev, day.day, part)).filter((v) => v !== from && v !== id.videoId);
  const offs: Write[][] = [];
  let was: string | null = null;
  for (const v of [from, ...others]) {
    const off = await removeWrites(ev, v, day.day, actor, at);
    if (!off.writes) return { ok: false, error: off.error };
    if (!offs.length) was = off.was;
    offs.push(off.writes);
  }
  const add = await addWrites(ev, id.videoId, day.day, part, actor, at);
  if (!add.writes) return { ok: false, error: add.error };
  await db().batch([...offs.flat(), ...add.writes], "write");
  done();
  await recordAudit(actor, "eventRecording.replace", { season: ev.season, code: ev.code, from, videoId: id.videoId, day: day.day, part, was, alsoOff: others });
  return { ok: true };
}

/** Take a video off the event for good: no automatic pass brings it back (Add puts it back, for a day). */
export async function removeEventRecording(season: number, code: string, body: { videoId?: unknown }, actor: string, now = Date.now()): Promise<Out> {
  const ev = await eventOf(season, code);
  if (!ev) return { ok: false, error: "No such event." };
  const videoId = typeof body.videoId === "string" && ID.test(body.videoId) ? body.videoId : null;
  if (!videoId) return { ok: false, error: "Not a YouTube video id." };
  const shown = (await ownerEventRecordings(ev.season, ev.code))?.videos.find((v) => v.videoId === videoId);
  const at = new Date(now).toISOString();
  const off = await removeWrites(ev, videoId, shown?.day ?? null, actor, at);
  if (!off.writes) return { ok: false, error: off.error };
  await db().batch([...off.writes], "write");
  done();
  await recordAudit(actor, "eventRecording.remove", { season: ev.season, code: ev.code, videoId, day: shown?.day ?? null, was: off.was });
  return { ok: true };
}
