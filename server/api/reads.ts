// The answers of the public read routes whose JSON an event pack carries (server/packs/eventApi.ts), one function
// each, called by the route (server/app.ts) and by the pack builder alike: the pack holds the server's own answer,
// never a re-implementation. Null: the route answers 404.
import { matchDetail, matchViews } from "./matches.js";
import { teamReportCards, teamSchedule } from "./teams.js";
import { eventMatchSpan, eventRecording, withClips } from "../videos/recordings.js";
import type { EventDetail, MatchDetail,MatchView, TeamReportCardAnswer, TeamScheduleAnswer } from "../../src/shared/api.js";

/** GET /api/teams/:number/matches?season=S: the team's season matches, unplayed ones with today's call. */
export async function teamMatchesAnswer(team: number, season: number): Promise<{ team: number; season: number; matches: MatchView[] }> {
  return { team, season, matches: await matchViews({ season, team }, { predictUnplayed: true }) };
}

/** GET /api/teams/:number/schedule?season=S (the scheduleDifficulty switch gates the route). */
export async function teamScheduleAnswer(team: number, season: number): Promise<TeamScheduleAnswer> {
  return { team, season, schedule: await teamSchedule(season, team) };
}

/** GET /api/teams/:number/report-card?season=S. */
export async function teamReportCardAnswer(team: number, season: number): Promise<TeamReportCardAnswer> {
  return { team, season, reportCards: await teamReportCards(season, team) };
}

/** GET /api/events/:season/:code/matches/:key: the match and its context, with the clip it has on the event page. */
/** `event`: the event's detail (eventDetail) when the caller already built it for many matches (the pack builder). */
export async function matchDetailAnswer(season: number, code: string, key: string, event?: EventDetail | null): Promise<MatchDetail | null> {
  const d = await matchDetail(season, code, key, event);
  if (!d) return null;
  const rec = await eventRecording(d.event.season, d.event.code).catch(() => null);
  // The event's own first and last matches, so this match gets the clip it has on the event page.
  return rec ? { ...d, match: withClips([d.match], rec, Date.now(), await eventMatchSpan(d.event.season, d.event.code))[0] } : d;
}
