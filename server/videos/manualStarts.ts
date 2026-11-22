// Match starts the owner types in (Owner › Official videos): "Q12 at 1:42:05" on a video of an event. Stored in
// manual_starts (migration 97) and held in memory by server/data/frameTimings.ts, where they win over a frame read of
// the same match, so the event page, search and the list's Clips badge all play from them at once.
import { all, get, run } from "../db.js";
import { setManualStarts } from "../data/frameTimings.js";
import { clearClipCaches } from "../caches.js";
import { recordAudit } from "../portal/audit.js";
import type { ManualStart } from "../../src/shared/api.js";

/** "1:42:05", "42:05", "6125" or "1h42m5s" → seconds; null when it isn't a time. */
export function parseVideoTime(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  let m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (m) {
    const [h, mm, ss] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
    return m[1] != null && mm > 59 ? null : ss > 59 ? null : h * 3600 + mm * 60 + ss;
  }
  m = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/.exec(t);
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return null;
}

/** Every typed start into memory (at boot, and after each change). */
export async function loadManualStarts(): Promise<number> {
  // Only a video still on its event: one taken off (removeOfficial) keeps its rows on record but plays none.
  const rows = await all<{ video_id: string; code: string; label: string; seconds: number }>(
    `SELECT m.video_id, m.code, m.label, m.seconds FROM manual_starts m
     WHERE EXISTS (SELECT 1 FROM official_videos o WHERE o.video_id = m.video_id AND o.season = m.season AND o.code = m.code AND o.removed_at IS NULL)`);
  setManualStarts(rows.map((r) => ({ videoId: String(r.video_id), code: String(r.code), label: String(r.label), seconds: Number(r.seconds) })));
  return rows.length;
}

/** A video's typed starts for an event, in the order typed into the video. */
export async function manualStarts(videoId: string, season: number, code: string): Promise<ManualStart[]> {
  const rows = await all<{ label: string; seconds: number; set_by: string; set_at: string }>(
    "SELECT label, seconds, set_by, set_at FROM manual_starts WHERE video_id = ? AND season = ? AND code = ? ORDER BY seconds", [videoId, season, code]);
  return rows.map((r) => ({ label: String(r.label), seconds: Number(r.seconds), setBy: String(r.set_by), setAt: String(r.set_at) }));
}

type Out = { ok: true; starts: ManualStart[] } | { ok: false; error: string };

/** Saves (or replaces) one match's start: the match must be one of the event's, the time a time. */
export async function setManualStart(videoId: string, body: { season?: unknown; code?: unknown; label?: unknown; at?: unknown }, actor: string, now = Date.now()): Promise<Out> {
  const season = Number(body.season), code = String(body.code ?? "").trim().toUpperCase(), label = String(body.label ?? "").trim().toUpperCase();
  if (!Number.isInteger(season) || !code) return { ok: false, error: "Pick the event first." };
  const on = await get("SELECT 1 FROM official_videos WHERE video_id = ? AND season = ? AND code = ? AND removed_at IS NULL", [videoId, season, code]);
  if (!on) return { ok: false, error: `This video isn't on ${season} ${code}.` };
  const seconds = parseVideoTime(String(body.at ?? ""));
  if (seconds == null) return { ok: false, error: "Type the time as 1:42:05, 42:05 or seconds." };
  const match = await get<{ label: string }>("SELECT label FROM matches WHERE season = ? AND code = ? AND UPPER(label) = ?", [season, code, label]);
  if (!match) return { ok: false, error: `${label || "That match"} isn't one of ${code}'s matches (Q12, M3, F1 …).` };
  const meta = await get<{ duration: number | null }>("SELECT duration FROM video_meta WHERE video_id = ?", [videoId]).catch(() => undefined);
  if (meta?.duration && seconds > Number(meta.duration)) return { ok: false, error: "That's past the end of the video." };
  await run(`INSERT INTO manual_starts (video_id, season, code, label, seconds, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (video_id, season, code, label) DO UPDATE SET seconds = excluded.seconds, set_by = excluded.set_by, set_at = excluded.set_at`,
  [videoId, season, code, String(match.label), seconds, actor, new Date(now).toISOString()]);
  await recordAudit(actor, "officialVideo.manualStart", { videoId, season, code, label: String(match.label), seconds });
  await loadManualStarts();
  clearClipCaches();
  return { ok: true, starts: await manualStarts(videoId, season, code) };
}

export async function deleteManualStart(videoId: string, body: { season?: unknown; code?: unknown; label?: unknown }, actor: string): Promise<Out> {
  const season = Number(body.season), code = String(body.code ?? "").trim().toUpperCase(), label = String(body.label ?? "").trim();
  if (!Number.isInteger(season) || !code || !label) return { ok: false, error: "Not a typed start." };
  const n = await run("DELETE FROM manual_starts WHERE video_id = ? AND season = ? AND code = ? AND label = ?", [videoId, season, code, label]);
  if (!n) return { ok: false, error: "Not a typed start." };
  await recordAudit(actor, "officialVideo.manualStartRemoved", { videoId, season, code, label });
  await loadManualStarts();
  clearClipCaches();
  return { ok: true, starts: await manualStarts(videoId, season, code) };
}
