// Clip coverage triage (owner brief 2026-11-14, "auto-triage"): each event with played matches missing a clip gets one
// category, computed here from its missing matches' reasons and its season, never chosen by the owner. Only Actionable
// events are the owner's "To review"; the rest are kept with their category and reason, one click from view.
//
//   actionable   a match whose reason a better check (or a human with the video) can still overturn: played before the
//                broadcast started or after it ended (never checked against the video itself: the clock says so, the
//                frames haven't been read), or no reason found. Brief §6: "started before the livestream" is often
//                wrong, so it's never put anywhere else on that reason alone.
//   old-season   older than last season, and not actionable.
//   early-start  most missing matches are held back because an early start would open on the match before: the
//                system already refused to guess.
//   no-timing    everything else: no clock, video unavailable, shorter than its broadcast with nothing to place the
//                gap, no real start from FIRST, no recording that day, and so on.
//
// Nothing here places or removes a clip: it only decides what the owner is asked to look at.
import { seasonLabel } from "../../src/shared/format.js";
import type { CoverageMatch, CoverageReason, CoverageTriage } from "../../src/shared/api.js";
import { WHY } from "./coverage.js";

/** Reasons that don't settle a match: the video itself may still hold it. */
export const ACTIONABLE_REASONS: ReadonlySet<CoverageReason> = new Set(["before-broadcast", "after-broadcast", "unexplained"]);

const UNCHECKED: Partial<Record<CoverageReason, string>> = {
  "before-broadcast": "played before the broadcast started, by the clock: not yet checked against the video",
  "after-broadcast": "played after the broadcast ended, by the clock: not yet checked against the video",
  unexplained: "no clip and no reason found",
};

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

/**
 * The category of one event's missing list. `missing`: its played matches without a clip (with their reasons);
 * `current`: the current season. Old season is anything before last season.
 */
export function triageCoverage(season: number, missing: Pick<CoverageMatch, "reason">[], current: number): { triage: CoverageTriage; why: string } {
  const reasons = byReason(missing);
  if (!reasons.length) return { triage: "no-timing", why: "No match is missing a clip" };
  const open = reasons.filter(([r]) => ACTIONABLE_REASONS.has(r));
  if (open.length) {
    const n = open.reduce((s, [, k]) => s + k, 0);
    return { triage: "actionable", why: open.map(([r, k]) => `${matchesWord(k)} ${UNCHECKED[r]}`).join("; ") + (n < missing.length ? ` (${missing.length - n} more held back for other reasons)` : "") };
  }
  if (season < current - 1) return { triage: "old-season", why: `${seasonLabel(season)} season. ${lead(reasons, missing.length)}` };
  const early = reasons.find(([r]) => r === "overlaps-previous")?.[1] ?? 0;
  if (early * 2 >= missing.length) return { triage: "early-start", why: `${lead([["overlaps-previous", early]], missing.length)}: not guessed, so no clip opens on the wrong match` };
  return { triage: "no-timing", why: lead(reasons, missing.length) };
}
