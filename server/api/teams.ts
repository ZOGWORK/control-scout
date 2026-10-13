// Team profile + compare.
import { all, get } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import type { CompareView, TeamEventRow, TeamInfo, TeamProfile, TeamSeasonStats } from "../../src/shared/api.js";
import { matchViews } from "./matches.js";

export async function teamInfo(number: number): Promise<TeamInfo | null> {
  const t = await get<any>("SELECT * FROM teams WHERE number = ?", [number]);
  if (!t) return null;
  return {
    number: Number(t.number), name: t.name, fullName: t.full_name, school: t.school, sponsors: t.sponsors ? JSON.parse(t.sponsors) : [],
    city: t.city, state: t.state, country: t.country, rookieYear: t.rookie_year, website: t.website, homeRegion: t.home_region,
  };
}

/** Seasons with any data for the team (registered, played, or ranked), newest first. */
export async function teamSeasons(number: number): Promise<number[]> {
  const rows = await all<{ season: number }>(
    `SELECT season FROM team_seasons WHERE team = ? UNION SELECT season FROM event_teams WHERE team = ? UNION SELECT season FROM team_season_stats WHERE team = ? ORDER BY season DESC`,
    [number, number, number],
  );
  return rows.map((r) => Number(r.season));
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
     WHERE et.season = ? AND et.team = ? ORDER BY e.start, e.code`,
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
  const seasons = await teamSeasons(number);
  if (!team && !seasons.length) return null;
  // Default: the newest season the team has results in (fall back to registered).
  let s = season;
  if (!s) {
    const withResults = await get<{ season: number }>("SELECT MAX(season) season FROM team_season_stats WHERE team = ? AND matches > 0", [number]);
    s = seasons.includes(CURRENT_SEASON) && (await get("SELECT 1 FROM event_teams WHERE season = ? AND team = ? LIMIT 1", [CURRENT_SEASON, number]))
      ? CURRENT_SEASON : withResults?.season ?? seasons[0] ?? CURRENT_SEASON;
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
      events: events.map((e) => ({ code: e.code, name: e.name, start: e.start, opr: e.opr.np, rank: e.rank })),
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
