// Team profile + compare.
import { all, get } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import type { CompareView, ShortlistTeam, TeamEventRow, TeamInfo, TeamProfile, TeamSeasonStats, TeamSummary } from "../../src/shared/api.js";
import { matchViews } from "./matches.js";

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
  const s = await get<any>("SELECT * FROM team_season_stats WHERE season = ? AND team = ?", [season, team]);
  if (!s) return null;
  const of = s.ranked_teams ?? null;
  const stat = (v: any, rank: any) => ({ value: v ?? null, rank: rank ?? null, of });
  return {
    opr: { np: stat(s.opr_np, s.rank_np), auto: stat(s.opr_auto, s.rank_auto), teleop: stat(s.opr_teleop, s.rank_teleop), endgame: stat(s.opr_endgame, s.rank_endgame), pen: s.opr_pen ?? null },
    rating: s.rating_np == null ? null : { np: s.rating_np, auto: s.rating_auto, teleop: s.rating_teleop, endgame: s.rating_endgame, pen: s.rating_pen, sd: s.rating_sd, matches: s.rating_matches, rank: s.rating_rank },
    record: { wins: s.wins, losses: s.losses, ties: s.ties, matches: s.matches, events: s.events },
    avg: { np: s.avg_np, score: s.avg_score, pen: s.avg_pen },
  };
}

export async function teamEvents(season: number, team: number): Promise<TeamEventRow[]> {
  const rows = await all<any>(
    `SELECT e.season, e.code, e.name, e.type, e.start, e.end, e.city, e.state, e.country,
            et.rank, et.rp, et.wins, et.losses, et.ties, et.qual_played,
            s.opr_np, s.opr_auto, s.opr_teleop, s.opr_endgame, s.opr_pen, s.avg_score, s.avg_np, s.avg_pen
     FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
     LEFT JOIN team_event_stats s ON s.season = et.season AND s.code = et.code AND s.team = et.team
     WHERE et.season = ? AND et.team = ?
       -- League rosters list every league team at every meet: once an event has
       -- results, keep it only if this team was on the field in a played match
       -- (scheduled no-shows don't count).
       AND (NOT EXISTS (SELECT 1 FROM matches m WHERE m.season = et.season AND m.code = et.code AND m.played = 1)
            OR EXISTS (SELECT 1 FROM match_teams x JOIN matches m
                         ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
                       WHERE x.season = et.season AND x.code = et.code AND x.team = et.team AND x.on_field = 1 AND m.played = 1))
     ORDER BY e.start, e.code`,
    [season, team],
  );
  const [awards, alliances] = await Promise.all([
    all<any>("SELECT code, type, placement, name FROM awards WHERE season = ? AND team = ?", [season, team]),
    all<any>("SELECT code, number, captain, pick1, pick2, backup FROM alliances WHERE season = ? AND (captain = ? OR pick1 = ? OR pick2 = ? OR backup = ?)", [season, team, team, team, team]),
  ]);
  return rows.map((r) => {
    const al = alliances.find((a) => a.code === r.code);
    const seat = al ? (al.captain === team ? "captain" : al.pick1 === team ? "pick1" : al.pick2 === team ? "pick2" : "backup") : null;
    return {
      season, code: r.code, name: r.name, type: r.type, start: r.start, end: r.end, city: r.city, state: r.state, country: r.country,
      rank: r.rank, rp: r.rp, wins: r.wins, losses: r.losses, ties: r.ties, qualPlayed: r.qual_played,
      opr: { np: r.opr_np, auto: r.opr_auto, teleop: r.opr_teleop, endgame: r.opr_endgame, pen: r.opr_pen },
      avg: { score: r.avg_score, np: r.avg_np, pen: r.avg_pen },
      awards: awards.filter((a) => a.code === r.code).map((a) => ({ type: a.type, placement: a.placement, name: a.name })),
      alliance: al && seat ? { number: al.number, seat } : null,
    };
  });
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
  const [stats, events, awardsAllTime] = await Promise.all([
    seasonStats(s, number),
    teamEvents(s, number),
    all<any>("SELECT a.season, a.code, e.name event, a.type, a.placement, a.name FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code WHERE a.team = ? ORDER BY a.season DESC, e.start DESC", [number]),
  ]);
  return {
    team: team ?? { number, name: null, fullName: null, school: null, sponsors: [], city: null, state: null, country: null, rookieYear: null, website: null, homeRegion: null },
    season: s, seasons, stats, events,
    awardsAllTime: awardsAllTime.map((a) => ({ season: a.season, code: a.code, event: a.event, type: a.type, placement: a.placement, name: a.name })),
  };
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
  // Matches where at least two of the compared teams both played.
  const meetings: CompareView["meetings"] = [];
  if (numbers.length >= 2) {
    const first = await matchViews({ season, team: numbers[0] });
    for (const m of first) {
      if (!m.played) continue;
      const red = m.red.teams.map((t) => t.number), blue = m.blue.teams.map((t) => t.number);
      const others = numbers.slice(1);
      const together = others.some((o) => (red.includes(numbers[0]) && red.includes(o)) || (blue.includes(numbers[0]) && blue.includes(o)));
      const against = others.some((o) => (red.includes(numbers[0]) && blue.includes(o)) || (blue.includes(numbers[0]) && red.includes(o)));
      if (together || against) meetings.push({ ...m, relation: against ? "opponents" : "partners" });
    }
  }
  return { season, teams, meetings };
}

/** Compact summaries for many teams (shortlist, tracked-teams feed). */
export async function teamSummaries(numbers: number[], season: number): Promise<TeamSummary[]> {
  if (!numbers.length) return [];
  const ph = numbers.map(() => "?").join(",");
  const [infos, stats, lastEv] = await Promise.all([
    all<any>(`SELECT number, name, city, state, country FROM teams WHERE number IN (${ph})`, numbers),
    all<any>(`SELECT * FROM team_season_stats WHERE season = ? AND team IN (${ph})`, [season, ...numbers]),
    all<any>(
      `SELECT et.team, e.code, e.name, e.start, e.end, et.rank, et.wins, et.losses, et.ties FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
       WHERE et.season = ? AND et.team IN (${ph}) ORDER BY e.start DESC`, [season, ...numbers]),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return numbers.map((n) => {
    const i = infos.find((x) => Number(x.number) === n);
    const s = stats.find((x) => Number(x.team) === n);
    const evs = lastEv.filter((x) => Number(x.team) === n);
    const last = evs.find((e) => (e.start ?? "") <= today) ?? null;
    const next = [...evs].reverse().find((e) => (e.start ?? "") > today) ?? null;
    const ev = (e: any) => e && { code: e.code, name: e.name, start: e.start, end: e.end, rank: e.rank, record: e.wins == null ? null : `${e.wins}-${e.losses}-${e.ties}` };
    return {
      team: n, name: i?.name ?? null, place: [i?.city, i?.state, i?.country].filter(Boolean).join(", "),
      opr: s?.opr_np ?? null, oprRank: s?.rank_np ?? null, of: s?.ranked_teams ?? null,
      rating: s?.rating_np ?? null, ratingSd: s?.rating_sd ?? null, record: s ? `${s.wins}-${s.losses}-${s.ties}` : null,
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
