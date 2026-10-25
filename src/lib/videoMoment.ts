// Which match a recording is showing at a second, from each match's clip (MatchView.clip: its second in the
// video, a CLIP_LEAD_S lead-in before it starts; server/videos/recordings.ts). The predictions over the event
// page's player follow it: the call before and while the match runs, then its result until the next one is up.
import type { MatchView } from "../shared/api";
import { CLIP_LEAD_S } from "../shared/recording";

/** A match's length on the field: 30 s autonomous, 8 s transition, 2 min driver-controlled. */
export const MATCH_S = 158;
/** How long a result stays up when the next match is far off (a break, lunch, the end of a day). */
export const RESULT_HOLD_S = 6 * 60;
/** How early the first match of the video shows as up next. */
export const FIRST_LEAD_S = 90;

export type Phase = "before" | "playing" | "after";
export interface VideoMoment { match: MatchView; phase: Phase }

/** The match on screen at second `t` of the recording, and where in it; null between matches or outside them. */
export function videoMoment(matches: MatchView[], t: number): VideoMoment | null {
  const timed = matches.filter((m) => m.clip).sort((a, b) => a.clip!.t - b.clip!.t);
  if (!timed.length || !Number.isFinite(t)) return null;
  let i = -1;
  for (let k = 0; k < timed.length && timed[k].clip!.t <= t; k++) i = k;
  if (i < 0) return t >= timed[0].clip!.t - FIRST_LEAD_S ? { match: timed[0], phase: "before" } : null;
  const m = timed[i];
  const d = t - (m.clip!.t + CLIP_LEAD_S);
  if (d < 0) return { match: m, phase: "before" };
  if (d < MATCH_S) return { match: m, phase: "playing" };
  return d < MATCH_S + RESULT_HOLD_S ? { match: m, phase: "after" } : null;
}
