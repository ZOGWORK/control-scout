// Clip coverage triage (owner brief 2026-11-14, "auto-triage", and its 2026-11-15 addendum §7): each event with played
// matches missing a clip gets one category, computed here from its missing matches' reasons, what their video showed
// (CoverageMatch.video, read off its frames) and its season, never chosen by the owner. Only Actionable events are the
// owner's "To review"; the rest are kept with their category and reason, one click from view.
//
//   actionable   a match checked against the video (its frames read) and still without a clip, or a match with no
//                reason found, or no list at all; its other unsettled matches, not yet checked, are counted beside it.
//                Before the video check, a match left out by the clock alone (coverage.ts CLOCK_ONLY: an early start, or a time before or
//                after the broadcast, the cut start, the video's end, what its chapters confirm, every recording),
//                unless its video's frames show it starting inside the match before; or no reason found, or no list
//                at all. §6/§7: the stream is the truth, the clock isn't, so an early start or a time outside the video
//                is never a reason on its own. Its "why" says what was checked in the video and what was missing
//                there, never what the clock said.
//   unchecked    left out by the clock alone and not yet checked against the video (no frame read of it): a pending
//                check, not a reason. Its own count, in any season; never "To review", never marked reviewed (zero-error
//                brief 2026-11-15, journey 5: To review holds only matches the video itself was checked for).
//   early-start  most missing matches are ones the video's frames show starting while the match before is still on:
//                a clip would open on the wrong match.
//   no-timing    everything else: no clock, video unavailable or not read, shorter than its broadcast with nothing to
//                place the gap, past the frames checked by eye, no real start from FIRST, no recording that day.
//   old-season   older than last season and not actionable: applied when read (seasonTriage), never stored, so it
//                follows the current season when it turns over.
//
// Nothing here places or removes a clip: it only decides what the owner is asked to look at.
import { seasonLabel } from "../../src/shared/format.js";
import type { CoverageMatch, CoverageReason, CoverageTriage } from "../../src/shared/api.js";
import { CLOCK_ONLY, WHY } from "./coverage.js";

/** Reasons that leave a match unsettled: the clock's alone (the video may still hold it), or none found. */
export const ACTIONABLE_REASONS: ReadonlySet<CoverageReason> = new Set<CoverageReason>([...CLOCK_ONLY, "between-recordings", "unexplained"]);

/** What's stored: the category from the missing list alone (old season is decided when read). */
export type BaseTriage = Exclude<CoverageTriage, "old-season">;

type Missing = Pick<CoverageMatch, "reason"> & Partial<Pick<CoverageMatch, "label" | "video">>;

const matchesWord = (n: number) => `${n} ${n === 1 ? "match" : "matches"}`;
/** " (Q2, Q19)", the first few labels then how many more; nothing when the list has none. */
function labels(ms: Missing[]): string {
  const ls = ms.map((m) => m.label).filter((l): l is string => !!l);
  if (!ls.length) return "";
  return ` (${ls.slice(0, 5).join(", ")}${ls.length > 5 ? `, ${ls.length - 5} more` : ""})`;
}

/** The video's frames show it starting while the match before is still on. */
const earlyInVideo = (m: Missing) => m.reason === "overlaps-previous" && !!m.video?.earlyStart;
/** Unsettled: left out by the clock alone and not shown by the video to start inside the match before, or no reason. */
const unsettled = (m: Missing) => ACTIONABLE_REASONS.has(m.reason ?? "unexplained") && !earlyInVideo(m) && !betweenSettled(m);
/** Played between two recordings, and both videos' frames were read with it in neither: settled, nothing to place. */
const betweenSettled = (m: Missing) => m.reason === "between-recordings" && !!m.video?.checked && m.video.seenAt == null;

/** The reasons of the missing matches, most common first. */
function byReason(missing: Missing[]): [CoverageReason, number][] {
  const n = new Map<CoverageReason, number>();
  for (const m of missing) { const r = m.reason ?? "unexplained"; n.set(r, (n.get(r) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1]);
}

/** "12 matches: Video unavailable or private, and 3 more for other reasons". */
function lead(reasons: [CoverageReason, number][], total: number): string {
  const [r, n] = reasons[0];
  return `${matchesWord(n)}: ${WHY[r]}${n < total ? `, and ${total - n} more for other reasons` : ""}`;
}

/** Checked against the video (its frames read), or with no reason found: what To review is for. */
const videoChecked = (m: Missing) => (m.reason ?? "unexplained") === "unexplained" || !!m.video?.checked;

/** An unsettled list in plain words: what was checked in the video and what was missing there, never the clock. */
function openWhy(open: Missing[]): string {
  const none = (m: Missing) => (m.reason ?? "unexplained") === "unexplained";
  const groups: [string, Missing[]][] = [
    ["not yet checked against the video", open.filter((m) => !none(m) && !m.video?.checked)],
    ["seen in the video, not yet confirmed", open.filter((m) => !none(m) && m.video?.checked && m.video.seenAt != null)],
    ["checked in the video, no start found there", open.filter((m) => !none(m) && m.video?.checked && m.video.seenAt == null)],
    ["with no clip and no reason found", open.filter(none)],
  ];
  return groups.filter(([, ms]) => ms.length).map(([what, ms]) => `${matchesWord(ms.length)} ${what}${labels(ms)}`).join("; ");
}

/** The category of one event's missing list. `missing`: its played matches without a clip. */
export function baseTriage(missing: Missing[]): { triage: BaseTriage; why: string } {
  // Nothing to judge from (a list lost or not written): it can't be settled, so it's looked at.
  if (!missing.length) return { triage: "actionable", why: "No missing list to judge from: look at the event" };
  const open = missing.filter(unsettled);
  const held = (n: number) => (n < missing.length ? ` (${missing.length - n} more held back for other reasons)` : "");
  const checked = open.filter(videoChecked);
  if (checked.length) {
    // To review: what the video showed; the matches still waiting for their video check are counted beside it.
    const pending = open.filter((m) => !videoChecked(m));
    return { triage: "actionable", why: openWhy(checked) + (pending.length ? `; ${openWhy(pending)}` : "") + held(open.length) };
  }
  if (open.length) return { triage: "unchecked", why: openWhy(open) + held(open.length) };
  const early = missing.filter(earlyInVideo);
  if (early.length * 2 >= missing.length) {
    return { triage: "early-start", why: `${matchesWord(early.length)} checked in the video: each starts while the match before is still on, so a clip would open on the wrong match${labels(early)}${early.length < missing.length ? `, and ${missing.length - early.length} more for other reasons` : ""}` };
  }
  return { triage: "no-timing", why: lead(byReason(missing.filter((m) => !earlyInVideo(m))), missing.length) };
}

/** The category shown: a stored one, made Old season when it's settled (not actionable, not waiting for its video
 *  check) and older than last season. */
export function seasonTriage(stored: { triage: BaseTriage; why: string }, season: number, current: number): { triage: CoverageTriage; why: string } {
  // A pending video check stays one in any season: nothing waiting for a check is folded away.
  return stored.triage !== "actionable" && stored.triage !== "unchecked" && season < current - 1 ? { triage: "old-season", why: `${seasonLabel(season)} season. ${stored.why}` } : stored;
}

/** Both at once: the category an event shows now. */
export const triageCoverage = (season: number, missing: Missing[], current: number) => seasonTriage(baseTriage(missing), season, current);
