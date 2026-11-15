// What a clock clip's first frame says about it (scripts/video-frames.ts --clock, server/data/clipChecks.ts). Owner
// decision 2026-11-15: only an overlay naming a different match pulls a clip; a frame that names nothing (blank, a
// transition, a cutaway, the player still buffering) leaves it live, to be read again.

/** One read of a clip's first frame: the match its overlay names, and whether that overlay is another division's. */
export interface OpeningRead { label: string | null; division?: "own" | "other" | null }

export type OpeningVerdict = { state: "ok" } | { state: "pulled"; showed: string } | { state: "unconfirmed"; why: string };

/** Seconds after a clip's start its first frame is read at, in turn: the first read naming a match decides. The later
 *  ones only stand in for a frame that read nothing (a seek still buffering), never for one naming another match. */
export const FIRST_FRAME_AT = [0, 2, 4];

export const NO_OVERLAY_AT_START = "no overlay at its first frame";

/** The verdict on a clip from the reads of its first frame (FIRST_FRAME_AT order). */
export function openingVerdict(label: string, reads: OpeningRead[]): OpeningVerdict {
  for (const r of reads) {
    if (r.division === "other") return { state: "pulled", showed: r.label ? `another division's ${r.label}` : "another division's match" };
    if (!r.label) continue;
    return r.label === label ? { state: "ok" } : { state: "pulled", showed: r.label };
  }
  return { state: "unconfirmed", why: NO_OVERLAY_AT_START };
}

/** At least this many clips of a video read, none of them naming any match: the video's overlay can't be read
 *  (an older season's layout, a camera-only stream), so it can't be checked by frame. */
export const NO_OVERLAY_MIN = 3;

/** Whether a video's clips can't be checked by frame: enough of them read, and not one named a match. */
export function noOverlay(verdicts: OpeningVerdict[]): boolean {
  return verdicts.length >= NO_OVERLAY_MIN && verdicts.every((v) => v.state === "unconfirmed");
}
