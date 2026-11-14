// Clip coverage: for an event's recording, which of its days and parts are recorded, and for every played match
// whether it has a clip and, when it has none, why, in plain words. The clip itself is always withClips' (the
// page's own), so the two never disagree; the reason is read off the same decisions withClips makes
// (src/shared/recording.ts: timingTrusted, gapSlack, chaptersConfirm, clipSecond, clearOfPrevious; within here).
// A played match withClips gives no clip that none of them explains is "unexplained": the audit
// (scripts/clip-coverage.ts) lists those apart, never as covered.
import { all } from "../db.js";
import { CLIP_LEAD_S, GAP_SLACK_MAX_S, actualStart, clearOfPrevious, clipSecond, gapSlack, type RecordingTiming } from "../../src/shared/recording.js";
import { localToUtcMs } from "../../src/shared/time.js";
import { checkedTo } from "../data/checkedTimings.js";
import { dayLabel, eventSpan, previousStart, seasonRecordings, withClips, withConfirmed, within, type EventSpan, type Recording, type RecordingVideo } from "./recordings.js";
import type { ClipCoverage, CoverageMatch, CoverageReason, CoverageVideo } from "../../src/shared/api.js";

/** The fields of a match coverage reads (a MatchView has them all). */
export interface CoverageInput {
  key: string; label: string; time: string | null; startsAt: string | null; played: boolean;
  video?: string | null; clip?: unknown;
  teams?: number[];
}

/** A broadcast's date at the venue (YYYY-MM-DD), or null. */
function venueDate(iso: string | null | undefined, timezone: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(t); } catch { return new Date(t).toISOString().slice(0, 10); }
}
/** A match's date at the venue: FIRST's time is the venue's own. */
const matchDate = (m: CoverageInput) => (m.time && /^\d{4}-\d\d-\d\d/.test(m.time) ? m.time.slice(0, 10) : null);
/** A date's weekday ("Saturday"). */
const weekday = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(Date.parse(`${date}T12:00:00Z`));
const mins = (s: number) => Math.round(s / 60);
/** 4520 → "1 h 15 min", 900 → "15 min". */
export function span(s: number): string {
  const m = mins(s);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

/** How far a video falls short of its broadcast (seconds), or null when that can't be told. */
function missingOf(meta: RecordingTiming): number | null {
  if (!meta.start || !meta.end || meta.length == null || meta.live) return null;
  const v = (Date.parse(meta.end) - Date.parse(meta.start)) / 1000 - meta.length;
  return Number.isFinite(v) ? v : null;
}

const WHY: Record<CoverageReason, string> = {
  "no-start": "No real start time from FIRST",
  "no-recording-day": "No recording for that day",
  "outside-span": "Outside every recording's time",
  "before-broadcast": "Played before the broadcast started",
  "after-broadcast": "Played after the broadcast ended",
  "video-unavailable": "Video unavailable or private",
  "video-unread": "Video's facts not read from YouTube yet",
  "no-clock": "Video has no broadcast clock (an upload, not a live stream)",
  "gap-unplaced": "Video shorter than its broadcast, missing time can't be placed",
  "past-chapters": "Past the part of the video its chapters confirm",
  "past-video-end": "After the video ends",
  "before-cut": "Before the video starts",
  "overlaps-previous": "An early start would open on the match before",
  "no-first-video": "FIRST posted no video for this match",
  unexplained: "No clip, reason not found",
};

interface Judged {
  v: RecordingVideo; date: string | null; label: string;
  /** Why this video gives no clips at all, when it gives none. */
  dead?: { reason: CoverageReason; why: string };
  timing?: RecordingTiming & { confirmedTo?: number | null }; slack?: number; starts?: number[];
  /** What its clips stand on (the audit's verification column). */
  basis?: string;
}

/** One video judged as withClips judges it: its held matches, timing, slack; or why it gives nothing. */
function judge(v: RecordingVideo, r: Recording, whole: EventSpan, timezone: string | null | undefined, now: number): Judged {
  const date = v.day ?? venueDate(v.meta?.start, timezone);
  const label = dayLabel(v.meta?.start ?? (v.day ? `${v.day}T12:00:00Z` : null), v.meta?.start ? timezone : "UTC") + (v.part ? ` · ${v.part}` : "");
  const meta = v.meta;
  if (!meta) return { v, date, label, dead: { reason: "video-unread", why: WHY["video-unread"] } };
  if (meta.status === "unavailable") return { v, date, label, dead: { reason: "video-unavailable", why: WHY["video-unavailable"] } };
  if (meta.status !== "ok") return { v, date, label, dead: { reason: "video-unread", why: "YouTube's facts couldn't be read" } };
  if (!meta.start) return { v, date, label, dead: { reason: "no-clock", why: WHY["no-clock"] } };
  const held = r.daily || r.more?.length ? eventSpan(whole.starts.filter((s) => within(s.startsAt, meta, now))) : whole;
  const timing: RecordingTiming = withConfirmed(v.videoId, meta, held);
  const slack = gapSlack(timing);
  const starts = held.starts.map((s) => (s.startsAt ? Date.parse(s.startsAt) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  if (slack == null) {
    const missing = missingOf(timing);
    const chapters = meta.chapters?.length ? "its chapters don't confirm the clock" : "no chapters to confirm the clock";
    const why = missing != null
      ? `Video ${span(missing)} shorter than its broadcast (over the ${mins(GAP_SLACK_MAX_S)} min an early start covers), ${chapters}`
      : WHY["gap-unplaced"];
    return { v, date, label, timing, dead: { reason: "gap-unplaced", why } };
  }
  const missing = missingOf(timing) ?? 0;
  const basis = timing.confirmedTo != null
    ? (checkedTo(v.videoId) === timing.confirmedTo ? "clock + frames checked by eye"
      : timing.shift ? `clock + YouTube chapters (its first ${span(timing.shift)} cut off)` : "clock + YouTube chapters")
    : slack ? `clock only, started up to ${span(slack)} early (gap can't be placed)`
      : missing > 180 ? "clock, tail of the stream cut after the event"
        : "clock, video length matches its broadcast";
  return { v, date, label, timing, slack, starts, basis };
}

/** Why a played match judged against its videos gets no clip. */
function reasonFor(m: CoverageInput, videos: Judged[], now: number): { reason: CoverageReason; why: string; videoId: string | null } {
  const date = matchDate(m);
  // Counted in its day's video (by the schedule's date), so that day never reads as fully clipped without it.
  if (!actualStart(m.time)) {
    const day = videos.filter((j) => j.date && j.date === date);
    return { reason: "no-start", why: WHY["no-start"], videoId: (day[0] ?? (videos.length === 1 ? videos[0] : null))?.v.videoId ?? null };
  }
  // The video that holds its start, else that day's.
  const holding = videos.find((j) => j.v.meta?.status === "ok" && j.v.meta.start && within(m.startsAt, j.v.meta, now));
  const sameDay = videos.filter((j) => j.date && j.date === date);
  // A video whose day can't be told (no broadcast start, unavailable, not read) may be any day's: its reason is the one.
  const undated = videos.filter((x) => !x.date);
  const j = holding ?? (sameDay.length ? sameDay.find((x) => x.dead) ?? sameDay[0] : undated.find((x) => x.dead) ?? undated[0]);
  if (!j) {
    // No video that day: a recording broadcast a day at a time, other days recorded, this one not.
    if (date && videos.some((x) => x.date && x.date !== date)) return { reason: "no-recording-day", why: `No recording for ${weekday(date)}`, videoId: null };
    return { reason: "outside-span", why: WHY["outside-span"], videoId: null };
  }
  const id = j.v.videoId;
  if (j.dead) return { ...j.dead, videoId: id };
  if (!holding) {
    const at = m.startsAt ? Date.parse(m.startsAt) : NaN, from = j.v.meta?.start ? Date.parse(j.v.meta.start) : NaN;
    return at < from ? { reason: "before-broadcast", why: WHY["before-broadcast"], videoId: id } : { reason: "after-broadcast", why: WHY["after-broadcast"], videoId: id };
  }
  const t = j.timing!, slack = j.slack!, shift = t.shift ?? 0;
  // clipSecond's own steps: the clock against what the chapters vouch for, then the video's seconds (clock − shift).
  const from = Date.parse(t.start!), clock = Math.floor((Date.parse(m.startsAt!) - from) / 1000), offset = clock - shift;
  if (clipSecond(m.startsAt, t, now) == null) {
    if (clock < 0) return { reason: "before-broadcast", why: WHY["before-broadcast"], videoId: id };
    if (t.confirmedTo != null && clock > t.confirmedTo) return { reason: "past-chapters", why: `${WHY["past-chapters"]} (to ${span(t.confirmedTo)} into the broadcast)`, videoId: id };
    if (shift && t.confirmedFrom != null && clock < t.confirmedFrom) return { reason: "past-chapters", why: `${WHY["past-chapters"]} (from ${span(t.confirmedFrom)} into the broadcast)`, videoId: id };
    if (offset < 0) return { reason: "before-cut", why: `${WHY["before-cut"]} (its first ${span(shift)} were cut off)`, videoId: id };
    if (t.length != null && offset - slack > t.length) return { reason: "past-video-end", why: `${WHY["past-video-end"]} (the video stops ${span(offset - slack - t.length)} before it)`, videoId: id };
  } else if (!clearOfPrevious(m.startsAt, slack ? previousStart(j.starts!, m.startsAt) : null, slack)) {
    return { reason: "overlaps-previous", why: `${WHY["overlaps-previous"]} (starts up to ${span(slack + CLIP_LEAD_S)} early)`, videoId: id };
  }
  return { reason: "unexplained", why: WHY.unexplained, videoId: id };
}

/**
 * An event's clip coverage. `matches`: the event's matches (MatchView or the audit's own rows); `rec`: the recording the
 * page plays (seasonRecordings), `full`: the same with videos YouTube won't play kept (so their days are named, not
 * missing). Played matches only. No recording and no FIRST match video: "none".
 */
export function clipCoverage(matches: CoverageInput[], rec: Recording | null, full: Recording | null, timezone: string | null | undefined, now = Date.now()): ClipCoverage {
  const played = matches.filter((m) => m.played);
  const placed = new Map<string, CoverageInput>();
  for (const m of rec ? withClips(played as any[], rec, now) as CoverageInput[] : played) placed.set(m.key, m);
  const r = full ?? rec;
  const whole = eventSpan(played.filter((x) => actualStart(x.time)).map((x) => ({ label: x.label, startsAt: x.startsAt })));
  const judged = r ? [r as RecordingVideo, ...(r.more ?? [])].map((v) => judge(v, r, whole, timezone, now)) : [];
  const firstVideos = played.some((m) => m.video);
  const out: CoverageMatch[] = [];
  const counts = new Map<string, { matches: number; clipped: number }>();
  for (const m of played) {
    const p = placed.get(m.key)!;
    const clip = p.clip as { videoId: string; early?: number } | undefined;
    const base = { key: m.key, label: m.label, date: matchDate(m), ...(m.teams ? { teams: m.teams } : {}) };
    if (m.video || clip) {
      const vid = clip?.videoId ?? null;
      if (vid) { const c = counts.get(vid) ?? { matches: 0, clipped: 0 }; c.matches++; c.clipped++; counts.set(vid, c); }
      out.push({ ...base, clip: true, videoId: vid, basis: m.video && !clip ? "FIRST's match video" : judged.find((j) => j.v.videoId === vid)?.basis ?? "clock" });
      continue;
    }
    const why = judged.length ? reasonFor(m, judged, now) : { reason: "no-first-video" as const, why: WHY["no-first-video"], videoId: null };
    if (why.videoId) { const c = counts.get(why.videoId) ?? { matches: 0, clipped: 0 }; c.matches++; counts.set(why.videoId, c); }
    out.push({ ...base, clip: false, videoId: why.videoId, reason: why.reason, why: why.why });
  }
  const videos: CoverageVideo[] = judged.map((j) => ({
    videoId: j.v.videoId, label: j.label, date: j.date, ...(counts.get(j.v.videoId) ?? { matches: 0, clipped: 0 }),
    ...(j.dead ? { why: j.dead.why } : {}), ...(j.basis ? { basis: j.basis } : {}),
  }));
  // Days with played matches and no video of their own, for a recording that has days (a single video spanning them doesn't).
  const recordedDates = new Set(judged.map((j) => j.date).filter(Boolean));
  const daysMissing = [...new Set(out.filter((m) => m.reason === "no-recording-day").map((m) => m.date!))].sort()
    .map((date) => ({ date, label: weekday(date), matches: out.filter((m) => m.date === date && !m.clip).length }));
  const withClip = out.filter((m) => m.clip).length;
  const state: ClipCoverage["state"] = !judged.length && !firstVideos ? "none" : !out.length ? "pending" : withClip === out.length ? "full" : withClip ? "partial" : "unplaced";
  return { state, played: out.length, withClip, videos, daysMissing, recordedDays: [...recordedDates].sort() as string[], matches: out };
}

/** An event's coverage as the page and the owner console read it. Null: no such event. */
export async function eventClipCoverage(season: number, code: string, now = Date.now()): Promise<ClipCoverage | null> {
  const ev = (await all<{ timezone: string | null }>("SELECT timezone FROM events WHERE season = ? AND code = ?", [season, code]))[0];
  if (!ev) return null;
  const [recs, full, rows] = await Promise.all([seasonRecordings(season), seasonRecordings(season, true), eventMatchRows(season, [code])]);
  return clipCoverage(rows.get(code) ?? [], recs.get(code) ?? null, full.get(code) ?? null, ev.timezone, now);
}

/** Matches as coverage reads them, for some events of a season (by code), with their teams. */
export async function eventMatchRows(season: number, codes: string[]): Promise<Map<string, CoverageInput[]>> {
  const out = new Map<string, CoverageInput[]>();
  for (let i = 0; i < codes.length; i += 200) {
    const part = codes.slice(i, i + 200), q = part.map(() => "?").join(",");
    const [rows, teams] = await Promise.all([
      all<{ code: string; level: string; series: number; number: number; label: string; time: string | null; played: number; video: string | null; timezone: string | null }>(
        `SELECT m.code, m.level, m.series, m.number, m.label, m.time, m.played, m.video, e.timezone FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
         WHERE m.season = ? AND m.code IN (${q}) ORDER BY m.code, m.time, m.level DESC, m.series, m.number`, [season, ...part]),
      all<{ code: string; level: string; series: number; number: number; team: number }>(
        `SELECT code, level, series, number, team FROM match_teams WHERE season = ? AND code IN (${q}) ORDER BY alliance DESC, station`, [season, ...part]),
    ]);
    const byMatch = new Map<string, number[]>();
    for (const t of teams) { const k = `${t.code}|${t.level}:${t.series}:${t.number}`; (byMatch.get(k) ?? byMatch.set(k, []).get(k)!).push(Number(t.team)); }
    for (const r of rows) {
      const key = `${r.level}:${r.series}:${r.number}`, code = String(r.code);
      const ms = localToUtcMs(r.time, r.timezone);
      (out.get(code) ?? out.set(code, []).get(code)!).push({
        key, label: String(r.label), time: r.time, startsAt: ms == null ? null : new Date(ms).toISOString(), played: !!r.played,
        video: r.video || null, teams: byMatch.get(`${code}|${key}`) ?? [],
      });
    }
  }
  return out;
}
