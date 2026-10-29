// Event live streams (migration 34, src/shared/stream.ts): the owner sets one per event in the owner portal;
// the event page plays it and the events list marks a live event that has one. Reads are one indexed row
// (or one small season list), cached for 30 s; a save or removal drops this server's cache at once (another
// server, or a browser holding a non-live event's page, catches up within its own cache time).
import { all, get, readThenWrite } from "../db.js";
import { registerCache } from "../caches.js";
import { parseStreamUrl, embedUrl } from "../../src/shared/stream.js";
import type { EventStream, OwnerStreamRow } from "../../src/shared/api.js";

const TTL_MS = 30_000;
let bySeason = new Map<number, { at: number; v: Promise<Map<string, EventStream>> }>();
registerCache("Event streams", () => { bySeason = new Map(); });

/** Every stream set in a season, by event code (a few dozen at most). */
export function seasonStreams(season: number, now = Date.now()): Promise<Map<string, EventStream>> {
  const hit = bySeason.get(season);
  if (hit && now - hit.at < TTL_MS) return hit.v;
  const v = all<{ code: string; video_id: string }>("SELECT code, video_id FROM event_streams WHERE season = ?", [season])
    .then((rows) => new Map(rows.map((r) => [String(r.code), { videoId: String(r.video_id), streamUrl: embedUrl(String(r.video_id)) }])));
  bySeason.set(season, { at: now, v });
  v.catch(() => { if (bySeason.get(season)?.v === v) bySeason.delete(season); });
  return v;
}

export async function eventStream(season: number, code: string): Promise<EventStream | null> {
  return (await seasonStreams(season)).get(code) ?? null;
}

export class StreamError extends Error {}

/** Set (or with an empty url, remove) an event's stream. Throws StreamError for an unknown event or a link that can't be used. */
/** Set (or, with an empty url, remove) an event's stream. `was`: the video it replaced, read in the same transaction. */
export async function setEventStream(season: number, code: string, url: string, by: string): Promise<{ stream: EventStream | null; was: string | null }> {
  const ev = await get("SELECT 1 FROM events WHERE season = ? AND code = ?", [season, code]);
  if (!ev) throw new StreamError(`No event ${code} in ${season}`);
  const read = { sql: "SELECT video_id FROM event_streams WHERE season = ? AND code = ?", args: [season, code] };
  if (!url.trim()) {
    const { before } = await readThenWrite<{ video_id: string }>(read, [{ sql: "DELETE FROM event_streams WHERE season = ? AND code = ?", args: [season, code] }]);
    bySeason.delete(season);
    return { stream: null, was: before?.video_id ?? null };
  }
  const p = parseStreamUrl(url);
  if (!p.ok) throw new StreamError(p.error);
  const { before } = await readThenWrite<{ video_id: string }>(read, [{
    sql: `INSERT INTO event_streams (season, code, url, video_id, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(season, code) DO UPDATE SET url = excluded.url, video_id = excluded.video_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    // Stored as a full link to the video (what was pasted may lack its https://), so the owner's list links to YouTube.
    args: [season, code, `https://www.youtube.com/watch?v=${p.videoId}`, p.videoId, new Date().toISOString(), by],
  }]);
  bySeason.delete(season);
  return { stream: { videoId: p.videoId, streamUrl: p.embedUrl }, was: before?.video_id ?? null };
}

/** The owner portal's list: every event with a stream, newest events first, with its name and dates. */
export async function listStreams(): Promise<OwnerStreamRow[]> {
  const rows = await all<any>(
    `SELECT s.season, s.code, s.url, s.video_id, s.updated_at, e.name, e.start, e.end FROM event_streams s
     LEFT JOIN events e ON e.season = s.season AND e.code = s.code ORDER BY e.start DESC, s.code LIMIT 500`);
  return rows.map((r) => ({ season: Number(r.season), code: String(r.code), name: r.name ?? null, start: r.start ?? null, end: r.end ?? null, url: String(r.url), videoId: String(r.video_id), updatedAt: String(r.updated_at) }));
}
