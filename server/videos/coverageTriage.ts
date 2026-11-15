// Clip coverage triage (owner brief 2026-11-14, "auto-triage"): each event with played matches missing a clip gets one
// category, computed here from its missing matches' reasons and its season, never chosen by the owner. Only Actionable
// events are the owner's "To review"; the rest are kept with their category and reason, one click from view.
//
//   actionable   a match placed outside its video by the clock alone, never checked against the video itself: before
//                the broadcast started or after it ended, before the video's first second or after its last, before
//                or after the part its chapters confirm, outside every recording's time; or no reason found, or no
//                list at all.
//                Brief §6: the clock comparison is often wrong (a timezone, a stream that started early), so these are
//                never put anywhere else on that reason alone.
//   early-start  most missing matches are held back because an early start would open on the match before: the
//                system already refused to guess.
//   no-timing    everything else: no clock, video unavailable or not read, shorter than its broadcast with nothing to
//                place the gap, past the frames checked by eye, no real start from FIRST, no recording that day.
//   old-season   older than last season and not actionable: applied when read (seasonTriage), never stored, so it
//                follows the current season when it turns over.
//
// Nothing here places or removes a clip: it only decides what the owner is asked to look at.
import { seasonLabel } from "../../src/shared/format.js";
import type { CoverageMatch, CoverageReason, CoverageTriage } from "../../src/shared/api.js";
import { WHY } from "./coverage.js";

/** Reasons that rest on the clock alone, never on the video: the video itself may still hold the match. */
const UNCHECKED: Partial<Record<CoverageReason, string>> = {
  "before-broadcast": "played before the broadcast started, by the clock: not yet checked against the video",
  "after-broadcast": "played after the broadcast ended, by the clock: not yet checked against the video",
  "before-cut": "played before the video's first second, by the clock and its cut start: not yet checked against the video",
  "past-video-end": "played after the video's last second, by the clock: not yet checked against the video",
  "before-chapters": "played before the part its chapters confirm, by the clock: not yet checked against the video",
  "past-chapters": "played after the part its chapters confirm, by the clock: not yet checked against the video",
  "outside-span": "played outside every recording's time, by the clock: not yet checked against the video",
  unexplained: "no clip and no reason found",
};
export const ACTIONABLE_REASONS: ReadonlySet<CoverageReason> = new Set(Object.keys(UNCHECKED) as CoverageReason[]);

/** What's stored: the category from the reasons alone (old season is decided when read). */
export type BaseTriage = Exclude<CoverageTriage, "old-season">;

const matchesWord = (n: number) => `${n} ${n === 1 ? "match" : "matches"}`;

/** The reasons of the missing matches, most common first. */
function byReason(missing: Pick<CoverageMatch, "reason">[]): [CoverageReason, number][] {
  const n = new Map<CoverageReason, number>();
  for (const m of missing) { const r = m.reason ?? "unexplained"; n.set(r, (n.get(r) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1]);
}

/** "12 matches: Video unavailable or private, and 3 more for other reasons". */
function lead(reasons: [CoverageReason, number][], total: number): string {
  const [r, n] = reasons[0];
  return `${matchesWord(n)}: ${WHY[r]}${n < total ? `, and ${total - n} more for other reasons` : ""}`;
}

/** The category of one event's missing list from its reasons alone. `missing`: its played matches without a clip. */
export function baseTriage(missing: Pick<CoverageMatch, "reason">[]): { triage: BaseTriage; why: string } {
  const reasons = byReason(missing);
  // Nothing to judge from (a list lost or not written): it can't be settled, so it's looked at.
  if (!reasons.length) return { triage: "actionable", why: "No missing list to judge from: look at the event" };
  const open = reasons.filter(([r]) => ACTIONABLE_REASONS.has(r));
  if (open.length) {
    const n = open.reduce((s, [, k]) => s + k, 0);
    return { triage: "actionable", why: open.map(([r, k]) => `${matchesWord(k)} ${UNCHECKED[r]}`).join("; ") + (n < missing.length ? ` (${missing.length - n} more held back for other reasons)` : "") };
  }
  const early = reasons.find(([r]) => r === "overlaps-previous")?.[1] ?? 0;
  if (early * 2 >= missing.length) return { triage: "early-start", why: `${lead([["overlaps-previous", early]], missing.length)}: not guessed, so no clip opens on the wrong match` };
  return { triage: "no-timing", why: lead(reasons, missing.length) };
}

/** The category shown: a stored one, made Old season when it isn't actionable and is older than last season. */
export function seasonTriage(stored: { triage: BaseTriage; why: string }, season: number, current: number): { triage: CoverageTriage; why: string } {
  return stored.triage !== "actionable" && season < current - 1 ? { triage: "old-season", why: `${seasonLabel(season)} season. ${stored.why}` } : stored;
}

/** Both at once: the category an event shows now. */
export const triageCoverage = (season: number, missing: Pick<CoverageMatch, "reason">[], current: number) => seasonTriage(baseTriage(missing), season, current);
