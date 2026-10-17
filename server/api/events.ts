// Event list + event detail + the engine's EventInput for forecasting.
import type { EventInput } from "@control-scout/predict-engine";
import { all, get } from "../db.js";
import { eventTypeLabel, isLegacy } from "../data/seasons.js";
import type { EventDetail, EventSummary, FieldRow } from "../../src/shared/api.js";
import { matchViews } from "./matches.js";
import { dataVersion, liveForecaster, liveVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";
import { FULL_EVERY_MS, isEventDay, liveIo, liveSyncOn, liveSyncSeconds } from "../data/live.js";

const today = () => new Date().toISOString().slice(0, 10);

function statusOf(start: string | null, end: string | null, played: number, total: number): EventSummary["status"] {
  const t = today();
  if (start && start > t) return "upcoming";
  if ((end ?? start ?? "") < t) return "finished";
  return played && played >= total && total > 0 ? "finished" : "live";
}

function summary(r: any): EventSummary {
  const played = Number(r.played ?? 0), total = Number(r.total ?? 0);
  return {
    season: Number(r.season), code: r.code, name: r.name, type: r.type, typeLabel: eventTypeLabel(r.type), divisionCode: r.division_code ?? null,
    region: r.region, city: r.city, state: r.state, country: r.country, venue: r.venue ?? null, start: r.start, end: r.end, remote: !!r.remote,
    teams: Number(r.teams ?? 0), matchesPlayed: played, matchesTotal: total, status: statusOf(r.start, r.end, played, total),
  };
}

const SUMMARY_SQL = `SELECT e.*,
  (SELECT COUNT(*) FROM event_teams t WHERE t.season = e.season AND t.code = e.code) teams,
  (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1) played,
  (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code) total
  FROM events e`;

export interface EventListFilter { season: number; from?: string; to?: string; q?: string; type?: string; region?: string; limit?: number; hideNoMatch?: boolean }

export async function listEvents(f: EventListFilter): Promise<EventSummary[]> {
  const where = ["e.season = ?"];
  const args: (string | number)[] = [f.season];
  if (f.from) { where.push("COALESCE(e.end, e.start) >= ?"); args.push(f.from); }
  if (f.to) { where.push("e.start <= ?"); args.push(f.to); }
  if (f.type) { where.push("e.type = ?"); args.push(f.type); }
  if (f.region) { where.push("e.region = ?"); args.push(f.region); }
  if (f.q) { where.push("(e.name LIKE ? OR e.code LIKE ? OR e.city LIKE ?)"); const like = `%${f.q}%`; args.push(like, like, like); }
  if (f.hideNoMatch) where.push("e.type NOT IN ('Kickoff','Workshop','DemoExhibition','VolunteerSignup','PracticeDay','InnovationChallenge')");
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
 * version (moves on with every sync and every live result), the ratings in use (liveVersion) and the
 * day (an event's status follows the date). A big event's detail takes tens of milliseconds to build
 * (every match, its prediction, the field), so a repeat visit or a match report reuses it. An event
 * that's on today isn't cached: its live check times move without a new data version. Callers must
 * not change the object they get back (it's shared).
 */
export async function cachedEventDetail(season: number, code: string): Promise<EventDetail | null> {
  const key = `${await dataVersion()}|${await liveVersion(season)}|${today()}|${season}|${code}`;
  const hit = details.get(key);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.value;
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
  const [entries, oprs, alliances, awards, adv, matches] = await Promise.all([
    all<any>(`SELECT et.*, t.name, t.city, t.state FROM event_teams et LEFT JOIN teams t ON t.number = et.team WHERE et.season = ? AND et.code = ?`, [season, code]),
    all<any>("SELECT * FROM team_event_stats WHERE season = ? AND code = ?", [season, code]),
    all<any>("SELECT * FROM alliances WHERE season = ? AND code = ? ORDER BY number", [season, code]),
    all<any>("SELECT * FROM awards WHERE season = ? AND code = ? ORDER BY CASE type WHEN 'Inspire' THEN 0 WHEN 'Winner' THEN 1 WHEN 'Finalist' THEN 2 ELSE 3 END, type, placement", [season, code]),
    get<any>("SELECT * FROM advancement WHERE season = ? AND code = ?", [season, code]),
    matchViews({ season, code }, { predictUnplayed: true }),
  ]);
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
  };
}

/** The later of two ISO timestamps (either may be missing). */
const latest = (a: string | null, b: string | null) => (!a ? b ?? null : !b ? a : a > b ? a : b);

/** The engine's view of an event (same fields Control Point passes from FtcEventFull). */
export function toEventInput(ev: EventSummary, field: FieldRow[], matches: EventDetail["matches"], alliances: any[]): EventInput {
  return {
    season: ev.season, code: ev.code, type: ev.type, start: ev.start, end: ev.end,
    field: field.map((f) => ({ teamNumber: f.team, rank: f.rank })),
    matches: matches.map((m) => ({
      key: m.key, label: m.label, level: m.level, series: m.series, number: m.number, time: m.time, played: m.played,
      // Played matches: robots that were on the field (playoff alliances list 3).
      red: { teams: (m.played ? m.red.teams.filter((t) => t.onField) : m.red.teams).map((t) => ({ number: t.number, surrogate: t.surrogate, dq: t.dq })), score: m.red.score ? { total: m.red.score.total, totalNp: m.red.score.np, auto: m.red.score.auto, teleop: m.red.score.teleop, endgame: m.red.score.endgame, penaltiesCommitted: m.red.score.pen, tips: m.red.score.tips ?? null } : null },
      blue: { teams: (m.played ? m.blue.teams.filter((t) => t.onField) : m.blue.teams).map((t) => ({ number: t.number, surrogate: t.surrogate, dq: t.dq })), score: m.blue.score ? { total: m.blue.score.total, totalNp: m.blue.score.np, auto: m.blue.score.auto, teleop: m.blue.score.teleop, endgame: m.blue.score.endgame, penaltiesCommitted: m.blue.score.pen, tips: m.blue.score.tips ?? null } : null },
    })),
    alliances: alliances.filter((a) => a.captain).map((a) => ({ number: a.number, captain: a.captain, picks: [a.pick1, a.pick2].filter((x): x is number => x != null) })),
  };
}
