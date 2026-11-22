// A match's own picture inside an event's recording: a frame from YouTube's storyboard (the sprite sheets of small frames
// the player shows when you hover its timeline), so a grid of clips cut from one long stream shows each match, not the
// stream's one thumbnail five times. The sheets are public images on i.ytimg.com, but each needs the video's signed
// spec, which only the watch page carries, and YouTube shows data-centre addresses a bot check instead of it (the VM,
// #1445). So the spec is read at home (scripts/storyboards.ts, run by the clip autopilot: docs/clip-autopilot.md) and
// handed over through the auto-reads inbox as `{ kind: "storyboards", rows: [{ videoId, spec }] }` (./autoReads.ts),
// kept in video_storyboards. Search reads the specs (cached) and names one tile of one sheet per clip (`stillAt`); the
// page crops it. No spec, or a sheet that won't load: the video's own thumbnail, as before.
import { all, run } from "../db.js";
import { CLIP_LEAD_S } from "../../src/shared/recording.js";
import type { SearchVideoItem } from "../../src/shared/api.js";

/** One storyboard level: frame size, frame count, tiles per sheet (cols × rows), ms between frames, sheet name, signature. */
export interface StoryLevel { level: number; w: number; h: number; count: number; cols: number; rows: number; ms: number; name: string; sigh: string }
export interface Storyboard { base: string; levels: StoryLevel[] }

const ID = /^[A-Za-z0-9_-]{11}$/;

/** A watch page's storyboard spec ("<url template>|w#h#count#cols#rows#ms#name#sigh|…") → its levels, or null when it
 *  isn't one for this video (only i.ytimg.com sheets of this video id are ever served). */
export function parseSpec(videoId: string, spec: string): Storyboard | null {
  if (!ID.test(videoId) || typeof spec !== "string" || spec.length > 4000) return null;
  const [base, ...parts] = spec.replace(/\\u0026/g, "&").split("|");
  if (!base?.startsWith(`https://i.ytimg.com/sb/${videoId}/`) || !base.includes("$L") || !base.includes("$N")) return null;
  const levels: StoryLevel[] = [];
  parts.forEach((p, level) => {
    const f = p.split("#");
    if (f.length < 8) return;
    const [w, h, count, cols, rows, ms] = f.slice(0, 6).map(Number);
    const name = f[6], sigh = f[7];
    if (![w, h, count, cols, rows, ms].every((x) => Number.isInteger(x) && x >= 0) || !cols || !rows || !count || !/^[\w$-]+$/.test(name) || !/^[\w$=-]*$/.test(sigh)) return;
    levels.push({ level, w, h, count, cols, rows, ms, name, sigh });
  });
  return levels.some((l) => l.ms > 0) ? { base, levels } : null;
}

/** The tile showing second `s` of the video: its sheet's URL and the tile's place in that sheet (`cols` × `rows` as the
 *  sheet is drawn: a last sheet holds only the frames left). The largest level with timed frames; null past its end. */
export function stillAt(sb: Storyboard, s: number): NonNullable<SearchVideoItem["still"]> | null {
  const l = [...sb.levels].filter((x) => x.ms > 0).sort((a, b) => b.w - a.w)[0];
  if (!l || !(s >= 0)) return null;
  const i = Math.floor((s * 1000) / l.ms);
  if (i >= l.count) return null;
  const per = l.cols * l.rows, sheet = Math.floor(i / per), at = i % per;
  const left = l.count - sheet * per;
  const cols = left >= l.cols ? l.cols : left, rows = Math.min(l.rows, Math.ceil(left / l.cols));
  const src = `${sb.base.replace("$L", String(l.level)).replace("$N", l.name.replace("$M", String(sheet)))}${l.sigh ? `${sb.base.includes("?") ? "&" : "?"}sigh=${encodeURIComponent(l.sigh)}` : ""}`;
  return { src, col: at % l.cols, row: Math.floor(at / l.cols), cols, rows };
}

/** Seconds into a clip its picture is taken at: past the lead-in, half a minute into the match (the field mid-play). */
export const STILL_INTO_S = CLIP_LEAD_S + 30;

/** One delivery of specs read at home. */
export interface StoryboardDelivery { kind: "storyboards"; rows: { videoId: string; spec: string }[]; source?: string }
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
export const isStoryboardDelivery = (d: unknown): boolean => isObj(d) && d.kind === "storyboards";
/** Why a parsed storyboards file isn't a delivery (null: it is). */
export function storyboardShape(d: unknown): string | null {
  if (!isObj(d) || d.kind !== "storyboards") return "not a storyboards delivery";
  if (!Array.isArray(d.rows)) return "no rows";
  if (d.rows.length > 2000) return `${d.rows.length} rows, over 2000`;
  return null;
}

/** Keeps each row whose spec parses for its video (a later read replaces an earlier one); the rest are dropped. */
export async function applyStoryboards(d: StoryboardDelivery, now = Date.now()): Promise<{ kept: number; dropped: number }> {
  const at = new Date(now).toISOString();
  let kept = 0, dropped = 0;
  for (const r of d.rows) {
    if (!isObj(r) || typeof r.videoId !== "string" || typeof r.spec !== "string" || !parseSpec(r.videoId, r.spec)) { dropped++; continue; }
    await run(`INSERT INTO video_storyboards (video_id, spec, read_at) VALUES (?, ?, ?)
      ON CONFLICT (video_id) DO UPDATE SET spec = excluded.spec, read_at = excluded.read_at`, [r.videoId, r.spec, at]);
    cache.delete(r.videoId);
    kept++;
  }
  return { kept, dropped };
}

const TTL_MS = 10 * 60_000, MAX = 2000;
let cache = new Map<string, { at: number; sb: Storyboard | null }>();
export const forgetStoryboards = () => { cache = new Map(); };

/** The storyboards on hand for these videos (cached 10 minutes, a missing one too). A failed read: none. */
export async function storyboards(ids: string[], now = Date.now()): Promise<Map<string, Storyboard>> {
  const out = new Map<string, Storyboard>();
  const need = [...new Set(ids)].filter((id) => {
    const hit = cache.get(id);
    if (hit && now - hit.at < TTL_MS) { if (hit.sb) out.set(id, hit.sb); return false; }
    return ID.test(id);
  });
  for (let i = 0; i < need.length; i += 200) {
    const part = need.slice(i, i + 200);
    const rows = await all<{ video_id: string; spec: string }>(`SELECT video_id, spec FROM video_storyboards WHERE video_id IN (${part.map(() => "?").join(",")})`, part).catch(() => null);
    if (!rows) return out;
    const got = new Map(rows.map((r) => [String(r.video_id), parseSpec(String(r.video_id), String(r.spec))]));
    for (const id of part) {
      const sb = got.get(id) ?? null;
      cache.set(id, { at: now, sb });
      if (sb) out.set(id, sb);
    }
  }
  if (cache.size > MAX) cache = new Map([...cache].slice(-MAX));
  return out;
}

/** Each clip cut from a recording gets its own picture (`still`): the frame STILL_INTO_S into it. A match's own video
 *  keeps its thumbnail (it already is that match). */
export async function withStills(items: SearchVideoItem[], now = Date.now()): Promise<void> {
  const cut = items.filter((v) => v.kind === "recording");
  if (!cut.length) return;
  const sbs = await storyboards(cut.map((v) => v.videoId), now).catch(() => new Map<string, Storyboard>());
  for (const v of cut) {
    const sb = sbs.get(v.videoId);
    const s = sb ? stillAt(sb, v.t + STILL_INTO_S) : null;
    if (s) v.still = s;
  }
}
