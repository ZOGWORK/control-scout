// Recordings whose producer drew FTC Live's screen small, in a box over the camera picture (picture in picture), not
// over the whole frame. Every crop the frame reader has is for the full-frame screen, so on these none finds the bar.
// For a listed video the reader's player scales its picture up until the box fills the frame (zoomCss), and every read
// runs on that as on any other recording. A recording joins once its box was measured on a frame: `box` is its place
// in the 1280×720 player (x, y, width, height), `shift` moves the zoomed picture down so the bar sits where the reader's
// bottom-bar crops look, `checked` is the day, `seen` what the zoomed frame showed. `part`, where the box holds
// FTC Live's screen for only part of the recording (its first and last second): the video is read as it is, full size,
// and the matches that read leaves without a start in a row are read again zoomed to the box (scripts/video-frames.ts).

export interface CornerBox { season: number; code: string; videoId: string; box: [number, number, number, number]; shift: number; checked: string; seen: string; part?: [number, number] }

export const CORNER_BOXES: CornerBox[] = [
  { season: 2025, code: "USCOFRQ", videoId: "w36Zw_uqfms", box: [877, 418, 403, 302], shift: 120, checked: "2026-11-18", seen: "box at the bottom right over the field camera; zoomed at 5000 s: field timer 2:02 and the bar \"Mountain Qualifier | Qualification 2 of 18\", teams 25158 16629 / 21818 5196" },
  { season: 2025, code: "USNDBIQ", videoId: "rLKw84eo9cQ", box: [859, 483, 421, 237], shift: 0, part: [0, 7200], checked: "2026-11-28", seen: "FTC Live's whole screen at a third in the bottom-right box over the camera until Q11 (full size from 7252 s): at 3650 s the Field 1 timer 2:01 over the bar \"Dakota FTC Bismarck Qualifier | Qualification 4 of 23\", teams 16127 26907 / 28100 22411; at 3760 s 0:19" },
];

/** The listed box of a video, or null. A box with a `part` zooms only the stretch read again for it (wholeBox: none). */
export const cornerBox = (videoId: string, list: CornerBox[] = CORNER_BOXES): CornerBox | null => list.find((b) => b.videoId === videoId) ?? null;
/** Whether a stretch of the video (from–to s) reaches into a box's `part`: a stretch wholly outside it holds no frame
 *  the box is on, so it's never read zoomed to the box. */
export const reachesPart = (from: number, to: number, part: readonly [number, number]): boolean => from < part[1] && to > part[0];
/** The starts a read through a part box placed (in `after`, not in `before`) outside the box's `part`: where the box
 *  isn't on screen a zoomed frame shows the camera, never FTC Live's screen, so such a start isn't the box's. */
export function outsidePart(before: ReadonlyMap<string, { t: number }>, after: ReadonlyMap<string, { t: number }>, part: readonly [number, number]): string[] {
  return [...after].filter(([l, p]) => !before.has(l) && (p.t < part[0] || p.t > part[1])).map(([l]) => l);
}
/** The listed box a video's every read is zoomed to: one without a `part`, or null. */
export const wholeBox = (videoId: string, list: CornerBox[] = CORNER_BOXES): CornerBox | null => { const b = cornerBox(videoId, list); return b && !b.part ? b : null; };

/** The style that scales a player's video so `box` fills the width of a `width`×`height` frame, its bottom edge `shift`
 *  px below the frame's bottom edge: the box's left edge at the frame's, scaled by width / box width. */
export function zoomCss(box: [number, number, number, number], shift: number, width = 1280, height = 720): string {
  const [x, y, w, h] = box;
  if (!(w > 0 && h > 0)) throw new Error(`a box needs a width and a height (${box.join(", ")})`);
  const s = width / w;
  const dx = -x * s, dy = height - (y + h) * s + shift;
  return `video { transform-origin: 0 0 !important; transform: translate(${+dx.toFixed(2)}px, ${+dy.toFixed(2)}px) scale(${+s.toFixed(5)}) !important; }`;
}

/** The fewest sampled frames that must find a shrunk bar in the same place (foundBox) before the player is zoomed to it. */
export const FOUND_MIN = 3;
/** A bottom bar's lowest row, where a found bar's is zoomed to (foundBox): 4 px up, as FTC Live draws its own. */
export const BAR_FLOOR = 716;

/**
 * A box for zoomCss from where overlayBar found a shrunk score bar on several sampled frames (null: none found on that
 * frame), for a recording not in CORNER_BOXES. Taken where at least FOUND_MIN frames agree, its ends and bottom row
 * each within 2% of the frame of the first such frame's: a results screen's halves (blue, the QR code's white, red) or
 * a stray patch of crowd can give a bar too, but not in the same place as the bar of most frames. The box is the bar's
 * ends and rows (their medians over those frames); `shift` puts the bar's bottom row at BAR_FLOOR, so zoomed it sits
 * where a full-size bottom bar does: the row over it (the event and the match) at the label row's place, the timer in
 * the bottom crops'. Null: no FOUND_MIN frames agree.
 */
export function foundBox(found: readonly ({ x0: number; x1: number; top: number; bottom: number } | null)[], width = 1280, height = 720): { box: [number, number, number, number]; shift: number } | null {
  const bars = found.filter((b): b is { x0: number; x1: number; top: number; bottom: number } => b != null);
  const nearX = width * 0.02, nearY = height * 0.02;
  let best: typeof bars = [];
  for (const a of bars) {
    const like = bars.filter((b) => Math.abs(b.x0 - a.x0) <= nearX && Math.abs(b.x1 - a.x1) <= nearX && Math.abs(b.bottom - a.bottom) <= nearY);
    if (like.length > best.length) best = like;
  }
  if (best.length < FOUND_MIN) return null;
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
  const x0 = median(best.map((b) => b.x0)), x1 = median(best.map((b) => b.x1));
  const top = median(best.map((b) => b.top)), bottom = median(best.map((b) => b.bottom));
  return { box: [x0, top, x1 - x0, bottom - top], shift: BAR_FLOOR - height };
}

/**
 * Each sampled frame's find (`read` at each of `times`, in turn), a frame whose read failed (a refused seek, a failed
 * screenshot, a read over its limit) counted as finding nothing: one bad frame mustn't throw away the others' votes,
 * where foundBox needs only FOUND_MIN of them. An error `stops` says ends the event (the reader's EventOverTime) is
 * thrown on, as anywhere else.
 */
export async function sampleFinds<T>(times: readonly number[], read: (t: number) => Promise<T | null>, stops: (e: unknown) => boolean): Promise<(T | null)[]> {
  const out: (T | null)[] = [];
  for (const t of times) {
    try { out.push(await read(t)); } catch (e) { if (stops(e)) throw e; out.push(null); }
  }
  return out;
}
