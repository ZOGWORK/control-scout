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
  /** The video's own chapters line up with the clock (chaptersConfirm): trusted though its length falls short. */
  confirmed?: boolean;
}

/** How far the video's length may fall short of the broadcast's start-to-end time before its times can't be trusted. */
export const GAP_TOLERANCE_S = 180;
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
  if (rec.confirmed) return true;
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

/** Chapter evidence counts only for this much missing time: below it, a chapter's own slack (a minute or more) could hide a gap. */
export const CHAPTER_MIN_GAP_S = 1800;
/** How many chapters must name a played match before they say anything. */
export const CHAPTER_MIN_ANCHORS = 6;

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

/** The match a chapter names, as its label (Q5, M2), or null: a chapter naming two matches, or anything else. */
export function chapterLabel(title: string): string | null {
  const m = /^\s*(playoff match|qualification(?: match)?|qual(?:s)?|match|q|m)\s*#?\s*([a-z]+(?:[-\s][a-z]+)?|\d{1,3})\s*$/i.exec(title);
  if (!m) return null;
  const n = numberOf(m[2].toLowerCase());
  if (n == null || n < 1) return null;
  const kind = m[1].toLowerCase();
  return `${kind === "playoff match" || kind === "m" ? "M" : "Q"}${n}`;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * Whether the video's chapters say its seconds follow the clock, where its length alone can't (timingTrusted):
 * YouTube cut the archive short (a stream left running all night, kept to its first part) or the broadcast
 * dropped out for that long and came back. A drop-out puts every match after it that far from its chapter; a
 * cut leaves every match near its own. So: enough chapters naming played matches (Q5 at "Match five"), and in
 * both the earlier and the later half of them (by the clock), the typical distance from match to chapter under
 * half the missing time. Generated chapters run a little early and now and then skip or merge a match, so only
 * a large missing time (CHAPTER_MIN_GAP_S) is judged this way. DECODE Preview Event (USTXFMS1) 2025: 6 h 32 min
 * missing; matches sit 2 min (earlier half) and 5 min (later half) from their chapters.
 */
export function chaptersConfirm(rec: RecordingTiming, chapters: Chapter[] | null | undefined, matches: { label: string; startsAt: string | null | undefined }[]): boolean {
  if (!rec.start || !rec.end || rec.length == null || !chapters?.length) return false;
  const from = Date.parse(rec.start), missing = (Date.parse(rec.end) - from) / 1000 - rec.length;
  if (!Number.isFinite(missing) || missing < CHAPTER_MIN_GAP_S) return false;
  const at = new Map<string, number>();
  for (const [t, title] of chapters) { const l = chapterLabel(title); if (l && !at.has(l)) at.set(l, t); }
  const anchors: { clock: number; off: number }[] = [];
  for (const m of matches) {
    const c = at.get(m.label), ms = m.startsAt ? Date.parse(m.startsAt) : NaN;
    if (c == null || !Number.isFinite(ms)) continue;
    const clock = (ms - from) / 1000;
    anchors.push({ clock, off: Math.abs(clock - c) });
  }
  if (anchors.length < CHAPTER_MIN_ANCHORS) return false;
  anchors.sort((a, b) => a.clock - b.clock);
  const half = Math.floor(anchors.length / 2);
  return [anchors.slice(0, half), anchors.slice(half)].every((h) => median(h.map((a) => a.off)) < missing / 2);
}

/**
 * The second in the recording to start a match from, or null when the recording doesn't hold it: no
 * broadcast start, no match start, a match before the broadcast began or after the video ends (a long
 * stream's archive keeps its first 12 hours only; another day's stream is another video), or a video with
 * a gap (timingTrusted). While the broadcast is still live, up to now.
 */
export function clipSecond(startsAt: string | null | undefined, rec: RecordingTiming, now = Date.now()): number | null {
  if (!startsAt || !rec.start || !timingTrusted(rec)) return null;
  const from = Date.parse(rec.start), at = Date.parse(startsAt);
  if (!Number.isFinite(from) || !Number.isFinite(at) || at < from) return null;
  const offset = Math.floor((at - from) / 1000);
  const end = rec.live ? Math.floor((now - from) / 1000) : rec.length;
  if (end == null || offset > end) return null;
  return Math.max(0, offset - CLIP_LEAD_S);
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

/** 3725 → "1:02:05", 125 → "2:05". */
export function clipTime(t: number): string {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
