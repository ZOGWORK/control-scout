// Official event videos (migration 83, docs/official-videos.md): YouTube videos from event organisers' own channels,
// each checked against its Scout event (name, city, dates, division, day) before it's kept. A recording is a day's
// broadcast and joins the event's player like FIRST's own link does (server/videos/recordings.ts): it's the fallback
// for a match, after FIRST's per-match video and a verified contributor's link. A highlight is a short reel, shown on
// the event page as a highlight only: never a match's video, never the event's recording.
//
// The checked list ships in server/data/officialVideos.json and is written once per video at boot (seedOfficialVideos).
// A video already in the table, kept or removed, is never written again, so removing one sticks.
import { all, db } from "../db.js";
import { registerCache } from "../caches.js";
import list from "../data/officialVideos.json" with { type: "json" };

/** A UTC instant's date at a venue ("2026-03-14"); UTC when the zone isn't known or isn't valid. */
export function localDate(iso: string, tz: string | null | undefined): string {
  const t = new Date(iso);
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(t); } catch { return t.toISOString().slice(0, 10); }
}

export type OfficialKind = "recording" | "highlight";
export interface OfficialVideo {
  season: number; code: string; videoId: string; kind: OfficialKind;
  /** The broadcast's date at the venue (recordings). */
  day?: string | null;
  /** A named part when one day has more than one video ("Awards"). */
  part?: string | null;
  channelId: string; title: string;
}
export interface OfficialList { channels: Record<string, string>; videos: OfficialVideo[] }

const TTL_MS = 60_000;
let bySeason = new Map<number, { at: number; v: Promise<OfficialVideo[]> }>();
registerCache("Official event videos", () => { bySeason = new Map(); });
/** Drop the cached season lists (after a write). */
export function forgetOfficial() { bySeason = new Map(); }

const rowOf = (r: any): OfficialVideo => ({
  season: Number(r.season), code: String(r.code), videoId: String(r.video_id), kind: r.kind === "highlight" ? "highlight" : "recording",
  day: r.day ?? null, part: r.part ?? null, channelId: String(r.channel_id), title: String(r.title),
});

/** Every kept official video of a season (both kinds), cached for a minute. */
export function seasonOfficial(season: number, now = Date.now()): Promise<OfficialVideo[]> {
  const hit = bySeason.get(season);
  if (hit && now - hit.at < TTL_MS) return hit.v;
  const v = all<any>("SELECT season, code, video_id, kind, day, part, channel_id, title FROM official_videos WHERE season = ? AND removed_at IS NULL ORDER BY code, day, added_at", [season]).then((rows) => rows.map(rowOf));
  bySeason.set(season, { at: now, v });
  v.catch(() => { if (bySeason.get(season)?.v === v) bySeason.delete(season); });
  return v;
}

/** An event's highlights, oldest first. */
export async function eventHighlightVideos(season: number, code: string): Promise<{ videoId: string; title: string }[]> {
  return (await seasonOfficial(season)).filter((v) => v.code === code && v.kind === "highlight").map((v) => ({ videoId: v.videoId, title: v.title }));
}

/** The video ids of every kept official recording (for the timing backfill). */
export async function officialRecordingIds(): Promise<string[]> {
  return (await all<{ video_id: string }>("SELECT video_id FROM official_videos WHERE kind = 'recording' AND removed_at IS NULL")).map((r) => String(r.video_id));
}

/** Whether a video id is a YouTube video id. */
const isId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{11}$/.test(s);

/**
 * The videos an event already plays, with their broadcast date at the venue when known: FIRST's link, a short link's
 * video, a channel's broadcasts, the owner's stream, and its official recordings. timed: YouTube's timing for it has
 * been read (video_meta), or the date came from the list or the channel's broadcast; false: not read yet, so its
 * day can't be told.
 */
export async function eventVideosByDay(season: number, code: string): Promise<{ videoId: string; day: string | null; part: string | null; timed: boolean }[]> {
  const ev = await all<{ livestream: string | null; timezone: string | null }>("SELECT livestream, timezone FROM events WHERE season = ? AND code = ?", [season, code]);
  if (!ev.length) return [];
  const tz = ev[0].timezone;
  const first = /(?:v=|youtu\.be\/|\/live\/|\/embed\/)([A-Za-z0-9_-]{11})/.exec(ev[0].livestream ?? "")?.[1] ?? null;
  const others = await all<{ video_id: string; day: string | null; part: string | null; start: string | null }>(
    `SELECT video_id, NULL AS day, NULL AS part, NULL AS start FROM event_stream_links WHERE season = ? AND code = ? AND video_id IS NOT NULL
     UNION SELECT video_id, NULL, NULL, start FROM event_broadcasts WHERE season = ? AND code = ?
     UNION SELECT video_id, NULL, NULL, NULL FROM event_streams WHERE season = ? AND code = ?
     UNION SELECT video_id, day, part, NULL FROM official_videos WHERE season = ? AND code = ? AND kind = 'recording' AND removed_at IS NULL`,
    [season, code, season, code, season, code, season, code]);
  const ids = [...new Set([...(first ? [first] : []), ...others.map((o) => String(o.video_id))])];
  const starts = new Map<string, string | null>();
  if (ids.length) for (const r of await all<{ video_id: string; start: string | null }>(`SELECT video_id, start FROM video_meta WHERE video_id IN (${ids.map(() => "?").join(",")})`, ids)) starts.set(String(r.video_id), r.start ?? null);
  return ids.map((id) => {
    const os = others.filter((x) => String(x.video_id) === id);
    const listed = os.find((x) => x.day)?.day ?? null;
    const start = starts.get(id) ?? os.find((x) => x.start)?.start ?? null;
    return { videoId: id, day: listed ?? (start ? localDate(start, tz) : null), part: os.find((x) => x.part)?.part ?? null, timed: !!listed || starts.has(id) || !!start };
  });
}

/**
 * Write the checked list's videos that aren't in the table yet. A video is skipped when its event isn't in this
 * database (a data copy without that season), when it's already the event's video some other way, or when the event
 * already plays another video for the same day and part (the one there stays). Returns how many it wrote.
 */
let seeded = false;
let waitingWas = -1;
export async function seedOfficialVideos(log: (s: string) => void, data: OfficialList = list as OfficialList, now = Date.now(), again = false): Promise<number> {
  // Once a process: the list only changes with a deploy, which starts a new one.
  if (seeded && !again) return 0;
  const known = new Set((await all<{ video_id: string }>("SELECT video_id FROM official_videos")).map((r) => String(r.video_id)));
  const todo = data.videos.filter((v) => isId(v.videoId) && !known.has(v.videoId));
  if (!todo.length) { seeded = true; return 0; }
  const keys = [...new Set(todo.map((v) => `${v.season}/${v.code}`))];
  const events = new Set<string>();
  for (let i = 0; i < keys.length; i += 200) {
    const part = keys.slice(i, i + 200);
    const rows = await all<{ season: number; code: string }>(`SELECT season, code FROM events WHERE ${part.map(() => "(season = ? AND code = ?)").join(" OR ")}`, part.flatMap((k) => { const [s, c] = k.split("/"); return [Number(s), c]; }));
    for (const r of rows) events.add(`${r.season}/${r.code}`);
  }
  const at = new Date(now).toISOString();
  const writes: { sql: string; args: (string | number | null)[] }[] = [];
  let skipped = 0, waiting = 0;
  const byEvent = new Map<string, OfficialVideo[]>();
  for (const v of todo) if (events.has(`${v.season}/${v.code}`)) (byEvent.get(`${v.season}/${v.code}`) ?? byEvent.set(`${v.season}/${v.code}`, []).get(`${v.season}/${v.code}`)!).push(v); else skipped++;
  for (const vs of byEvent.values()) {
    const has = vs.some((v) => v.kind === "recording") ? await eventVideosByDay(vs[0].season, vs[0].code) : [];
    // A video the event plays whose timing isn't read yet (the backfill runs after this): its day can't be told, so the
    // event's recordings wait for a later run rather than risk a second video for one day.
    const unknown = has.some((h) => !h.timed);
    for (const v of vs) {
      if (v.kind === "recording" && unknown && !has.some((h) => h.videoId === v.videoId)) { waiting++; continue; }
      if (v.kind === "recording" && has.some((h) => h.videoId === v.videoId || (h.day && h.day === v.day && (h.part ?? null) === (v.part ?? null)))) { skipped++; continue; }
      writes.push({
        sql: `INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'list', ?, ?, NULL) ON CONFLICT(video_id) DO NOTHING`,
        args: [v.videoId, v.season, v.code, v.kind, v.day ?? null, v.part ?? null, v.channelId, v.title.slice(0, 300), `checked list: ${data.channels[v.channelId] ?? v.channelId}`, at],
      });
    }
  }
  for (let i = 0; i < writes.length; i += 100) await db().batch(writes.slice(i, i + 100), "write");
  if (writes.length) forgetOfficial();
  // Done for this process unless some wait on a video's timing: then again on the next run, after the backfill.
  seeded = waiting === 0;
  if (writes.length || waiting !== waitingWas) log(`official videos: ${writes.length} added from the checked list${skipped ? `, ${skipped} skipped (event not here or already has that day)` : ""}${waiting ? `, ${waiting} waiting for a video's timing` : ""}`);
  waitingWas = waiting;
  return writes.length;
}
