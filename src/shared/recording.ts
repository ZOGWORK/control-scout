// Where a match sits in its event's recording: the broadcast's start (from YouTube, server/videos/youtube.ts)
// and the match's real start (MatchView.startsAt, from FIRST) give the second to jump to. Shared by the
// server (which attaches each match's clip) and the app (the player's seek, the link's label).

/** Seconds of lead-in before a match's start: the field reset and the announcer calling it. */
export const CLIP_LEAD_S = 20;

export interface RecordingTiming {
  start: string | null; end?: string | null; length: number | null; live: boolean;
  /** The event's first and last played matches' real starts (UTC ISO), when known: tell a trimmed-off tail from a gap (timingTrusted). */
  firstMatch?: string | null;
  lastMatch?: string | null;
  /** The clock's second (from the broadcast's start) up to which the video's own chapters line up with it
   *  (chaptersConfirm): trusted that far though its length falls short. */
  confirmedTo?: number | null;
}

/** How far the video's length may fall short of the broadcast's start-to-end time before its times can't be trusted. */
export const GAP_TOLERANCE_S = 180;
/** The most a video may fall short of its broadcast, where the gap can't be placed, for its matches still to get a
 *  clip: each then starts early by all the time missing, so it never starts after its match, at most this early. */
export const GAP_SLACK_MAX_S = 900;
/** A match's play on screen: 2:30 of play and the few seconds to its final score. */
export const MATCH_PLAY_S = 160;

/**
 * Whether a clip started early by `slack` (gapSlack) is clear of the match before it: started that early, it must
 * never open on another match being played. The gap may sit anywhere, so the match before may be where its clock
 * says while this one is too; the clip then starts slack + CLIP_LEAD_S before this match, and that match's play
 * must have ended by then. Glen Allen VA #1 Qualifier 2024 (9 min short): Q10's clip started early enough to play
 * Q8 and Q9 first. No early start, or no match before it in the video: clear.
 */
export function clearOfPrevious(startsAt: string | null | undefined, previous: string | null | undefined, slack: number): boolean {
  if (!slack || !previous || !startsAt) return true;
  return (Date.parse(startsAt) - Date.parse(previous)) / 1000 >= slack + CLIP_LEAD_S + MATCH_PLAY_S;
}

/** The least and the most the recording runs behind FIRST's clock: a match's timer shows on screen 9 to 14 s after
 *  its real start (YouTube's live delay, measured on AUSYOS 2025 and others' frames). */
export const LIVE_DELAY_MIN_S = 9;
export const LIVE_DELAY_MAX_S = 14;
/** How long a clip runs on after its match's play (MATCH_PLAY_S from its start by the clock): the live delay and the
 *  final score going up. Checked on APOC 2026's frames (Q1, Q32, Q37, M5, F1): the timer shows 7 to 8 s after the
 *  clock, the buzzer at +166 to +172 s, and the overlay's score stops changing 33 to 43 s after it (+205 to +210 s);
 *  "Under Review" and the results screen come minutes later, over the next match's setup. With the live delay up to
 *  LIVE_DELAY_MAX_S, the score settles by +216 s: a clip stops at +220 s. See clipEnd. */
export const CLIP_TAIL_S = 60;

/**
 * The second in the recording a match's clip stops at (YouTube's end=), or null when it has no clip (clipSecond).
 * It's the match's own place in the video (its clock second, less any start cut off the video: `shift`), never moved
 * earlier by an early start (gapSlack: the match may sit up to that much before its clock second, never after), plus
 * MATCH_PLAY_S and CLIP_TAIL_S. `next`: the next match's start in the same video: the clip then stops before that
 * match's timer shows (its clock second, at the earliest it may sit, plus LIVE_DELAY_MIN_S), though never before its
 * own match's play has ended on screen at the latest it may show. Never past the video's end.
 */
export function clipEnd(startsAt: string | null | undefined, rec: RecordingTiming & { shift?: number | null }, next?: string | null, now = Date.now()): number | null {
  if (clipSecond(startsAt, rec, now) == null) return null;
  const slack = gapSlack(rec) ?? 0, from = Date.parse(rec.start!), shift = rec.shift ?? 0;
  const at = (Date.parse(startsAt!) - from) / 1000 - shift;
  let end = at + MATCH_PLAY_S + CLIP_TAIL_S;
  const n = next ? (Date.parse(next) - from) / 1000 - shift - slack + LIVE_DELAY_MIN_S : NaN;
  if (Number.isFinite(n)) end = Math.max(Math.min(end, n), at + MATCH_PLAY_S + LIVE_DELAY_MAX_S);
  if (!rec.live && rec.length != null) end = Math.min(end, rec.length);
  return Math.floor(end);
}

/** How soon after the last match's start a video trimmed at the event's end stops. */
export const TAIL_TRIM_S = 900;

/**
 * Whether the video's seconds follow the clock: a broadcast that dropped out and came back is archived without
 * the dead air, so after the gap every match would land on a later one. Its length then falls short of its
 * start-to-end time. Still live: trusted up to now. No end: an archive whose end YouTube didn't give, trusted.
 * One exception: a stream left running for hours after the event, its archive then cut where the event ended
 * (Salk League Meet 2026: broadcast 10 h 26 min, video 5 h 10 min, ending 6 min after the last match's start).
 * The clock alone can't say where missing time went, so this asks for that cut's whole signature: the video ends
 * within TAIL_TRIM_S of the last match's start (by the clock), and the broadcast ran on after the last match for
 * longer than the matches themselves took (Salk: 5 h 21 min after 4 h 22 min of matches). A drop-out during an
 * event whose stream ended soon after it fails the second; one that also ran on for hours, and was also cut by hand
 * at the end, would pass: that pair is the case this can't rule out.
 */
export function timingTrusted(rec: RecordingTiming): boolean {
  if (!rec.start) return false;
  if (rec.confirmedTo != null) return true;
  if (rec.live || !rec.end || rec.length == null) return true;
  const from = Date.parse(rec.start), span = (Date.parse(rec.end) - from) / 1000;
  if (!Number.isFinite(span)) return false;
  const missing = span - rec.length;
  if (missing <= GAP_TOLERANCE_S) return true;
  const first = rec.firstMatch ? Date.parse(rec.firstMatch) : NaN, last = rec.lastMatch ? Date.parse(rec.lastMatch) : NaN;
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return false;
  const lastAt = (last - from) / 1000;
  const ranOn = (Date.parse(rec.end) - last) / 1000, matches = (last - first) / 1000;
  return lastAt <= rec.length && rec.length - lastAt <= TAIL_TRIM_S && ranOn > matches;
}

/** A video chapter: its start in seconds and its title (YouTube's own, often generated: "Match five", "Playoff match two"). */
export type Chapter = [t: number, title: string];

/** Chapter evidence counts only for more missing time than an early start covers (gapSlack): at or below it, the
 *  length check (timingTrusted, gapSlack) is the one to go by. It was 30 min, which left a video 15 to 30 min short with
 *  neither (Minnesota Championship Nano 2026: 21 min short, 0 clips). */
export const CHAPTER_MIN_GAP_S = GAP_SLACK_MAX_S;
/** How many chapters must name a played match before they say anything. */
export const CHAPTER_MIN_ANCHORS = 6;
/** How far the matches' distance from their chapters (typically: the median) may move before that's a gap: generated
 *  chapters start a minute or two early, and their numbering drifts by up to 13 min and back (USTXFMS1). */
export const CHAPTER_DRIFT_S = 600;
/** How many matches after a point judge whether the video jumps there: the last few chapters on their own say nothing. */
export const CHAPTER_TAIL = 4;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/** "5", "five", "twenty-one", "thirty one" → the number; anything else null. */
function numberOf(word: string): number | null {
  if (/^\d{1,3}$/.test(word)) return Number(word);
  const [a, b] = word.split(/[-\s]+/);
  const t = TENS.indexOf(a), o = ONES.indexOf(b ?? a);
  if (b === undefined) return t >= 2 ? t * 10 : o >= 0 ? o : null;
  return t >= 2 && o >= 1 && o <= 9 ? t * 10 + o : null;
}

/** A chapter's number at its start ("21 analysis", "twenty one", "five gameplay") and what follows it, or null. */
function leadingNumber(rest: string): { n: number; tail: string } | null {
  const d = /^(\d{1,3})(?!\d)(.*)$/s.exec(rest);
  if (d) return { n: Number(d[1]), tail: d[2] };
  const w = /^([a-z]+)(?:([-\s]+)([a-z]+))?(.*)$/is.exec(rest);
  if (!w) return null;
  // Two words first ("twenty one", "twenty-one"), then one ("five gameplay").
  if (w[3]) {
    const two = numberOf(`${w[1]}-${w[3]}`.toLowerCase());
    if (two != null && TENS.indexOf(w[1].toLowerCase()) >= 2) return { n: two, tail: w[4] };
  }
  const one = numberOf(w[1].toLowerCase());
  return one == null ? null : { n: one, tail: rest.slice(w[1].length) };
}

/** A number token ("7", "seven"): a chapter that goes on to name it ("Match 7 and 8"), or another match by name
 *  ("Q1 Q2", "Qualification 5 / Qualification 6"), names two matches. */
const NUMBER_WORD = `\\d{1,3}|${[...ONES.slice(1), ...TENS.slice(2)].join("|")}`;
const SECOND_MATCH = new RegExp(`^\\s*(?:and|&|\\+|,|/|to|through|thru|-|–|—)\\s*(?:${NUMBER_WORD})\\b`
  + `|\\b(?:playoff match|qualification|quals?|match(?:es)?)\\s*#?\\s*(?:${NUMBER_WORD})\\b|\\b[qm]\\s*#?\\d{1,3}\\b`, "i");

/**
 * The match a chapter names, as its label (Q5, M2), or null: a chapter naming two matches, or anything else. YouTube's
 * generated chapters often say more after the number ("Match 16 analysis", "Match one gameplay"), and an organiser's
 * may list the teams ("Q1 🔵20288 Mechanical Mages …"): the match is the one its title starts with.
 */
export function chapterLabel(title: string): string | null {
  const m = /^\s*(playoff match|qualification(?: match)?|quals?|match|q|m)\s*#?\s*(.*)$/is.exec(title);
  if (!m) return null;
  const num = leadingNumber(m[2]);
  if (!num || num.n < 1) return null;
  // The number must end there ("Match 5", "Match 5 recap"), and the title must not go on to a second match.
  if (/^[a-z0-9]/i.test(num.tail) || SECOND_MATCH.test(num.tail)) return null;
  const kind = m[1].toLowerCase();
  return `${kind === "playoff match" || kind === "m" ? "M" : "Q"}${num.n}`;
}

/** The middle value (the lower of the two middle ones for an even count, so one stray value never decides it). */
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[(s.length - 1) >> 1]; };

/**
 * How far into the broadcast (seconds, by the clock) the video's chapters say its seconds still follow the clock,
 * where its length alone can't (timingTrusted); null for not at all. A video far shorter than its broadcast was cut
 * (a stream left running all night, kept to its first part) or dropped out and came back, or both. A drop-out
 * moves every match after it away from its chapter by the time lost, for good; a cut moves none. So, over the
 * chapters that name a played match (Q5 at "Match five"), in clock order: the first ones must sit near their
 * matches, and at each match the distance must not jump by more than CHAPTER_DRIFT_S both right there (the next
 * CHAPTER_TAIL matches) and for good (every match from there on), against the matches before it. A chapter
 * numbering that drifts and comes back fails the second; a gap fails both. The clock is trusted up to the match
 * before the first jump, or, with none, up to the last match with CHAPTER_TAIL still to judge it; never with fewer
 * than CHAPTER_MIN_ANCHORS behind it. Only a large shortfall (CHAPTER_MIN_GAP_S) is judged this way, however much a
 * cut at the end also took. DECODE Preview Event (USTXFMS1) 2025: 6 h 32 min missing; chapters 1 to 13 min early
 * and back, trusted to M8 of 11.
 */
export function chaptersConfirm(rec: RecordingTiming, chapters: Chapter[] | null | undefined, matches: { label: string; startsAt: string | null | undefined }[]): number | null {
  if (!rec.start || !rec.end || rec.length == null || !chapters?.length) return null;
  const from = Date.parse(rec.start), missing = (Date.parse(rec.end) - from) / 1000 - rec.length;
  if (!Number.isFinite(missing) || missing <= CHAPTER_MIN_GAP_S) return null;
  const at = new Map<string, number>();
  for (const [t, title] of chapters) { const l = chapterLabel(title); if (l && !at.has(l)) at.set(l, t); }
  const anchors: { clock: number; off: number }[] = [];
  for (const m of matches) {
    const c = at.get(m.label), ms = m.startsAt ? Date.parse(m.startsAt) : NaN;
    if (c == null || !Number.isFinite(ms)) continue;
    const clock = (ms - from) / 1000;
    // A drop-out puts a match later by the clock than in the video: this grows by the time lost.
    anchors.push({ clock, off: clock - c });
  }
  if (anchors.length < CHAPTER_MIN_ANCHORS + CHAPTER_TAIL - 1) return null;
  anchors.sort((a, b) => a.clock - b.clock);
  const offs = anchors.map((a) => a.off);
  // Lost before the first match: every chapter that far off.
  if (Math.abs(median(offs.slice(0, CHAPTER_MIN_ANCHORS))) > CHAPTER_DRIFT_S) return null;
  let to = anchors.length - CHAPTER_TAIL;
  for (let p = 1; p <= anchors.length - CHAPTER_TAIL; p++) {
    // At least the first CHAPTER_MIN_ANCHORS set what "before" is: one stray early chapter is no gap after it.
    const before = median(offs.slice(0, Math.max(p, CHAPTER_MIN_ANCHORS)));
    const jumps = (xs: number[]) => Math.abs(median(xs) - before) > CHAPTER_DRIFT_S;
    if (jumps(offs.slice(p, p + CHAPTER_TAIL)) && jumps(offs.slice(p))) { to = p - 1; break; }
  }
  return to + 1 >= CHAPTER_MIN_ANCHORS ? anchors[to].clock : null;
}

/**
 * The second in the recording to start a match from, or null when the recording doesn't hold it: no
 * broadcast start, no match start, a match before the broadcast began or after the video ends (a long
 * stream's archive keeps its first 12 hours only; another day's stream is another video), or a video with
 * a gap (timingTrusted), or one past where the video's chapters vouch for it (confirmedTo). While the broadcast is
 * still live, up to now.
 */
export function clipSecond(startsAt: string | null | undefined, rec: RecordingTiming, now = Date.now()): number | null {
  const slack = gapSlack(rec);
  if (!startsAt || !rec.start || slack == null) return null;
  const from = Date.parse(rec.start), at = Date.parse(startsAt);
  if (!Number.isFinite(from) || !Number.isFinite(at) || at < from) return null;
  const offset = Math.floor((at - from) / 1000);
  const end = rec.live ? Math.floor((now - from) / 1000) : rec.length;
  if (end == null || offset - slack > end) return null;
  // Trusted on the chapters' word: only as far as they vouch for.
  if (rec.confirmedTo != null && offset > rec.confirmedTo) return null;
  return Math.max(0, offset - slack - CLIP_LEAD_S);
}

/**
 * How many seconds early a clip starts for a gap that can't be placed: 0 for a video whose times are trusted
 * (timingTrusted); else, for an archive at most GAP_SLACK_MAX_S short of its broadcast (a drop-out, its dead air cut),
 * all the time missing: a match sits between that much earlier and its clock time, so starting there never misses
 * it (Royal Oak Qualifier 2026: 13 min short, no chapters). Null for more missing, or none known. A match whose
 * early start would reach back into the match before it gets no clip at all (clearOfPrevious).
 */
export function gapSlack(rec: RecordingTiming): number | null {
  if (timingTrusted(rec)) return 0;
  if (!rec.start || !rec.end || rec.length == null || rec.live) return null;
  const missing = (Date.parse(rec.end) - Date.parse(rec.start)) / 1000 - rec.length;
  return Number.isFinite(missing) && missing > 0 && missing <= GAP_SLACK_MAX_S ? Math.ceil(missing) : null;
}

/**
 * Whether a played match's time is when it really started. FIRST's actual start carries seconds and
 * milliseconds ("2026-05-02T11:55:18.162"); a result posted without one falls back to the schedule, which
 * is on the minute ("09:00:00"). In the 2025 data: 2 of 45,421 played matches are on the minute, 219 of
 * 228 unplayed ones. A schedule would put the Watch on another match, so on-the-minute times get none.
 */
export function actualStart(time: string | null | undefined): boolean {
  const m = time ? /T\d\d:\d\d:(\d\d)(?:\.(\d+))?/.exec(time) : null;
  return !!m && (m[1] !== "00" || /[1-9]/.test(m[2] ?? ""));
}

/** YouTube's own page for the video at a second (the link when the page has no player to seek). */
export const watchUrl = (videoId: string, t?: number | null) => `https://www.youtube.com/watch?v=${videoId}${t ? `&t=${t}s` : ""}`;

/** The second a YouTube link starts at (t=90, t=90s, t=1m30s, start=90; #t= too), 0 without one. */
export function linkStart(url: string): number {
  let u: URL;
  try { u = new URL(url); } catch { return 0; }
  const raw = u.searchParams.get("t") ?? u.searchParams.get("start") ?? new URLSearchParams(u.hash.slice(1)).get("t");
  const m = raw ? /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw) : null;
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/** 3725 → "1:02:05", 125 → "2:05". */
export function clipTime(t: number): string {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
