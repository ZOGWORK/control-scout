// Recordings no frame read can place a match in. Most show no match overlay at all: no score bar, no timer, no match
// name on any frame (a camera on the field, nothing drawn over it). `kind: "stutters"`: the overlay is there but the
// picture holds still, then skips ahead, so its timer never runs and no start can be confirmed (coverage.ts reason
// video-stutters). No frame read can place their matches, and nothing else times them (an upload has no
// broadcast clock), so each of their matches without a clip is settled with this reason (coverage.ts UNPLAYABLE) rather
// than counted as missing. A recording joins only once its frames were looked at: `checked` is that day, `seen` what
// they showed. A frame read finding nothing is not enough on its own: a stream whose overlay its read misses
// (USMOKSKNM1 2021, read nothing at first, its bar there all along) looks the same to it.
// Some have a bar the reader can't use: one with no match name, or one with no running timer (a DECODE bar that hides
// it while a match runs and shows "0:00" only at its end, a POWERPLAY bar whose timer the frame's edge cuts off). Every
// start the reader places is confirmed by a running timer, so their matches can't be placed either; such an entry comes
// off the list if the reader learns to place a start without one.
import type { CoverageReason } from "../../src/shared/api.js";

/** `season`: the event's, for whoever reads the list (the video alone identifies the recording). */
export interface NoOverlay { season: number; code: string; videoId: string; checked: string; seen: string; kind?: "stutters" }

export const NO_OVERLAY: NoOverlay[] = [
  { season: 2021, code: "USCANOSCQ", videoId: "eXfH6cxEfwE", kind: "stutters", checked: "2026-11-18", seen: "playing frames 2.5 s apart: the overlay timer jumps 30 to 74 at 1500 s and 12 to 65 at 2400 s, the picture held in between; every qual read shows a timer that doesn't run, so no qual start can be confirmed (its playoffs M2-2, F1 and F2 were placed)" },
  { season: 2021, code: "CABCVIS1", videoId: "OrQ_Iitlqe8", checked: "2026-11-18", seen: "frames at 1500 s and 3000 s: the field from a fixed camera, no score bar, timer or match name; a full read found no overlay" },
  { season: 2022, code: "USTXNOULM3", videoId: "Qy2x3LmYmhw", checked: "2026-11-27", seen: "the POWERPLAY bar names the match, but sits so low that the frame's bottom edge cuts its timer box in half (2430–2440 s, 7840 s), so no timer reads; a full read found no overlay in 125 frames, twice" },
  { season: 2023, code: "USNDCMP", videoId: "tjhNe5UdwY8", checked: "2026-11-18", seen: "frames at 1800–12000 s and through the qualifications (15500–24300 s): the fields from a fixed camera, no score bar, timer or match name drawn over them, only the venue's field-side timer screens, too small to name a match; a full read found no overlay" },
  { season: 2023, code: "USNDMAQ", videoId: "wk_StZ7htuY", checked: "2026-11-18", seen: "frames at 1800–12000 s and through the qualifications (10500–25500 s): the field from a camera on the floor, no score bar, timer or match name drawn over it; before play it filmed a TV showing test matches and inspection status; the field-side timer screens are too small to name a match; a full read found no overlay" },
  { season: 2024, code: "USCALACAS", videoId: "jgRLlw92hAk", checked: "2026-11-27", seen: "frames at 600, 2400, 4500 and 6500 s: a camera over the field, nothing drawn on it during play; between matches only full-screen Up Next and results cards (2100 s, 2190 s), which name a match but have no timer; a full read found no overlay in 25 frames, twice" },
  { season: 2024, code: "USHIHI24M5", videoId: "Tnai70TlF2E", checked: "2026-11-27", seen: "during play a small bar at the bottom with teams, scores and the timer (0:25 at 3004 s) but no match name; the name shows only on a full-screen card before each match (\"Qualification 12 of 17\" at 2:30, 6460 s) and a lower third between them; six frames from 690 s to 7900 s; a full read found no overlay in 23 and 28 frames" },
  { season: 2024, code: "USIATASM1", videoId: "KM9d-jelHM4", checked: "2026-11-27", seen: "frames at 300, 1500, 2000, 6000, 10000 and 10500 s: a camera at the field (a lunch-break slide at 6000 s), no score bar, timer or match name; a full read found no overlay in 21 frames, twice" },
  { season: 2024, code: "USOKOKDVM2", videoId: "HedOy2nlu8Y", checked: "2026-11-27", seen: "six frames from 700 s to 8000 s: a fixed camera over the field, nothing drawn on the stream; only the venue's timer screen behind the field" },
  { season: 2024, code: "USOKOKMYM4", videoId: "jNQS-ds27_A", checked: "2026-11-27", seen: "six frames from 760 s to 8720 s: a camera at the field, nothing drawn on the stream" },
  { season: 2025, code: "ROEM2", videoId: "n8vNZKBdgzw", checked: "2026-11-27", seen: "Q5 played through (16200–16450 s): the DECODE bar names the match and its scores climb (35–71, then 109–128), but it shows no timer while the match runs, only \"0:00\" once it ends (16560 s); a full read found no running timer in 96 frames, twice" },
  { season: 2025, code: "USCALACAS2", videoId: "vGua-Y2ANkA", checked: "2026-11-27", seen: "Q7 played through (4230–4380 s): the DECODE bar names the match and its scores climb (59 to 170), with no timer between them; a full read found no running timer, twice" },
  { season: 2025, code: "USFCTKAQ", videoId: "inTg2y3YymA", checked: "2026-11-27", seen: "frames at 7330 s and 13610 s, and six from 1680 s to 19270 s: a fixed camera on the field from behind the alliance stations, nothing drawn on the stream" },
  { season: 2025, code: "USOKOKDVM1", videoId: "58jTgjgNnVM", checked: "2026-11-18", seen: "frames at 1800 s and 4000 s: a handheld camera at the field, no score bar, timer or match name drawn on the stream; the only match text is the venue's timer screen behind the field" },
  { season: 2025, code: "USOKOKDVM2", videoId: "N826JxMkOJw", checked: "2026-11-18", seen: "frames at 1500 s and 4000 s: a fixed camera on the field, no score bar or match name drawn on the stream; only the field-side timer screen in the scene" },
  { season: 2025, code: "USOKOKHRM1", videoId: "iWor_qAwe3w", checked: "2026-11-18", seen: "frames at 1800 s and 4000 s: a camera at the field, nothing drawn on the stream; the only match text is the venue projector at the back of the room, too small to read" },
  { season: 2025, code: "USOKOKHRM3", videoId: "a-hJWs1qdPk", checked: "2026-11-18", seen: "frames at 1500 s and 4000 s: a phone camera at the field, nothing drawn on the stream; the venue projector behind it shows the audience display" },
  { season: 2025, code: "USOKTUS", videoId: "Dolp4XFMw8o", checked: "2026-11-18", seen: "frames at 1500 s, 4000 s and 5000 s: a fixed camera at Tulsa Robotics Center, no score bar, timer or match name; a full read found no overlay" },
  { season: 2025, code: "USOKTUS3", videoId: "pjlm3mw8GLY", checked: "2026-11-18", seen: "frames at 1500 s and 4000 s: a fixed camera on the field, no overlay; only the field-side timer screen in the scene; a full read found no overlay" },
  { season: 2026, code: "USCANOEBM1", videoId: "fdvPInsQ2mY", checked: "2026-11-27", seen: "a team's stream (Part 1), six frames from 670 s to 7760 s: a camera in the gym, nothing drawn on it; once it films the venue projector's audience display, too blurred to read; a full read found no overlay in 35 frames, twice" },
  { season: 2026, code: "USCANOEBM1", videoId: "44mne4zzkPU", checked: "2026-11-27", seen: "a team's stream (Part 2), six frames from 470 s to 5370 s: a camera in the gym and the team's \"Matches resume shortly\" slide, nothing drawn on play; a full read found no overlay in 20 frames, twice" },
  { season: 2026, code: "USOKOKDVM1", videoId: "gBloQhx9MTo", checked: "2026-11-18", seen: "frames at 1500 s, 2500 s and 4000 s: a phone camera at the field, no score bar, timer or match name drawn on the stream" },
  { season: 2026, code: "USOKOKDVM2", videoId: "6Qh-uraABRw", checked: "2026-11-18", seen: "frames at 1500 s and 4000 s: a camera at the field, no score bar, timer or match name drawn on the stream" },
];

/** Reasons a recording with no overlay settles: a match it holds that only its frames (or a broadcast clock it hasn't)
 *  could place. A match it doesn't hold keeps its own reason: another day's, between two recordings, or played before
 *  the broadcast or the video starts, after either ends, or outside every recording's time. */
const SETTLES: ReadonlySet<CoverageReason> = new Set<CoverageReason>([
  "no-start", "no-clock", "gap-unplaced", "unexplained", "overlaps-previous", "before-chapters", "past-chapters", "past-checked",
]);

/** The reason an entry's matches are settled with: its picture stutters, or it has no overlay at all. */
export const noOverlayReason = (x: NoOverlay): CoverageReason => (x.kind === "stutters" ? "video-stutters" : "video-no-overlay");

/** The no-overlay entry that settles a match of `code` left by `reason` in recording `videoId`, or null. By event and
 *  video, as frame rows are kept (server/data/frameTimings.ts): a video is one recording, so its season goes with it. */
export function noOverlayFor(code: string, videoId: string | null, reason: CoverageReason, list: NoOverlay[] = NO_OVERLAY): NoOverlay | null {
  if (!videoId || !SETTLES.has(reason)) return null;
  return list.find((x) => x.code === code && x.videoId === videoId) ?? null;
}
