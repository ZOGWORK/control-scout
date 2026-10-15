// Database: SQLite through @libsql/client (a local file by default, Turso when
// DATABASE_URL is a libsql:// URL). Schema changes are numbered migrations,
// applied once each, in order, inside a transaction.
import { createClient, type Client, type InArgs, type InStatement, type Row } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "./env.js";

const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "core data",
    sql: `
CREATE TABLE seasons (
  season INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  frozen INTEGER NOT NULL DEFAULT 0,
  last_sync TEXT,
  last_complete TEXT
);

CREATE TABLE teams (
  number INTEGER PRIMARY KEY,
  name TEXT,
  full_name TEXT,
  school TEXT,
  sponsors TEXT,             -- JSON array
  city TEXT, state TEXT, country TEXT,
  rookie_year INTEGER,
  website TEXT,
  home_region TEXT,
  updated_at TEXT
);

CREATE TABLE team_seasons (
  season INTEGER NOT NULL,
  team INTEGER NOT NULL,
  PRIMARY KEY (season, team)
);

CREATE TABLE events (
  season INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,                 -- FTC Scout style, no spaces: Qualifier, LeagueTournament…
  division_code TEXT,
  region TEXT,
  league TEXT,
  venue TEXT, city TEXT, state TEXT, country TEXT,
  start TEXT, end TEXT,      -- YYYY-MM-DD
  timezone TEXT,
  remote INTEGER NOT NULL DEFAULT 0,
  hybrid INTEGER NOT NULL DEFAULT 0,
  website TEXT,
  livestream TEXT,
  source TEXT NOT NULL,      -- first | ftc-scout
  upstream_updated TEXT,     -- upstream change marker (FTC Scout updatedAt)
  synced_at TEXT,
  detail_synced_at TEXT,     -- when matches/rankings/awards were last pulled
  PRIMARY KEY (season, code)
);
CREATE INDEX events_start ON events (start);
CREATE INDEX events_season_type ON events (season, type);

CREATE TABLE event_teams (
  season INTEGER NOT NULL, code TEXT NOT NULL, team INTEGER NOT NULL,
  rank INTEGER, rp REAL, tbp REAL,
  wins INTEGER, losses INTEGER, ties INTEGER, qual_played INTEGER, dq INTEGER,
  PRIMARY KEY (season, code, team)
);
CREATE INDEX event_teams_team ON event_teams (team, season);

CREATE TABLE matches (
  season INTEGER NOT NULL, code TEXT NOT NULL,
  level TEXT NOT NULL,       -- qual | playoff
  series INTEGER NOT NULL, number INTEGER NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  time TEXT,                 -- ISO, actual start else scheduled
  played INTEGER NOT NULL DEFAULT 0,
  red_total INTEGER, red_np INTEGER, red_auto INTEGER, red_teleop INTEGER, red_endgame INTEGER, red_pen INTEGER, red_bonus TEXT,
  blue_total INTEGER, blue_np INTEGER, blue_auto INTEGER, blue_teleop INTEGER, blue_endgame INTEGER, blue_pen INTEGER, blue_bonus TEXT,
  video TEXT,                -- official match video (FIRST videoURL)
  source TEXT NOT NULL,
  PRIMARY KEY (season, code, level, series, number)
);
CREATE INDEX matches_time ON matches (time);

CREATE TABLE match_teams (
  season INTEGER NOT NULL, code TEXT NOT NULL, level TEXT NOT NULL, series INTEGER NOT NULL, number INTEGER NOT NULL,
  team INTEGER NOT NULL,
  alliance TEXT NOT NULL,    -- red | blue
  station INTEGER,
  surrogate INTEGER NOT NULL DEFAULT 0,
  dq INTEGER NOT NULL DEFAULT 0,
  on_field INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (season, code, level, series, number, team)
);
CREATE INDEX match_teams_team ON match_teams (team, season);

CREATE TABLE alliances (
  season INTEGER NOT NULL, code TEXT NOT NULL, number INTEGER NOT NULL,
  name TEXT, captain INTEGER, pick1 INTEGER, pick2 INTEGER, backup INTEGER,
  PRIMARY KEY (season, code, number)
);

CREATE TABLE awards (
  season INTEGER NOT NULL, code TEXT NOT NULL,
  type TEXT NOT NULL,        -- Inspire, Think, …, Winner, Finalist, DeansList
  placement INTEGER NOT NULL,
  team INTEGER NOT NULL,
  name TEXT,
  PRIMARY KEY (season, code, type, placement, team)
);
CREATE INDEX awards_team ON awards (team, season);

CREATE TABLE advancement (
  season INTEGER NOT NULL, code TEXT NOT NULL,
  slots INTEGER NOT NULL,
  advances_to TEXT,
  rows TEXT NOT NULL,        -- JSON [{team,status,declined}]
  PRIMARY KEY (season, code)
);

CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: "computed stats + prediction ledger + search",
    sql: `
CREATE TABLE team_event_stats (
  season INTEGER NOT NULL, code TEXT NOT NULL, team INTEGER NOT NULL,
  opr_np REAL, opr_auto REAL, opr_teleop REAL, opr_endgame REAL, opr_pen REAL,
  avg_score REAL, avg_np REAL, avg_pen REAL,
  matches INTEGER NOT NULL DEFAULT 0, wins INTEGER, losses INTEGER, ties INTEGER,
  PRIMARY KEY (season, code, team)
);
CREATE INDEX tes_team ON team_event_stats (team, season);

CREATE TABLE team_season_stats (
  season INTEGER NOT NULL, team INTEGER NOT NULL,
  opr_np REAL, opr_auto REAL, opr_teleop REAL, opr_endgame REAL, opr_pen REAL,
  rank_np INTEGER, rank_auto INTEGER, rank_teleop INTEGER, rank_endgame INTEGER,
  ranked_teams INTEGER,
  rating_np REAL, rating_auto REAL, rating_teleop REAL, rating_endgame REAL, rating_pen REAL,
  rating_sd REAL, rating_matches INTEGER, rating_rank INTEGER,
  events INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, ties INTEGER NOT NULL DEFAULT 0,
  avg_np REAL, avg_score REAL, avg_pen REAL,
  PRIMARY KEY (season, team)
);
CREATE INDEX tss_rank ON team_season_stats (season, rank_np);

CREATE TABLE predictions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,        -- live (logged before the match) | backtest (walk-forward replay)
  season INTEGER NOT NULL, code TEXT NOT NULL, level TEXT NOT NULL, series INTEGER NOT NULL, number INTEGER NOT NULL,
  red TEXT NOT NULL, blue TEXT NOT NULL,
  p_red REAL NOT NULL, red_mean REAL NOT NULL, blue_mean REAL NOT NULL,
  tier TEXT NOT NULL,
  factors TEXT,
  engine_version TEXT NOT NULL,
  predicted_at TEXT NOT NULL,
  match_time TEXT,
  red_score INTEGER, blue_score INTEGER,
  outcome REAL,              -- 1 red won, 0 blue won, 0.5 tie
  scored_at TEXT,
  UNIQUE (kind, season, code, level, series, number)
);
CREATE INDEX predictions_scored ON predictions (kind, season, scored_at);

CREATE VIRTUAL TABLE search USING fts5(
  kind UNINDEXED, ref UNINDEXED, season UNINDEXED, weight UNINDEXED,
  title, subtitle, terms,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '1 2 3'
);
`,
  },
  {
    version: 3,
    name: "accounts + personal data",
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE COLLATE NOCASE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  last_seen TEXT
);
CREATE TABLE identities (
  provider TEXT NOT NULL,    -- email | google | control-point (later)
  subject TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,       -- sha256 of the cookie token
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE TABLE email_codes (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 1,
  window_start TEXT NOT NULL
);
CREATE TABLE user_state (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,         -- myTeam | tracked | bookmarks | settings | videoLinks
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE scout_entries (
  uuid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  team INTEGER NOT NULL,
  event_code TEXT,
  match_label TEXT,
  kind TEXT NOT NULL,        -- match | pit
  data TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX scout_user ON scout_entries (user_id, season);
`,
  },
  {
    version: 4,
    name: "typo-tolerant search (trigram index)",
    sql: `
CREATE VIRTUAL TABLE search_fuzzy USING fts5(
  kind UNINDEXED, ref UNINDEXED, season UNINDEXED, weight UNINDEXED, title UNINDEXED, subtitle UNINDEXED,
  name,
  tokenize = 'trigram'
);
`,
  },
  {
    version: 5,
    name: "indexes for event and team match lookups",
    sql: `
-- The unique key starts with kind, so lookups by (season, code) scanned the table.
CREATE INDEX predictions_event ON predictions (season, code);
-- Team match lists start from the team's lineup rows instead of every match in the season.
CREATE INDEX match_teams_team_match ON match_teams (team, season, code, level, series, number);
DROP INDEX IF EXISTS match_teams_team;
`,
  },
  {
    version: 6,
    name: "live calls remember whether they had a scoring basis",
    sql: `
-- 1 = logged before the season had rated matches: win odds only, the predicted score means nothing.
ALTER TABLE predictions ADD COLUMN no_score_basis INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    version: 7,
    name: "records tables (team-event and team-season stats for filtering)",
    sql: `
-- One row per team per event (teams that played a qualification match), written
-- by the stats job (server/stats/records.ts). Team and event fields are copied in
-- so a filtered, sorted page is one scan of one table.
-- Score columns: <part>_<aggregate>, over the team's qualification matches.
CREATE TABLE team_event_records (
  season INTEGER NOT NULL, code TEXT NOT NULL, team INTEGER NOT NULL,
  event_name TEXT, event_type TEXT, event_region TEXT, event_start TEXT, event_end TEXT,
  team_name TEXT, home_region TEXT, rookie_year INTEGER, school TEXT,
  -- Case- and accent-folded copies for text filters (SQLite's lower() is ASCII-only).
  event_name_fold TEXT, team_name_fold TEXT, school_fold TEXT,
  rank INTEGER, rp REAL, tb1 REAL, played INTEGER, wins INTEGER, losses INTEGER, ties INTEGER,
  total_tot REAL, total_avg REAL, total_opr REAL, total_min REAL, total_max REAL, total_dev REAL,
  np_tot REAL, np_avg REAL, np_opr REAL, np_min REAL, np_max REAL, np_dev REAL,
  auto_tot REAL, auto_avg REAL, auto_opr REAL, auto_min REAL, auto_max REAL, auto_dev REAL,
  dc_tot REAL, dc_avg REAL, dc_opr REAL, dc_min REAL, dc_max REAL, dc_dev REAL,
  endgame_tot REAL, endgame_avg REAL, endgame_opr REAL, endgame_min REAL, endgame_max REAL, endgame_dev REAL,
  pen_tot REAL, pen_avg REAL, pen_opr REAL, pen_min REAL, pen_max REAL, pen_dev REAL,
  opp_pen_tot REAL, opp_pen_avg REAL, opp_pen_opr REAL, opp_pen_min REAL, opp_pen_max REAL, opp_pen_dev REAL,
  pred_win_avg REAL, pred_score_avg REAL, adv_odds REAL,
  PRIMARY KEY (season, code, team)
) WITHOUT ROWID;
-- WITHOUT ROWID clusters rows by season: a filtered page reads one season's rows
-- in order (≈30 ms for 2025–26) instead of 28k rowid lookups through an index (≈180 ms).

-- One row per team per season: the same stats over all its qualification
-- matches that season (OPR = best event OPR, as the season ranks use).
CREATE TABLE team_season_records (
  season INTEGER NOT NULL, team INTEGER NOT NULL,
  team_name TEXT, home_region TEXT, rookie_year INTEGER, school TEXT,
  team_name_fold TEXT, school_fold TEXT,
  events INTEGER, played INTEGER, wins INTEGER, losses INTEGER, ties INTEGER,
  total_tot REAL, total_avg REAL, total_opr REAL, total_min REAL, total_max REAL, total_dev REAL,
  np_tot REAL, np_avg REAL, np_opr REAL, np_min REAL, np_max REAL, np_dev REAL,
  auto_tot REAL, auto_avg REAL, auto_opr REAL, auto_min REAL, auto_max REAL, auto_dev REAL,
  dc_tot REAL, dc_avg REAL, dc_opr REAL, dc_min REAL, dc_max REAL, dc_dev REAL,
  endgame_tot REAL, endgame_avg REAL, endgame_opr REAL, endgame_min REAL, endgame_max REAL, endgame_dev REAL,
  pen_tot REAL, pen_avg REAL, pen_opr REAL, pen_min REAL, pen_max REAL, pen_dev REAL,
  opp_pen_tot REAL, opp_pen_avg REAL, opp_pen_opr REAL, opp_pen_min REAL, opp_pen_max REAL, opp_pen_dev REAL,
  pred_win_avg REAL, pred_score_avg REAL,
  PRIMARY KEY (season, team)
) WITHOUT ROWID;

-- One row per played match (in-person events), with event fields, lineups
-- (listed teams, space-separated) and DC as FIRST reports it.
CREATE TABLE match_records (
  season INTEGER NOT NULL, code TEXT NOT NULL, level TEXT NOT NULL, series INTEGER NOT NULL, number INTEGER NOT NULL,
  label TEXT, time TEXT,
  event_name TEXT, event_type TEXT, event_region TEXT, event_start TEXT, event_end TEXT,
  event_name_fold TEXT,
  red_teams TEXT, blue_teams TEXT,
  red_total INTEGER, red_np INTEGER, red_auto INTEGER, red_dc INTEGER, red_endgame INTEGER, red_pen INTEGER,
  blue_total INTEGER, blue_np INTEGER, blue_auto INTEGER, blue_dc INTEGER, blue_endgame INTEGER, blue_pen INTEGER,
  margin INTEGER, high INTEGER, combined INTEGER,
  red_pred_win REAL,
  PRIMARY KEY (season, code, level, series, number)
) WITHOUT ROWID;
`,
  },
  {
    version: 8,
    name: "live events remember when FIRST was last checked",
    sql: `
-- Set by the live fast lane / "Refresh results" each time FIRST is asked, even when nothing changed
-- (detail_synced_at moves only when the event's detail is rewritten).
ALTER TABLE events ADD COLUMN live_checked_at TEXT;
`,
  },
  {
    version: 9,
    name: "anonymous usage statistics (daily aggregates only)",
    sql: `
-- One row per UTC day x route pattern x external referrer host ('' = none) x screen bucket x language.
-- Page views from visitors who opted in (server/analytics.ts). No raw events, IPs, user agents or IDs.
CREATE TABLE analytics_daily (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer_host TEXT NOT NULL DEFAULT '',
  screen TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT '',
  views INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, referrer_host, screen, lang)
) WITHOUT ROWID;
`,
  },
  {
    version: 10,
    name: "contact form messages",
    sql: `
-- One row per message sent from /contact (server/contact.ts). No IP address is kept.
-- emailed: 1 once it was forwarded to CONTACT_TO, 0 if that wasn't set or the send failed.
CREATE TABLE contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  topic TEXT NOT NULL,       -- bug | data | feature | other
  name TEXT,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  emailed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX contact_messages_created ON contact_messages (created_at);
`,
  },
];

export type Db = Client;
let client: Client | null = null;
let replicaClient: Client | null = null;

export function db(): Client {
  if (!client) client = openDb(env.databaseUrl, env.databaseToken);
  return client;
}

export const isRemote = (url: string) => /^(libsql|https?|wss?):\/\//.test(url);

/**
 * Remote database (Turso) → an embedded replica: a local file that syncs from
 * Turso. The app makes many small queries per page; over the network each one
 * is a round trip (event pages took 80–110 s on Turso directly), locally they
 * take microseconds. Writes go to Turso and show up locally after they commit.
 *
 * Call once at startup, before db() is first used. Downloads everything on the
 * first sync, then re-syncs every `syncSeconds`. Falls back to the plain remote
 * client if the replica can't sync, so a failure is never worse than before.
 * DATABASE_REPLICA=off keeps the plain remote client.
 */
export async function openReplicaIfRemote(log: (m: string) => void, syncSeconds = 300): Promise<"replica" | "remote" | "local"> {
  const url = env.databaseUrl;
  if (!isRemote(url)) return "local";
  if (process.env.DATABASE_REPLICA === "off" || client) return "remote";
  const t0 = Date.now();
  let replica: Client | null = null;
  try {
    // Inside the try: a read-only or missing data directory must fall back too.
    const path = resolve(env.dataDir, "replica.db");
    mkdirSync(dirname(path), { recursive: true });
    replica = createClient({ url: `file:${path}`, syncUrl: url, authToken: env.databaseToken ?? undefined, syncInterval: syncSeconds });
    const r = await replica.sync();
    client = replicaClient = replica;
    log(`database: embedded replica of ${url.replace(/^\w+:\/\//, "")} synced in ${((Date.now() - t0) / 1000).toFixed(1)} s (frames ${r?.frames_synced ?? "?"}), re-syncs every ${syncSeconds} s`);
    return "replica";
  } catch (e) {
    try { replica?.close(); } catch { /* already unusable */ }
    log(`database: replica unavailable (${(e as Error).message}); using the remote database directly`);
    return "remote";
  }
}

export function openDb(url: string, authToken?: string | null): Client {
  if (url.startsWith("file:")) {
    const path = url.slice(5);
    if (path && path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  return createClient({ url, authToken: authToken ?? undefined });
}

/** Use a specific client (tests). */
export function setDb(c: Client): void { client = c; }

/** Per-connection settings: WAL and a 5 s busy wait on local files, foreign keys everywhere. */
export async function configure(c: Client = db()): Promise<void> {
  if ((!c.protocol || c.protocol === "file") && c !== replicaClient) { // a replica manages its own journal
    await c.execute("PRAGMA journal_mode = WAL");
    await c.execute("PRAGMA busy_timeout = 5000");
  }
  await c.execute("PRAGMA foreign_keys = ON");
}

export async function migrate(c: Client = db()): Promise<number[]> {
  await configure(c);
  await c.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL)");
  const done = new Set((await c.execute("SELECT version FROM schema_version")).rows.map((r) => Number(r.version)));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    const stmts = splitSql(m.sql);
    await c.batch([...stmts, { sql: "INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)", args: [m.version, m.name, new Date().toISOString()] }], "write");
    applied.push(m.version);
  }
  return applied;
}

/** Split a migration into statements (no semicolons inside our SQL literals). */
function splitSql(sql: string): string[] {
  return sql.split(/;\s*(?:\n|$)/).map((s) => s.replace(/--[^\n]*$/gm, "").trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Small query helpers
// ---------------------------------------------------------------------------

export async function all<T = Row>(sql: string, args: InArgs = []): Promise<T[]> {
  return (await db().execute({ sql, args })).rows as unknown as T[];
}

export async function get<T = Row>(sql: string, args: InArgs = []): Promise<T | undefined> {
  return (await db().execute({ sql, args })).rows[0] as unknown as T | undefined;
}

export async function run(sql: string, args: InArgs = []): Promise<number> {
  return (await db().execute({ sql, args })).rowsAffected;
}

/** Run statements atomically, in chunks (libsql batches are one transaction each). */
export async function writeBatch(stmts: InStatement[], chunk = 2000): Promise<void> {
  if (!stmts.length) return;
  if (stmts.length <= chunk) { await db().batch(stmts, "write"); return; }
  const tx = await db().transaction("write");
  try {
    for (let i = 0; i < stmts.length; i += chunk) await tx.batch(stmts.slice(i, i + chunk));
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const r = await get<{ value: string }>("SELECT value FROM kv WHERE key = ?", [key]);
  return r ? (JSON.parse(r.value) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await run("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [key, JSON.stringify(value), new Date().toISOString()]);
}
