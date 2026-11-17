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
import type { CoverageFrames, CoverageMatch, CoverageReason, FrameQueueSummary } from "../../src/shared/api.js";

/** Reasons a frame read can't change: no video to read, one YouTube won't play, or no start time to place a match by. */
export const UNREADABLE: ReadonlySet<CoverageReason> = new Set<CoverageReason>(["no-start", "no-zone", "no-recording-day", "video-unavailable", "no-first-video"]);
/** The video's YouTube facts aren't in yet: the reader waits for them (it reads no video without its facts). */
const FACTS_PENDING: CoverageReason = "video-unread";

/** One event as the queue reads it: its last day (YYYY-MM-DD, the venue's) and its missing matches with their video checks. */
export interface QueueEvent { season: number; code: string; name: string; end: string | null; missing: CoverageMatch[] }
/** An event's place with the frame reader, before ranking: `due`, the missing matches a read could place now. */
export interface FrameStatus extends CoverageFrames { due: number }

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "es"}`;
/** The UTC date of `now`, YYYY-MM-DD. An event is over from the day after its last day, wherever it was. */
const day = (now: number) => new Date(now).toISOString().slice(0, 10);

/** The date a match's video was read for this event, or null. Coverage carries the video check only where the clock
 *  alone left the match out, or it fell between two recordings (both checked, betweenCheck); the frame rows themselves
 *  say it for the rest, so a row merged since the last coverage check counts at once. */
const checkedOf = (m: CoverageMatch, code: string) => (m.video ? m.video.checked : m.videoId ? videoCheck(m.videoId, code, m.label, []).checked : null) ?? null;

/** How one missing match stands with the frame reader. */
function matchState(m: CoverageMatch, checked: string | null, end: string | null): "unreadable" | "facts" | "unread" | "stale" | "read" {
  const reason = m.reason ?? "unexplained";
  // Between two recordings it has no video of its own, only its check of both.
  const between = reason === "between-recordings" && !!m.video;
  if (!between && (!m.videoId || UNREADABLE.has(reason))) return "unreadable";
  if (reason === FACTS_PENDING) return "facts";
  if (!checked) return "unread";
  // Read on or before the event's last day: matches played after that read aren't in it.
  return end && checked.slice(0, 10) <= end ? "stale" : "read";
}

/** Where one event stands with the frame reader (not yet ranked): queued, waiting for the event to end or for its
 *  video's facts, read (with what's still missing), or nothing a read can fix. */
export function frameStatus(e: QueueEvent, now = Date.now()): FrameStatus {
  const states = e.missing.map((m) => { const checked = checkedOf(m, e.code); return { m, checked, s: matchState(m, checked, e.end) }; });
  const n = (s: string) => states.filter((x) => x.s === s).length;
  const due = n("unread") + n("stale"), readable = due + n("read") + n("facts");
  if (!readable) {
    const top = topReason(e.missing);
    return { state: "unreadable", matches: 0, due: 0, why: `Nothing a frame read can place${top ? `: ${top}` : ""}` };
  }
  const end = e.end ?? e.missing.map((m) => m.date).filter((d): d is string => !!d).sort().at(-1) ?? null;
  if (due && end && end >= day(now)) return { state: "waiting", matches: due, due: 0, why: `Waits for the event to finish (last day ${end}): ${plural(due, "match")} to read then` };
  if (due) {
    const stale = n("stale");
    return { state: "queued", matches: due, due, why: `Queued for a frame read: ${plural(due, "match")}${stale === due ? ", read before the event finished" : stale ? ` (${stale} read before the event finished)` : ""}` };
  }
  if (n("facts") && !n("read")) return { state: "waiting", matches: n("facts"), due: 0, why: `Waits for YouTube's facts for its video: ${plural(n("facts"), "match")}` };
  const at = states.map((x) => x.checked).filter((d): d is string => !!d).sort().at(-1) ?? null;
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
  queued.forEach((e, i) => { e.frames.rank = i + 1; e.frames.why += ` · ${ordinal(i + 1)} in line`; });
  return queued;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** Every event with a played match missing a clip, as clip_coverage holds it, with its place with the frame reader. */
export async function frameQueue(now = Date.now()): Promise<{ season: number; code: string; name: string; frames: FrameStatus }[]> {
  const rows = await all<{ season: number; code: string; name: string | null; end: string | null; detail: string }>(
    `SELECT c.season, c.code, e.name, e.end, c.detail FROM clip_coverage c LEFT JOIN events e ON e.season = c.season AND e.code = c.code
     WHERE c.with_clip < c.played AND c.state != 'none'`);
  const out: { season: number; code: string; name: string; frames: FrameStatus }[] = [];
  for (let i = 0; i < rows.length; i++) {
    // Parsing hundreds of missing lists is work between reads: let other requests in as it goes.
    if (i % 50 === 49) await busyTurn();
    const r = rows[i];
    let missing: CoverageMatch[] = [];
    try { missing = (JSON.parse(String(r.detail)) ?? {}).missing ?? []; } catch { /* an unreadable detail: nothing to queue */ }
    const e: QueueEvent = { season: Number(r.season), code: String(r.code), name: String(r.name ?? r.code), end: r.end ?? null, missing };
    out.push({ season: e.season, code: e.code, name: e.name, frames: frameStatus(e, now) });
  }
  rankQueue(out);
  return out;
}

/** The queue in numbers for the owner console: events and matches queued, and the next few in line. */
export function queueSummary(events: { season: number; code: string; name: string; frames: FrameStatus }[], next = 5): FrameQueueSummary {
  const queued = events.filter((e) => e.frames.state === "queued").sort((a, b) => (a.frames.rank ?? 0) - (b.frames.rank ?? 0));
  return {
    queued: queued.length, matches: queued.reduce((s, e) => s + e.frames.due, 0),
    waiting: events.filter((e) => e.frames.state === "waiting").length,
    next: queued.slice(0, next).map((e) => ({ season: e.season, code: e.code, name: e.name, matches: e.frames.due })),
  };
}
