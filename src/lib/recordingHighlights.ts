// Beside a finished event's recording (components/WatchLive.tsx): its best auto, best TeleOp and closest match, from
// the matches the page already holds. Best auto and best TeleOp are one alliance's period score; the closest match is
// the smallest margin between two scored alliances (a tie, margin 0, is the closest of all). A remote event (one
// alliance a match) has no closest match. Each names the alliance's robots that played (all of them if none is marked).
import type { EventDetail, MatchView, RecordingOrigin } from "../shared/api";

export type Side = "red" | "blue";
export interface RecordingHighlight { match: MatchView; side: Side | null; value: number; teams: number[] }
export interface RecordingHighlights { auto: RecordingHighlight | null; teleop: RecordingHighlight | null; closest: RecordingHighlight | null }

const onField = (m: MatchView, c: Side) => {
  const on = m[c].teams.filter((t) => t.onField);
  return (on.length ? on : m[c].teams).map((t) => t.number);
};

export function recordingHighlights(d: Pick<EventDetail, "event" | "matches">): RecordingHighlights {
  const played = d.matches.filter((m) => m.played);
  let auto: RecordingHighlight | null = null;
  let teleop: RecordingHighlight | null = null;
  let closest: RecordingHighlight | null = null;
  for (const m of played) {
    for (const c of ["red", "blue"] as const) {
      const s = m[c].score;
      if (!s || !m[c].teams.length) continue;
      // Strictly higher: the earlier match keeps a tie (the schedule's order).
      if (s.auto > 0 && (!auto || s.auto > auto.value)) auto = { match: m, side: c, value: s.auto, teams: onField(m, c) };
      if (s.teleop > 0 && (!teleop || s.teleop > teleop.value)) teleop = { match: m, side: c, value: s.teleop, teams: onField(m, c) };
    }
    if (!d.event.remote && m.red.score && m.blue.score && m.red.teams.length && m.blue.teams.length) {
      const margin = Math.abs(m.red.score.total - m.blue.score.total);
      // The winner's side (a tie has none): its robots lead the block.
      const side: Side | null = margin === 0 ? null : m.red.score.total > m.blue.score.total ? "red" : "blue";
      if (!closest || margin < closest.value) closest = { match: m, side, value: margin, teams: side ? onField(m, side) : [...onField(m, "red"), ...onField(m, "blue")] };
    }
  }
  return { auto, teleop, closest };
}

/** The line under the player: where the video playing came from, in plain words. Null: not known. */
export function originNote(origin: RecordingOrigin | undefined): string | null {
  switch (origin) {
    case "first": return "From FIRST: the stream link on FIRST's event listing.";
    case "channel": return "Found by our watcher on the YouTube channel FIRST lists for this event.";
    case "watcher": return "Found by our watcher on the organiser's YouTube channel.";
    case "list": return "From our hand-checked list of official event videos.";
    case "owner": return "Added by the site owner.";
    default: return null;
  }
}
