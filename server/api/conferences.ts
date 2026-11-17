// A New Jersey league's conference tables (src/shared/conferences.ts): each conference tournament's teams ranked by
// FIRST's league standing over the league meets only, never by the tournament. The conference comes from what the sync
// stored (server/data/conferences.ts); the teams from FIRST's team list for the tournament, or, before FIRST posts it,
// FTC New Jersey's sign-ups (labelled registered, never the field); the numbers from FIRST's league table as stored:
// today's before the tournament, the week-before snapshot after it. Scout computes none of FIRST's numbers.
import { all } from "../db.js";
import { CONFERENCE_REGION, conferenceHref, type Conference, type ConferenceRow, type ConferenceRs, type LeagueConferences, type TeamConference, type TeamConferenceInfo } from "../../src/shared/conferences.js";
import { leagueStandings, storedLeague, teamLeagueStanding } from "./leagues.js";
import { get } from "../db.js";
import { liveList } from "./rankings.js";
import { provisionalFor } from "../data/provisional.js";
import type { LeagueStandings } from "../../src/shared/leagues.js";

interface ConfRow { season: number; code: string; region: string; league: string; name: string; slug: string; first_name: string | null; aliases: string; event: string; start: string | null; end: string | null; venue: string | null; city: string | null }

const CONF_SELECT = `SELECT c.season, c.code, c.region, c.league, c.name, c.slug, c.first_name, c.aliases, e.name event, e.start, e.end, e.venue, e.city
  FROM event_conferences c JOIN events e ON e.season = c.season AND e.code = c.code`;

const today = () => new Date().toISOString().slice(0, 10);
const aliasesOf = (r: Pick<ConfRow, "aliases" | "slug">): string[] => { try { const a = JSON.parse(r.aliases); return Array.isArray(a) && a.length ? a : [r.slug]; } catch { return [r.slug]; } };

/** League numbers by team: one row of FIRST's league table (today's, or the snapshot). */
type LeagueNums = { rank: number; rs: number | null; tbp: number | null; wins: number | null; losses: number | null; ties: number | null; played: number | null; meets: number | null };

async function buildConference(c: ConfRow, league: LeagueStandings | null, now: string): Promise<Conference> {
  const { season, code } = c;
  const [field, played, winners, snap, others] = await Promise.all([
    all<{ team: number; name: string | null }>("SELECT et.team, t.name FROM event_teams et LEFT JOIN teams t ON t.number = et.team WHERE et.season = ? AND et.code = ? ORDER BY et.team", [season, code]),
    all<{ n: number }>("SELECT COUNT(*) n FROM matches WHERE season = ? AND code = ? AND played = 1", [season, code]),
    all<{ placement: number; team: number; name: string | null }>("SELECT a.placement, a.team, t.name FROM awards a LEFT JOIN teams t ON t.number = a.team WHERE a.season = ? AND a.code = ? AND a.type = 'Winner' ORDER BY a.placement", [season, code]),
    all<LeagueNums & { team: number; read_at: string | null; taken_at: string }>("SELECT team, rank, rs, tbp, wins, losses, ties, played, meets, read_at, taken_at FROM conference_snapshots WHERE season = ? AND code = ?", [season, code]),
    all<ConfRow>(`${CONF_SELECT} WHERE c.season <> ?`, [season]),
  ]);
  const captain = winners.find((w) => w.placement === 1);
  const finished = !!captain || (!!c.end && c.end < now);
  const status: Conference["status"] = finished ? "finished" : Number(played[0]?.n ?? 0) > 0 ? "live" : "upcoming";

  // The teams: FIRST's list, else FTC New Jersey's sign-ups (never both as one list).
  const prov = field.length ? null : await provisionalFor(season, code);
  const teams: { team: number; name: string | null; registered?: "registered" | "pending" }[] = field.length
    ? field.map((t) => ({ team: Number(t.team), name: t.name }))
    : (prov?.teams ?? []).map((t) => ({ team: Number(t.team), name: t.name, registered: t.status }));
  if (!field.length && prov) {
    const names = new Map((await all<{ number: number; name: string | null }>(`SELECT number, name FROM teams WHERE number IN (${teams.map(() => "?").join(",") || "NULL"})`, teams.map((t) => t.team))).map((r) => [Number(r.number), r.name]));
    for (const t of teams) t.name = names.get(t.team) ?? t.name;
  }

  // Whose league numbers: today's before the tournament; after it the snapshot, or today's when every league meet was
  // before it (FIRST's league table leaves the tournament out, so nothing has moved), else none.
  const lastMeet = (league?.meets ?? []).filter((m) => m.type === "LeagueMeet" && m.played && m.start).map((m) => m.start!).sort().pop() ?? null;
  let rs: ConferenceRs;
  let nums: Map<number, LeagueNums>;
  const liveNums = () => new Map((league?.rows ?? []).map((r) => [r.team, { rank: r.rank, rs: r.rs, tbp: r.tbp, wins: r.wins, losses: r.losses, ties: r.ties, played: r.played, meets: r.meets }]));
  if (status === "upcoming") { rs = { kind: "live", asOf: league?.readAt ?? null }; nums = liveNums(); }
  else if (snap.length) {
    rs = { kind: "snapshot", asOf: snap.map((s) => s.read_at ?? s.taken_at).sort().pop()! };
    nums = new Map(snap.map((s) => [Number(s.team), s]));
  } else if (lastMeet && c.start && lastMeet < c.start) { rs = { kind: "final", asOf: league?.readAt ?? null, lastMeet }; nums = liveNums(); }
  else { rs = { kind: "gone" }; nums = new Map(); }
  const leagueOf = [...nums.values()].filter((n) => (n.played ?? 1) > 0).length;

  // Scout's numbers beside FIRST's, the same ones /rankings and the league page show.
  const ids = teams.map((t) => t.team);
  const [ranked, stats] = await Promise.all([
    liveList(season),
    ids.length ? all<{ team: number; opr: number | null }>(`SELECT team, opr_np opr FROM team_season_stats WHERE season = ? AND team IN (${ids.map(() => "?").join(",")})`, [season, ...ids]) : Promise.resolve([]),
  ]);
  const rating = new Map(ranked.map((t) => [Number(t.team), t.rating]));
  const opr = new Map(stats.map((s) => [Number(s.team), s.opr == null ? null : Math.round(Number(s.opr) * 100) / 100]));

  const row = (t: (typeof teams)[number]): ConferenceRow => {
    const n = nums.get(t.team);
    // A league row with no match played is FIRST's list of members, not a standing: unranked, like no row at all.
    const has = !!n && (n.played ?? 1) > 0;
    return {
      team: t.team, name: t.name, rank: null, leagueRank: has ? Number(n!.rank) : null,
      wins: has ? n!.wins : null, losses: has ? n!.losses : null, ties: has ? n!.ties : null,
      rs: has ? n!.rs : null, tbp: has ? n!.tbp : null, played: has ? n!.played : null, meets: has ? n!.meets : null,
      rating: rating.get(t.team) ?? null, opr: opr.get(t.team) ?? null,
      ...(t.registered ? { registered: t.registered } : {}),
    };
  };
  const all_ = teams.map(row);
  const rankedRows = all_.filter((r) => r.leagueRank != null).sort((a, b) => a.leagueRank! - b.leagueRank! || a.team - b.team);
  rankedRows.forEach((r, i) => { r.rank = i + 1; });
  const rows = [...rankedRows, ...all_.filter((r) => r.leagueRank == null).sort((a, b) => a.team - b.team)];

  // The same conference in other seasons: a shared slug, and only one match in that season (two would be a guess).
  const mine = new Set(aliasesOf(c));
  const bySeason = new Map<number, ConfRow[]>();
  for (const o of others) if (aliasesOf(o).some((a) => mine.has(a))) bySeason.set(o.season, [...(bySeason.get(o.season) ?? []), o]);
  const seasons = [...bySeason.values()].filter((l) => l.length === 1).map(([o]) => ({ season: o.season, region: o.region, league: o.league, code: o.code, name: o.name, slug: o.slug })).sort((a, b) => b.season - a.season);

  return {
    season, code, name: c.name, slug: c.slug, firstName: c.first_name, event: c.event, start: c.start, venue: c.venue, city: c.city, status,
    teamsFrom: field.length ? "field" : teams.length ? "registered" : "none",
    registered: !field.length && prov ? { count: prov.teams.filter((t) => t.status === "registered").length, fetchedAt: prov.fetchedAt, url: prov.url, sessionUnknown: prov.sessionUnknown } : null,
    rs, leagueOf, rows,
    winner: captain ? { captain: { team: Number(captain.team), name: captain.name }, picks: winners.filter((w) => w.placement > 1).map((w) => ({ team: Number(w.team), name: w.name })) } : null,
    seasons,
  };
}

/** A league's conferences, oldest tournament first; none outside New Jersey; null when the season has no such league. */
export async function leagueConferences(season: number, regionRaw: string, codeRaw: string, o: { now?: string } = {}): Promise<LeagueConferences | null> {
  const k = await storedLeague(season, regionRaw, codeRaw);
  if (!k) return null;
  const { region, code } = k;
  if (region !== CONFERENCE_REGION) return { season, region, code, conferences: [] };
  const confs = await all<ConfRow>(`${CONF_SELECT} WHERE c.season = ? AND c.region = ? AND c.league = ? ORDER BY e.start, c.code`, [season, region, code]);
  if (!confs.length) return { season, region, code, conferences: [] };
  const league = await leagueStandings(season, region, code);
  const now = o.now ?? today();
  return { season, region, code, conferences: await Promise.all(confs.map((c) => buildConference(c, league, now))) };
}

/** One conference tournament's table, by its (season, code); null when it names no conference. */
export async function conferenceByEvent(season: number, code: string, o: { now?: string } = {}): Promise<(Conference & { region: string; league: string; leagueName: string | null }) | null> {
  const [c] = await all<ConfRow>(`${CONF_SELECT} WHERE c.season = ? AND c.code = ? COLLATE NOCASE`, [season, code]);
  if (!c) return null;
  const league = await leagueStandings(season, c.region, c.league);
  return { ...(await buildConference(c, league, o.now ?? today())), region: c.region, league: c.league, leagueName: league?.name ?? null };
}

/** A team's conference in a season: the conference tournament FIRST lists it in (its latest), with its place there. */
export async function teamConference(season: number, team: number, o: { now?: string } = {}): Promise<TeamConference | null> {
  const [c] = await all<{ code: string }>(
    `SELECT c.code FROM event_conferences c JOIN event_teams et ON et.season = c.season AND et.code = c.code AND et.team = ? JOIN events e ON e.season = c.season AND e.code = c.code
     WHERE c.season = ? ORDER BY e.start DESC, c.code LIMIT 1`, [team, season]);
  if (!c) return null;
  const conf = await conferenceByEvent(season, c.code, o);
  if (!conf) return null;
  const r = conf.rows.find((x) => x.team === team);
  return {
    season, region: conf.region, league: conf.league, code: conf.code, name: conf.name, slug: conf.slug,
    rank: r?.rank ?? null, of: conf.rows.length, ranked: conf.rows.filter((x) => x.rank != null).length,
    leagueRank: r?.leagueRank ?? null, leagueOf: conf.leagueOf, available: conf.rs.kind !== "gone",
    href: conferenceHref(season, conf.region, conf.league, { slug: conf.slug, team }),
  };
}

/** What the conference button needs about a team: whether it's based in New Jersey, its league and its conference. */
export async function teamConferenceInfo(team: number, season: number): Promise<TeamConferenceInfo> {
  const [home, league, conference] = await Promise.all([
    get<{ state: string | null; country: string | null }>("SELECT state, country FROM teams WHERE number = ?", [team]),
    teamLeagueStanding(season, team),
    teamConference(season, team),
  ]);
  return {
    team, season,
    nj: home ? (home.state ?? "").toUpperCase() === "NJ" && /^(USA|United States)/i.test(home.country ?? "USA") : null,
    league: league ? { region: league.region, code: league.code, name: league.name } : null,
    conference,
  };
}

/** Every stored conference, every season (a few dozen rows): what search reads a conference's name against. */
export async function allConferences(): Promise<{ season: number; code: string; region: string; league: string; leagueName: string | null; name: string; slug: string; aliases: string[]; start: string | null; end: string | null }[]> {
  const rows = await all<ConfRow & { league_name: string | null }>(`SELECT c.season, c.code, c.region, c.league, c.name, c.slug, c.first_name, c.aliases, e.name event, e.start, e.end, e.venue, e.city, l.name league_name
    FROM event_conferences c JOIN events e ON e.season = c.season AND e.code = c.code LEFT JOIN leagues l ON l.season = c.season AND l.region = c.region AND l.code = c.league
    ORDER BY c.season, e.start, c.code`);
  return rows.map((r) => ({ season: Number(r.season), code: r.code, region: r.region, league: r.league, leagueName: r.league_name?.trim() || null, name: r.name, slug: r.slug, aliases: aliasesOf(r), start: r.start, end: r.end }));
}

/** The conference tournament a team is in for a season: FIRST's field first, else FTC New Jersey's sign-ups (`registered`). */
export async function teamConferenceEvent(season: number, team: number): Promise<{ code: string; registered: boolean } | null> {
  const [field] = await all<{ code: string }>(
    `SELECT c.code FROM event_conferences c JOIN event_teams et ON et.season = c.season AND et.code = c.code AND et.team = ? JOIN events e ON e.season = c.season AND e.code = c.code
     WHERE c.season = ? ORDER BY e.start DESC, c.code LIMIT 1`, [team, season]);
  if (field) return { code: field.code, registered: false };
  // Sign-ups only count for a tournament FIRST has no team list for yet.
  const prov = await all<{ code: string; teams: string }>(
    `SELECT c.code, p.teams FROM event_conferences c JOIN event_provisional p ON p.season = c.season AND p.code = c.code JOIN events e ON e.season = c.season AND e.code = c.code
     WHERE c.season = ? AND NOT EXISTS (SELECT 1 FROM event_teams et WHERE et.season = c.season AND et.code = c.code) ORDER BY e.start DESC, c.code`, [season]);
  for (const p of prov) {
    try { if ((JSON.parse(p.teams) as { team: number }[]).some((t) => Number(t.team) === team)) return { code: p.code, registered: true }; } catch { /* a damaged row: not this one */ }
  }
  return null;
}

/** The tournament's own rank for a team (its event table), to say beside the league one: two different rankings. */
export async function tournamentRank(season: number, code: string, team: number): Promise<number | null> {
  const [r] = await all<{ rank: number | null }>("SELECT rank FROM event_teams WHERE season = ? AND code = ? AND team = ?", [season, code, team]);
  return r?.rank == null ? null : Number(r.rank);
}
