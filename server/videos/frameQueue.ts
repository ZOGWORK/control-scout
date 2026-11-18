// The frame-read queue: which events the automatic frame reader (scripts/clip-autopilot.ts) reads next, and where each
// event with a missing clip stands with it. It's read off the clip coverage check's own rows (clip_coverage,
// server/videos/coverageCheck.ts), so a recording the official-videos watcher links, the owner adds, or a refresh of
// YouTube's facts makes due within one check pass (5 minutes), with nobody running anything.
//
// An event is due when it's over (the day after its last day) and a missing match sits in one of its videos that a
// frame read can place: that video hasn't been read for this event yet (or its read couldn't play it), or it was read
// on or before the event's last day, while matches could still be coming (read again once, after the event). The most
// missing go first. A match no frame read can help (no video, a private one, no real start time from FIRST) never
// queues: its reason stands as it is.
import { all, busyTurn } from "../db.js";
import { WHY, videoCheck } from "./coverage.js";
import { localToUtcMs } from "../../src/shared/time.js";
import type { CoverageFrames, CoverageMatch, CoverageReason, FrameQueueSummary } from "../../src/shared/api.js";

/** Reasons a frame read can't change: no video to read, one YouTube won't play, or no start time to place a match by. */
export const UNREADABLE: ReadonlySet<CoverageReason> = new Set<CoverageReason>(["no-start", "no-zone", "no-recording-day", "video-unavailable", "video-no-embed", "video-no-overlay", "no-first-video"]);
/** The video's YouTube facts aren't in yet: the reader waits for them (it reads no video without its facts). */
const FACTS_PENDING: CoverageReason = "video-unread";

/** One event as the queue reads it: its last day (YYYY-MM-DD, the venue's), the venue's time zone, and its missing
 *  matches with their video checks. */
export interface QueueEvent { season: number; code: string; name: string; end: string | null; timezone?: string | null; missing: CoverageMatch[] }
/** An event's place with the frame reader, before ranking: `due`, the missing matches a read could place now. */
export interface FrameStatus extends CoverageFrames { due: number }

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "es"}`;
/** The UTC date of a moment, YYYY-MM-DD: the calendar a read's `checked` date is written in. */
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** The UTC date the venue's last day ends on (its 23:59:59 there): an evening in America is the next UTC day. A zone
 *  not known is taken as the latest on earth (UTC-12), so no event is called over while it may still be on. */
function lastUtcDay(end: string, timezone: string | null | undefined): string {
  const t = localToUtcMs(`${end}T23:59:59`, timezone || "Etc/GMT+12");
  return t == null ? end : utcDay(t);
}

/** The date a match's video was read for this event, or null: off the frame rows themselves, so a row merged since
 *  the last coverage check counts at once. A match between two recordings has no video of its own: its stored check
 *  of both (betweenCheck) stands. */
const checkedOf = (m: CoverageMatch, code: string) => (m.videoId ? videoCheck(m.videoId, code, m.label, []).checked : m.video?.checked) ?? null;

/** How one missing match stands with the frame reader. */
function matchState(m: CoverageMatch, checked: string | null, last: string | null): "unreadable" | "facts" | "unread" | "stale" | "read" {
  const reason = m.reason ?? "unexplained";
  // Between two recordings it has no video of its own, only its check of both.
  const between = reason === "between-recordings" && !!m.video;
  if (!between && (!m.videoId || UNREADABLE.has(reason))) return "unreadable";
  if (reason === FACTS_PENDING) return "facts";
  if (!checked) return "unread";
  // Read on or before the UTC day the event's last day ends on: matches played after that read may not be in it. The
  // queue only reads after that day (frameStatus), so a read it makes settles: never read twice for this.
  // No last day known: the event may still be on, so no read of it is taken as after it.
  return !last || checked.slice(0, 10) <= last ? "stale" : "read";
}

/** Where one event stands with the frame reader (not yet ranked): queued, waiting for the event to end or for its
 *  video's facts, read (with what's still missing), or nothing a read can fix. */
export function frameStatus(e: QueueEvent, now = Date.now()): FrameStatus {
  // The last day: the event's own, else its latest missing match's.
  const end = e.end ?? e.missing.map((m) => m.date).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const last = end ? lastUtcDay(end, e.timezone) : null;
  const states = e.missing.map((m) => { const checked = checkedOf(m, e.code); return { m, checked, s: matchState(m, checked, last) }; });
  const n = (s: string) => states.filter((x) => x.s === s).length;
  const due = n("unread") + n("stale"), readable = due + n("read") + n("facts");
  if (!readable) {
    const top = topReason(e.missing);
    return { state: "unreadable", matches: 0, due: 0, why: `Nothing a frame read can place${top ? `: ${top}` : ""}` };
  }
  // No last day known (no end stored, no missing match dated): it may still be on, so it waits rather than queue early.
  if (due && !last) return { state: "waiting", matches: due, due: 0, why: `Waits for the event's last day to be known: ${plural(due, "match")} to read then` };
  if (due && last && last >= utcDay(now)) return { state: "waiting", matches: due, due: 0, why: `Waits for the event to finish (last day ${end}): ${plural(due, "match")} to read then` };
  if (due) {
    const stale = n("stale");
    return { state: "queued", matches: due, due, why: `Queued for a frame read: ${plural(due, "match")}${stale === due ? ", read before the event finished" : stale ? ` (${stale} read before the event finished)` : ""}` };
  }
  // A video whose facts aren't in yet is still to read, whatever the event's other videos showed.
  if (n("facts")) return { state: "waiting", matches: n("facts"), due: 0, why: `Waits for YouTube's facts for its video: ${plural(n("facts"), "match")}${n("read") ? ` (${n("read")} more read, no clip)` : ""}` };
  // The read's date: the matches it read, never one it can't place (a no-start match's video, read another day).
  const at = states.filter((x) => x.s === "read").map((x) => x.checked).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const still = n("read");
  return { state: "read", matches: 0, due: 0, at, why: `Read ${at}: ${plural(still, "match")} still without a clip, as the video shows (see each match)` };
}

/** The commonest reason among the missing, in plain words. */
function topReason(missing: CoverageMatch[]): string | null {
  const count = new Map<CoverageReason, number>();
  for (const m of missing) count.set(m.reason ?? "unexplained", (count.get(m.reason ?? "unexplained") ?? 0) + 1);
  const top = [...count].sort((a, b) => b[1] - a[1])[0];
  return top ? WHY[top[0]] : null;
}

/** The queue, most missing first (then newest season, then code), each given its place in line (`rank`, 1 = next). */
export function rankQueue<T extends { season: number; code: string; frames: FrameStatus }>(events: T[]): T[] {
  const queued = events.filter((e) => e.frames.state === "queued")
    .sort((a, b) => b.frames.due - a.frames.due || b.season - a.season || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  // Ranking again (a list ranked before, filtered) replaces each place: never two, and none left on an event no longer queued.
  for (const e of events) { delete e.frames.rank; e.frames.why = e.frames.why.replace(IN_LINE, ""); }
  queued.forEach((e, i) => { e.frames.rank = i + 1; e.frames.why += ` · ${ordinal(i + 1)} in line`; });
  return queued;
}

const IN_LINE = / · \d+(?:st|nd|rd|th) in line$/;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** Every event with a played match missing a clip, as clip_coverage holds it, with its place with the frame reader. */
export async function frameQueue(now = Date.now(), read: Read = all): Promise<{ season: number; code: string; name: string; frames: FrameStatus }[]> {
  const rows = await read<{ season: number; code: string; name: string | null; end: string | null; timezone: string | null; detail: string }>(
    `SELECT c.season, c.code, e.name, e.end, e.timezone, c.detail FROM clip_coverage c LEFT JOIN events e ON e.season = c.season AND e.code = c.code
     WHERE c.with_clip < c.played AND c.state != 'none'`);
  const out: { season: number; code: string; name: string; frames: FrameStatus }[] = [];
  for (let i = 0; i < rows.length; i++) {
    // Parsing hundreds of missing lists is work between reads: let other requests in as it goes.
    if (i % 50 === 49) await busyTurn();
    const r = rows[i];
    let missing: CoverageMatch[] = [];
    try { missing = (JSON.parse(String(r.detail)) ?? {}).missing ?? []; } catch { /* an unreadable detail: nothing to queue */ }
    const e: QueueEvent = { season: Number(r.season), code: String(r.code), name: String(r.name ?? r.code), end: r.end ?? null, timezone: r.timezone ?? null, missing };
    out.push({ season: e.season, code: e.code, name: e.name, frames: frameStatus(e, now) });
  }
  rankQueue(out);
  return out;
}

/** A read of the database: `all`, or one inside a snapshot (inSnapshot), so the queue and what's beside it agree. */
export type Read = <R>(sql: string, args?: (string | number | null)[]) => Promise<R[]>;

/** The queue in numbers for the owner console: events and matches queued, and the next few in line. */
export function queueSummary(events: { season: number; code: string; name: string; frames: FrameStatus }[], next = 5): FrameQueueSummary {
  const queued = events.filter((e) => e.frames.state === "queued").sort((a, b) => (a.frames.rank ?? 0) - (b.frames.rank ?? 0));
  return {
    queued: queued.length, matches: queued.reduce((s, e) => s + e.frames.due, 0),
    waiting: events.filter((e) => e.frames.state === "waiting").length,
    next: queued.slice(0, next).map((e) => ({ season: e.season, code: e.code, name: e.name, matches: e.frames.due })),
  };
}
