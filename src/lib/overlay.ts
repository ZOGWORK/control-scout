// The broadcast overlay (/events/:season/:code/overlay, pages/EventOverlayPage.tsx): a lower-third for an
// event's stream, added in OBS as a browser source over the video. What the bar shows is the Watch live
// rail's pick (lib/watchRail.ts: the match being called, its result for a minute once it's in, then the
// next one), so the overlay and the rail never disagree. Pure, tested in overlay.test.ts.
//
//   now      the match on the field (its start has passed, no result yet) or next up, with each side's win chance.
//   result   the result of the match the bar was calling, with whether the call it showed was right (RESULT_MS).
//   last     nothing left to call (every match played, or the event over): the last result stays up,
//            "Final result" once the event is finished.
//   empty    no schedule posted yet (or a finished event with no results posted).
//
// Query options (keep to these): ?bg=green (a solid chroma-key green instead of transparent), ?pos=top (the
// bar at the top), ?scale=0.8 (the bar's size, 0.5–1.5; the page never lets it grow past the screen's width).
import type { EventDetail, MatchPredictionView, MatchView } from "../shared/api";
import { oddsPct } from "../shared/share";
import { lastPlayed } from "./pitDisplay";
import { verdict, type Flip, type Rail } from "./watchRail";

export interface OverlayOptions { bg: "transparent" | "green"; pos: "bottom" | "top"; scale: number }

export const SCALE_MIN = 0.5;
export const SCALE_MAX = 1.5;
/** The chroma-key green OBS's filter defaults to. */
export const CHROMA_GREEN = "#00ff00";

/** The overlay's options from its query string; anything unknown or malformed falls back to the default. */
export function overlayOptions(search: string | URLSearchParams): OverlayOptions {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const bg = sp.get("bg")?.toLowerCase() === "green" ? "green" : "transparent";
  const pos = sp.get("pos")?.toLowerCase() === "top" ? "top" : "bottom";
  const raw = sp.get("scale");
  const n = raw != null && raw.trim() !== "" ? Number(raw) : NaN;
  const scale = Number.isFinite(n) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, n)) : 1;
  return { bg, pos, scale };
}

export interface OverlayTeam { number: number; name: string | null }
export interface OverlaySide { teams: OverlayTeam[]; score: number | null; won: boolean }

export type OverlayKind = "now" | "result" | "last" | "empty";

export interface OverlayModel {
  kind: OverlayKind;
  /** The bar's heading: "On the field", "Up next", "Result", "Final result", "Last result". */
  heading: string;
  match: MatchView | null;
  /** The call the bar shows (for a result: the one shown before it, as the rail keeps it). */
  prediction: MatchPredictionView | null;
  red: OverlaySide;
  blue: OverlaySide;
  /** How the call went (results only). */
  verdict: "called" | "upset" | null;
}

/** The teams of an alliance: those on the field once played (a surrogate list can be longer), else everyone listed. */
function sideOf(m: MatchView, c: "red" | "blue", names: ReadonlyMap<number, string | null>): OverlaySide {
  const s = m[c];
  const on = m.played ? s.teams.filter((t) => t.onField) : s.teams;
  const other = m[c === "red" ? "blue" : "red"].score?.total;
  const score = m.played ? (s.score?.total ?? null) : null;
  return {
    teams: (on.length ? on : s.teams).map((t) => ({ number: t.number, name: names.get(t.number) ?? null })),
    score,
    won: score != null && other != null && score > other,
  };
}

const NONE: OverlaySide = { teams: [], score: null, won: false };

/** What the bar shows now, from the rail's pick (lib/watchRail.ts railModel) and the event's data. `flip` is the rail's
 *  last flip, kept after its minute: when the last result stays up, it's judged against the call that was on screen
 *  (once scored, the match's own prediction can be a different one, or none), as the timed result was. */
export function overlayModel(d: Pick<EventDetail, "event" | "matches" | "field">, rail: Rail, now: number, flip: Flip | null = null): OverlayModel {
  const names = new Map(d.field.map((f) => [f.team, f.name]));
  const build = (kind: OverlayKind, heading: string, match: MatchView): OverlayModel => ({
    kind, heading, match, prediction: match.prediction,
    red: sideOf(match, "red", names), blue: sideOf(match, "blue", names),
    verdict: kind === "now" ? null : verdict(match),
  });
  if (rail.result) return build("result", "Result", rail.result);
  if (rail.current) {
    const start = rail.current.startsAt ? Date.parse(rail.current.startsAt) : NaN;
    return build("now", Number.isFinite(start) && start <= now ? "On the field" : "Up next", rail.current);
  }
  // Nothing left to call (or the rail hides: the event is finished): the last result stays on screen.
  const last = lastPlayed(d.matches);
  if (last) return build("last", d.event.status === "finished" ? "Final result" : "Last result", flip?.key === last.key ? { ...last, prediction: flip.shown } : last);
  return { kind: "empty", heading: d.event.status === "finished" ? "Event over" : d.matches.length ? "Up next" : "Schedule", match: null, prediction: null, red: NONE, blue: NONE, verdict: null };
}

/** A team's name as it fits under its number in the bar: whitespace tidied, cut at `max` characters with an ellipsis. */
export function shortName(name: string | null | undefined, max = 22): string | null {
  const s = name?.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** The line under a result: what the model said before it ("Model: red 64%", "Model: even match"). */
export function callWords(p: MatchPredictionView | null): string | null {
  if (!p) return null;
  if (p.pRed === 0.5) return "Model: even match";
  return p.pRed > 0.5 ? `Model: red ${oddsPct(p.pRed)}` : `Model: blue ${oddsPct(1 - p.pRed)}`;
}
