// The normalised shape every data source produces for one event. Ingest
// writes a bundle atomically: an event's rows are replaced as a whole, so a
// half-fetched event never mixes old and new data.
import type { InStatement } from "@libsql/client";
import { isLegacy, type ScoreSplit } from "./seasons.js";

export interface EventRow {
  season: number;
  code: string;
  name: string;
  type: string | null;
  divisionCode: string | null;
  region: string | null;
  league: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  start: string | null;
  end: string | null;
  timezone: string | null;
  remote: boolean;
  hybrid: boolean;
  website: string | null;
  livestream: string | null;
  source: "first" | "ftc-scout";
  upstreamUpdated: string | null;
}

export interface TeamRow {
  number: number;
  name: string | null;
  fullName: string | null;
  school: string | null;
  sponsors: string[] | null;
  city: string | null;
  state: string | null;
  country: string | null;
  rookieYear: number | null;
  website: string | null;
  homeRegion: string | null;
}

export interface EntryRow {
  team: number;
  rank: number | null;
  rp: number | null;
  tbp: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  qualPlayed: number | null;
  dq: number | null;
}

export interface MatchTeam {
  team: number;
  station: number | null;
  surrogate: boolean;
  dq: boolean;
  onField: boolean;
}

export interface MatchRow {
  level: "qual" | "playoff";
  series: number;
  number: number;
  label: string;
  description: string | null;
  time: string | null;
  played: boolean;
  red: MatchTeam[];
  blue: MatchTeam[];
  redScore: ScoreSplit | null;
  blueScore: ScoreSplit | null;
  /** Official match video (FIRST's videoURL), when published. */
  video?: string | null;
  /** Field the match is scheduled on (FIRST's schedule "field"), when the source says. */
  field?: string | null;
  /** False when the scores are totals only (no breakdown reported yet: the split is an estimate). Default true. */
  breakdown?: boolean;  /** Each alliance's score sheet (seasons.ts scoreDetail), when the source reported one. */
  redDetail?: Record<string, number> | null;
  blueDetail?: Record<string, number> | null;
}

export interface AllianceRow { number: number; name: string | null; captain: number | null; pick1: number | null; pick2: number | null; backup: number | null }
export interface AwardRow { type: string; placement: number; team: number; name: string | null }
export interface AdvancementRow { slots: number; advancesTo: string | null; rows: { team: number; status: string; declined: boolean }[] }

export interface EventBundle {
  event: EventRow;
  /** Team metadata seen while fetching (merged into `teams`, never blanking known fields). */
  teams: TeamRow[];
  /** Null = detail not fetched (event-list-only refresh): keep existing detail rows. */
  detail: {
    entries: EntryRow[];
    matches: MatchRow[];
    alliances: AllianceRow[];
    awards: AwardRow[];
    advancement: AdvancementRow | null | undefined; // undefined = not fetched
  } | null;
}

export const matchKey = (m: { level: string; series: number; number: number }) => `${m.level}:${m.series}:${m.number}`;

/**
 * Readable label: Q12 for quals; playoff bracket matches M{series} (replays
 * M{series}-{n}); a best-of finals between two alliances (series 0) F{n}.
 */
export function matchLabel(level: "qual" | "playoff", series: number, number: number): string {
  if (level === "qual") return `Q${number}`;
  return series ? `M${series}${number > 1 ? `-${number}` : ""}` : `F${number}`;
}

const now = () => new Date().toISOString();

/** Upsert team metadata without blanking known fields. `onlyNew`: add unknown
 *  teams but never touch known ones (2019–2022 names and towns are years old). */
export function teamStatements(teams: TeamRow[], onlyNew = false): InStatement[] {
  if (onlyNew) {
    return teams.map((t) => ({
      sql: `INSERT OR IGNORE INTO teams (number, name, full_name, school, sponsors, city, state, country, rookie_year, website, home_region, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [t.number, t.name, t.fullName, t.school, t.sponsors ? JSON.stringify(t.sponsors) : null, t.city, t.state, t.country, t.rookieYear, t.website, t.homeRegion, now()],
    }));
  }
  return teams.map((t) => ({
    sql: `INSERT INTO teams (number, name, full_name, school, sponsors, city, state, country, rookie_year, website, home_region, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(number) DO UPDATE SET
            name = COALESCE(excluded.name, teams.name),
            full_name = COALESCE(excluded.full_name, teams.full_name),
            school = COALESCE(excluded.school, teams.school),
            sponsors = COALESCE(excluded.sponsors, teams.sponsors),
            city = COALESCE(excluded.city, teams.city),
            state = COALESCE(excluded.state, teams.state),
            country = COALESCE(excluded.country, teams.country),
            rookie_year = COALESCE(excluded.rookie_year, teams.rookie_year),
            website = COALESCE(excluded.website, teams.website),
            home_region = COALESCE(excluded.home_region, teams.home_region),
            updated_at = excluded.updated_at`,
    args: [t.number, t.name, t.fullName, t.school, t.sponsors ? JSON.stringify(t.sponsors) : null, t.city, t.state, t.country, t.rookieYear, t.website, t.homeRegion, now()],
  }));
}

/** All statements that write one bundle (event row + replacement of its detail rows). */
export function bundleStatements(b: EventBundle): InStatement[] {
  const e = b.event;
  const s: InStatement[] = [];
  s.push({
    sql: `INSERT INTO events (season, code, name, type, division_code, region, league, venue, city, state, country, start, end, timezone, remote, hybrid, website, livestream, source, upstream_updated, synced_at, detail_synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(season, code) DO UPDATE SET
            name = excluded.name, type = excluded.type, division_code = excluded.division_code,
            region = COALESCE(excluded.region, events.region), league = COALESCE(excluded.league, events.league),
            venue = COALESCE(excluded.venue, events.venue), city = COALESCE(excluded.city, events.city),
            state = COALESCE(excluded.state, events.state), country = COALESCE(excluded.country, events.country),
            start = excluded.start, end = excluded.end, timezone = COALESCE(excluded.timezone, events.timezone),
            remote = excluded.remote, hybrid = excluded.hybrid,
            website = COALESCE(excluded.website, events.website), livestream = COALESCE(excluded.livestream, events.livestream),
            source = CASE WHEN excluded.detail_synced_at IS NOT NULL THEN excluded.source ELSE events.source END,
            upstream_updated = COALESCE(excluded.upstream_updated, events.upstream_updated),
            synced_at = excluded.synced_at,
            detail_synced_at = COALESCE(excluded.detail_synced_at, events.detail_synced_at)`,
    args: [e.season, e.code, e.name, e.type, e.divisionCode, e.region, e.league, e.venue, e.city, e.state, e.country, e.start, e.end, e.timezone, e.remote ? 1 : 0, e.hybrid ? 1 : 0, e.website, e.livestream, e.source, e.upstreamUpdated, now(), b.detail ? now() : null],
  });
  s.push(...teamStatements(b.teams, isLegacy(e.season)));
  if (!b.detail) return s;
  const k = [e.season, e.code];
  for (const t of ["event_teams", "matches", "match_teams", "alliances", "awards"]) s.push({ sql: `DELETE FROM ${t} WHERE season = ? AND code = ?`, args: k });
  // Every writer that replaces an event's matches moves its result-change guard (data/resultChanges.ts), so a
  // diff read before this write is never applied after it.
  s.push({ sql: "UPDATE result_watch SET rev = rev + 1 WHERE season = ? AND code = ?", args: k });
  for (const r of b.detail.entries) {
    s.push({ sql: "INSERT OR REPLACE INTO event_teams (season, code, team, rank, rp, tbp, wins, losses, ties, qual_played, dq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", args: [...k, r.team, r.rank, r.rp, r.tbp, r.wins, r.losses, r.ties, r.qualPlayed, r.dq] });
    s.push({ sql: "INSERT OR IGNORE INTO team_seasons (season, team) VALUES (?, ?)", args: [e.season, r.team] });
  }
  for (const m of b.detail.matches) {
    const sc = (x: ScoreSplit | null) => x ? [x.total, x.np, x.auto, x.teleop, x.endgame, x.pen, x.bonus ? JSON.stringify(x.bonus) : null, x.tips ?? null] : [null, null, null, null, null, null, null, null];
    s.push({
      sql: `INSERT OR REPLACE INTO matches (season, code, level, series, number, label, description, time, played,
              red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, red_bonus, red_tips,
              blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, blue_bonus, blue_tips, video, source, field, breakdown, red_detail, blue_detail)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [...k, m.level, m.series, m.number, m.label, m.description, m.time, m.played ? 1 : 0, ...sc(m.redScore), ...sc(m.blueScore), m.video ?? null, e.source, m.field ?? null, m.played ? (m.breakdown === false ? 0 : 1) : null,
        ...[m.redDetail, m.blueDetail].map((x) => (m.played && x ? JSON.stringify(x) : null))],
    });
    for (const [alliance, ts] of [["red", m.red], ["blue", m.blue]] as const) {
      for (const t of ts) {
        s.push({ sql: "INSERT OR REPLACE INTO match_teams (season, code, level, series, number, team, alliance, station, surrogate, dq, on_field) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", args: [...k, m.level, m.series, m.number, t.team, alliance, t.station, t.surrogate ? 1 : 0, t.dq ? 1 : 0, t.onField ? 1 : 0] });
      }
    }
  }
  for (const a of b.detail.alliances) s.push({ sql: "INSERT OR REPLACE INTO alliances (season, code, number, name, captain, pick1, pick2, backup) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: [...k, a.number, a.name, a.captain, a.pick1, a.pick2, a.backup] });
  for (const a of b.detail.awards) s.push({ sql: "INSERT OR REPLACE INTO awards (season, code, type, placement, team, name) VALUES (?, ?, ?, ?, ?, ?)", args: [...k, a.type, a.placement, a.team, a.name] });
  if (b.detail.advancement !== undefined) {
    s.push({ sql: "DELETE FROM advancement WHERE season = ? AND code = ?", args: k });
    const adv = b.detail.advancement;
    if (adv) s.push({ sql: "INSERT INTO advancement (season, code, slots, advances_to, rows) VALUES (?, ?, ?, ?, ?)", args: [...k, adv.slots, adv.advancesTo, JSON.stringify(adv.rows)] });
  }
  return s;
}
