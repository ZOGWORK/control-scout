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

/** The match an overlay names: "Qualification 21 of 36" → Q21, "Playoff Match 7" → M7; anything else (a bracket
 *  screen's "Match 7", a schedule) none. */
export function overlayLabel(text: string): string | null {
  const q = /Qualification\s+(\d{1,3})\s+of\s+\d{1,3}/i.exec(text);
  if (q) return `Q${Number(q[1])}`;
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

