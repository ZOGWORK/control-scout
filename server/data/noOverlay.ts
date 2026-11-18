// Recordings that show no match overlay at all: no score bar, no timer, no match name on any frame (a camera on the
// field, nothing drawn over it). No frame read can place their matches, and nothing else times them (an upload has no
// broadcast clock), so each of their matches without a clip is settled with this reason (coverage.ts UNPLAYABLE) rather
// than counted as missing. A recording joins only once its frames were looked at: `checked` is that day, `seen` what
// they showed. A frame read finding nothing is not enough on its own: a stream whose overlay its read misses
// (USMOKSKNM1 2021, read nothing at first, its bar there all along) looks the same to it.
import type { CoverageReason } from "../../src/shared/api.js";

/** `season`: the event's, for whoever reads the list (the video alone identifies the recording). */
export interface NoOverlay { season: number; code: string; videoId: string; checked: string; seen: string }

export const NO_OVERLAY: NoOverlay[] = [
  { season: 2021, code: "CABCVIS1", videoId: "OrQ_Iitlqe8", checked: "2026-11-18", seen: "frames at 1500 s and 3000 s: the field from a fixed camera, no score bar, timer or match name; a full read found no overlay" },
  { season: 2023, code: "USNDCMP", videoId: "tjhNe5UdwY8", checked: "2026-11-18", seen: "frames at 1800–12000 s and through the qualifications (15500–24300 s): the fields from a fixed camera, no score bar, timer or match name drawn over them, only the venue's field-side timer screens, too small to name a match; a full read found no overlay" },
  { season: 2023, code: "USNDMAQ", videoId: "wk_StZ7htuY", checked: "2026-11-18", seen: "frames at 1800–12000 s and through the qualifications (10500–25500 s): the field from a camera on the floor, no score bar, timer or match name drawn over it; before play it filmed a TV showing test matches and inspection status; the field-side timer screens are too small to name a match; a full read found no overlay" },
];

/** Reasons a recording with no overlay settles: a match it holds that only its frames (or a broadcast clock it hasn't)
 *  could place. A match it doesn't hold keeps its own reason: another day's, between two recordings, or played before
 *  the broadcast or the video starts, after either ends, or outside every recording's time. */
const SETTLES: ReadonlySet<CoverageReason> = new Set<CoverageReason>([
  "no-clock", "gap-unplaced", "unexplained", "overlaps-previous", "before-chapters", "past-chapters", "past-checked",
]);

/** The no-overlay entry that settles a match of `code` left by `reason` in recording `videoId`, or null. By event and
 *  video, as frame rows are kept (server/data/frameTimings.ts): a video is one recording, so its season goes with it. */
export function noOverlayFor(code: string, videoId: string | null, reason: CoverageReason, list: NoOverlay[] = NO_OVERLAY): NoOverlay | null {
  if (!videoId || !SETTLES.has(reason)) return null;
  return list.find((x) => x.code === code && x.videoId === videoId) ?? null;
}
