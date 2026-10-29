// Team profile + compare.
import { all, get, kvGet } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import type { CompareView, ReportCard, ReportCardField, ShortlistTeam, TeamReportCards, TeamEventRow, TeamInfo, TeamProfile, TeamSeasonStats, TeamSummary } from "../../src/shared/api.js";
import { matchViews } from "./matches.js";
import { REPORT_PRIOR } from "../stats/reportCards.js";
import { reliabilityFromRow, type Reliability, type ReliabilityResponse } from "../../src/shared/reliability.js";
import { recordSql, recordsFromRows, wltText } from "../../src/shared/eventRecord.js";
import { teamEventRows, teamEventsQuery } from "../../src/shared/teamEventRows.js";

/**
 * Many teams' stored season reliability, in the order asked (null: none stored). Public match data only; also
 * what Control Point shows next to OPR (GET /api/reliability).
 */
export async function reliabilityMany(season: number, teams: number[]): Promise<ReliabilityResponse> {
  const ts = [...new Set(teams)];
  const rows = ts.length ? await all<any>(`SELECT * FROM team_reliability WHERE season = ? AND code = '' AND team IN (0, ${ts.map(() => "?").join(",")})`, [season, ...ts]) : [];
  const field = rows.find((r) => Number(r.team) === 0);
  const fieldIndex = field ? Number(field.idx) : null;
  const by = new Map(rows.filter((r) => Number(r.team) !== 0).map((r) => [Number(r.team), reliabilityFromRow(r, fieldIndex)]));
  return { season, fieldIndex, teams: teams.map((team) => ({ team, reliability: by.get(team) ?? null })) };
}

/** A team's stored season reliability (team 0 = the field, for its average index). Null when not computed. */
export async function teamReliability(season: number, team: number): Promise<Reliability | null> {
  const rows = await all<any>("SELECT * FROM team_reliability WHERE season = ? AND code = '' AND team IN (0, ?)", [season, team]);
  const own = rows.find((r) => Number(r.team) === team && team !== 0);
  if (!own) return null;
  const field = rows.find((r) => Number(r.team) === 0);
  return reliabilityFromRow(own, field ? Number(field.idx) : null);
}

export async function teamInfo(number: number): Promise<TeamInfo | null> {
  const t = await get<any>("SELECT * FROM teams WHERE number = ?", [number]);
  if (!t) return null;
  return {
    number: Number(t.number), name: t.name, fullName: t.full_name, school: t.school, sponsors: t.sponsors ? JSON.parse(t.sponsors) : [],
    city: t.city, state: t.state, country: t.country, rookieYear: t.rookie_year, website: t.website, homeRegion: t.home_region,
  };
}

/** Whether we hold anything at all for the team (registered, played, or ranked, any season). */
export async function teamKnown(number: number): Promise<boolean> {
  return !!(await get(
    `SELECT 1 FROM team_seasons WHERE team = ? UNION ALL SELECT 1 FROM event_teams WHERE team = ? UNION ALL SELECT 1 FROM team_season_stats WHERE team = ? LIMIT 1`,
    [number, number, number],
  ));
}

/**
 * Seasons the team's robot played, newest first: matches on record, or a rank
 * at a remote event (2020–2022 had no alliance matches). Registration alone
 * doesn't count, except for the current season, which is always offered.
 */
export async function teamSeasons(number: number): Promise<number[]> {
  const rows = await all<{ season: number }>(
    `SELECT season FROM team_season_stats WHERE team = ? AND matches > 0
     UNION SELECT season FROM event_teams WHERE team = ? AND qual_played > 0
     UNION SELECT et.season FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code WHERE et.team = ? AND e.remote = 1 AND et.rank IS NOT NULL`,
    [number, number, number],
  );
  return [...new Set([CURRENT_SEASON, ...rows.map((r) => Number(r.season))])].sort((a, b) => b - a);
}

export async function seasonStats(season: number, team: number): Promise<TeamSeasonStats | null> {
  const [s, reliability] = await Promise.all([get<any>("SELECT * FROM team_season_stats WHERE season = ? AND team = ?", [season, team]), teamReliability(season, team)]);
  if (!s) return null;
  const of = s.ranked_teams ?? null;
  const stat = (v: any, rank: any) => ({ value: v ?? null, rank: rank ?? null, of });
  return {
    opr: { np: stat(s.opr_np, s.rank_np), auto: stat(s.opr_auto, s.rank_auto), teleop: stat(s.opr_teleop, s.rank_teleop), endgame: stat(s.opr_endgame, s.rank_endgame), pen: s.opr_pen ?? null },
    rating: s.rating_np == null ? null : { np: s.rating_np, auto: s.rating_auto, teleop: s.rating_teleop, endgame: s.rating_endgame, pen: s.rating_pen, sd: s.rating_sd, matches: s.rating_matches, rank: s.rating_rank },
    record: { wins: s.wins, losses: s.losses, ties: s.ties, matches: s.matches, events: s.events },
    avg: { np: s.avg_np, score: s.avg_score, pen: s.avg_pen },
    reliability,
  };
}

/**
 * SQL: the event_teams row `et` is an event the team took part in. League rosters list every league team at
 * every meet: once an event has results, it counts only if this team was on the field in a played match
 * (scheduled no-shows don't count). An event with no results yet (upcoming, or a remote one) counts as listed.
 */
export const ATTENDED = `(NOT EXISTS (SELECT 1 FROM matches m WHERE m.season = et.season AND m.code = et.code AND m.played = 1)
            OR EXISTS (SELECT 1 FROM match_teams x JOIN matches m
                         ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
                       WHERE x.season = et.season AND x.code = et.code AND x.team = et.team AND x.on_field = 1 AND m.played = 1))`;

/**
 * A season's event rows for the team page: every event the team is on the roster of or played a match at, each with
 * its record counted from the matches (src/shared/teamEventRows.ts). Events the team never played are left out.
 */
export async function teamEvents(season: number, team: number): Promise<TeamEventRow[]> {
  const q = teamEventsQuery(season, team, { meetRanks: true });
  const [rows, recs, awards, alliances] = await Promise.all([
    all<any>(q.sql, q.args),
    all<any>(recordSql("mt.season = ? AND mt.team = ?"), [season, team]),
    all<any>("SELECT code, type, placement, name FROM awards WHERE season = ? AND team = ?", [season, team]),
    all<any>("SELECT code, number, captain, pick1, pick2, backup FROM alliances WHERE season = ? AND (captain = ? OR pick1 = ? OR pick2 = ? OR backup = ?)", [season, team, team, team, team]),
  ]);
  return teamEventRows(season, team, rows, recordsFromRows(recs), awards, alliances, new Date().toISOString().slice(0, 10));
}

const nOrNull = (x: unknown) => (x == null ? null : Number(x));
const sdOf = (v: unknown) => (v == null ? null : Math.sqrt(Math.max(0, Number(v))));

function reportCard(r: any, ev?: { name: string | null; start: string | null }): ReportCard {
  const decided = Number(r.decided), hits = Number(r.hits);
  return {
    code: r.code ? String(r.code) : null, name: ev?.name ?? null, start: ev?.start ?? null, final: !!Number(r.final),
    calls: Number(r.calls), decided, hits, scored: Number(r.scored),
    raw: { hitRate: decided ? hits / decided : null, errMean: nOrNull(r.err_mean), errAbs: nOrNull(r.err_abs), errSd: sdOf(r.err_var) },
    shrunk: { hitRate: nOrNull(r.hit_shrunk), errMean: nOrNull(r.err_mean_shrunk), errAbs: nOrNull(r.err_abs_shrunk), errSd: sdOf(r.err_var_shrunk) },
  };
}

/** Stored report cards (server/stats/reportCards.ts): the season row and finished events. Null when there's none. */
export async function teamReportCards(season: number, team: number): Promise<TeamReportCards | null> {
  const rows = await all<any>(
    `SELECT r.*, e.name, e.start FROM team_report_cards r LEFT JOIN events e ON e.season = r.season AND e.code = r.code
     WHERE r.season = ? AND r.team = ? AND (r.code = '' OR r.final = 1) ORDER BY e.start, r.code`,
    [season, team],
  );
  const whole = rows.find((r) => r.code === "");
  if (!whole) return null;
  return {
    season: reportCard(whole),
    events: rows.filter((r) => r.code !== "").map((r) => reportCard(r, { name: r.name ?? null, start: r.start ?? null })),
    field: await kvGet<ReportCardField>(`reportCards:field:${season}`),
    prior: REPORT_PRIOR,
  };
}

export async function teamProfile(number: number, season?: number): Promise<TeamProfile | null> {
  const team = await teamInfo(number);
  if (!team && !(await teamKnown(number))) return null;
  const seasons = await teamSeasons(number);
  // Default: the newest season the team has results in (fall back to registered).
  let s = season;
  if (!s) {
    const withResults = await get<{ season: number }>("SELECT MAX(season) season FROM team_season_stats WHERE team = ? AND matches > 0", [number]);
    // The current season is always listed (seasons[0]) but is only the default when the team is entered in
    // it; otherwise the newest season it actually played, remote-only seasons included (they have no stats row).
    const entered = !!(await get("SELECT 1 FROM event_teams WHERE season = ? AND team = ? LIMIT 1", [CURRENT_SEASON, number]));
    s = entered || withResults?.season === CURRENT_SEASON ? CURRENT_SEASON : seasons.find((x) => x !== CURRENT_SEASON) ?? CURRENT_SEASON;
  }
  const [stats, events, awardsAllTime, reportCards] = await Promise.all([
    seasonStats(s, number),
    teamEvents(s, number),
    all<any>("SELECT a.season, a.code, e.name event, a.type, a.placement, a.name FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code WHERE a.team = ? ORDER BY a.season DESC, e.start DESC", [number]),
    teamReportCards(s, number),
  ]);
  return {
    team: team ?? { number, name: null, fullName: null, school: null, sponsors: [], city: null, state: null, country: null, rookieYear: null, website: null, homeRegion: null },
    season: s, seasons, stats, events, reportCards,
    awardsAllTime: awardsAllTime.map((a) => ({ season: a.season, code: a.code, event: a.event, type: a.type, placement: a.placement, name: a.name })),
  };
}

/** Schedule order, as matchViews returns matches: by time (none first), event, quals before playoffs, series, number. */
export function bySchedule(a: { time: string | null; code: string; level: string; series: number; number: number }, b: typeof a): number {
  return (a.time ?? "").localeCompare(b.time ?? "") || a.code.localeCompare(b.code) || b.level.localeCompare(a.level) || a.series - b.series || a.number - b.number;
}

/** How a match relates the compared teams, seen from the first of them in it: "opponents" when another compared
 *  team was on the other side, "partners" when only on the same side, null when no other compared team played. */
export function relationOf(numbers: number[], red: number[], blue: number[]): "opponents" | "partners" | null {
  const base = numbers.find((n) => red.includes(n) || blue.includes(n));
  if (base == null) return null;
  const mine = red.includes(base) ? red : blue, theirs = mine === red ? blue : red;
  const others = numbers.filter((n) => n !== base);
  if (others.some((o) => theirs.includes(o))) return "opponents";
  return others.some((o) => mine.includes(o)) ? "partners" : null;
}

export async function compareTeams(numbers: number[], season: number): Promise<CompareView> {
  const teams = await Promise.all(numbers.map(async (n) => {
    const [info, stats, events] = await Promise.all([teamInfo(n), seasonStats(season, n), teamEvents(season, n)]);
    return {
      team: info ?? { number: n, name: null, fullName: null, school: null, sponsors: [], city: null, state: null, country: null, rookieYear: null, website: null, homeRegion: null },
      stats,
      events: events.map((e) => ({ code: e.code, name: e.name, start: e.start, opr: e.opr.np, auto: e.opr.auto, teleop: e.opr.teleop, endgame: e.opr.endgame, rank: e.rank })),
    };
  }));
  // Matches where at least two of the compared teams both played, between any of them: the page shows the ones
  // its first team (the baseline, which the member can change without asking again) played in. `relation` is from
  // the side of the first requested team that played.
  const meetings: CompareView["meetings"] = [];
  if (numbers.length >= 2) {
    const seen = new Set<string>();
    for (const n of numbers.slice(0, -1)) {
      for (const m of await matchViews({ season, team: n })) {
        const id = `${m.code}:${m.key}`;
        if (!m.played || seen.has(id)) continue;
        const relation = relationOf(numbers, m.red.teams.map((t) => t.number), m.blue.teams.map((t) => t.number));
        if (!relation) continue;
        seen.add(id);
        meetings.push({ ...m, relation });
      }
    }    // Each team's list comes in schedule order; merged, they're put back in it (as matchViews orders: time, event,
    // quals before playoffs, series, number), so an event's matches stay together in one section.
    meetings.sort(bySchedule);
  }
  return { season, teams, meetings };
}

/** Compact summaries for many teams (shortlist, tracked-teams feed). */
export async function teamSummaries(numbers: number[], season: number): Promise<TeamSummary[]> {
  if (!numbers.length) return [];
  const ph = numbers.map(() => "?").join(",");
  const [infos, stats, lastEv, recRows, rel] = await Promise.all([
    all<any>(`SELECT number, name, city, state, country FROM teams WHERE number IN (${ph})`, numbers),
    all<any>(`SELECT * FROM team_season_stats WHERE season = ? AND team IN (${ph})`, [season, ...numbers]),
    all<any>(
      `SELECT et.team, e.code, e.name, e.type, e.start, e.end, e.remote, et.rank, r.rank meet_rank
       FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
       LEFT JOIN team_event_records r ON r.season = et.season AND r.code = et.code AND r.team = et.team AND e.type = 'LeagueMeet'
       WHERE et.season = ? AND et.team IN (${ph}) ORDER BY e.start DESC`, [season, ...numbers]),
    all<any>(recordSql(`mt.season = ? AND mt.team IN (${ph})`), [season, ...numbers]),
    all<any>(`SELECT team, idx, matches FROM team_reliability WHERE season = ? AND code = '' AND team IN (${ph})`, [season, ...numbers]),
  ]);
  const recs = recordsFromRows(recRows);
  const today = new Date().toISOString().slice(0, 10);
  return numbers.map((n) => {
    const i = infos.find((x) => Number(x.number) === n);
    const s = stats.find((x) => Number(x.team) === n);
    // Events it played (a match on its record), or that haven't ended: a league lists every league team at every
    // meet, so a finished meet the team has no match at isn't its last event (as the team page's rows).
    const evs = lastEv.filter((x) => Number(x.team) === n && (recs.has(`${n}|${x.code}`) || Number(x.remote) === 1 || (x.end ?? x.start ?? "9999") >= today));
    const r = rel.find((x) => Number(x.team) === n);
    const last = evs.find((e) => (e.start ?? "") <= today) ?? null;
    const next = [...evs].reverse().find((e) => (e.start ?? "") > today) ?? null;
    // The record there: its matches (playoffs included), as the team page counts it.
    const ev = (e: any) => {
      if (!e) return null;
      const rec = recs.get(`${n}|${e.code}`);
      return { code: e.code, name: e.name, start: e.start, end: e.end, rank: e.type === "LeagueMeet" ? e.meet_rank ?? null : e.rank, record: rec ? wltText(rec) : null };
    };
    return {
      team: n, name: i?.name ?? null, place: [i?.city, i?.state, i?.country].filter(Boolean).join(", "),
      opr: s?.opr_np ?? null, oprRank: s?.rank_np ?? null, of: s?.ranked_teams ?? null,
      rating: s?.rating_np ?? null, ratingSd: s?.rating_sd ?? null, record: s ? `${s.wins}-${s.losses}-${s.ties}` : null,
      reliability: r ? Number(r.idx) : null, reliabilityMatches: r ? Number(r.matches) : null,
      lastEvent: ev(last), nextEvent: ev(next),
    };
  });
}

/**
 * The shortlist in one request: each team's summary, its OPR split and its
 * event-by-event OPR (for the trend graphs). Three queries for the whole list
 * (summaries) plus one, however many teams, not N requests per team.
 */
export async function shortlistTeams(numbers: number[], season: number): Promise<ShortlistTeam[]> {
  if (!numbers.length) return [];
  const ph = numbers.map(() => "?").join(",");
  const [summaries, events] = await Promise.all([
    teamSummaries(numbers, season),
    all<any>(
      `SELECT s.team, e.code, e.name, e.start, et.rank, s.opr_np, s.opr_auto, s.opr_teleop, s.opr_endgame, s.avg_np
       FROM team_event_stats s JOIN events e ON e.season = s.season AND e.code = s.code
       LEFT JOIN event_teams et ON et.season = s.season AND et.code = s.code AND et.team = s.team
       WHERE s.season = ? AND s.team IN (${ph})
       ORDER BY e.start, e.code`, [season, ...numbers]),
  ]);
  const n = (x: unknown) => (x == null ? null : Number(x));
  return summaries.map((t) => {
    const evs = events.filter((e) => Number(e.team) === t.team).map((e) => ({
      code: e.code as string, name: e.name as string, start: e.start ?? null, rank: n(e.rank),
      opr: n(e.opr_np), auto: n(e.opr_auto), teleop: n(e.opr_teleop), endgame: n(e.opr_endgame), avgNp: n(e.avg_np),
    }));
    // The season OPR is the best event OPR: take the split from that same event, so the parts belong
    // to the total shown (the season's per-part bests can come from different events).
    const best = evs.filter((e) => e.opr != null).reduce<(typeof evs)[number] | null>((b, e) =>
      (b == null || (t.opr != null ? Math.abs(e.opr! - t.opr) < Math.abs(b.opr! - t.opr) : e.opr! > b.opr!) ? e : b), null);
    return {
      ...t,
      breakdown: best ? { auto: best.auto, teleop: best.teleop, endgame: best.endgame, event: { code: best.code, name: best.name } } : { auto: null, teleop: null, endgame: null, event: null },
      events: evs,
    };
  });
}
