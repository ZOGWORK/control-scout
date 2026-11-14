// The pure parts of scripts/video-frames.ts: reading FTC Live's overlay text, the timer's elapsed time, and placing a
// video's matches from the frames read. Kept apart so they can be tested without a browser.

/** A played match: its label and its real start (epoch seconds, from FIRST's actual start time). */
export type M = { label: string; epoch: number };

/** Two reads closer than this (seconds) are the same distance: the timer reads to the second, and the frame read lags it. */
export const SAME_S = 6;
/** The most frames read looking for one match. */
export const TRIES = 7;
/** A DECODE match: 30 s of Auto, 8 s to switch, 2:00 of TeleOp (FTC Live's timer stops between them). */
export const AUTO_S = 30, SWITCH_S = 8, TELEOP_S = 120;

/** The match an overlay names: "Qualification 21 of 36" → Q21, "Playoff Match 7" → M7, "Finals Match 2" → F2;
 *  anything else (a bracket screen's "Match 7", a schedule) none. */
export function overlayLabel(text: string): string | null {
  const q = /Qualification\s+(\d{1,3})\s+of\s+\d{1,3}/i.exec(text);
  if (q) return `Q${Number(q[1])}`;
  const f = /Finals?\s+Match\s+(\d)\b/i.exec(text);
  if (f) return `F${Number(f[1])}`;
  const p = /Playoff\s+Match\s+(\d{1,2})\b/i.exec(text);
  return p ? `M${Number(p[1])}` : null;
}

/** "2:25" → 145; anything else null. */
export const secondsOf = (s: string) => { const m = /(\d):([0-5]\d)/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Seconds since the match started, from its timer (where it's running: a timer standing at its full time is a match
 *  not started yet). Either bar counts Auto down from 0:30, then TeleOp from 2:00, so a reading of 0:30 or less is Auto
 *  only when `auto` says so (readAt tells it by a second read 45 s on); some bottom bars instead count the whole match
 *  down from 2:30, Auto being above 2:00. */
export function elapsed(t: { where: "bottom" | "top"; left: number; auto: boolean }): number | null {
  // Between Auto and TeleOp the timer counts down the 8 s to pick up the controllers ("0:05" under a hand): the same
  // digits as TeleOp's last seconds. Either could be meant, so no reading that low is used.
  if (t.left <= SWITCH_S) return null;
  if (t.auto) return t.left >= AUTO_S ? null : AUTO_S - t.left;
  if (t.where === "bottom" && t.left > TELEOP_S) return t.left >= AUTO_S + TELEOP_S ? null : AUTO_S + TELEOP_S - t.left;
  return t.left >= TELEOP_S ? null : AUTO_S + SWITCH_S + TELEOP_S - t.left;
}

/**
 * The matches placed by what was read (index → start second): a video loses time and never gains it, so how far it sits
 * from the clock only ever falls, match by match. A read that breaks that is a misread (a replay, an overlay left on the
 * last match, a digit read wrong): the most reads that keep to it are kept, the rest dropped. Each kept read places its
 * match; two kept reads the same distance from the clock place every match between them.
 */
export function placed(ms: M[], seen: Map<number, number>): Map<string, number> {
  const idx = [...seen.keys()].sort((a, b) => a - b);
  const d = (i: number) => seen.get(i)! - ms[i].epoch;
  // The longest run (in match order) never rising by more than a read's slack.
  const len = idx.map(() => 1), from = idx.map(() => -1);
  for (let b = 0; b < idx.length; b++) for (let a = 0; a < b; a++) {
    if (d(idx[b]) <= d(idx[a]) + SAME_S && len[a] + 1 > len[b]) { len[b] = len[a] + 1; from[b] = a; }
  }
  const kept: number[] = [];
  for (let k = len.indexOf(Math.max(0, ...len)); k >= 0; k = from[k]) kept.unshift(idx[k]);
  const out = new Map<string, number>();
  kept.forEach((i, n) => {
    out.set(ms[i].label, seen.get(i)!);
    const j = kept[n + 1];
    if (j != null && Math.abs(d(i) - d(j)) <= SAME_S) for (let k = i + 1; k < j; k++) out.set(ms[k].label, Math.round(ms[k].epoch + d(i)));
  });
  return out;
}

/** A match's start in the video, and how sure: "high" (a confirmed read, with another read or the broadcast's own
 *  clock agreeing on how far the video sits from the clock), "medium" (between two reads that agree). */
export type Placed = { t: number; confidence: "high" | "medium" };
/** What a video's frames say about each of its matches: placed, for review (one signal only, or implausible), or
 *  missing with the reason. */
export type Judged = { placed: Map<string, Placed>; review: Map<string, { t: number; why: string }>; missing: Map<string, string> };

/** Why a match is missing when no frame of its video could be read at all. */
export const NOTHING_READ = "no frame of the video could be read";

/** The least a match can take in a video: 30 s Auto, 8 s switch, 2:00 TeleOp. Two placed starts closer than this
 *  overlap. */
export const MATCH_S = AUTO_S + SWITCH_S + TELEOP_S;

/**
 * Judge a video's matches from its confirmed reads (index → start second). The clock (FIRST's actual start of each
 * match) is the anchor; the frames are the second signal. A read is kept only in the longest run that never rises (as
 * `placed`). Reads that agree on how far the video sits from the clock form stretches. A stretch of two or more reads
 * places its reads ("high") and every match between them ("medium"). A stretch of one read places it only where the
 * broadcast's own clock (`shift`, the video's second minus the epoch, when YouTube gives the broadcast start and the
 * video kept it) agrees; otherwise that one read is all there is, and it goes to review. Placed starts must be in order,
 * a match apart and inside the video; any that aren't go to review too. Every other match is missing, with the reason.
 */
export function judge(ms: M[], seen: Map<number, number>, shift: number | null, length: number, read: Set<number> = new Set(seen.keys())): Judged {
  const idx = [...seen.keys()].sort((a, b) => a - b);
  const d = (i: number) => seen.get(i)! - ms[i].epoch;
  const len = idx.map(() => 1), from = idx.map(() => -1);
  for (let b = 0; b < idx.length; b++) for (let a = 0; a < b; a++) {
    if (d(idx[b]) <= d(idx[a]) + SAME_S && len[a] + 1 > len[b]) { len[b] = len[a] + 1; from[b] = a; }
  }
  const kept: number[] = [];
  for (let k = len.indexOf(Math.max(0, ...len)); k >= 0; k = from[k]) kept.unshift(idx[k]);
  const dropped = new Set(idx.filter((i) => !kept.includes(i)));

  const placedAt = new Map<string, Placed>();
  const review = new Map<string, { t: number; why: string }>();
  // Stretches: kept reads in a row agreeing on the distance.
  const stretches: number[][] = [];
  for (const i of kept) {
    const s = stretches.at(-1);
    if (s && Math.abs(d(s.at(-1)!) - d(i)) <= SAME_S) s.push(i);
    else stretches.push([i]);
  }
  for (const s of stretches) {
    if (s.length === 1) {
      const i = s[0];
      if (shift != null && Math.abs(d(i) - shift) <= SAME_S) placedAt.set(ms[i].label, { t: seen.get(i)!, confidence: "high" });
      else review.set(ms[i].label, { t: seen.get(i)!, why: "one frame read, and nothing else agrees where the video sits" });
      continue;
    }
    for (let n = 0; n < s.length; n++) {
      placedAt.set(ms[s[n]].label, { t: seen.get(s[n])!, confidence: "high" });
      const j = s[n + 1];
      if (j != null) for (let k = s[n] + 1; k < j; k++) placedAt.set(ms[k].label, { t: Math.round(ms[k].epoch + d(s[n])), confidence: "medium" });
    }
  }

  // Plausible: inside the video, in order, a match apart.
  const order = ms.map((m) => m.label).filter((l) => placedAt.has(l));
  const bad = new Set<string>();
  order.forEach((l, n) => {
    const t = placedAt.get(l)!.t;
    if (t < 0 || t + MATCH_S > length + SAME_S) bad.add(l);
    const next = order[n + 1];
    if (next != null && placedAt.get(next)!.t - t < MATCH_S - SAME_S) { bad.add(l); bad.add(next); }
  });
  for (const l of bad) { review.set(l, { t: placedAt.get(l)!.t, why: "placed outside the video, out of order, or overlapping the next match" }); placedAt.delete(l); }

  const missing = new Map<string, string>();
  ms.forEach((m, i) => {
    if (placedAt.has(m.label) || review.has(m.label)) return;
    const before = kept.filter((k) => k < i).at(-1), after = kept.find((k) => k > i);
    missing.set(m.label,
      dropped.has(i) ? "its frame read disagrees with the matches around it"
      : read.has(i) ? "its frames didn't confirm a start"
      : before != null && after != null ? "in a gap: the reads either side disagree where the video sits, so it may not be in the video"
      : !kept.length ? NOTHING_READ
      : "no frame read of it, and no agreeing reads on both sides");
  });
  return { placed: placedAt, review, missing };
}

