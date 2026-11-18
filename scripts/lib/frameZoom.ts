// Recordings whose producer drew FTC Live's screen small, in a box over the camera picture (picture in picture), not
// over the whole frame. Every crop the frame reader has is for the full-frame screen, so on these none finds the bar.
// For a listed video the reader's player scales its picture up until the box fills the frame (zoomCss), and every read
// runs on that as on any other recording. A recording joins once its box was measured on a frame: `box` is its place
// in the 1280×720 player (x, y, width, height), `shift` moves the zoomed picture down so the bar sits where the reader's
// bottom-bar crops look, `checked` is the day, `seen` what the zoomed frame showed.

export interface CornerBox { season: number; code: string; videoId: string; box: [number, number, number, number]; shift: number; checked: string; seen: string }

export const CORNER_BOXES: CornerBox[] = [
  { season: 2025, code: "USCOFRQ", videoId: "w36Zw_uqfms", box: [877, 418, 403, 302], shift: 120, checked: "2026-11-18", seen: "box at the bottom right over the field camera; zoomed at 5000 s: field timer 2:02 and the bar \"Mountain Qualifier | Qualification 2 of 18\", teams 25158 16629 / 21818 5196" },
];

/** The listed box of a video, or null. */
export const cornerBox = (videoId: string, list: CornerBox[] = CORNER_BOXES): CornerBox | null => list.find((b) => b.videoId === videoId) ?? null;

/** The style that scales a player's video so `box` fills the width of a `width`×`height` frame, its bottom edge `shift`
 *  px below the frame's bottom edge: the box's left edge at the frame's, scaled by width / box width. */
export function zoomCss(box: [number, number, number, number], shift: number, width = 1280, height = 720): string {
  const [x, y, w, h] = box;
  if (!(w > 0 && h > 0)) throw new Error(`a box needs a width and a height (${box.join(", ")})`);
  const s = width / w;
  const dx = -x * s, dy = height - (y + h) * s + shift;
  return `video { transform-origin: 0 0 !important; transform: translate(${+dx.toFixed(2)}px, ${+dy.toFixed(2)}px) scale(${+s.toFixed(5)}) !important; }`;
}
