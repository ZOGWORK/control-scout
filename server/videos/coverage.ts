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
import { frameRow, outsideRecording, plausibleStarts, playableStarts } from "../data/frameTimings.js";
import { noOverlayFor, noOverlayReason } from "../data/noOverlay.js";
import { dayLabel, eventSpan, previousStart, seasonRecordings, withClips, withConfirmed, within, type EventSpan, type Recording, type RecordingVideo } from "./recordings.js";
import type { ClipCoverage, CoverageMatch, CoverageReason, CoverageVideo, CoverageVideoCheck } from "../../src/shared/api.js";

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
  // Under a minute: in seconds, never "0 min".
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  const m = mins(s);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

/** How far a video falls short of its broadcast (seconds), or null when that can't be told. */
function missingOf(meta: RecordingTiming): number | null {
  if (!meta.start || !meta.end || meta.length == null || meta.live) return null;
  const v = (Date.parse(meta.end) - Date.parse(meta.start)) / 1000 - meta.length;
  return Number.isFinite(v) ? v : null;
}

export const WHY: Record<CoverageReason, string> = {
  "no-start": "No real start time from FIRST",
  "no-zone": "The event's time zone isn't known, so its start can't be placed",
  "no-recording-day": "No recording for that day",
  "outside-span": "Outside every recording's time",
  "before-broadcast": "Played before the broadcast started",
  "after-broadcast": "Played after the broadcast ended",
  "video-unavailable": "Recording can't be played: unavailable on YouTube (private or removed)",
  "video-no-embed": "Recording can't be read: its owner turned off playing it on other sites, so its frames can't be read",
  "video-no-overlay": "Recording shows no match overlay (no score bar, timer or match name), so no frame can place its matches",
  "video-stutters": "Recording stutters (its picture holds still, then skips ahead), so its overlay timer never runs and no frame can confirm where a match starts",
  "video-unread": "Video's facts not read from YouTube yet",
  "no-clock": "Video has no broadcast clock (an upload, not a live stream)",
  "gap-unplaced": "Video shorter than its broadcast, missing time can't be placed",
  "past-chapters": "Past the part of the video its chapters confirm",
  "past-checked": "Past the part of the video checked frame by frame",
  "past-video-end": "After the video ends",
  "before-cut": "Before the video starts",
  "before-chapters": "Before the part of the video its chapters confirm",
  "overlaps-previous": "An early start would open on the match before",
  "between-recordings": "Played between two of the day's recordings, in neither",
  "no-first-video": "FIRST posted no video for this match",
  unexplained: "No clip, reason not found",
};

/** Reasons that rest on the clock alone, never on the video: an early start, or a time outside the video's. Their match
 *  may still be in the video, so what the video itself showed (its frames) is said instead (videoCheck). */
export const CLOCK_ONLY: ReadonlySet<CoverageReason> = new Set<CoverageReason>([
  "overlaps-previous", "before-broadcast", "after-broadcast", "before-cut", "past-video-end", "before-chapters", "past-chapters", "outside-span",
]);

/** Reasons that settle a match because its recording can't be played here at all (video_meta: unavailable, or embedding
 *  off), as recorded per video by the YouTube facts read (server/videos/recordings.ts saveMeta), read again weekly: not
 *  "missing" work, since no frame read or clip can reach it until the video plays again. */
export const UNPLAYABLE: ReadonlySet<CoverageReason> = new Set<CoverageReason>(["video-unavailable", "video-no-embed", "video-no-overlay", "video-stutters"]);

/** Reasons only a frame read could settle (it would show where the match is): the clock's, and a gap the clock can't
 *  place. A video no frame read can play turns these into video-no-embed. Not "unexplained": no reason found is a
 *  coverage gap, not a frame one; its clock clip may still be owed (embedding off, clips still open on youtube.com), so
 *  it stays To review. */
export const FRAME_SETTLES: ReadonlySet<CoverageReason> = new Set<CoverageReason>([...CLOCK_ONLY, "gap-unplaced"]);

/** "since 2026-10-24, checked again weekly (last 2026-11-17)": when a video was first read as unplayable, and its last read. */
function unplayableDates(meta: { unplayableSince?: string; checkedAt?: string } | null | undefined): string {
  const since = meta?.unplayableSince?.slice(0, 10), last = meta?.checkedAt?.slice(0, 10);
  return `${since ? ` since ${since}` : ""}; checked again weekly${last ? ` (last ${last})` : ""}`;
}

/** 10440 → "2:54:00", 209 → "0:03:29": a second in a video. */
export function hms(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** What a video's frames showed of one match (`order`: the event's played matches in time order, for the nearest ones
 *  the frames placed in it). Unread: `checked` null. */
export function videoCheck(videoId: string, code: string, label: string, order: string[]): CoverageVideoCheck {
  const row = frameRow(videoId, code);
  // Not read, or the video couldn't be played (read again on the next run): not checked yet.
  if (!row || row.missing?.[label]?.startsWith(PLAY_FAILED)) return { checked: null };
  const starts = playableStarts(row);
  const i = order.indexOf(label);
  const near = (step: number) => {
    for (let j = i + step; i >= 0 && j >= 0 && j < order.length; j += step) if (starts[order[j]] != null) return { label: order[j], at: starts[order[j]] };
    return undefined;
  };
  const before = near(-1), after = near(1);
  const out: CoverageVideoCheck = { checked: row.checked, ...(before ? { before } : {}), ...(after ? { after } : {}) };
  const early = row.earlyStart?.[label];
  if (early) return { ...out, earlyStart: early };
  const seen = row.review?.[label];
  if (seen) return { ...out, seenAt: seen.t, found: seen.why };
  // A read seen, never placed: the server plays it, yet no clip (withClips keeps a video's starts only in the order the
  // matches were played, inOrder in server/videos/recordings.ts: a replay shown in a break, an older misread); or the
  // plausibility check left it out (it overlaps another); or its clip's opening frame was checked and didn't name it.
  if (row.starts[label] != null) {
    const found = starts[label] != null ? "its read breaks the order the matches were played in"
      : plausibleStarts(row.starts, row.opens)[label] == null ? "its read overlaps another match's"
      : "its clip's opening frame doesn't name it";
    return { ...out, seenAt: row.starts[label], found };
  }
  // Played before the recording starts or after it ends, as its first or last frames show: not in it at all.
  const outside = outsideRecording(row, label, order);
  if (outside) return { ...out, outside };
  if (row.missing?.[label]) return { ...out, found: row.missing[label] };
  // Read, and none of the event's matches are in it (they're all another of its videos').
  return !Object.keys(row.starts).length && !row.missing ? { ...out, found: "none of this event's matches are in it" } : out;
}

/** A video's frame read that couldn't play it (scripts/video-frames.ts): read again on the next run. */
const PLAY_FAILED = "the video couldn't be played";

/** A match played between two of a day's recordings (after `before` ended, before `after` started): checked once both
 *  videos' frames were read and neither holds it (seen in one: said so). */
function betweenCheck(ids: [string, string], code: string, label: string, order: string[]): CoverageVideoCheck {
  const checks = ids.map((id) => videoCheck(id, code, label, order));
  if (checks.some((c) => !c.checked)) return { checked: null };
  const seen = checks.find((c) => c.seenAt != null);
  if (seen) return seen;
  return { checked: checks.map((c) => c.checked!).sort().at(-1)!, found: "in neither video" };
}

/** A clock time at the venue: "9:45 AM". */
function venueTime(iso: string, timezone: string | null | undefined): string {
  try { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone ?? "UTC" }).format(Date.parse(iso)); } catch { return iso.slice(11, 16); }
}

/** A match's video check in plain words: what the video showed, never what the clock said. */
export function videoWhy(v: CoverageVideoCheck): string {
  const near = [v.before && `${v.before.label} at ${hms(v.before.at)}`, v.after && `${v.after.label} at ${hms(v.after.at)}`].filter(Boolean).join(", ");
  const inVideo = near ? `; in the video, ${near}` : "";
  if (v.earlyStart) return `Checked in the video: it starts at ${hms(v.earlyStart.t)} while the match before runs to ${hms(v.earlyStart.previousEnds)}, so a clip would open on that one`;
  if (!v.checked) return `Not yet checked against the video${inVideo}`;
  if (v.seenAt != null) return `Checked in the video (${v.checked}): seen at ${hms(v.seenAt)}, not yet confirmed${v.found ? ` (${v.found})` : ""}`;
  if (v.outside) return `Checked in the video (${v.checked}): not in the recording, ${v.outside}`;
  return `Checked in the video (${v.checked}): no start found for it${v.found ? ` (${v.found})` : ""}${inVideo}`;
}

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
  if (meta.status === "unavailable") return { v, date, label, dead: { reason: "video-unavailable", why: WHY["video-unavailable"] + unplayableDates(meta) } };
  if (meta.status !== "ok") return { v, date, label, dead: { reason: "video-unread", why: "YouTube's facts couldn't be read" } };
  if (!meta.start) return { v, date, label, dead: { reason: "no-clock", why: WHY["no-clock"] } };
  // A finished broadcast whose length YouTube didn't give: clipSecond has no end to place a match against.
  if (meta.length == null && !meta.live) return { v, date, label, dead: { reason: "video-unread", why: "YouTube didn't give the video's length" } };
  const held = r.daily || r.more?.length ? eventSpan(whole.starts.filter((s) => within(s.startsAt, meta, now))) : whole;
  const timing: RecordingTiming = withConfirmed(v.videoId, meta, held);
  const slack = gapSlack(timing);
  const starts = held.starts.map((s) => (s.startsAt ? Date.parse(s.startsAt) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  if (slack == null) {
    const missing = missingOf(timing);
    const chapters = meta.chapters?.length ? "its chapters don't confirm the clock" : "no chapters to confirm the clock";
    const why = missing != null
      ? `Video ${span(missing)} shorter than its broadcast (more than the ${mins(GAP_SLACK_MAX_S)} min the clock allows for), ${chapters}`
      : WHY["gap-unplaced"];
    return { v, date, label, timing, dead: { reason: "gap-unplaced", why } };
  }
  const missing = missingOf(timing);
  const basis = timing.confirmedTo != null
    ? (checkedTo(v.videoId) === timing.confirmedTo ? "clock + frames checked by eye"
      : timing.shift ? `clock + YouTube chapters (its first ${span(timing.shift)} cut off)` : "clock + YouTube chapters")
    : slack ? `clock only, started up to ${span(slack)} early (gap can't be placed)`
      : meta.live ? "clock, broadcast still live"
        : missing == null ? "clock, broadcast's end not known (length not compared)"
          : missing > 180 ? "clock, tail of the stream cut after the event"
            : "clock, video length matches its broadcast";
  return { v, date, label, timing, slack, starts, basis };
}

/** Why a played match judged against its videos gets no clip. */
function reasonFor(m: CoverageInput, videos: Judged[], now: number, timezone?: string | null): { reason: CoverageReason; why: string; videoId: string | null; between?: [string, string] } {
  const date = matchDate(m);
  // Counted in its day's video (by the schedule's date), so that day never reads as fully clipped without it.
  // A real start the event's time zone can't place (none known): no clock to judge it by.
  const noZone = actualStart(m.time) && !Number.isFinite(m.startsAt ? Date.parse(m.startsAt) : NaN);
  if (!actualStart(m.time) || noZone) {
    const day = videos.filter((j) => j.date && j.date === date);
    // The part of that day whose broadcast holds its scheduled time, else the day's first. Never another day's: a lone
    // video whose day can't be told is the only other one it may be.
    const part = day.find((j) => j.v.meta?.status === "ok" && j.v.meta.start && within(m.startsAt, j.v.meta, now)) ?? day[0];
    const reason = noZone ? "no-zone" as const : "no-start" as const;
    return { reason, why: WHY[reason], videoId: (part ?? (videos.length === 1 && !videos[0].date ? videos[0] : null))?.v.videoId ?? null };
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
    // Between two of its day's recordings (one ended before it, the next started after): in neither, so never counted
    // against either video, and named as the gap, with both times.
    const at = m.startsAt ? Date.parse(m.startsAt) : NaN;
    const clocked = (sameDay.length ? sameDay : videos).filter((x) => x.v.meta?.status === "ok" && x.v.meta.start && x.v.meta.end);
    const ended = clocked.filter((x) => Date.parse(x.v.meta!.end!) <= at).sort((a, b) => Date.parse(b.v.meta!.end!) - Date.parse(a.v.meta!.end!))[0];
    const next = clocked.filter((x) => Date.parse(x.v.meta!.start!) > at).sort((a, b) => Date.parse(a.v.meta!.start!) - Date.parse(b.v.meta!.start!))[0];
    if (ended && next && ended !== next) {
      return {
        reason: "between-recordings", videoId: null, between: [ended.v.videoId, next.v.videoId],
        why: `Played between the recordings (after ${ended.v.videoId} ended at ${venueTime(ended.v.meta!.end!, timezone)}, before ${next.v.videoId} started at ${venueTime(next.v.meta!.start!, timezone)})`,
      };
    }
    const from = j.v.meta?.start ? Date.parse(j.v.meta.start) : NaN;
    return at < from ? { reason: "before-broadcast", why: WHY["before-broadcast"], videoId: id } : { reason: "after-broadcast", why: WHY["after-broadcast"], videoId: id };
  }
  const t = j.timing!, slack = j.slack!, shift = t.shift ?? 0;
  // clipSecond's own steps: the clock against what the chapters vouch for, then the video's seconds (clock − shift).
  const from = Date.parse(t.start!), clock = Math.floor((Date.parse(m.startsAt!) - from) / 1000), offset = clock - shift;
  if (clipSecond(m.startsAt, t, now) == null) {
    if (clock < 0) return { reason: "before-broadcast", why: WHY["before-broadcast"], videoId: id };
    if (t.confirmedTo != null && clock > t.confirmedTo) {
      // withConfirmed's confirmedTo is the chapters' (they set a shift) or else the frames checked by eye.
      const reason = t.shift == null && checkedTo(id) === t.confirmedTo ? "past-checked" as const : "past-chapters" as const;
      return { reason, why: `${WHY[reason]} (to ${span(t.confirmedTo)} into the broadcast)`, videoId: id };
    }
    if (shift && t.confirmedFrom != null && clock < t.confirmedFrom) return { reason: "before-chapters", why: `${WHY["before-chapters"]} (from ${span(t.confirmedFrom)} into the broadcast)`, videoId: id };
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
  const order = played.map((m) => m.label);
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
    let why: ReturnType<typeof reasonFor> = judged.length ? reasonFor(m, judged, now, timezone) : { reason: "no-first-video" as const, why: WHY["no-first-video"], videoId: null };
    // Its video plays on youtube.com only (embedding off) and no frame read of it exists: what a frame read would settle
    // never can be, as neither the frame reader nor the app's player can show it. A video read anyway keeps its check.
    const meta = why.videoId ? judged.find((j) => j.v.videoId === why.videoId)?.v.meta : null;
    if (why.videoId && meta?.status === "ok" && meta.embeddable === false && FRAME_SETTLES.has(why.reason) && !(r?.code && frameRow(why.videoId, r.code))) {
      why = { reason: "video-no-embed", why: WHY["video-no-embed"] + unplayableDates(meta), videoId: why.videoId };
    }
    // A recording whose frames were looked at and can't place a match (server/data/noOverlay.ts: no overlay at all, or a
    // picture that stutters): what only its frames could place never can be. Settled, with the day it was looked at.
    const bare = r?.code ? noOverlayFor(r.code, why.videoId, why.reason) : null;
    if (bare) { const reason = noOverlayReason(bare); why = { reason, why: `${WHY[reason]}; checked ${bare.checked}: ${bare.seen}`, videoId: why.videoId }; }
    if (why.videoId) { const c = counts.get(why.videoId) ?? { matches: 0, clipped: 0 }; c.matches++; counts.set(why.videoId, c); }
    // Between two recordings: the gap is the reason, with whether both videos were checked for it.
    if (why.between && r?.code) {
      const video = betweenCheck(why.between, r.code, m.label, order);
      const said = video.seenAt != null ? `; ${videoWhy(video)}` : video.checked ? `; checked in both videos (${video.checked}): in neither` : "; not yet checked against either video";
      out.push({ ...base, clip: false, videoId: null, reason: why.reason, why: why.why + said, video });
      continue;
    }
    // Left out by the clock alone: what the video's own frames showed of it is the reason (the clock's kept apart).
    if (why.videoId && r?.code && CLOCK_ONLY.has(why.reason)) {
      const video = videoCheck(why.videoId, r.code, m.label, order);
      out.push({ ...base, clip: false, videoId: why.videoId, reason: why.reason, why: videoWhy(video), clock: why.why, video });
      continue;
    }
    // A video too short of its broadcast for the clock to place anything in it, whose frames were read: what they showed
    // is the reason too (played before the recording opens, no start found, seen with no clip), never the shortfall alone.
    if (why.videoId && r?.code && why.reason === "gap-unplaced") {
      const video = videoCheck(why.videoId, r.code, m.label, order);
      if (video.checked) {
        out.push({ ...base, clip: false, videoId: why.videoId, reason: why.reason, why: videoWhy(video), clock: why.why, video });
        continue;
      }
    }
    out.push({ ...base, clip: false, videoId: why.videoId, reason: why.reason, why: why.why });
  }
  const videos: CoverageVideo[] = judged.map((j) => ({
    videoId: j.v.videoId, label: j.label, date: j.date, ...(counts.get(j.v.videoId) ?? { matches: 0, clipped: 0 }),
    ...(j.dead ? { why: j.dead.why } : {}), ...(j.basis ? { basis: j.basis } : {}),
  }));
  // Days with played matches and no video of their own, whatever each match's own reason (a day whose matches all lack
  // a real start is still unrecorded): only when the videos' days are known, and never a day any of whose matches got a
  // clip (a broadcast that ran past midnight holds it).
  const recordedDates = new Set(judged.map((j) => j.date).filter(Boolean));
  const daysMissing = [...new Set(out.map((m) => m.date).filter((d): d is string => !!d))]
    .filter((d) => recordedDates.size && judged.every((j) => j.date) && !recordedDates.has(d) && !out.some((m) => m.date === d && m.clip)).sort()
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

/** An event's matches with no clip served right now that a video's frames saw, by label: the video and the second (its
 *  coverage worked out now, not the stored check, so a start that has since become a clip is never one). Null: no such
 *  event. Owner › Clip coverage's Found in the video, and its Clip from / Not this match. */
export async function seenUnserved(season: number, code: string): Promise<Map<string, { videoId: string; t: number }> | null> {
  const c = await eventClipCoverage(season, code);
  if (!c) return null;
  const out = new Map<string, { videoId: string; t: number }>();
  for (const m of c.matches) if (!m.clip && m.videoId && m.video?.seenAt != null) out.set(m.label, { videoId: m.videoId, t: Math.round(m.video.seenAt) });
  return out;
}

/** How many events' matches eventMatchRows reads at a time. The driver reads synchronously on the server's one thread:
 *  200 events' matches and their teams (a busy season's 10,000-odd matches, 40,000-odd team rows) held it for up to
 *  0.6 s a read in the clip coverage check's first pass after every deploy (every event checked, 2026-11-22). A part
 *  of 10 is a few hundred matches, tens of milliseconds; the reads let the loop turn between them (db.ts busyTurn). */
export const MATCH_ROWS_PART = 10;

/** Matches as coverage reads them, for some events of a season (by code), with their teams. */
export async function eventMatchRows(season: number, codes: string[]): Promise<Map<string, CoverageInput[]>> {
  const out = new Map<string, CoverageInput[]>();
  for (let i = 0; i < codes.length; i += MATCH_ROWS_PART) {
    const part = codes.slice(i, i + MATCH_ROWS_PART), q = part.map(() => "?").join(",");
    // One after the other: started together, both reads wait for the same turn of the loop and then run in it.
    const rows = await all<{ code: string; level: string; series: number; number: number; label: string; time: string | null; played: number; video: string | null; timezone: string | null }>(
        `SELECT m.code, m.level, m.series, m.number, m.label, m.time, m.played, m.video, e.timezone FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code
         WHERE m.season = ? AND m.code IN (${q}) ORDER BY m.code, m.time, m.level DESC, m.series, m.number`, [season, ...part]);
    const teams = await all<{ code: string; level: string; series: number; number: number; team: number }>(
      `SELECT code, level, series, number, team FROM match_teams WHERE season = ? AND code IN (${q}) ORDER BY alliance DESC, station`, [season, ...part]);
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
