// The autopilot's second look at a frame row's review entries (scripts/video-frames.ts --recheck): a start the reader
// saw with one signal only ("one frame read, and nothing else agrees where the video sits"), or whose clip's first
// frame showed the match before ("its clip's first frame shows Q6, not Q7": the start a few seconds early), is read
// again on frames a few seconds after it (RECHECK_AFTER), FTC's bar and timer as every start read takes them. Where
// two or more separate frames name the match and their timers give one start, that is the second signal it lacked:
// it moves out of review into the row's starts, its confirming frames kept (`confirmed`), its clip opening on the first
// of them, and the server puts it live like any read (server/data/frameRowRules.ts). Where they don't, it stays for the
// owner, marked looked at (`again`), so it isn't read again every run. A move the row's rules refuse (out of order,
// overlapping: rowProblems; running past the video's end, as the reader's judge has it) stays for the owner too. Pure: tested without a browser.
import { CONFIRM_FRAMES, OPEN_LEADS, SAME_S, rowProblems, secondLookDue } from "../../server/data/frameRowRules.js";
import type { FrameTiming } from "../../server/data/frameTimings.js";
import { MATCH_S, sameMatch } from "./videoFrames.js";

/** Seconds after a review entry's `t` its second look reads a frame at. */
export const RECHECK_AFTER = [2, 8, 20, 40];
/** The most the second look moves a start from its entry's `t`: further is another match, or a misread. */
export const RECHECK_SHIFT_S = 30;

/** One frame the second look read: its second, the match its bar named (null: none), the start its timer gave (null:
 *  not read running), and whose overlay it was on a stream divisions share ("other": a sibling's or another event's). */
export type RecheckRead = { at: number; label: string | null; start: number | null; division?: "own" | "other" | null };
/** What the frames say of one entry: a start (and where its clip opens, and the frames it stands on), why it stays for
 *  the owner, or (`unread`) that some frames weren't read at all and the rest settled nothing: no look taken, the entry
 *  left as it was for the next run (a stalled seek never uses up its second look). */
export type RecheckVerdict = { settled: { start: number; open: number; frames: number[] } } | { stays: string } | { unread: string };

/** What each frame showed, in words, for the log and the entry's `again.saw`: "2 s on: Q6; 8 s on: Q7 from 1234 s". */
export function sawText(t: number, reads: RecheckRead[]): string {
  return reads.map((r) => `${Math.round(r.at - t)} s on: ${r.division === "other" ? "another division's or event's match" : r.label ? `${r.label}${r.start != null ? ` from ${r.start} s` : ""}` : "nothing"}`).join("; ");
}

/** The verdict on review entry `label` at `t` from the frames read after it. `missed`: frames asked for that weren't
 *  read (a seek that never landed): where the rest settle nothing, the look is no look (`unread`). */
export function recheckVerdict(label: string, t: number, reads: RecheckRead[], missed = 0): RecheckVerdict {
  const v = judgeReads(label, t, reads);
  return "stays" in v && missed > 0 ? { unread: `${missed} of its frames weren't read (${v.stays}): looked at again next run` } : v;
}
function judgeReads(label: string, t: number, reads: RecheckRead[]): RecheckVerdict {
  const names = (r: RecheckRead) => r.division !== "other" && !!r.label && sameMatch(r.label, label);
  const others = reads.filter((r) => r.division === "other" || (!!r.label && !sameMatch(r.label, label)));
  const timed = reads.filter((r) => names(r) && r.start != null).sort((a, b) => a.start! - b.start!);
  if (!reads.some(names)) {
    if (!others.length) return { stays: "no frame after it named a match" };
    return { stays: `the frames after it named ${[...new Set(others.map((r) => (r.division === "other" ? "another division's or event's match" : r.label)))].join(", ")}, not ${label}` };
  }
  // The most reads whose timers agree on one start (within a read's slack of each other).
  let best: RecheckRead[] = [];
  for (let i = 0; i < timed.length; i++) {
    const run = timed.filter((r) => r.start! >= timed[i].start! && r.start! - timed[i].start! <= SAME_S);
    if (run.length > best.length) best = run;
  }
  const start = best.length ? best[Math.floor((best.length - 1) / 2)].start! : null;
  // Each frame at or after the start (a second's slack: a playing frame is read a little after the second asked for),
  // inside the match.
  const inside = start == null ? [] : best.filter((r) => r.at >= start - 1 && r.at <= start + MATCH_S);
  const frames = [...new Set(inside.map((r) => Math.ceil(r.at)))].sort((a, b) => a - b);
  if (start == null || frames.length < CONFIRM_FRAMES) {
    return { stays: timed.length >= CONFIRM_FRAMES ? `the frames after it named ${label}, but their timers gave starts more than ${SAME_S} s apart` : `only ${timed.length} frame after it named ${label} with its timer running` };
  }
  if (Math.abs(start - t) > RECHECK_SHIFT_S) return { stays: `the frames after it put ${label}'s start at ${start} s, ${Math.abs(start - t)} s from where it was seen` };
  // A frame between the agreeing ones that names another match: not one match throughout.
  const between = others.find((r) => r.at > frames[0] && r.at < frames[frames.length - 1]);
  if (between) return { stays: `a frame between the ones naming ${label} named ${between.division === "other" ? "another division's or event's match" : between.label}` };
  // The clip opens on the first frame naming it: a lead the row's rules know (OPEN_LEADS) from the timer's start, else
  // the start itself moves to that frame (its opening shows the match; the seconds before it showed the one before).
  const open = frames[0];
  return OPEN_LEADS.includes(start - open) ? { settled: { start, open, frames } } : { settled: { start: open, open, frames: frames.filter((x) => x >= open) } };
}

/** The entries of `row` a second look is for (secondLookDue: in review with a second, not a start already, not looked
 *  at again since the video was read), less those the owner rejected at that second (`rejected`). */
export function recheckDue(row: Pick<FrameTiming, "starts" | "review">, rejected?: (label: string, t: number) => boolean): { label: string; t: number }[] {
  return Object.keys(row.review ?? {}).flatMap((label) => {
    if (!secondLookDue(row, label)) return [];
    const t = Math.round(row.review![label].t);
    return rejected?.(label, t) ? [] : [{ label, t }];
  });
}

/**
 * `row` after the second look's `verdicts` (each entry's, with what its frames showed), dated `today`: a settled entry
 * moves to the starts (opening and confirming frames with it, out of review and missing) unless that gives the row a
 * problem it didn't have against `live` (out of order, overlapping: rowProblems) or the match would run past the end of
 * the video (`length`, its seconds; judge's own rule): then it stays, marked looked at with why, as an entry that didn't
 * settle. `order`: the
 * event's played matches in the order they were played. Null (with why): nothing to write, as the row as served
 * already breaks a rule (a change to it would wait for the owner whatever this look found), or the live row was read
 * today (a change needs a newer date), or the row's openings were never checked.
 */
export function recheckRow(row: FrameTiming, verdicts: Map<string, { verdict: RecheckVerdict; saw: string }>, live: FrameTiming | undefined, order: string[] | undefined, today: string, length?: number): { row: FrameTiming; settled: string[]; stays: string[] } | { row: null; why: string } {
  if (!verdicts.size) return { row: null, why: "nothing to look at again" };
  if (live && !(today > live.checked)) return { row: null, why: `the live row was read ${live.checked}: looked at again on a later day` };
  if (!row.opens) return { row: null, why: "its clip openings were never checked (--verify reads them first)" };
  const marked = (r: FrameTiming, label: string, saw: string): FrameTiming => ({ ...r, review: { ...r.review, [label]: { ...r.review![label], again: { on: today, saw } } } });
  let next: FrameTiming = { ...row, checked: today, starts: { ...row.starts }, opens: { ...row.opens }, ...(row.review ? { review: { ...row.review } } : {}) };
  const unchanged = !live || JSON.stringify(row) === JSON.stringify(live);
  const before = rowProblems(next, live, order);
  if (unchanged && before.length) return { row: null, why: `the row as served already waits on a rule (${before[0]}): left for the owner` };
  const settled: string[] = [], stays: string[] = [];
  for (const [label, { verdict, saw }] of verdicts) {
    if (!next.review?.[label] || "unread" in verdict) continue;
    if ("stays" in verdict) { next = marked(next, label, `${verdict.stays} (${saw})`); stays.push(label); continue; }
    const { start, open, frames } = verdict.settled;
    const moved: FrameTiming = { ...next, starts: Object.fromEntries([...Object.entries(next.starts), [label, start] as [string, number]].sort((a, b) => a[1] - b[1])), opens: { ...next.opens, [label]: open }, confirmed: { ...next.confirmed, [label]: frames } };
    const review = { ...moved.review }; delete review[label];
    if (Object.keys(review).length) moved.review = review; else delete moved.review;
    if (moved.missing?.[label] != null) { const missing = { ...moved.missing }; delete missing[label]; if (Object.keys(missing).length) moved.missing = missing; else delete moved.missing; }
    const had = new Set(rowProblems(next, live, order));
    const added = rowProblems(moved, live, order).filter((p) => !had.has(p));
    const outside = length != null && start + MATCH_S > length + SAME_S ? `the match would run past the video's end (${length} s)` : null;
    if (added.length || outside) {
      next = marked(next, label, `confirmed at ${start} s by frames ${frames.join(", ")}, but ${added[0] ?? outside} (${saw})`);
      stays.push(label);
      continue;
    }
    next = moved;
    settled.push(label);
  }
  return { row: next, settled, stays };
}
