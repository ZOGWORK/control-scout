// The frame reader's clock on a busy machine (scripts/video-frames.ts). Two things go wrong when the CPU is shared
// (a DormLab mini also training models, several players at once):
//   - a seek reports "seeked" and readyState 3 before the player has drawn a frame at the new second, so a screenshot
//     taken a fixed 900 ms later can still show the frame from before the seek (the last read's match, seconds or
//     minutes away);
//   - a timer read's OCR takes seconds, and the video's second the reading is placed at was taken after it, so the
//     start it gives comes out late by however long the OCR took, and two readings 1.5 s apart differ by the OCR's
//     own jitter instead of the time played (timerRan's ±1.6 s).
// A fast machine draws the frame inside the 900 ms and OCRs in a fraction of a second, so its reads don't change.

/** A frame the player drew (requestVideoFrameCallback's metadata): its media second and the player's running count. */
export type Drawn = { t: number; n: number };
/** A seek as the page saw it start: the second asked for and the drawn-frame count then. */
export type SeekMark = { t: number; n0: number };

/** Seconds a drawn frame may sit before the second asked for (a frame's own length, and the player landing on the
 *  frame just before a keyframe's exact second). */
export const DRAWN_BEFORE_S = 0.5;
/** Seconds past the time waited a playing video's drawn frame may be (the player runs on while it's waited for). */
export const DRAWN_AFTER_S = 1;

/** Whether a drawn frame is the seek's: drawn after the seek began, at the second asked for (paused: that second; playing:
 *  no further on than the time waited). A frame from before the seek fails the count; one from a seek elsewhere (an
 *  earlier stretch further on, or before) fails the second. */
export function drawnAt(f: Drawn | null | undefined, seek: SeekMark, waitedS: number, still: boolean, before = DRAWN_BEFORE_S, after = DRAWN_AFTER_S): boolean {
  if (!f || f.n <= seek.n0) return false;
  const hi = seek.t + (still ? before : waitedS + after);
  return f.t >= seek.t - before && f.t <= hi;
}

/** The video's second a screenshot shows: midway between the player's second just before and just after it was taken
 *  (a screenshot on a busy machine takes a few hundred ms of its own). Read before any OCR runs, so the OCR's time is
 *  never counted as video played. */
export const shotSecond = (before: number, after: number) => (before + after) / 2;

/** Installed in the player page once (by source): keeps the last drawn frame in window.__drawn. Nothing when the
 *  browser has no requestVideoFrameCallback (the seek's wait then falls back to the fixed one alone). */
export const DRAWN_TRACKER = `(() => {
  const v = document.querySelector("video");
  if (!v || v.__drawnTracked || typeof v.requestVideoFrameCallback !== "function") return !!(v && v.__drawnTracked);
  v.__drawnTracked = true;
  window.__drawn = null;
  const tick = (_now, m) => { window.__drawn = { t: m.mediaTime, n: m.presentedFrames }; v.requestVideoFrameCallback(tick); };
  v.requestVideoFrameCallback(tick);
  return true;
})()`;

/** The longest a seek waits for its frame to be drawn, past the fixed 900 ms (seconds). A busy mini draws it within
 *  a few seconds; a player that never draws it (a stretch YouTube won't play) fails the seek's own checks as before. */
export const DRAWN_WAIT_S = 8;

/** Whether a drawn picture is a low-quality step (YouTube's 144p while several players share the connection) of what
 *  this player has shown: under 3/4 of its tallest (of 720p, where it has shown more: 720p reads as well as 1080p),
 *  where that was at least 480p. A player that has never shown more
 *  (a 360p upload) never waits. */
export function lowQuality(height: number, best: number): boolean {
  return best >= 480 && height > 0 && height < Math.min(best, 720) * 0.75;
}
/** The longest a seek waits for a low-quality picture to step back up (seconds); a busy mini steps up in a few. */
export const QUALITY_WAIT_S = 8;
