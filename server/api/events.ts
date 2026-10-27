// Event list + event detail + the engine's EventInput for forecasting.
import type { EventInput } from "@control-scout/predict-engine";
import { all, get, kvGet } from "../db.js";
import { eventTypeLabel, isLegacy } from "../data/seasons.js";
import type { EventDetail, EventSummary, FieldRow, MatchView, ProvisionalInfo } from "../../src/shared/api.js";
import { provisionalFor } from "../data/provisional.js";
import { matchViews } from "./matches.js";
import { dataVersion, liveForecaster, liveVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";
import { FULL_EVERY_MS, isEventDay, liveIo, liveSyncOn, liveSyncSeconds } from "../data/live.js";
import { eventStatus } from "../../src/shared/eventDay.js";
import { toEventInput } from "../../src/shared/eventInput.js";
import { meetStandings, type MeetSide } from "../../src/shared/meetStandings.js";

function summary(r: any): EventSummary {
  const played = Number(r.played ?? 0), total = Number(r.total ?? 0);
  return {
    season: Number(r.season), code: r.code, name: r.name, type: r.type, typeLabel: eventTypeLabel(r.type), divisionCode: r.division_code ?? null,
    region: r.region, city: r.city, state: r.state, country: r.country, venue: r.venue ?? null, start: r.start, end: r.end, remote: !!r.remote,
    teams: Number(r.teams ?? 0), matchesPlayed: played, matchesTotal: total, status: eventStatus(r, played, total),
  };
}

const SUMMARY_SQL = `SELECT e.*,
  (SELECT COUNT(*) FROM event_teams t WHERE t.season = e.season AND t.code = e.code) teams,
  (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1) played,
  (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code) total
  FROM events e`;

/** Listed event types that have no matches (kept out of event lists and counts unless asked for). */
export const NO_MATCH_TYPES = ["Kickoff", "Workshop", "DemoExhibition", "VolunteerSignup", "PracticeDay", "InnovationChallenge"] as const;

export interface EventListFilter { season: number; from?: string; to?: string; q?: string; type?: string; region?: string; limit?: number; hideNoMatch?: boolean }

export async function listEvents(f: EventListFilter): Promise<EventSummary[]> {
  const where = ["e.season = ?"];
  const args: (string | number)[] = [f.season];
  if (f.from) { where.push("COALESCE(e.end, e.start) >= ?"); args.push(f.from); }
  if (f.to) { where.push("e.start <= ?"); args.push(f.to); }
  if (f.type) { where.push("e.type = ?"); args.push(f.type); }
  if (f.region) { where.push("e.region = ?"); args.push(f.region); }
  if (f.q) { where.push("(e.name LIKE ? OR e.code LIKE ? OR e.city LIKE ?)"); const like = `%${f.q}%`; args.push(like, like, like); }
  if (f.hideNoMatch) { where.push(`e.type NOT IN (${NO_MATCH_TYPES.map(() => "?").join(",")})`); args.push(...NO_MATCH_TYPES); }
  const rows = await all<any>(`${SUMMARY_SQL} WHERE ${where.join(" AND ")} ORDER BY e.start, e.name LIMIT ?`, [...args, f.limit ?? 2000]);
  return rows.map(summary);
}

export async function eventSummary(season: number, code: string): Promise<EventSummary | null> {
  const r = await get<any>(`${SUMMARY_SQL} WHERE e.season = ? AND e.code = ?`, [season, code]);
  return r ? summary(r) : null;
}

/** How long a cached event detail may be reused (on top of its key), and how many are kept. */
export const DETAIL_TTL_MS = 5 * 60_000;
const DETAIL_MAX = 300;
const details = new Map<string, { at: number; value: Promise<EventDetail | null> }>();
registerCache("Event details", () => details.clear());

/**
 * eventDetail for pages (the event page and match reports), cached by what it's built from: the data
 * version (moves on with every sync and every live result) and the ratings in use (liveVersion); a
 * cached one whose status the venue's calendar has since moved on (eventStatus) is rebuilt. A big event's detail takes tens of milliseconds to build
 * (every match, its prediction, the field), so a repeat visit or a match report reuses it. An event
 * that's on today isn't cached: its live check times move without a new data version. Callers must
 * not change the object they get back (it's shared).
 */
export async function cachedEventDetail(season: number, code: string): Promise<EventDetail | null> {
  // data:settled moves once a sync's or live result's writes are all done: a detail built in between (new
  // version, half-written stats) isn't kept past them.
  const key = `${await dataVersion()}|${(await kvGet<string>("data:settled")) ?? ""}|${await liveVersion(season)}|${season}|${code}`;
  const hit = details.get(key);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) {
    // The venue's date turns over at its own midnight, not UTC's: upcoming → live → finished without a new version.
    const d = await hit.value.catch(() => null);
    if (!d || d.event.status === eventStatus(d.event, d.event.matchesPlayed, d.event.matchesTotal)) return hit.value;
  }
  const value = eventDetail(season, code);
  details.set(key, { at: Date.now(), value });
  value.then((d) => { if (!d || d.live) details.delete(key); }, () => details.delete(key));
  while (details.size > DETAIL_MAX) details.delete(details.keys().next().value!);
  return value;
}

const LEGACY_NOTE ="Seasons before 2023–24 are shown for history: results and stats, no predictions.";

export async function eventDetail(season: number, code: string): Promise<EventDetail | null> {
  const r = await get<any>(`${SUMMARY_SQL} WHERE e.season = ? AND e.code = ?`, [season, code]);
  if (!r) return null;
  const [entries, oprs, alliances, awards, adv, matches, seasonOprs] = await Promise.all([
    all<any>(`SELECT et.*, t.name, t.city, t.state FROM event_teams et LEFT JOIN teams t ON t.number = et.team WHERE et.season = ? AND et.code = ?`, [season, code]),
    all<any>("SELECT * FROM team_event_stats WHERE season = ? AND code = ?", [season, code]),
    all<any>("SELECT * FROM alliances WHERE season = ? AND code = ? ORDER BY number", [season, code]),
    all<any>("SELECT * FROM awards WHERE season = ? AND code = ? ORDER BY CASE type WHEN 'Inspire' THEN 0 WHEN 'Winner' THEN 1 WHEN 'Finalist' THEN 2 ELSE 3 END, type, placement", [season, code]),
    get<any>("SELECT * FROM advancement WHERE season = ? AND code = ?", [season, code]),
    matchViews({ season, code }, { predictUnplayed: true }),
    // Season OPR for the "At a glance" card before the event starts (the event's own OPR is empty then).
    all<any>("SELECT s.team, s.opr_np FROM team_season_stats s JOIN event_teams et ON et.season = s.season AND et.team = s.team WHERE et.season = ? AND et.code = ?", [season, code]),
  ]);
  const seasonOprBy = new Map(seasonOprs.map((o) => [Number(o.team), o.opr_np == null ? null : Number(o.opr_np)]));
  const meet = r.type === "LeagueMeet" && !isLegacy(season) ? await meetOf(season, code, matches) : null;
  const oprBy = new Map(oprs.map((o) => [Number(o.team), o]));
  const f = isLegacy(season) ? null : await liveForecaster(season).catch(() => null);
  const book = f?.book(season) ?? null;
  const field: FieldRow[] = entries.map((e) => {
    const o = oprBy.get(Number(e.team));
    const rt = book?.ratings.has(Number(e.team)) ? book.get(Number(e.team)) : null;
    return {
      team: Number(e.team), name: e.name ?? null, city: e.city ?? null, state: e.state ?? null, rank: e.rank, rp: e.rp, tbp: e.tbp,
      wins: e.wins, losses: e.losses, ties: e.ties, qualPlayed: e.qual_played,
      opr: { np: o?.opr_np ?? null, auto: o?.opr_auto ?? null, teleop: o?.opr_teleop ?? null, endgame: o?.opr_endgame ?? null, pen: o?.opr_pen ?? null },
      avgNp: o?.avg_np ?? null,
      rating: rt ? { np: Math.round((rt.auto + rt.teleop + rt.endgame) * 10) / 10, sd: Math.round(Math.sqrt(rt.uncertainty) * 10) / 10, matches: rt.n } : null,
      seasonOpr: seasonOprBy.get(Number(e.team)) ?? null,
      ...(meet ? { meet: meet.get(Number(e.team)) ?? null } : {}),
    };
  }).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.team - b.team);
  const input = toEventInput(summary(r), field, matches, alliances);
  return {
    event: { ...summary(r), website: r.website ?? null, livestream: r.livestream ?? null, timezone: r.timezone ?? null, source: r.source },
    field,
    matches,
    alliances: alliances.map((a) => ({ number: a.number, name: a.name, captain: a.captain, pick1: a.pick1, pick2: a.pick2, backup: a.backup })),
    awards: awards.map((a) => ({ type: a.type, placement: a.placement, team: a.team, name: a.name })),
    advancement: adv ? { slots: adv.slots, advancesTo: adv.advances_to, rows: JSON.parse(adv.rows) } : null,
    forecastUnsupported: isLegacy(season) ? LEGACY_NOTE : f ? f.unsupportedReason(input) : "Predictions are still loading.",
    // Without FIRST credentials only the 5-minute FTC Scout fetch runs, so that's the cadence the page shows.
    live: isEventDay(r) ? { checkedAt: latest(r.live_checked_at, r.detail_synced_at), everySeconds: liveIo.canProbe() ? liveSyncSeconds() : FULL_EVERY_MS / 1000, auto: liveSyncOn() } : null,
    // A stopgap until FIRST posts the event: once it has a team list or a schedule, FIRST's data is all that shows.
    provisional: field.length || matches.length ? null : await provisional(season, code),
  };
}

const SOURCE_NAMES: Record<string, string> = { ftcnj: "FTC New Jersey" };

/** The regional site's row for the event, with FIRST's team names and homes where we have the team. */
async function provisional(season: number, code: string): Promise<ProvisionalInfo | null> {
  const p = await provisionalFor(season, code);
  if (!p) return null;
  const nums = p.teams.map((t) => t.team);
  const known = nums.length ? await all<any>(`SELECT number, name, city, state FROM teams WHERE number IN (${nums.map(() => "?").join(",")})`, nums) : [];
  const by = new Map(known.map((t) => [Number(t.number), t]));
  return {
    sourceName: SOURCE_NAMES[p.source] ?? p.source, url: p.url, fetchedAt: p.fetchedAt,
    nickname: p.nickname, hosts: p.hosts, venue: p.venue, address: p.address, capacity: p.capacity, schedule: p.schedule, notes: p.notes, closed: p.closed,
    teams: p.teams.map((t) => {
      const k = by.get(t.team);
      return { team: t.team, name: k?.name ?? t.name, city: k?.city ?? null, state: k?.state ?? null, status: t.status, session: t.session, known: !!k };
    }),
    sessionUnknown: p.sessionUnknown,
  };
}

/** The later of two ISO timestamps (either may be missing). */
const latest = (a: string | null, b: string | null) => (!a ? b ?? null : !b ? a : a > b ? a : b);

/** The engine's view of an event: shared with the device's local estimate (src/shared/eventInput.ts). */
export { toEventInput };

/** A league meet's own standing by team (src/shared/meetStandings.ts): its played qualification matches, with
 *  their bonus ranking points (stored with the match, not in the match view). */
async function meetOf(season: number, code: string, matches: MatchView[]): Promise<Map<number, NonNullable<FieldRow["meet"]>>> {
  const quals = matches.filter((m) => m.level === "qual" && m.played && m.red.score && m.blue.score);
  const bonusRows = quals.length ? await all<any>("SELECT series, number, red_bonus, blue_bonus FROM matches WHERE season = ? AND code = ? AND level = 'qual' AND played = 1", [season, code]) : [];
  const bonusBy = new Map(bonusRows.map((b) => [`${b.series}:${b.number}`, b]));
  const side = (m: MatchView, s: "red" | "blue"): MeetSide => {
    const a = m[s], sc = a.score!, b = bonusBy.get(`${m.series}:${m.number}`)?.[`${s}_bonus`];
    return {
      teams: a.teams.map((t) => ({ team: t.number, counts: !t.surrogate, noShow: !t.onField, dq: t.dq })),
      total: sc.total, np: sc.np, auto: sc.auto, endgame: sc.endgame, tips: sc.tips ?? null, bonus: b ? JSON.parse(b) : null,
    };
  };
  const rows = meetStandings(season, quals.map((m) => ({ red: side(m, "red"), blue: side(m, "blue") })));
  return new Map(rows.map(({ team, ...x }) => [team, x]));
}
