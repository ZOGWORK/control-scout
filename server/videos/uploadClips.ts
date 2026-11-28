// The per-match uploads that play (./matchUploads.ts decides them; migration 123), held in memory like the owner's typed
// starts: loaded at boot and after every change. Only an added upload not taken off, whose video the channel audit last
// read as public, playable here and still on its channel. Every surface that plays a clip lays these over its matches
// (withUploads): a match nothing else clips plays its upload, from its start to its end. Kept apart from the deciding
// (which reads the watcher's events) so the recordings code can read it without the watcher.
import { all } from "../db.js";
import { watchUrl } from "../../src/shared/recording.js";
import type { MatchClip, MatchView } from "../../src/shared/api.js";


type Clip = Pick<MatchClip, "videoId" | "t" | "end"> & { level: string; series: number; number: number };
let playing = new Map<string, Clip>();
const keyOf = (season: number, code: string, label: string) => `${season}|${code}|${label}`;
/** The clips held in memory (loadMatchUploads; tests). end: the video's length. */
export function setMatchUploads(rows: { season: number; code: string; label: string; level: string; series: number; number: number; videoId: string; t: number; end: number | null }[]) {
  playing = new Map(rows.map((r) => [keyOf(r.season, r.code, r.label), { videoId: r.videoId, t: r.t, level: r.level, series: r.series, number: r.number, ...(r.end != null && r.end > r.t ? { end: r.end } : {}) }]));
}

/** Every added upload that plays, into memory (at boot, and after each change). */
export async function loadMatchUploads(): Promise<number> {
  const rows = await all<{ season: number; code: string; label: string; level: string; series: number; number: number; video_id: string; t: number; duration: number | null }>(
    `SELECT u.season, u.code, u.label, u.level, u.series, u.number, u.video_id, u.t, a.duration FROM match_uploads u JOIN official_audit_videos a ON a.video_id = u.video_id
     WHERE u.status = 'added' AND u.removed_at IS NULL AND a.gone_at IS NULL AND a.privacy = 'public' AND COALESCE(a.embeddable, 1) != 0 AND COALESCE(a.blocked_in, 0) < 50`);
  setMatchUploads(rows.map((r) => ({ season: Number(r.season), code: String(r.code), label: String(r.label), level: String(r.level), series: Number(r.series), number: Number(r.number), videoId: String(r.video_id), t: Number(r.t ?? 0), end: r.duration == null ? null : Number(r.duration) })));
  return rows.length;
}

const playingNow = () => [...playing].map(([k, c]) => `${k} ${c.videoId} ${c.t} ${c.end ?? ""}`).sort().join("\n");
/** After each channel audit: loads again, since the audit may have read an added upload as private, unplayable here or
 *  gone. True when what plays changed (the caller clears the clip caches and checks coverage again). */
export async function refreshMatchUploads(): Promise<boolean> {
  const before = playingNow();
  await loadMatchUploads();
  return playingNow() !== before;
}

/** A match's upload clip, if it has one. */
export function uploadClip(season: number, code: string, label: string): MatchClip | null {
  const c = playing.get(keyOf(season, code, label));
  return c ? { videoId: c.videoId, t: c.t, url: watchUrl(c.videoId, c.t), ...(c.end != null ? { end: c.end } : {}) } : null;
}

/** Every match of a season an upload plays, with its video. */
export function uploadMatches(season: number): { code: string; label: string; level: string; series: number; number: number; videoId: string }[] {
  const out: { code: string; label: string; level: string; series: number; number: number; videoId: string }[] = [];
  for (const [k, c] of playing) {
    const [s, code, ...rest] = k.split("|");
    if (Number(s) === season) out.push({ code, label: rest.join("|"), level: c.level, series: c.series, number: c.number, videoId: c.videoId });
  }
  return out;
}

/** The matches with a played match's upload as its clip where it has none; the given objects are never changed. */
export function withUploads<M extends Pick<MatchView, "label" | "played" | "clip">>(matches: M[], season: number, code: string): M[] {
  if (!playing.size) return matches;
  let changed = false;
  const out = matches.map((x) => {
    if (x.clip || !x.played) return x;
    const c = uploadClip(season, code, x.label);
    if (!c) return x;
    changed = true;
    return { ...x, clip: c };
  });
  return changed ? out : matches;
}
