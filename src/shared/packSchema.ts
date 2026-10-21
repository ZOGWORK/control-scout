// The schema of a full season pack (one SQLite file per season). The server
// builds packs with it (server/packs/build.ts); the app reads saved packs
// offline against it (src/lib/offline). One definition, so they can't drift.

/** Season tables, each copied as-is from the server's database (every row of the season). */
export const PACK_TABLES: { name: string; ddl: string; teamsJoin?: boolean }[] = [
  { name: "events", ddl: "CREATE TABLE events (season INTEGER, code TEXT, name TEXT, type TEXT, division_code TEXT, region TEXT, league TEXT, venue TEXT, city TEXT, state TEXT, country TEXT, start TEXT, \"end\" TEXT, timezone TEXT, remote INTEGER, hybrid INTEGER, website TEXT, livestream TEXT, source TEXT, PRIMARY KEY (season, code))" },
  { name: "event_teams", ddl: "CREATE TABLE event_teams (season INTEGER, code TEXT, team INTEGER, rank INTEGER, rp REAL, tbp REAL, wins INTEGER, losses INTEGER, ties INTEGER, qual_played INTEGER, dq INTEGER, PRIMARY KEY (season, code, team))" },
  { name: "matches", ddl: "CREATE TABLE matches (season INTEGER, code TEXT, level TEXT, series INTEGER, number INTEGER, label TEXT, description TEXT, time TEXT, played INTEGER, red_total INTEGER, red_np INTEGER, red_auto INTEGER, red_teleop INTEGER, red_endgame INTEGER, red_pen INTEGER, red_bonus TEXT, blue_total INTEGER, blue_np INTEGER, blue_auto INTEGER, blue_teleop INTEGER, blue_endgame INTEGER, blue_pen INTEGER, blue_bonus TEXT, video TEXT, source TEXT, PRIMARY KEY (season, code, level, series, number))" },
  { name: "match_teams", ddl: "CREATE TABLE match_teams (season INTEGER, code TEXT, level TEXT, series INTEGER, number INTEGER, team INTEGER, alliance TEXT, station INTEGER, surrogate INTEGER, dq INTEGER, on_field INTEGER, PRIMARY KEY (season, code, level, series, number, team))" },
  { name: "alliances", ddl: "CREATE TABLE alliances (season INTEGER, code TEXT, number INTEGER, name TEXT, captain INTEGER, pick1 INTEGER, pick2 INTEGER, backup INTEGER, PRIMARY KEY (season, code, number))" },
  { name: "awards", ddl: "CREATE TABLE awards (season INTEGER, code TEXT, type TEXT, placement INTEGER, team INTEGER, name TEXT, PRIMARY KEY (season, code, type, placement, team))" },
  { name: "advancement", ddl: "CREATE TABLE advancement (season INTEGER, code TEXT, slots INTEGER, advances_to TEXT, rows TEXT, PRIMARY KEY (season, code))" },
  { name: "team_event_stats", ddl: "CREATE TABLE team_event_stats (season INTEGER, code TEXT, team INTEGER, opr_np REAL, opr_auto REAL, opr_teleop REAL, opr_endgame REAL, opr_pen REAL, avg_score REAL, avg_np REAL, avg_pen REAL, matches INTEGER, wins INTEGER, losses INTEGER, ties INTEGER, PRIMARY KEY (season, code, team))" },
  { name: "team_season_stats", ddl: "CREATE TABLE team_season_stats (season INTEGER, team INTEGER, opr_np REAL, opr_auto REAL, opr_teleop REAL, opr_endgame REAL, opr_pen REAL, rank_np INTEGER, rank_auto INTEGER, rank_teleop INTEGER, rank_endgame INTEGER, ranked_teams INTEGER, rating_np REAL, rating_auto REAL, rating_teleop REAL, rating_endgame REAL, rating_pen REAL, rating_sd REAL, rating_matches INTEGER, rating_rank INTEGER, events INTEGER, matches INTEGER, wins INTEGER, losses INTEGER, ties INTEGER, avg_np REAL, avg_score REAL, avg_pen REAL, PRIMARY KEY (season, team))" },
  // Stored Monte Carlo projections (server/projections), so a saved event shows them offline. Packs built before
  // this table existed don't have it: the offline reader then answers that there are none.
  { name: "event_projections", ddl: "CREATE TABLE event_projections (season INTEGER, code TEXT, kind TEXT, state_key TEXT, seed INTEGER, runs INTEGER, target_runs INTEGER, stage TEXT, played INTEGER, scheduled INTEGER, through TEXT, slots INTEGER, slots_source TEXT, engine_version TEXT, ms INTEGER, computed_at TEXT, teams TEXT, PRIMARY KEY (season, code, kind))" },
];

export const PACK_TEAMS_DDL = "CREATE TABLE teams (number INTEGER PRIMARY KEY, name TEXT, full_name TEXT, school TEXT, sponsors TEXT, city TEXT, state TEXT, country TEXT, rookie_year INTEGER, website TEXT, home_region TEXT)";

export const PACK_INDEXES = [
  "CREATE INDEX match_teams_team ON match_teams (team)",
  "CREATE INDEX event_teams_team ON event_teams (team)",
];
