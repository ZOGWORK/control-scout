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

/** The match an overlay names: "Qualification 21 of 36" → Q21, "Finals Match 2" → F2, "Playoff Match 7" or just
 *  "Match 7" (a playoff on 2025's overlay) → M7; anything else none. A frame's label only counts with its timer seen
 *  running and confirmed a minute on (scripts/video-frames.ts), so a bracket screen or schedule naming a match, with no
 *  timer running, gives no start. `semifinals`: the event's playoffs are best-of-3 semifinals and finals (2019–2022),
 *  whose overlay names each as "Semifinal 1 Match 2" or "Finals Match 1": a bare "Match 1" there is one of those read
 *  with its first word lost (2019IASQ4's "Finals Match 1" read "Match 1"), so it names none. */
export function overlayLabel(text: string, semifinals = false): string | null {
  const q = /Qualification\s+(\d{1,3})\s+of\s+\d{1,3}/i.exec(text);
  if (q) return `Q${Number(q[1])}`;
  // "Finals" with a letter the OCR reads as another ("Finais", "Fnals").
  const f = /(?<!Semi-?\s?)\bF[il1]?na[il1|]s?\s+Match\s+(\d)\b/i.exec(text);
  if (f) return `F${Number(f[1])}`;
  // Best-of-3 semifinals (2019–2022's playoffs): "Semifinal 2 Match 1" is the second semifinal's first match, the
  // event's M2 (series 2, number 1), and "Semifinal 1 Match 2" is its M1-2, never M2. Named with series and number
  // ("M2-1", "M1-2") so it's never taken for a replay (sameMatch).
  const sf = /Semi-?\s?finals?\s+(\d)\s+Match\s+(\d)\b/i.exec(text);
  if (sf) return `M${Number(sf[1])}-${Number(sf[2])}`;
  if (semifinals) return null;
  // A full-screen card can name several matches: a bracket ("Up Next Match 4", "Winner advances to Playoff Match 7") or
  // a result ("Match 6", "Advances to: Playoff Match 8"). A match it says a team advances to is a later one, never the
  // one on screen; of the rest, two different numbers name no one match, so the frame names none (CAONMIQ 2025). A
  // "Test Match 1" is the field check before the event's matches start (USNMCMP 2025 opens on one): none of its matches.
  // A bracket's boxes ("M4 vs A5", "M3 vs A6", "M8") make it one even where its "advances to" line is cut off at the
  // top (USIAWESTLT 2025 M3: "Playoff Match 5" alone): three different M-numbers, and the frame names no match, unless
  // its header says which is up next ("Up Next  Match 4", CAONMIQ 2025).
  const next = /Up\s+Next\W+(?:Playoff\s+)?Match\s+(\d{1,2})\b/i.exec(text);
  if (next) return `M${Number(next[1])}`;
  if (new Set([...text.matchAll(/\bM(\d{1,2})\b/g)].map((m) => m[1])).size >= 3) return null;
  const named = new Set<number>();
  for (const m of text.matchAll(/(advances\s+to:?\s+(?:Playoff\s+)?|\bTest\s+)?\bMatch\s+(\d{1,2})\b/gi)) if (!m[1]) named.add(Number(m[2]));
  return named.size === 1 ? `M${[...named][0]}` : null;
}

/** Whether a timer reading `later` seconds after an Auto reading of `left` is that same match's TeleOp, to within 3 s:
 *  Auto's rest, the 8 s switch, then TeleOp counting down from 2:00. The end of TeleOp (the other way to read a
 *  reading of 0:30 or less) leads to a finished match, never to that reading. */
export function autoLeadsTo(left: number, later: number, reading: number): boolean {
  const into = later - left - SWITCH_S;
  return into > 0 && into < TELEOP_S && Math.abs(reading - (TELEOP_S - into)) <= 3;
}

/** Whether a frame's match (overlayLabel) is the event's match `label`. A semifinal's ("M1-2": series and number) is
 *  that match only: the event's M1 is "M1-1", its M1-2 "M1-2". Any other ("M6", 2025's overlay) also names its
 *  replays ("M6-2", a tiebreak), which that overlay names by their match alone. */
export function sameMatch(named: string, label: string): boolean {
  if (/^M\d+-\d+$/.test(named)) return (/^M\d+$/.test(label) ? `${label}-1` : label) === named;
  return named === label.replace(/-\d+$/, "");
}

/** A frame's match (overlayLabel) as the event names it, where that's one match: a semifinal's first match ("M2-1")
 *  is the event's M2; every other name is the event's own already ("M1-2", "Q4", "F1"; "M6" of 2025's overlay, whose
 *  replays it can't tell apart, stays "M6"). What a recording's edge stores (opensOn, endsOn), so outsideRecording
 *  finds the match in the event's order. */
export const eventLabel = (named: string) => named.replace(/^(M\d+)-1$/, "$1");

/** FTC Live's rankings card counts the matches played so far ("4 / 23 matches played"): the count and the total. */
export function playedCount(text: string): { played: number; of: number } | null {
  const m = /(\d{1,3})\s*\/\s*(\d{1,3})\s+matches\s+played/i.exec(text);
  return m && Number(m[1]) <= Number(m[2]) ? { played: Number(m[1]), of: Number(m[2]) } : null;
}

/** Seconds from a recording's start (or back from its end) its edge is read at, in turn: the first frame that names a
 *  match or counts the matches played is the edge (within EDGE_S, server/data/frameTimings.ts). */
export const EDGE_AT = [3, 20, 45, 75, 110];
/** Where none of those frames names a match (a stream opening on an empty field, USORIMLT 2025), the edge is read on
 *  every CLEAR_STEP_S, up to CLEAR_MAX_S in, until one does: under a match's 2:38, so a match played in that stretch
 *  would show on at least two of the frames. Every frame before it showing no match makes it the edge ("clear"). */
export const CLEAR_STEP_S = 60;
export const CLEAR_MAX_S = 2400;

/** "2:25" → 145; anything else null. */
export const secondsOf = (s: string) => { const m = /(\d):([0-5]\d)/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** secondsOf, where the font's colon is too thin for the OCR to keep ("1:17" read "117", FIRST AGE's white box): the
 *  whole reading is one timer, with or without its colon, at most 2:59. */
export const secondsLoose = (s: string) => { const m = /^([0-2]):?([0-5]\d)$/.exec(s.replace(/\s/g, "")); return m ? Number(m[1]) * 60 + Number(m[2]) : secondsOf(s); };
/** A timer that shows bare seconds (FTC Live's overlay from 2019 to 2022: Auto's "30" down to "0", the switch's "8" to
 *  "0", TeleOp's "120" to "0"): one to three digits and nothing else, at most TeleOp's 120. A colon is another bar's
 *  timer, never this one. */
export const secondsPlain = (s: string) => { const m = /^\d{1,3}$/.exec(s.replace(/\s/g, "")); return m && Number(m[0]) <= TELEOP_S ? Number(m[0]) : null; };

/** Seconds since the match started, from its timer (where it's running: a timer standing at its full time is a match
 *  not started yet). Either bar counts Auto down from 0:30, then TeleOp from 2:00, so a reading of 0:30 or less is Auto
 *  only when `auto` says so (readAt tells it by a second read 45 s on); some bottom bars instead count the whole match
 *  down from 2:30, Auto being above 2:00. */
export function elapsed(t: { where: "bottom" | "top" | "plain"; left: number; auto: boolean }): number | null {
  // Between Auto and TeleOp the timer counts down the 8 s to pick up the controllers ("0:05" under a hand): the same
  // digits as TeleOp's last seconds. Either could be meant, so no reading that low is used.
  if (t.left <= SWITCH_S) return null;
  if (t.auto) return t.left >= AUTO_S ? null : AUTO_S - t.left;
  if (t.where === "bottom" && t.left > TELEOP_S) return t.left >= AUTO_S + TELEOP_S ? null : AUTO_S + TELEOP_S - t.left;
  return t.left >= TELEOP_S ? null : AUTO_S + SWITCH_S + TELEOP_S - t.left;
}

/** A match's start in the video, and how sure: "high" (a confirmed read, with another read or the broadcast's own
 *  clock agreeing on how far the video sits from the clock), "medium" (between two reads that agree). */
export type Placed = { t: number; confidence: "high" | "medium" };
/** What a video's frames say about each of its matches: placed, for review (one signal only, or implausible), or
 *  missing with the reason. */
export type Judged = {
  placed: Map<string, Placed>; review: Map<string, { t: number; why: string }>; missing: Map<string, string>;
  /** A match whose frame start lands inside the previous match's play (both read off the video): when it starts, and
   *  when the previous one's play ends. */
  earlyStart: Map<string, { t: number; previousEnds: number }>;
  /** Each placed match's clip start: the first second, of those tried before its start, whose overlay names it
   *  (filled by the reader's opening check, never by judge). */
  opens: Map<string, number>;
};

/** Why a match is missing when no frame of its video could be read at all. */
export const NOTHING_READ = "no frame of the video could be read";

/** The least a match can take in a video: 30 s Auto, 8 s switch, 2:00 TeleOp. Two placed starts closer than this
 *  overlap. */
export const MATCH_S = AUTO_S + SWITCH_S + TELEOP_S;
/** Where a clip may open, seconds before its match's start, earliest first: the first whose frame names the match.
 *  The last two open at the start itself: a results card ("Match 6 results", CAONMIQ 2025 M7) or a bracket card
 *  (USIAWESTLT 2025 M3) can stay up until the match's own overlay comes on, seconds before it starts. */
export const OPEN_LEADS = [20, 12, 5, 2, 0];

/** The reason a placed match whose clip opening couldn't be checked gets: never a clip, never a clock reason. */
export const OVERLAY_UNREAD = "overlay could not be read at its clip's start";

/** The most a recording loses in one cut, as a confirming read can explain it (USIAPOMPM11 2025 loses 19 s mid-match). */
export const LOSS_S = 60;

/**
 * How a confirming read's start compares with the start it checks, the confirming read being later in the match. A
 * recording can be cut mid-match (a stream that dropped a few seconds): the video loses time, never gains it, so a read
 * after the cut gives an earlier start by the time lost ("lost"), and a start that a later read puts later came from a
 * read after a cut itself ("gained": the later start is the one to check). Further off, it's another start ("other").
 */
export function startOffset(start: number, later: number): "same" | "lost" | "gained" | "other" {
  const off = later - start;
  if (Math.abs(off) <= SAME_S) return "same";
  if (off < 0 && -off <= LOSS_S) return "lost";
  if (off > 0 && off <= LOSS_S) return "gained";
  return "other";
}

/** A division's own name from its event's ("Romania Championship - COANDA Division" → "COANDA"), or null. */
export function divisionOf(name: string): string | null {
  const m = /\s[-–]\s*(.+?)\s+Division\s*$/i.exec(name.trim());
  return m ? m[1] : null;
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whose division an overlay names, when an event's divisions share a stream (one feed cutting between fields): "own",
 * "other" (a sibling division's name is on it), or null (no division name read: the ticker scrolled it off).
 */
export function overlayDivision(text: string, own: string, others: string[]): "own" | "other" | null {
  const t = plain(text);
  const has = (d: string) => new RegExp(`(^|[^A-Z])${escape(plain(d)).replace(/\s+/g, "\\s+")}([^A-Z]|$)`).test(t);
  if (others.some(has)) return "other";
  return has(own) ? "own" : null;
}

/** How long before a broadcast's start a match no broadcast holds is still looked for in it (seconds). */
export const LEAD_IN_S = 6 * 3600;

/**
 * Whether the video `i` (of an event's videos, by broadcast window, epoch seconds) should be read for a match at `at`
 * that its broadcast starts after. The clock says before it, yet it's often in it: FIRST's times can be the schedule's,
 * and YouTube's broadcast start can be late. So a match no broadcast holds, up to LEAD_IN_S before this one's start,
 * with no other broadcast starting between them, is looked for here too. Its frames decide, as for any match.
 */
export function leadIn(at: number, i: number, windows: { start: number | null; end: number | null }[]): boolean {
  const from = windows[i]?.start;
  if (from == null || at >= from || from - at > LEAD_IN_S) return false;
  if (windows.some((w) => w.start != null && w.start <= at && (w.end == null || at <= w.end))) return false;
  return !windows.some((w, k) => k !== i && w.start != null && at < w.start && w.start < from);
}

/** The rows of a server/data/frameTimings/<season>.ts file as written (one JSON row a line after the data marker). */
export function dataRows<T>(text: string): T[] {
  const data = text.split("// --- Data")[1] ?? "";
  return data.split("\n").flatMap((line) => { const m = /^\s*(\{.*\}),?\s*$/.exec(line); return m ? [JSON.parse(m[1]) as T] : []; });
}

/**
 * Judge a video's matches from its confirmed reads (index → start second). The clock (FIRST's actual start of each
 * match) is the anchor; the frames are the second signal. A video loses time and never gains it, so how far it sits
 * from the clock only ever falls, match by match: a read that breaks that is a misread (a replay, an overlay left on the
 * last match, a digit read wrong), and only the longest run of reads that never rises (by more than a read's slack) is
 * kept. Reads that agree on how far the video sits from the clock form stretches. A stretch of two or more reads
 * places its reads ("high") and every match between them ("medium"). A stretch of one read is a confirmed read too
 * (its overlay and timer agree at two points, and 25 s before it the match wasn't running): the video is the truth, so
 * it places that match where the frames show it, however far that is from FIRST's times (owner, 2026-11-16: never
 * flag a read for its distance from the schedule). Placed starts must be in order,
 * a match apart and inside the video; any that aren't go to review too. Every other match is missing, with the reason.
 */
export function judge(ms: M[], seen: Map<number, number>, shift: number | null, length: number, read: Set<number> = new Set(seen.keys())): Judged {
  const idx = [...seen.keys()].sort((a, b) => a - b);
  const d = (i: number) => seen.get(i)! - ms[i].epoch;
  // low: the least distance on the run so far. A read may sit at most a read's slack above it, so slack can't add up
  // read by read into a rise (0, +6, +12).
  const len = idx.map(() => 1), from = idx.map(() => -1), low = idx.map((i) => d(i));
  for (let b = 0; b < idx.length; b++) for (let a = 0; a < b; a++) {
    if (d(idx[b]) <= low[a] + SAME_S && len[a] + 1 > len[b]) { len[b] = len[a] + 1; from[b] = a; low[b] = Math.min(low[a], d(idx[b])); }
  }
  // Of the longest runs, the one with the most reads that agree with a neighbour (0, -120, 0 keeps the two zeros, not
  // a zero and the misread); then the later one.
  const runOf = (k: number) => { const r: number[] = []; for (; k >= 0; k = from[k]) r.unshift(idx[k]); return r; };
  const agreeing = (r: number[]) => r.filter((i, n) => [r[n - 1], r[n + 1]].some((o) => o != null && Math.abs(d(o) - d(i)) <= SAME_S)).length;
  let kept: number[] = [];
  const longest = Math.max(0, ...len);
  len.forEach((l, k) => { if (l === longest) { const r = runOf(k); if (!kept.length || agreeing(r) >= agreeing(kept)) kept = r; } });
  const dropped = new Set(idx.filter((i) => !kept.includes(i)));

  const placedAt = new Map<string, Placed>();
  const review = new Map<string, { t: number; why: string }>();
  // Stretches: kept reads in a row agreeing on the distance.
  const stretches: number[][] = [];
  for (const i of kept) {
    const s = stretches.at(-1);
    // Against the stretch's first read, so a slow drift (0, +6, +12) isn't taken as agreement.
    if (s && Math.abs(d(s[0]) - d(i)) <= SAME_S) s.push(i);
    else stretches.push([i]);
  }
  for (const s of stretches) {
    if (s.length === 1) {
      const i = s[0];
      // A confirmed read: where its frames show it, never weighed against the schedule.
      placedAt.set(ms[s[0]].label, { t: seen.get(s[0])!, confidence: "high" });
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
  const earlyStart = new Map<string, { t: number; previousEnds: number }>();
  order.forEach((l, n) => {
    const t = placedAt.get(l)!.t;
    if (t < 0 || t + MATCH_S > length + SAME_S) bad.add(l);
    const next = order[n + 1];
    // Two starts each read off its own frames, closer than a match by no more than a cut loses (LOSS_S): the recording
    // skipped the end of the first (USTXSASQ 2025 cuts from Q14 at 1:07 to Q13's results, then Q15). Both stand; each
    // clip is still checked to open on its match (checkOpenings).
    const cut = next != null && placedAt.get(l)!.confidence === "high" && placedAt.get(next)!.confidence === "high" && t + MATCH_S - placedAt.get(next)!.t <= LOSS_S;
    if (next != null && !cut && placedAt.get(next)!.t - t < MATCH_S - SAME_S) {
      bad.add(l); bad.add(next);
      // Only where both starts were read off the video: a start filled from the clock between two reads (medium) shows
      // nothing about where that match began.
      if (placedAt.get(l)!.confidence === "high" && placedAt.get(next)!.confidence === "high") earlyStart.set(next, { t: placedAt.get(next)!.t, previousEnds: t + MATCH_S });
    }
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
      : !kept.length && !read.size ? NOTHING_READ
      : "no frame read of it, and no agreeing reads on both sides");
  });
  return { placed: placedAt, review, missing, earlyStart, opens: new Map() };
}

