// This weekend (docs/weekend.md): the weekend's FTC events, and a team's next match. One reading of each, so the
// "This weekend" page (src/pages/WeekendPage.tsx, GET /api/weekend), the team page's Upcoming (GET
// /api/teams/:number/next) and search ("events this weekend", "4215 next match": ./answers/weekend.ts) list the same
// events, the same match, the same time and the same call.
//
// Rules:
//   - the weekend is search's own window (src/shared/query/time.ts weekendWindow): Saturday and Sunday, on a Sunday
//     the weekend under way. Each event is placed on its own calendar (its time zone; UTC when unknown), so a meet
//     under way in Los Angeles at 02:00 UTC on Sunday is still this weekend's there.
//   - the current season only; volunteer sign-ups are no event.
//   - a place: a state ("USA:NJ") or a whole country ("Romania"), as Rankings takes it.
//   - a team's next match is the match its team page shows (src/shared/nextMatch.ts), with the same call (the match
//     list's: ./matches.ts matchViews, the live call logged, else one worked out now by the same engine).
import { all } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { ROSTER } from "../data/registrations.js";
import { weekendWindow, type Weekend } from "../../src/shared/query/time.js";
export { inWeekend };
import { eventStatus } from "../../src/shared/eventDay.js";
import { dateRange, place, seasonLabel } from "../../src/shared/format.js";
import { nextMatchOf, type NextMatchEvent } from "../../src/shared/nextMatch.js";
import type { MatchView } from "../../src/shared/api.js";
import { dayAt, inWeekend, type NextMatchAnswer, type WeekendAnswer, type WeekendEvent } from "../../src/shared/weekend.js";
import { matchViews } from "./matches.js";
import { eventRecording } from "../videos/recordings.js";
import { regionLabel } from "../../src/shared/regions.js";

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A place as Rankings takes it ("USA:NJ", "Romania"), or null. */
export function weekendPlace(key: string | null | undefined): { key: string; country: string; state: string | null; name: string } | null {
  const k = (key ?? "").trim();
  if (!k) return null;
  const [country, state] = k.split(":");
  if (!country) return null;
  return { key: k, country, state: state || null, name: state ? regionLabel(k) || state : country };
}

/** An event as read for the weekend: its own row, its divisions under it. */
export interface WeekendRow { season: number; code: string; name: string; type: string | null; division_code?: string | null; city: string | null; state: string | null; country: string | null; start: string | null; end: string | null; timezone: string | null }

/** Events as the page and search list them: teams listed (its divisions' too), played matches, whether it's live where
 *  it is, and its recording. In the order given. Divisions are left out (their event stands for them). */
export async function eventCards(rows: WeekendRow[], now = Date.now()): Promise<WeekendEvent[]> {
  const main = rows.filter((r) => !r.division_code);
  if (!main.length) return [];
  const keys = main.map(() => "(e.season = ? AND (e.code = ? OR e.division_code = ?))").join(" OR ");
  const args = main.flatMap((r) => [r.season, r.code, r.code]);
  const [teams, games] = await Promise.all([
    all<{ season: number; code: string; n: number }>(`SELECT e.season, COALESCE(e.division_code, e.code) code, COUNT(DISTINCT r.team) n FROM events e JOIN ${ROSTER} r ON r.season = e.season AND r.code = e.code WHERE ${keys} GROUP BY e.season, COALESCE(e.division_code, e.code)`, args),
    all<{ season: number; code: string; played: number; total: number }>(`SELECT m.season, m.code, SUM(m.played = 1) played, COUNT(*) total FROM matches m WHERE ${main.map(() => "(m.season = ? AND m.code = ?)").join(" OR ")} GROUP BY m.season, m.code`, main.flatMap((r) => [r.season, r.code])),
  ]);
  const k = (s: number, c: string) => `${s}|${c}`;
  const nTeams = new Map(teams.map((t) => [k(Number(t.season), t.code), Number(t.n)]));
  const nGames = new Map(games.map((g) => [k(Number(g.season), g.code), { played: Number(g.played), total: Number(g.total) }]));
  return Promise.all(main.map(async (r) => {
    const g = nGames.get(k(Number(r.season), r.code)) ?? { played: 0, total: 0 };
    const status = eventStatus({ start: r.start, end: r.end, timezone: r.timezone }, g.played, g.total, now);
    const rec = status === "upcoming" ? null : await eventRecording(Number(r.season), r.code).catch(() => null);
    return {
      season: Number(r.season), code: r.code, name: r.name, type: r.type, place: place(r.city, r.state, r.country) || null, city: r.city, state: r.state, country: r.country,
      start: r.start, end: r.end, timezone: r.timezone, dates: dateRange(r.start, r.end) || null, teams: nTeams.get(k(Number(r.season), r.code)) ?? 0, status,
      href: `/events/${r.season}/${encodeURIComponent(r.code)}`, ...(rec ? { recording: `https://www.youtube.com/watch?v=${rec.videoId}` } : {}),
    };
  }));
}

/** The weekend's events: `which` weekend (this one unless said), in `region` when given, of `types` when given (FIRST's
 *  event types: "meets this weekend"), the current season. `today`: the date the page's heading is read from (the
 *  viewer's own; UTC's when not given). In date order, then by name; an event's divisions are under it, not apart. */
export async function weekendEvents(opts: { which?: Weekend; region?: string | null; types?: readonly string[] | null; now?: number; today?: string | null } = {}): Promise<WeekendAnswer> {
  const which = opts.which ?? "this", now = opts.now ?? Date.now();
  const today = opts.today && /^\d{4}-\d\d-\d\d$/.test(opts.today) ? opts.today : new Date(now).toISOString().slice(0, 10);
  const shown = weekendWindow(which, today);
  const region = weekendPlace(opts.region);
  // Read wide (a week either side: a calendar a day off UTC's can move "this weekend" a whole week), then each event
  // placed on its own calendar.
  const sql = ["season = ?", "(type IS NULL OR type <> 'VolunteerSignup')", "division_code IS NULL", "COALESCE(end, start) >= ?", "start <= ?"];
  const args: (string | number)[] = [CURRENT_SEASON, addDays(shown.from, -8), addDays(shown.to, 8)];
  if (region) { sql.push(region.state ? "country = ? AND state = ?" : "country = ?"); args.push(region.country, ...(region.state ? [region.state] : [])); }
  const rows = await all<WeekendRow>(`SELECT season, code, name, type, division_code, city, state, country, start, end, timezone FROM events WHERE ${sql.join(" AND ")}`, args);
  const kept = rows.filter((r) => inWeekend(r, which, now, today) && (!opts.types || opts.types.includes(r.type ?? "")))
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  return { which, season: CURRENT_SEASON, seasonLabel: seasonLabel(CURRENT_SEASON), window: { ...shown, label: dateRange(shown.from, shown.to) || shown.from }, region: region ? { key: region.key, name: region.name } : null, events: await eventCards(kept, now) };
}

export { noEventsLine } from "../../src/shared/weekend.js";

/** A team's next match (`now`: the moment it's read at): its next unplayed match on a posted schedule this weekend,
 *  with the event, time, alliance, partners, opponents and the call; else what it has this weekend or next. Never a
 *  match, time or call that isn't on record. */
export async function teamNextMatch(team: number, now = Date.now()): Promise<NextMatchAnswer> {
  const season = CURRENT_SEASON;
  const [named, events, matches] = await Promise.all([
    all<{ name: string | null; state: string | null; country: string | null }>("SELECT name, state, country FROM teams WHERE number = ?", [team]),
    all<NextMatchEvent & { city: string | null; state: string | null; country: string | null }>(
      `SELECT DISTINCT e.season, e.code, e.name, e.type, e.start, e.end, e.timezone, e.city, e.state, e.country FROM ${ROSTER} r JOIN events e ON e.season = r.season AND e.code = r.code
       WHERE r.team = ? AND r.season = ? AND (e.type IS NULL OR e.type <> 'VolunteerSignup') ORDER BY e.start, e.code`, [team, season]),
    matchViews({ season, team }, { predictUnplayed: true }),
  ]);
  const name = named[0]?.name ?? null;
  const pick = nextMatchOf(matches, events, now);
  const weekend = events.filter((e) => inWeekend(e, "this", now));
  // This weekend's matches already played: their scores and videos, never a time.
  const playedHere = matches.filter((m) => m.played && weekend.some((e) => e.code === m.code));
  const played = playedHere.slice(-3).map((m) => matchLine(m, team, events));
  const next = events.find((e) => !eventEnded(e, now) && !weekend.some((w) => w.code === e.code)) ?? null;
  const base = { team, name, season, seasonLabel: seasonLabel(season), played };
  if (pick && weekend.some((e) => e.code === pick.code)) return { ...base, kind: "match", match: matchLine(pick, team, events) };
  // An event this weekend with no match of the team's listed yet: said so, the event linked.
  const here = weekend.find((e) => !eventEnded(e, now));
  if (here) return { ...base, kind: "no-schedule", event: eventLine(here, team), line: `${here.name} is this weekend: its match list isn't posted yet.` };
  if (next) return { ...base, kind: "next-event", event: eventLine(next, team), line: `No matches this weekend — next event is ${next.name} on ${dateRange(next.start, next.end)}.` };
  return { ...base, kind: "none", line: `No matches this weekend — ${team} has no upcoming event in ${seasonLabel(season)}.` };
}

const eventEnded = (e: { start: string | null; end: string | null; timezone: string | null }, now: number) => (e.end ?? e.start ?? "") < dayAt(now, e.timezone);
const eventLine = (e: NextMatchEvent & { city?: string | null; state?: string | null; country?: string | null }, team: number) =>
  ({ season: e.season, code: e.code, name: e.name, dates: dateRange(e.start, e.end) || null, place: place(e.city ?? null, e.state ?? null, e.country ?? null) || null, href: `/events/${e.season}/${encodeURIComponent(e.code)}?team=${team}` });

/** A match as every surface shows it: the event, its label, its time (the event's own clock, with its zone), the team's
 *  side, partners and opponents, and the call or the score. */
function matchLine(m: MatchView, team: number, events: NextMatchEvent[]): NonNullable<NextMatchAnswer["match"]> {
  const e = events.find((x) => x.code === m.code);
  const side = m.red.teams.some((t) => t.number === team) ? "red" : "blue";
  const own = side === "red" ? m.red : m.blue, other = side === "red" ? m.blue : m.red;
  const t = (x: { number: number; name?: string }) => ({ number: x.number, name: x.name ?? null });
  const chance = m.prediction ? (side === "red" ? m.prediction.pRed : 1 - m.prediction.pRed) : null;
  return {
    season: m.season, code: m.code, event: e?.name ?? m.code, key: m.key, label: m.label, played: m.played,
    // A played match never shows when it was scheduled: its score instead.
    time: m.played ? null : m.time, startsAt: m.played ? null : m.startsAt, timezone: e?.timezone ?? null,
    alliance: side, partners: own.teams.filter((x) => x.number !== team).map(t), opponents: other.teams.map(t),
    ...(m.played && own.score && other.score ? { score: { own: own.score.total, opp: other.score.total, result: own.score.total > other.score.total ? "W" : own.score.total < other.score.total ? "L" : "T" } } : {}),
    ...(!m.played && m.prediction && chance != null ? { prediction: { chance, tier: m.prediction.tier, ownMean: side === "red" ? m.prediction.redMean : m.prediction.blueMean, oppMean: side === "red" ? m.prediction.blueMean : m.prediction.redMean, kind: m.prediction.kind } } : {}),
    ...(m.played && m.video ? { video: m.video } : {}),
    href: `/events/${m.season}/${encodeURIComponent(m.code)}/match/${encodeURIComponent(m.key)}`,
  };
}
