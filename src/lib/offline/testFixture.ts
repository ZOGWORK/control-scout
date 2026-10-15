// Test fixture: tiny season packs built with the real pack schema
// (src/shared/packSchema.ts) in sql.js, for the offline reader tests.
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { PACK_INDEXES, PACK_TABLES, PACK_TEAMS_DDL } from "../../shared/packSchema";
import { wrap, type SeasonDb } from "./readers";

type Rows = Record<string, Record<string, SqlValue>[]>;

export async function packDb(season: number, rows: Rows): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE pack_info (key TEXT PRIMARY KEY, value TEXT)");
  db.run("INSERT INTO pack_info VALUES ('format', '1'), ('season', ?)", [String(season)]);
  db.run(PACK_TEAMS_DDL);
  for (const t of PACK_TABLES) db.run(t.ddl);
  for (const ix of PACK_INDEXES) db.run(ix);
  for (const [table, list] of Object.entries(rows)) {
    for (const r of list) {
      const cols = Object.keys(r);
      db.run(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`, cols.map((c) => r[c]));
    }
  }
  return db;
}

const team = (number: number, name: string, city: string) => ({ number, name, full_name: `${name} Robotics`, school: `${name} High`, sponsors: JSON.stringify(["Acme"]), city, state: "NJ", country: "USA", rookie_year: 2015, website: null, home_region: "USNJ" });
const mt = (code: string, level: string, number: number, team: number, alliance: string, station: number, onField = 1) => ({ season: 2025, code, level, series: level === "qual" ? 0 : 1, number, team, alliance, station, surrogate: 0, dq: 0, on_field: onField });
const played = (code: string, level: string, number: number, label: string, time: string, red: number, blue: number) => ({
  season: 2025, code, level, series: level === "qual" ? 0 : 1, number, label, description: label, time, played: 1,
  red_total: red, red_np: red - 5, red_auto: 20, red_teleop: red - 45, red_endgame: 20, red_pen: 5, red_bonus: null,
  blue_total: blue, blue_np: blue, blue_auto: 15, blue_teleop: blue - 35, blue_endgame: 20, blue_pen: 0, blue_bonus: null, video: null, source: "first",
});

/** 2025: a finished qualifier (USNJQ1) with results, playoffs, alliances and awards; an upcoming one (USNJQ9) with a schedule. */
export async function season2025(): Promise<SeasonDb> {
  const db = await packDb(2025, {
    teams: [team(100, "Gearheads", "Newark"), team(200, "Bolt", "Trenton"), team(300, "Cogs", "Camden"), team(400, "Sprockets", "Hoboken"), team(500, "Spare", "Edison")],
    events: [
      { season: 2025, code: "USNJQ1", name: "New Jersey Qualifier 1", type: "Qualifier", region: "USNJ", venue: "Gym", city: "Newark", state: "NJ", country: "USA", start: "2025-11-01", end: "2025-11-01", timezone: "America/New_York", remote: 0, website: null, livestream: null, source: "first" },
      { season: 2025, code: "USNJQ9", name: "New Jersey Qualifier 9", type: "Qualifier", region: "USNJ", city: "Edison", state: "NJ", country: "USA", start: "2099-03-01", end: "2099-03-01", timezone: "America/New_York", remote: 0, source: "first" },
    ],
    event_teams: [
      { season: 2025, code: "USNJQ1", team: 100, rank: 2, rp: 2, tbp: 40, wins: 1, losses: 1, ties: 0, qual_played: 2, dq: 0 },
      { season: 2025, code: "USNJQ1", team: 200, rank: 1, rp: 2, tbp: 50, wins: 2, losses: 0, ties: 0, qual_played: 2, dq: 0 },
      { season: 2025, code: "USNJQ1", team: 300, rank: 3, rp: 1, tbp: 30, wins: 1, losses: 1, ties: 0, qual_played: 2, dq: 0 },
      { season: 2025, code: "USNJQ1", team: 400, rank: null, rp: null, tbp: null, wins: 0, losses: 2, ties: 0, qual_played: 2, dq: 0 },
      // Listed but never on the field (a league roster): dropped from 500's events.
      { season: 2025, code: "USNJQ1", team: 500, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qual_played: 0, dq: 0 },
      { season: 2025, code: "USNJQ9", team: 100, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qual_played: null, dq: 0 },
      { season: 2025, code: "USNJQ9", team: 300, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qual_played: null, dq: 0 },
    ],
    matches: [
      played("USNJQ1", "qual", 1, "Q1", "2025-11-01T09:00:00", 120, 80),
      played("USNJQ1", "qual", 2, "Q2", "2025-11-01T09:10:00", 90, 110),
      played("USNJQ1", "playoff", 1, "M1", "2025-11-01T14:00:00", 150, 100),
      { season: 2025, code: "USNJQ9", level: "qual", series: 0, number: 1, label: "Q1", time: "2099-03-01T09:00:00", played: 0, source: "first" },
    ],
    match_teams: [
      mt("USNJQ1", "qual", 1, 100, "red", 1), mt("USNJQ1", "qual", 1, 200, "red", 2), mt("USNJQ1", "qual", 1, 300, "blue", 1), mt("USNJQ1", "qual", 1, 400, "blue", 2),
      mt("USNJQ1", "qual", 2, 100, "blue", 1), mt("USNJQ1", "qual", 2, 400, "blue", 2), mt("USNJQ1", "qual", 2, 200, "red", 1), mt("USNJQ1", "qual", 2, 300, "red", 2),
      mt("USNJQ1", "playoff", 1, 200, "red", 1), mt("USNJQ1", "playoff", 1, 100, "red", 2), mt("USNJQ1", "playoff", 1, 500, "red", 3, 0),
      mt("USNJQ1", "playoff", 1, 300, "blue", 1), mt("USNJQ1", "playoff", 1, 400, "blue", 2),
      mt("USNJQ9", "qual", 1, 100, "red", 1), mt("USNJQ9", "qual", 1, 200, "red", 2), mt("USNJQ9", "qual", 1, 300, "blue", 1), mt("USNJQ9", "qual", 1, 400, "blue", 2),
    ],
    alliances: [
      { season: 2025, code: "USNJQ1", number: 1, name: "Alliance 1", captain: 200, pick1: 100, pick2: null, backup: null },
      { season: 2025, code: "USNJQ1", number: 2, name: "Alliance 2", captain: 300, pick1: 400, pick2: null, backup: null },
    ],
    awards: [
      { season: 2025, code: "USNJQ1", type: "Think", placement: 1, team: 300, name: null },
      { season: 2025, code: "USNJQ1", type: "Winner", placement: 1, team: 100, name: null },
      { season: 2025, code: "USNJQ1", type: "Inspire", placement: 1, team: 200, name: null },
    ],
    advancement: [{ season: 2025, code: "USNJQ1", slots: 2, advances_to: "USNJCMP", rows: JSON.stringify([{ team: 200, status: "Inspire", declined: false }]) }],
    team_event_stats: [
      { season: 2025, code: "USNJQ1", team: 100, opr_np: 55.5, opr_auto: 10, opr_teleop: 30, opr_endgame: 15.5, opr_pen: 2, avg_score: 105, avg_np: 100, avg_pen: 5, matches: 3, wins: 2, losses: 1, ties: 0 },
      { season: 2025, code: "USNJQ1", team: 200, opr_np: 60, opr_auto: 12, opr_teleop: 33, opr_endgame: 15, opr_pen: 1, avg_score: 120, avg_np: 115, avg_pen: 5, matches: 3, wins: 3, losses: 0, ties: 0 },
    ],
    team_season_stats: [
      { season: 2025, team: 100, opr_np: 55.5, opr_auto: 10, opr_teleop: 30, opr_endgame: 15.5, opr_pen: 2, rank_np: 7, rank_auto: 9, rank_teleop: 6, rank_endgame: 5, ranked_teams: 400,
        rating_np: 50, rating_auto: 9, rating_teleop: 28, rating_endgame: 13, rating_pen: 2, rating_sd: 6, rating_matches: 3, rating_rank: 8, events: 1, matches: 3, wins: 2, losses: 1, ties: 0, avg_np: 100, avg_score: 105, avg_pen: 5 },
    ],
  });
  return { season: 2025, db: wrap(db) };
}

/** 2024: team 100 won an award there; team 999 played only that season. */
export async function season2024(): Promise<SeasonDb> {
  const db = await packDb(2024, {
    teams: [team(100, "Gearheads (old name)", "Newark"), team(999, "Retired", "Princeton")],
    events: [{ season: 2024, code: "USNJCMP", name: "New Jersey Championship", type: "Championship", city: "Princeton", state: "NJ", country: "USA", start: "2025-03-01", end: "2025-03-02", timezone: "America/New_York", remote: 0, source: "ftcscout" }],
    event_teams: [
      { season: 2024, code: "USNJCMP", team: 100, rank: 4, rp: 1.5, tbp: 20, wins: 3, losses: 2, ties: 0, qual_played: 5, dq: 0 },
      { season: 2024, code: "USNJCMP", team: 999, rank: 9, rp: 0.5, tbp: 4, wins: 1, losses: 4, ties: 0, qual_played: 5, dq: 0 },
    ],
    awards: [{ season: 2024, code: "USNJCMP", type: "Design", placement: 2, team: 100, name: null }],
  });
  return { season: 2024, db: wrap(db) };
}
