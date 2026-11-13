// Where each match starts in an event recording, read off the recording's own frames (scripts/video-frames.ts): FTC
// Live's overlay names the match being played and runs its timer, so one frame gives the second the match started at.
// For recordings YouTube's facts can't place matches in (src/shared/recording.ts timingTrusted): a video shorter than
// its broadcast (a stream stopped over lunch, a tail or a start cut), or an upload with no broadcast clock.
//
// `starts`: a match (its label) → the second it starts at in the video (its timer's start, not a lead-in). A match is
// here only where a frame showed it being played, or between two such matches that sit the same distance from their
// real starts (a video loses time, never gains it, so nothing was lost between them). Kept per event as well as per
// video: one stream can carry two divisions.

export interface FrameTiming {
  videoId: string;
  /** The event the matches are of. */
  code: string;
  /** The day the frames were read (YYYY-MM-DD). */
  checked: string;
  starts: Record<string, number>;
}

let byKey: Map<string, Record<string, number>> | null = null;

/** The second a match starts at in a video, from its frames, or null when they weren't read for it. */
export function frameStart(videoId: string, code: string, label: string): number | null {
  byKey ??= new Map(FRAME_TIMINGS.map((f) => [`${f.videoId}|${f.code}`, f.starts]));
  return byKey.get(`${videoId}|${code}`)?.[label] ?? null;
}

/** Whether any of a video's matches for an event were read from its frames. */
export function hasFrames(videoId: string, code: string): boolean {
  byKey ??= new Map(FRAME_TIMINGS.map((f) => [`${f.videoId}|${f.code}`, f.starts]));
  return byKey.has(`${videoId}|${code}`);
}

/** Tests only: these timings in place of the file's. */
export function setFrameTimingsForTests(list: FrameTiming[]) {
  FRAME_TIMINGS.splice(0, FRAME_TIMINGS.length, ...list);
  byKey = null;
}

// --- Data (scripts/video-frames.ts writes from here on) ---
export const FRAME_TIMINGS: FrameTiming[] = [];
