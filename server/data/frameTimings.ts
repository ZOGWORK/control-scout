// Where each match starts in an event recording, read off the recording's own frames (scripts/video-frames.ts): FTC
// Live's overlay names the match being played and runs its timer, so one frame gives the second the match started at.
// For recordings YouTube's facts can't place matches in (src/shared/recording.ts timingTrusted): a video shorter than
// its broadcast (a stream stopped over lunch, a tail or a start cut), or an upload with no broadcast clock.
//
// `starts`: a match (its label) → the second it starts at in the video (its timer's start, not a lead-in). A match is
// here only where a frame showed it being played, or between two such matches that sit the same distance from their
// real starts (a video loses time, never gains it, so nothing was lost between them). Kept per event as well as per
// video: one stream can carry two divisions.
//
// Every frame read is confirmed before it counts: 70 s on the overlay must name the same match with the same start,
// and 25 s before, that match mustn't be running yet. A match is placed only where two signals agree (two reads that
// agree on where the video sits, or one read and the broadcast's own clock). `medium` lists the placed matches filled
// between two reads rather than read themselves. `review` holds starts with one signal only, or implausible ones (out
// of order, overlapping, outside the video): never shown as clips, left for the owner. `missing` gives each other
// match of the video the reason it has no start.

import { ROWS as S2019 } from "./frameTimings/2019.js";
import { ROWS as S2021 } from "./frameTimings/2021.js";
import { ROWS as S2022 } from "./frameTimings/2022.js";
import { ROWS as S2023 } from "./frameTimings/2023.js";
import { ROWS as S2024 } from "./frameTimings/2024.js";
import { ROWS as S2025 } from "./frameTimings/2025.js";
import { ROWS as S2026 } from "./frameTimings/2026.js";

export interface FrameTiming {
  videoId: string;
  /** The event the matches are of. */
  code: string;
  /** The day the frames were read (YYYY-MM-DD). */
  checked: string;
  starts: Record<string, number>;
  /** Placed matches filled between two agreeing reads (the rest of `starts` were read themselves). */
  medium?: string[];
  /** Starts with one signal only, or implausible: for the owner to check, never a clip. */
  review?: Record<string, { t: number; why: string }>;
  /** Matches the frames gave no start for, and why. */
  missing?: Record<string, string>;
  /** Matches the frames show starting while the match before is still being played: `t`, the second it starts at in
   *  the video, `previousEnds`, the second the one before ends. Only these are "Early start / unsafe" in Owner › Clip
   *  coverage (server/videos/coverageTriage.ts); an early start by the clock alone is never one. */
  earlyStart?: Record<string, { t: number; previousEnds: number }>;
  /** Where each placed match's clip opens: the first second before its start whose overlay names it. A row that has
   *  it was checked clip by clip, and only the starts in it are clips (scripts/video-frames.ts, checkOpenings). */
  opens?: Record<string, number>;
  /** Starts already live before openings were checked whose opening frame named nothing (blank, a transition): they
   *  keep playing at the usual lead-in until a re-read confirms or pulls them. Never set on a new placement. */
  unconfirmed?: string[];
  /** What the recording's first frames show (within EDGE_S of its start): the match its overlay names, or FTC Live's
   *  "N / M matches played" count. The proof that a match was played before the recording starts (outsideRecording). */
  opensOn?: RecordingEdge;
  /** What its last frames show (within EDGE_S of its end): the proof that a match was played after it ends. */
  endsOn?: RecordingEdge;
}

/** One edge of a recording, read off its frames: the second, and the match named there and/or the matches played. */
export interface RecordingEdge {
  at: number; label?: string; played?: number; of?: number;
  /** An end edge's distance back from the recording's end (`at` counts from its start): within EDGE_S, or `clear`. */
  fromEnd?: number;
  /** Read further from the edge than EDGE_S: every frame between the edge and `at`, CLEAR_STEP_S apart (less than a
   *  match lasts, so each match would show on two: scripts/lib/videoFrames.ts), showed no overlay naming a match and no
   *  running timer. */
  clear?: boolean;
  /** The opening's match was already being played: its timer ran between two reads 3 s apart, and its least elapsed
   *  reading puts its start before the recording's. Its clip can't open on its start: the recording cut it. */
  underway?: boolean;
}

/** How close to a recording's start or end a frame must be to count as its edge: a match first seen an hour in can't
 *  tell that the ones before it aren't in the video (their overlay may just not have read). */
export const EDGE_S = 120;

const hms = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const qualNumber = (label: string) => { const m = /^Q(\d+)$/.exec(label); return m ? Number(m[1]) : null; };

/**
 * Whether a match isn't in a recording at all, proven from its frames, never the clock: played before it starts (its
 * first frames name a later match, or count it among the matches already played) or after it ends (its last frames name
 * an earlier match, or count fewer played). `order`: the event's played matches in time order. Null where the frames
 * prove nothing about it (no edge read, or the match sits inside what the recording shows).
 */
export function outsideRecording(row: Pick<FrameTiming, "opensOn" | "endsOn"> & Partial<Pick<FrameTiming, "starts" | "review" | "earlyStart">>, label: string, order: string[]): string | null {
  const i = order.indexOf(label), q = qualNumber(label);
  // An edge counts only where everything else the frames saw in the video agrees with it: a first frame can show a
  // bracket, a schedule or the day before's last card, so one naming M7 while Q2 is read an hour in proves nothing.
  const seen = [...Object.keys(row.starts ?? {}), ...Object.keys(row.review ?? {}), ...Object.keys(row.earlyStart ?? {})];
  const at = (l: string) => order.indexOf(l);
  // FTC Live's "N / M matches played" counts qualification matches only: M is the event's qual total (MDCHS1 36 of its
  // 46 matches). A count whose M isn't that total (a sibling division's, a misread) settles nothing.
  const quals = order.filter((l) => qualNumber(l) != null).length;
  const counts = (edge: RecordingEdge) => edge.played != null && edge.of === quals;
  const opens = (edge: RecordingEdge | undefined) => !!edge && (edge.at <= EDGE_S || !!edge.clear) && !seen.some((l) =>
    (edge.label != null && at(edge.label) >= 0 && at(l) >= 0 && at(l) < at(edge.label)) ||
    (edge.played != null && qualNumber(l) != null && qualNumber(l)! <= edge.played));
  const ends = (edge: RecordingEdge | undefined) => !!edge && ((edge.fromEnd != null && edge.fromEnd <= EDGE_S) || !!edge.clear) && !seen.some((l) =>
    (edge.label != null && at(edge.label) >= 0 && at(l) > at(edge.label)) ||
    (edge.played != null && qualNumber(l) != null && qualNumber(l)! > edge.played));
  const o = opens(row.opensOn) ? row.opensOn : undefined, e = ends(row.endsOn) ? row.endsOn : undefined;
  if (o) {
    if (counts(o) && q != null && q <= o.played!) return `played before the recording starts: at ${hms(o.at)} it shows ${o.played}${o.of ? ` of ${o.of}` : ""} matches played`;
    if (o.underway && o.label === label) return `under way when the recording starts: at ${hms(o.at)} its timer is already running`;
    if (o.label && i >= 0 && order.indexOf(o.label) > i) return `played before the recording starts: it opens on ${o.label} at ${hms(o.at)}${o.clear ? ", no match on screen before it" : ""}`;
  }
  if (e) {
    if (counts(e) && q != null && q > e.played!) return `played after the recording ends: at ${hms(e.at)} it shows ${e.played}${e.of ? ` of ${e.of}` : ""} matches played`;
    if (e.label && i >= 0 && order.indexOf(e.label) >= 0 && order.indexOf(e.label) < i) return `played after the recording ends: it ends on ${e.label} at ${hms(e.at)}${e.clear ? ", no match on screen after it" : ""}`;
  }
  return null;
}

let byKey: Map<string, Record<string, number>> | null = null;

/** Two placed starts closer than this (a match's 2:38 less a read's slack) overlap: one of them is wrong. */
const OVERLAP_S = 152;

/** The closest two starts can be when the recording cut the end of the first (a match's 2:38 less the most one cut
 *  loses, LOSS_S in scripts/lib/videoFrames.ts). */
const CUT_S = 98;

/** A row's starts that can be clips: any two closer than a match overlap (a misread, or an older read written before
 *  the plausibility check), and neither is used. Unless the recording cut the first short: two starts no closer than
 *  CUT_S whose clip openings were each checked and named their own match (`opens`, scripts/video-frames.ts) stand. */
export function plausibleStarts(starts: Record<string, number>, opens?: Record<string, number>): Record<string, number> {
  const sorted = Object.entries(starts).sort((a, b) => a[1] - b[1]);
  const bad = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i][1] - sorted[i - 1][1];
    const cut = gap >= CUT_S && opens?.[sorted[i][0]] != null && opens?.[sorted[i - 1][0]] != null;
    if (gap < OVERLAP_S && !cut) { bad.add(sorted[i][0]); bad.add(sorted[i - 1][0]); }
  }
  return Object.fromEntries(sorted.filter(([l]) => !bad.has(l)));
}

/** A row's starts that can be clips: plausible, and, where its clip openings were checked, only those that open on
 *  their match. The one reading the server plays from and Owner › Clip coverage reports (server/videos/coverage.ts). */
export const playableStarts = (f: FrameTiming): Record<string, number> => {
  const s = plausibleStarts(f.starts, f.opens);
  return f.opens ? Object.fromEntries(Object.entries(s).filter(([l]) => f.opens![l] != null || f.unconfirmed?.includes(l))) : s;
};
const keyed = () => new Map(FRAME_TIMINGS.map((f) => [`${f.videoId}|${f.code}`, playableStarts(f)]));
let opensByKey: Map<string, Record<string, number>> | null = null;

/** The second a framed match's clip opens at, where its opening was checked (its overlay names it there), else null. */
export function frameOpen(videoId: string, code: string, label: string): number | null {
  opensByKey ??= new Map(FRAME_TIMINGS.map((f) => [`${f.videoId}|${f.code}`, f.opens ?? {}]));
  return opensByKey.get(`${videoId}|${code}`)?.[label] ?? null;
}

/** The second a match starts at in a video, from its frames, or null when they weren't read for it. */
export function frameStart(videoId: string, code: string, label: string): number | null {
  byKey ??= keyed();
  return byKey.get(`${videoId}|${code}`)?.[label] ?? null;
}

/** Whether any of a video's matches for an event were placed from its frames (a video read with none placed, only
 *  review or missing ones, doesn't count). */
export function hasFrames(videoId: string, code: string): boolean {
  byKey ??= keyed();
  const starts = byKey.get(`${videoId}|${code}`);
  return !!starts && Object.keys(starts).length > 0;
}

/** A video's matches for an event left for the owner to check (one signal only, or implausible), with why. */
export function frameReview(videoId: string, code: string): Record<string, { t: number; why: string }> {
  return FRAME_TIMINGS.find((f) => f.videoId === videoId && f.code === code)?.review ?? {};
}

/** A video's matches for an event the frames gave no start for, with why. */
export function frameMissing(videoId: string, code: string): Record<string, string> {
  return FRAME_TIMINGS.find((f) => f.videoId === videoId && f.code === code)?.missing ?? {};
}

/** A video's frame read for an event (the day it was read, and everything it found), or null when it wasn't read. */
export function frameRow(videoId: string, code: string): FrameTiming | null {
  return FRAME_TIMINGS.find((f) => f.videoId === videoId && f.code === code) ?? null;
}

/** The frames' word that a match starts while the one before is still on (its second, and when that one ends), or null. */
export function frameEarlyStart(videoId: string, code: string, label: string): { t: number; previousEnds: number } | null {
  return frameRow(videoId, code)?.earlyStart?.[label] ?? null;
}

/** How sure a framed start is: "high" read off its own frames, "medium" filled between two agreeing reads. */
export function frameConfidence(videoId: string, code: string, label: string): "high" | "medium" | null {
  const f = FRAME_TIMINGS.find((x) => x.videoId === videoId && x.code === code);
  if (!f || playableStarts(f)[label] == null) return null;
  return f.medium?.includes(label) ? "medium" : "high";
}

/** Tests only: these timings in place of the file's. */
export function setFrameTimingsForTests(list: FrameTiming[]) {
  FRAME_TIMINGS.splice(0, FRAME_TIMINGS.length, ...list);
  byKey = null;
  opensByKey = null;
}

// --- Data: one file a season (frameTimings/<season>.ts, the season of the row's event), which scripts/video-frames.ts
// writes, so readers of different seasons never touch the same file. Every caller reads this one list.
export const FRAME_TIMINGS: FrameTiming[] = [...S2019, ...S2021, ...S2022, ...S2023, ...S2024, ...S2025, ...S2026];
