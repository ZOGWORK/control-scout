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
  {
    version: 11,
    name: "in-app error reports",
    sql: `
-- One row per distinct error (server/errorReports.ts, docs/error-reporting.md). No IP, account or other
-- personal data: sample is the latest sanitized report (message, stack, route, app version, time, browser).
-- issue_number: the GitHub issue filed for it (NULL until filed, or when no GITHUB_REPORT_TOKEN is set).
-- reported_count: the count GitHub was last told (the issue body or the latest comment).
-- filing_at: a claim held while one server files or re-files the issue, so two never open duplicates.
CREATE TABLE error_reports (
  fingerprint TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  sample TEXT NOT NULL,
  issue_number INTEGER,
  issue_state TEXT,          -- open | closed | not_planned
  reported_count INTEGER NOT NULL DEFAULT 0,
  last_comment_at TEXT,
  filing_at TEXT
);
CREATE INDEX error_reports_last_seen ON error_reports (last_seen);
`,
  },
  {
    version: 12,
    name: "workspace scouting (Control Point workspaces mirrored)",
    sql: `
-- Workspaces and membership come from Control Point (docs/shared-accounts.md); Scout mirrors, never edits.
-- workspace_members: a cache of each linked account's workspaces as Control Point last sent them,
-- rewritten whenever Scout fetches the account (sign-in, /api/auth/me at most every 10 min, or a
-- membership miss on a workspace write). Keyed by Control Point's workspace id, so caching it
-- never needs a workspaces row.
CREATE TABLE workspace_members (
  account_id INTEGER NOT NULL,      -- the shared (Control Point) account id
  cp_workspace_id TEXT NOT NULL,    -- Control Point's workspace id: opaque, stable across renames
  workspace_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,               -- admin | member
  updated_at INTEGER NOT NULL,      -- ms; when Control Point last confirmed it
  PRIMARY KEY (account_id, cp_workspace_id)
) WITHOUT ROWID;
CREATE INDEX workspace_members_workspace ON workspace_members (cp_workspace_id);

-- One row per Control Point workspace that has used Scout: created on the first entry (or,
-- later, the first settings change), never on sign-in or by opening Scout.
-- settings: the workspace tier of settings (template, defaults, entry policy), JSON, NULL until an
-- admin first saves; settings_version goes up on every change so clients can refetch.
CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cp_workspace_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  settings TEXT,
  settings_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Shared scout entries, one set per workspace. Personal entries stay in scout_entries (keyed by
-- the Scout user). updated_at is the writer's clock and decides conflicts (newer wins); seq is the
-- server's own order (per workspace, bumped on every accepted write) and is the pull cursor, so an
-- entry synced late with an old updated_at is still seen by everyone who already pulled.
CREATE TABLE workspace_scout_entries (
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  uuid TEXT NOT NULL,
  season INTEGER NOT NULL,
  team INTEGER NOT NULL,
  event_code TEXT,
  match_label TEXT,
  kind TEXT NOT NULL,               -- match | pit
  data TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  author_account_id INTEGER NOT NULL,   -- who created it (set once, by the server)
  author_name TEXT NOT NULL DEFAULT '',
  editor_account_id INTEGER NOT NULL,   -- who wrote the stored version
  editor_name TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, uuid)
);
CREATE UNIQUE INDEX workspace_scout_seq ON workspace_scout_entries (workspace_id, seq);
`,
  },
  {
    version: 13,
    name: "owner portal: feature flags, audit log, request metrics, feedback status",
    sql: `
-- Runtime kill switches (server/flags.ts, src/shared/flags.ts). A flag with no row is on.
CREATE TABLE feature_flags (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- Every owner action (server/portal/audit.ts): who (the owner's email), what, when, details (JSON).
-- result: how an action that runs on after the request ended (a data job) finished; NULL for instant ones.
CREATE TABLE owner_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  result TEXT
);
CREATE INDEX owner_audit_at ON owner_audit (at);

-- API request counts and latency per UTC day and route pattern (server/metrics.ts). Route patterns only
-- (ids, team numbers and event codes replaced), never full URLs, IPs or accounts.
-- b0..b11: requests per latency bucket (upper bounds in METRIC_BUCKETS_MS, the last one open-ended).
CREATE TABLE request_metrics_daily (
  day TEXT NOT NULL,
  route TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  total_ms REAL NOT NULL DEFAULT 0,
  max_ms REAL NOT NULL DEFAULT 0,
  b0 INTEGER NOT NULL DEFAULT 0, b1 INTEGER NOT NULL DEFAULT 0, b2 INTEGER NOT NULL DEFAULT 0, b3 INTEGER NOT NULL DEFAULT 0,
  b4 INTEGER NOT NULL DEFAULT 0, b5 INTEGER NOT NULL DEFAULT 0, b6 INTEGER NOT NULL DEFAULT 0, b7 INTEGER NOT NULL DEFAULT 0,
  b8 INTEGER NOT NULL DEFAULT 0, b9 INTEGER NOT NULL DEFAULT 0, b10 INTEGER NOT NULL DEFAULT 0, b11 INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route)
) WITHOUT ROWID;

-- The owner's feedback inbox (the contact form's messages): open | resolved | archived.
ALTER TABLE contact_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE contact_messages ADD COLUMN status_at TEXT;
CREATE INDEX contact_messages_status ON contact_messages (status, created_at);
`,
  },
  {
    version: 14,
    name: "entry photos (Cloudflare R2) and owner alerts",
    sql: `
-- Photos on workspace scout entries (server/scout/photos.ts, docs/r2-photos.md). The image is in R2 under
-- object_key (photos/<season>/<event>/<entry uuid>/<id>.jpg), this row is its record.
-- status: pending (upload URL handed out, bytes reserved against the storage cap) | cancelled (a purged or
-- refused upload: still counted until the sweep, its URL may be live) | ready | expired
-- (the image was deleted after its event, or purged by the owner: the entry shows "photo expired").
-- bytes: the declared size while pending, the stored object's size once ready (the meter).
-- event_end: the event's last day (YYYY-MM-DD) from the synced events table, NULL when unknown.
-- expires_at: when the nightly job deletes the image (ms): 2 days after the event ended, else 14 days after upload.
CREATE TABLE entry_photos (
  id TEXT PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  entry_uuid TEXT NOT NULL,
  season INTEGER NOT NULL,
  event_code TEXT NOT NULL DEFAULT '',
  object_key TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  added_by_account_id INTEGER NOT NULL,
  added_by_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  recorded_at INTEGER,
  event_end TEXT,
  expires_at INTEGER NOT NULL,
  expired_at INTEGER,
  expired_reason TEXT
);
CREATE INDEX entry_photos_entry ON entry_photos (workspace_id, entry_uuid);
CREATE INDEX entry_photos_status ON entry_photos (status, expires_at);
CREATE INDEX entry_photos_event ON entry_photos (season, event_code);

-- Bumped on every photo change of an entry (which also gives the entry a new seq, so it streams):
-- devices take the server's photo list when this is newer, whatever the entry's text edits.
ALTER TABLE workspace_scout_entries ADD COLUMN photos_rev INTEGER NOT NULL DEFAULT 0;

-- Things the owner must act on (the first: photo storage near the free tier). At most one open alert per kind.
-- Shown in the owner portal now. inbox_item_id: set by the owner inbox (Task 14) once it has made an
-- inbox item for the alert, so each alert notifies once.
CREATE TABLE owner_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  inbox_item_id INTEGER
);
CREATE UNIQUE INDEX owner_alerts_open ON owner_alerts (kind) WHERE resolved_at IS NULL;
`,
  },
  {
    version: 15,
    name: "workspace scout templates (versioned) and the template each entry was made with",
    sql: `
-- A workspace's scout template (server/scout/templates.ts, docs/shared-accounts.md "Workspace templates").
-- The current template of each season lives in workspaces.settings (JSON: scoutTemplate.<season>); every
-- admin change bumps workspaces.settings_version and writes the new version here too. Rows are never
-- changed or deleted, so an entry made with an older version still renders with the fields it was made with.
-- match / pit: the field lists (JSON), NULL = that kind uses the built-in default.
CREATE TABLE workspace_template_versions (
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  season INTEGER NOT NULL,
  version INTEGER NOT NULL,
  match TEXT,
  pit TEXT,
  created_at TEXT NOT NULL,
  created_by_account_id INTEGER NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (workspace_id, season, version)
) WITHOUT ROWID;

-- The template an entry was made with: "ws:<workspace>:<season>:<kind>" (or a built-in id) and its version.
-- NULL on entries made before templates: they read with the built-in default.
ALTER TABLE workspace_scout_entries ADD COLUMN template_id TEXT;
ALTER TABLE workspace_scout_entries ADD COLUMN template_version INTEGER;
`,
  },
  {
    version: 16,
    name: "workspace activity feed",
    sql: `
-- What happened in each workspace's scout space, newest first (server/scout/activityLog.ts): entries added,
-- edited, deleted; template changes; photos; members joining and leaving (from the Control Point membership
-- refresh); later assignments, the pick list and comments. Members read it; kept 90 days (the scheduler prunes it).
-- id: the feed's order and its page cursor (AUTOINCREMENT, so an id is never reused).
-- at: ms. actor_account_id: the shared (Control Point) account, NULL for Control Point itself.
-- type: e.g. entry.edited. subject: what it's about, "<kind>:<key>" (entry:<uuid>, template:<season>, member:<account>).
-- details: JSON, per type (team, match, event, season, version, changed fields, ...): new kinds of event need no schema change.
CREATE TABLE workspace_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  at INTEGER NOT NULL,
  actor_account_id INTEGER,
  actor_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX workspace_activity_feed ON workspace_activity (workspace_id, id);
CREATE INDEX workspace_activity_subject ON workspace_activity (workspace_id, subject, id);
CREATE INDEX workspace_activity_at ON workspace_activity (at);
`,
  },
  {
    version: 17,
    name: "notification inbox",
    sql: `
-- The notification inbox (server/inbox/inbox.ts, docs/inbox.md): things that happened that concern one
-- account (an edit to my entry, an assignment, a template change, being added to a workspace, an owner
-- alert, ...), with read state kept here so it's the same on every device. Kept 90 days (the scheduler).
-- user_id: the Scout account it's for (users.id: what sessions and synced settings belong to; a Control
-- Point account maps to it through identities). at: ms. workspace_id: Control Point's workspace id (text,
-- no reference: the inbox outlives a mirror row), NULL for owner alerts. category: the Settings switch
-- (assignments, edits, template, membership, picklist, comments, ownerAlerts). type: the activity type it
-- came from, or owner.alert. title / body / link: written when the item is made, so every device says and
-- opens the same thing. read_at: ms, NULL while unread.
-- source_activity_id / source_alert_id: the workspace_activity or owner_alerts row it came from; unique per
-- account, so a retried fan-out or hand-off never makes a second item.
CREATE TABLE inbox_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  workspace_id TEXT,
  workspace_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  actor_account_id INTEGER,
  actor_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  read_at INTEGER,
  source_activity_id INTEGER,
  source_alert_id INTEGER
);
CREATE INDEX inbox_items_user ON inbox_items (user_id, id);
CREATE INDEX inbox_items_unread ON inbox_items (user_id) WHERE read_at IS NULL;
CREATE INDEX inbox_items_at ON inbox_items (at);
CREATE UNIQUE INDEX inbox_items_activity ON inbox_items (user_id, source_activity_id) WHERE source_activity_id IS NOT NULL;
CREATE UNIQUE INDEX inbox_items_alert ON inbox_items (user_id, source_alert_id) WHERE source_alert_id IS NOT NULL;
`,
  },
  {
    version: 18,
    name: "entry comments",
    sql: `
-- Comments on workspace scout entries (server/scout/comments.ts, Task 15): a flat thread per entry, oldest
-- first. workspace_id: the mirror row (workspaces.id). entry_uuid: the entry's uuid in that workspace.
-- author_account_id / author_name: the shared (Control Point) account and the name shown, stamped by the
-- server. body: plain text, trimmed, at most 2,000 characters. created_at / edited_at / deleted_at: ms.
-- A deleted comment keeps its row (so ids are never reused and the count stays right) but loses its body,
-- and is never sent to devices again: it disappears from the thread.
CREATE TABLE workspace_entry_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  entry_uuid TEXT NOT NULL,
  author_account_id INTEGER NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX workspace_entry_comments_thread ON workspace_entry_comments (workspace_id, entry_uuid, id);
`,
  },
  {
    version: 19,
    name: "scouting assignments",
    sql: `
-- Who in a workspace scouts which team at an event (server/scout/assignments.ts, docs/assignments.md).
-- Admins create and delete them; the assignee (or an admin) marks one done, only an admin reopens it.
-- One row per member, team and event: the same team can be held by several members (the app warns), but
-- the same member is never assigned the same team at the same event twice.
-- event_code: upper case. created_at / done_at: ms. done_by: the account that marked it done (NULL while open).
-- version: 1 when created, +1 on every status change, so a device can tell an older copy from a newer one.
-- Names are copied when written, so a member who leaves keeps a readable line.
CREATE TABLE workspace_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  season INTEGER NOT NULL,
  event_code TEXT NOT NULL,
  team INTEGER NOT NULL,
  assignee_account_id INTEGER NOT NULL,
  assignee_name TEXT NOT NULL DEFAULT '',
  created_by_account_id INTEGER NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  done_at INTEGER,
  done_by INTEGER,
  done_by_name TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX workspace_assignments_pair ON workspace_assignments (workspace_id, season, event_code, team, assignee_account_id);
CREATE INDEX workspace_assignments_event ON workspace_assignments (workspace_id, season, event_code);
CREATE INDEX workspace_assignments_assignee ON workspace_assignments (workspace_id, assignee_account_id);
`,
  },
  {
    version: 20,
    name: "workspace shared pick lists",
    sql: `
-- A workspace's shared pick list per season (server/scout/picklist.ts, docs/picklist.md): FTC team numbers in
-- pick order, edited by any member. rank: 1..n, renumbered by the server after every change (changes to one
-- workspace are applied one at a time, in arrival order). added_by_* / note_by_*: who, as the server stamped it
-- (Control Point account id and display name); *_at: ms. note: shared with the whole workspace, last write wins.
-- removed_at: ms, set when a member removes the team (the row stays so Undo brings back its note and who added it);
-- NULL while it's on the list. Adding the team again without Undo starts it afresh.
CREATE TABLE workspace_picklist (
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  season INTEGER NOT NULL,
  team INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  added_by_account_id INTEGER,
  added_by_name TEXT NOT NULL DEFAULT '',
  added_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  note_by_account_id INTEGER,
  note_by_name TEXT,
  note_updated_at INTEGER,
  removed_at INTEGER,
  PRIMARY KEY (workspace_id, season, team)
);
CREATE INDEX workspace_picklist_order ON workspace_picklist (workspace_id, season, rank);
-- One row per list that has ever changed: its version, bumped by every change (devices keep the newest).
CREATE TABLE workspace_picklist_versions (
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  season INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, season)
);
`,
  },
  {
    version: 21,
    name: "workspace entry version history",
    sql: `
-- The last 20 versions of each workspace scout entry (server/scout/history.ts): one row per accepted write
-- that changed something, written in the same transaction as the write; older ones pruned in it too.
-- version_no counts up per entry (never reused). written_by: who wrote that version (the editor, not the
-- entry's author). The text only (data, notes and where it was scouted): photos have their own list.
-- restored_from_version: the version a restore brought back (NULL: not a restore, or a version that never
-- reached the server, kept on the loser's device). restored: 1 when the write was a restore.
CREATE TABLE workspace_entry_versions (
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  uuid TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  season INTEGER NOT NULL,
  team INTEGER NOT NULL,
  event_code TEXT,
  match_label TEXT,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  written_by_account_id INTEGER NOT NULL,
  written_by_name TEXT NOT NULL DEFAULT '',
  template_id TEXT,
  template_version INTEGER,
  restored INTEGER NOT NULL DEFAULT 0,
  restored_from_version INTEGER,
  PRIMARY KEY (workspace_id, uuid, version_no)
) WITHOUT ROWID;

-- The stored version each entry's write was based on (the writer's last copy from the server; NULL: unknown,
-- a new entry or an older build). A device whose own edit is replaced by one based on an older copy knows
-- the writer never saw it (src/lib/lostEdits.ts).
ALTER TABLE workspace_scout_entries ADD COLUMN base_updated_at INTEGER;

-- Entries written before history existed start with what's stored now as their first version.
INSERT INTO workspace_entry_versions (workspace_id, uuid, version_no, season, team, event_code, match_label, kind, data, notes, deleted, updated_at,
    written_by_account_id, written_by_name, template_id, template_version)
  SELECT workspace_id, uuid, 1, season, team, event_code, match_label, kind, data, notes, deleted, updated_at,
    editor_account_id, editor_name, template_id, template_version FROM workspace_scout_entries;
`,
  },
  {
    version: 22,
    name: "orphaned workspaces",
    sql: `
-- A scout space whose Control Point workspace is gone, or has no admin left (server/scout/orphans.ts,
-- docs/shared-accounts.md "Orphaned workspaces"). orphaned_at: when Scout saw it (ISO), NULL while the
-- workspace is fine. orphan_reason: 'deleted' (Control Point's members route answers 404 not_found) or
-- 'no_admin'. Both are cleared when the workspace comes back. While set, the space is read-only.
ALTER TABLE workspaces ADD COLUMN orphaned_at TEXT;
ALTER TABLE workspaces ADD COLUMN orphan_reason TEXT;
-- orphan_check_at: ms, set when Scout owes the workspace a no-admin check that Control Point couldn't answer
-- (its last known admin left or was demoted); the next membership answer listing it makes the check. NULL: none owed.
ALTER TABLE workspaces ADD COLUMN orphan_check_at INTEGER;

-- Who keeps reading a space deleted in Control Point: everyone in Scout's membership cache
-- (workspace_members) for it when Scout saw it deleted, with the role they had. Their cached memberships
-- go as Control Point stops listing them; these rows stay until the workspace comes back.
CREATE TABLE workspace_former_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  account_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (workspace_id, account_id)
) WITHOUT ROWID;
CREATE INDEX workspace_former_members_account ON workspace_former_members (account_id);

-- A workspace that dropped out of an account's Control Point answer when Control Point couldn't say whether it was
-- deleted (its members route timed out or failed). Kept apart from workspace_members, so it never grants access;
-- the account's next answer asks again: deleted makes it a former member, otherwise it's logged as a removal then.
CREATE TABLE workspace_pending_departures (
  account_id INTEGER NOT NULL,
  cp_workspace_id TEXT NOT NULL,
  role TEXT NOT NULL,
  workspace_name TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL,
  PRIMARY KEY (account_id, cp_workspace_id)
) WITHOUT ROWID;
`,
  },
  {
    version: 23,
    name: "weekly world rankings snapshots",
    sql: `
-- The world ranking as of each Monday 00:00 UTC (week, YYYY-MM-DD), written by the stats job
-- (server/stats/rankings.ts) from a replay of the season's rated matches up to that instant: every
-- team with 3+ rated matches, its rank and its rating then. A week is written once, whole, and never
-- rewritten; weeks older than a year are pruned. /rankings measures movement against these
-- (src/shared/rankings.ts). Public FTC-derived data, like team_season_stats.
CREATE TABLE ranking_snapshots (
  season INTEGER NOT NULL, week TEXT NOT NULL, team INTEGER NOT NULL,
  rank INTEGER NOT NULL, rating REAL NOT NULL,
  PRIMARY KEY (season, week, team)
) WITHOUT ROWID;
-- One row per written week (in the same transaction as its rows, so a row here means the week is complete).
CREATE TABLE ranking_weeks (
  season INTEGER NOT NULL, week TEXT NOT NULL,
  teams INTEGER NOT NULL, taken_at TEXT NOT NULL,
  PRIMARY KEY (season, week)
) WITHOUT ROWID;
`,
  },
  {
    version: 24,
    name: "scout consensus index",
    sql: `
-- Scout consensus (server/scout/consensus.ts) reads one workspace's entries on a few teams of one season.
CREATE INDEX workspace_scout_team ON workspace_scout_entries (workspace_id, season, team);
`,
  },
  {
    version: 25,
    name: "web push",
    sql: `
-- Web push (server/push/push.ts, docs/push.md): one row per device that turned notifications on, for a
-- signed-in account. endpoint, p256dh and auth are what the browser's PushSubscription gives (the push
-- service URL and the keys a payload is encrypted to). ua_family: the browser family only ("Chrome on
-- Android"), never the full User-Agent. Times are ms. last_success_at: the last push the service accepted.
-- AUTOINCREMENT: an id is never reused, so a late answer about a deleted subscription can't touch a newer one.
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  ua_family TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_success_at INTEGER
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

-- What was pushed, so each thing is sent once per device however often the job runs, on however many
-- servers: a row is claimed before sending. kind: match | upset | start. subject: "season:CODE:level:series:number"
-- for a match or an upset, "season:CODE" for an event start. outcome: sent | limited (over the daily cap,
-- not sent) | failed (not sent, never retried). at: ms, for the daily cap and pruning.
CREATE TABLE push_sent (
  subscription_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  at INTEGER NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'sent',
  PRIMARY KEY (subscription_id, kind, subject)
) WITHOUT ROWID;
CREATE INDEX push_sent_at ON push_sent (subscription_id, at);
`,
  },
  {
    version: 26,
    name: "prediction engine 2.1: tips, ledger provenance",
    sql: `
-- BIOBUZZ HIVE TIPs per alliance (auto + TeleOp), the second qualification sort criterion
-- (Section 13 Table 13-1). Null = not reported (other seasons, or a source without them).
ALTER TABLE matches ADD COLUMN red_tips INTEGER;
ALTER TABLE matches ADD COLUMN blue_tips INTEGER;
-- What each logged call was made with: the probability model's parameter set (contextual id or
-- "legacy"), the data version the ratings were built from, and the start time of the latest
-- result the ratings had learned. Old rows stay null (engine_version still says what made them).
ALTER TABLE predictions ADD COLUMN model_id TEXT;
ALTER TABLE predictions ADD COLUMN data_version TEXT;
ALTER TABLE predictions ADD COLUMN ratings_through TEXT;
`,
  },
  {
    version: 27,
    name: "side-by-side shadow predictions",
    sql: `
-- The previous model's P(red wins) for the same match, from the same ratings at the same moment
-- (engine 2.1.1: the served model's fallback, i.e. 2.0 under 2.1), so versions are compared on
-- identical matches and information. Null for rows logged before this column existed.
ALTER TABLE predictions ADD COLUMN p_red_shadow REAL;
ALTER TABLE predictions ADD COLUMN shadow_model_id TEXT;
`,
  },
  {
    version: 28,
    name: "automatic power rankings",
    sql: `
-- Weeks of power rankings published automatically (server/powerRankings/auto.ts): every Friday at
-- 00:00 America/New_York, from the live world ranking, blurbs by Bruno (Control Point's AI) or a
-- data-only template. One row per season and ISO week; a hand-written file for the same week wins.
-- Public content (server/data/snapshot.ts): no personal data. edited_by is a role ("owner"), never
-- an email; who did what is in owner_audit.
CREATE TABLE power_rankings_generated (
  season INTEGER NOT NULL,
  week TEXT NOT NULL,                        -- ISO week of the Friday, "2026-w43"
  published TEXT NOT NULL,                   -- YYYY-MM-DD (America/New_York) it went out
  status TEXT NOT NULL DEFAULT 'pending',    -- pending (being written) | published | hidden
  intro TEXT NOT NULL DEFAULT '',
  intro_source TEXT NOT NULL DEFAULT 'template', -- bruno | template | owner
  entries TEXT NOT NULL DEFAULT '[]',        -- JSON [{rank, team, text, source, checks?}] in rank order
  packet TEXT NOT NULL DEFAULT '{}',         -- JSON: the frozen facts it was written from (ranks, ratings, records…)
  generated_at TEXT NOT NULL,
  edited_by TEXT,
  edited_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0,            -- +1 on every write: an owner edit is refused if it changed since
  PRIMARY KEY (season, week)
);
`,
  },
  {
    version: 29,
    name: "comment creation op ids",
    sql: `
-- The device's id for one attempt to post a comment (server/scout/comments.ts): a retry of the same
-- attempt (its answer was lost) sends the same id and gets the comment it already made, never a second
-- one. Null for comments posted before this column existed, or by a device that sent none. Unique per
-- workspace, author and entry, so two identical comments posted on purpose (two ids) both stay.
ALTER TABLE workspace_entry_comments ADD COLUMN client_op_id TEXT;
CREATE UNIQUE INDEX workspace_entry_comments_op ON workspace_entry_comments (workspace_id, author_account_id, entry_uuid, client_op_id) WHERE client_op_id IS NOT NULL;
`,
  },
  {
    version: 30,
    name: "team directory search",
    sql: `
-- Words of every team's name, city and state for the directory's ?q= search (server/api/directory.ts):
-- case- and accent-folded by the tokenizer, prefix-indexed, rowid = team number. Kept in step with
-- teams by triggers, so every writer (sync, bundles, tests) is covered. The update trigger fires only
-- when a searched field changes: the sync's upserts rewrite every team without touching most of them.
-- Trigger bodies stay on one line: migrations are split into statements at a semicolon ending a line.
CREATE VIRTUAL TABLE team_search USING fts5(name, city, state, tokenize = 'unicode61 remove_diacritics 2', prefix = '1 2');
INSERT INTO team_search (rowid, name, city, state) SELECT number, name, city, state FROM teams;
CREATE TRIGGER team_search_ai AFTER INSERT ON teams BEGIN DELETE FROM team_search WHERE rowid = new.number; INSERT INTO team_search (rowid, name, city, state) VALUES (new.number, new.name, new.city, new.state); END;
CREATE TRIGGER team_search_au AFTER UPDATE OF number, name, city, state ON teams WHEN old.number IS NOT new.number OR old.name IS NOT new.name OR old.city IS NOT new.city OR old.state IS NOT new.state BEGIN DELETE FROM team_search WHERE rowid = old.number; INSERT INTO team_search (rowid, name, city, state) VALUES (new.number, new.name, new.city, new.state); END;
CREATE TRIGGER team_search_ad AFTER DELETE ON teams BEGIN DELETE FROM team_search WHERE rowid = old.number; END;
`,
  },
  {
    version: 31,
    name: "pick list op ids",
    sql: `
-- The device's id for one pick list change (server/scout/picklist.ts): a change kept on the device and sent
-- again (after a reload, or a lost answer) carries the same id, and the server applies it once only. One row
-- per change the server accepted, per workspace and author; rows older than 30 days are pruned as new ones
-- arrive (a device gives up on a kept change after 14).
CREATE TABLE IF NOT EXISTS workspace_picklist_ops (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  op_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, account_id, op_id)
);
CREATE INDEX IF NOT EXISTS workspace_picklist_ops_age ON workspace_picklist_ops (workspace_id, created_at);
`,
  },
  {
    version: 32,
    name: "inbox follow-up flags",
    sql: `
-- Inbox follow-up (server/inbox/inbox.ts, docs/inbox.md): the account flagged this item to come back to.
-- ms, NULL when not flagged. Separate from read_at: an item can be read and still need doing. Mark all
-- read never touches it; a coalesced item that replaces a flagged one keeps the flag.
ALTER TABLE inbox_items ADD COLUMN follow_up_at INTEGER;
CREATE INDEX inbox_items_follow_up ON inbox_items (user_id, id) WHERE follow_up_at IS NOT NULL;
`,
  },
  {
    version: 33,
    name: "official result changes",
    sql: `
-- What changed in an event's official results, as the sync saw it (server/data/resultChanges.ts):
-- a result first posted, a posted score revised (real before and after values), or a scheduled
-- match moved (time, field, lineup). Written in the same transaction as the event's rows, only
-- when a stored value really changed, so a repeated poll of the same data adds nothing. Public
-- FTC data only: never scouting, never accounts.
CREATE TABLE result_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL, code TEXT NOT NULL,
  level TEXT NOT NULL, series INTEGER NOT NULL, number INTEGER NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,          -- posted | revised | schedule
  fields TEXT NOT NULL,        -- JSON: the values that changed, e.g. ["red.total","red.pen"]
  before TEXT,                 -- JSON snapshot before (null when first posted)
  after TEXT,                  -- JSON snapshot after (null when a result was withdrawn)
  source TEXT NOT NULL,        -- the feed that delivered the new value: first | ftc-scout
  prev_source TEXT,            -- the feed the stored value came from
  checked_at TEXT NOT NULL,    -- when the sync saw it (not when FIRST changed it)
  diff_key TEXT NOT NULL UNIQUE -- match + kind + previous change's key + new value: a replay can't add a second row
);
CREATE INDEX result_changes_event ON result_changes (season, code, id);
CREATE INDEX result_changes_match ON result_changes (season, code, level, series, number, id);
-- Events whose results are being watched, and since when: the first detail write after this
-- migration is the baseline (nothing before it was tracked). pruned: rows dropped by the
-- per-event retention cap. missing: the last stored state of matches a write left out (a
-- fallback feed may list fewer), so one that comes back is compared, not posted again.
CREATE TABLE result_watch (
  season INTEGER NOT NULL, code TEXT NOT NULL,
  since TEXT NOT NULL,
  pruned INTEGER NOT NULL DEFAULT 0,
  missing TEXT NOT NULL DEFAULT '{}',
  rev INTEGER NOT NULL DEFAULT 0,          -- +1 with every watched detail write (and db:push): the write guard
  PRIMARY KEY (season, code)
);
-- FIRST's scheduled field ("1", "2"…), so a field move can be told apart. Null = not reported.
ALTER TABLE matches ADD COLUMN field TEXT;
-- 1 = the score's components come from a reported breakdown, 0 = totals only (FIRST posted the
-- result before its breakdown: the split is an estimate). Null = unplayed, or written before this.
ALTER TABLE matches ADD COLUMN breakdown INTEGER;
`,
  },
  {
    version: 34,
    name: "event streams",
    sql: `
-- An event's live stream, set by the owner in the owner portal (server/portal/streams.ts) and played in the
-- event page's Watch live section. Its own table, not a column on events: data copies (db:push, the
-- shipped snapshot) replace whole events rows and would erase an owner's setting. YouTube only: url is
-- what was pasted, video_id what plays (src/shared/stream.ts).
CREATE TABLE event_streams (
  season INTEGER NOT NULL, code TEXT NOT NULL,
  url TEXT NOT NULL,
  video_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (season, code)
);
`,
  },
  {
    version: 35,
    name: "discord follows",
    sql: `
-- The Discord bot's automatic posts (bot/follows.ts): a server follows a team in one of its channels
-- (/follow), and the bot posts there 15 minutes before each of the team's matches and once each has a
-- result. Written only by the bot. created_by is a Discord user id. Version 35: 34 is taken by another
-- open change (event streams); migrations apply by version, so the order they land in doesn't matter.
CREATE TABLE discord_follows (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  team INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, channel_id, team)
);
CREATE INDEX discord_follows_team ON discord_follows (team);
-- One post per channel, match and kind (reminder | result), so a restart or two teams in one match never post
-- twice. A tick claims a row (claimed_at) before sending and marks it sent (sent_at) after; a claim that never
-- got sent (the bot stopped mid-send) can be taken again once it's stale, while the post is still due.
CREATE TABLE discord_posts (
  channel_id TEXT NOT NULL,
  season INTEGER NOT NULL, code TEXT NOT NULL, match_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (channel_id, season, code, match_key, kind)
);
`,
  },
  {
    version: 36,
    name: "prediction score ranges",
    sql: `
-- Engine 2.2: every call states an 80% range for each alliance's final score (range_level = 0.8), so the
-- ledger can score how often real scores land inside it. NULL on calls logged before 2.2: they stated no
-- range, and none is invented for them afterwards.
ALTER TABLE predictions ADD COLUMN red_lo REAL;
ALTER TABLE predictions ADD COLUMN red_hi REAL;
ALTER TABLE predictions ADD COLUMN blue_lo REAL;
ALTER TABLE predictions ADD COLUMN blue_hi REAL;
ALTER TABLE predictions ADD COLUMN range_level REAL;
`,
  },
  {
    version: 37,
    name: "predictability report cards",
    sql: `
-- Per team, how the engine's LIVE calls on its matches turned out (server/stats/reportCards.ts): never
-- the backtest replay. code '' = the whole season, else one event (final = the event is over and every
-- match played). Raw numbers and the same shrunk toward the season's field average (prior worth
-- REPORT_PRIOR calls). Misses are per robot: (alliance actual − predicted) ÷ robots on the alliance.
-- Rewritten whole per season by the stats job and the live fast lane. Public: derived from public results.
CREATE TABLE team_report_cards (
  season INTEGER NOT NULL, code TEXT NOT NULL, team INTEGER NOT NULL,
  final INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL, decided INTEGER NOT NULL, hits INTEGER NOT NULL, scored INTEGER NOT NULL,
  err_mean REAL, err_abs REAL, err_var REAL,
  hit_shrunk REAL, err_mean_shrunk REAL, err_abs_shrunk REAL, err_var_shrunk REAL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (season, code, team)
);
CREATE INDEX team_report_cards_team ON team_report_cards (team, season);
`,
  },
  {
    version: 38,
    name: "event projections",
    sql: `
-- Monte Carlo projections of live and upcoming events (server/projections/job.ts): each run simulates
-- the rest of the event (10,000 times, 5,000 when an event blows the time budget) and stores per-team
-- distributions; pages only read them. kind: current (the latest), baseline (before any match was
-- played; movement is measured against it), last_open (the last run made while quals were still open:
-- what a finished event's seeds are judged by). state_key: the event's results state the run was made
-- from (projections/state.ts); seed comes from it. teams: JSON array of src/shared/projections.ts
-- ProjectionTeam.
CREATE TABLE event_projections (
  season INTEGER NOT NULL, code TEXT NOT NULL,
  kind TEXT NOT NULL,
  state_key TEXT NOT NULL,
  seed INTEGER NOT NULL,
  runs INTEGER NOT NULL,
  target_runs INTEGER NOT NULL,
  stage TEXT NOT NULL,
  played INTEGER NOT NULL,
  scheduled INTEGER NOT NULL,
  through TEXT,
  slots INTEGER,
  slots_source TEXT,
  engine_version TEXT NOT NULL,
  ms INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  teams TEXT NOT NULL,
  PRIMARY KEY (season, code, kind)
);
-- The current run's advancement odds per team (0–1; null = already qualified elsewhere or ineligible), for
-- the records tables' Advancement Odds column, which reads them ahead of the static pre-event estimate.
CREATE TABLE event_projection_odds (
  season INTEGER NOT NULL, code TEXT NOT NULL, team INTEGER NOT NULL,
  p_advance REAL,
  PRIMARY KEY (season, code, team)
);
`,
  },
  {
    version: 39,
    name: "bonus ranking point calls in the ledger",
    sql: `
-- Bonus ranking point odds logged with each call (engine 2.3: explainMatch bonus), qualification matches of
-- 2025+ seasons with a bonus model only (else null): JSON [p1, p2, p3] per alliance in the engine's slot
-- order, their confidence tier, and the model they came from ("fitted:2025", or "season:<n>" for a fit to
-- the season's latest n alliance results). Scored against matches.red_bonus / blue_bonus once played.
ALTER TABLE predictions ADD COLUMN bonus_red TEXT;
ALTER TABLE predictions ADD COLUMN bonus_blue TEXT;
ALTER TABLE predictions ADD COLUMN bonus_tier TEXT;
ALTER TABLE predictions ADD COLUMN bonus_model TEXT;
`,
  },
  {
    version: 40,
    name: "partnership fact with logged calls",
    sql: `
-- The strongest partnership fact shown with a live call when it was logged (engine 2.4: explainMatch
-- partnership, as src/shared/pairHistory.ts PairHistory JSON), so match details and reports keep the line
-- once the call is logged. A reason only: it never changes the logged odds. Null for the backtest replay
-- and for calls with no pair history.
ALTER TABLE predictions ADD COLUMN history TEXT;
`,
  },
  {
    version: 41,
    name: "reliability index",
    sql: `
-- Per team, how dependable its robot has been (rules: src/shared/reliability.ts, job: server/stats/reliability.ts):
-- qualification no-shows, DQs, estimated near-zero matches, the swing of its estimated contribution, penalties
-- and the report card's miss spread. Public match data only: workspace scouting never gets here. code '' = the
-- whole season, else one event; team 0 with code '' = the season's field (its idx: the field-average index).
-- Rates and ratios are stored shrunk toward the field; counts raw. Rewritten whole per season by the stats job.
CREATE TABLE team_reliability (
  season INTEGER NOT NULL, code TEXT NOT NULL, team INTEGER NOT NULL,
  matches INTEGER NOT NULL, no_shows INTEGER NOT NULL, dqs INTEGER NOT NULL, near_zero INTEGER NOT NULL, contrib_n INTEGER NOT NULL,
  recent_matches INTEGER NOT NULL, recent_no_shows INTEGER NOT NULL, recent_near_zero INTEGER NOT NULL,
  no_show_rate REAL, dq_rate REAL, near_zero_rate REAL, swing REAL, penalty_ratio REAL, predictability_ratio REAL,
  idx INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (season, code, team)
);
CREATE INDEX team_reliability_team ON team_reliability (team, season);
`,
  },
  {
    version: 42,
    name: "daily power rankings refresh",
    sql: `
-- The current automatic power-rankings week is checked again every day at 00:00 America/New_York
-- (server/powerRankings/refresh.ts). updated: the New York date of its last check (null: never checked
-- since it went out); the page says "Updated <day>" when it differs from the publish date.
ALTER TABLE power_rankings_generated ADD COLUMN updated TEXT;
-- JSON [{team, text}]: owner-written blurbs of teams a daily check took out of the list, restored if
-- the team comes back the same week (an owner edit is never lost to a refresh).
ALTER TABLE power_rankings_generated ADD COLUMN parked TEXT NOT NULL DEFAULT '[]';
-- One row per week and New York day: the daily check's claim (status 'running') and then its outcome.
-- Public: counts and a note about public data, no personal data.
CREATE TABLE power_rankings_refreshes (
  season INTEGER NOT NULL,
  week TEXT NOT NULL,
  day TEXT NOT NULL,                         -- YYYY-MM-DD (America/New_York)
  status TEXT NOT NULL,                      -- running | unchanged | updated | failed
  started_at TEXT NOT NULL,
  finished_at TEXT,
  changed INTEGER NOT NULL DEFAULT 0,        -- teams whose shown facts changed (new to the list included)
  bruno INTEGER NOT NULL DEFAULT 0,          -- of those, blurbs Bruno rewrote
  template INTEGER NOT NULL DEFAULT 0,       -- of those, blurbs from the data-only template
  kept INTEGER NOT NULL DEFAULT 0,           -- of those, owner edits left as they were
  note TEXT,
  PRIMARY KEY (season, week, day)
);
`,
  },
  {
    version: 43,
    name: "youtube video timing",
    sql: `
-- What YouTube says about an event's recording (server/videos/youtube.ts): when its broadcast started and how
-- long the video is, so a match's start lands on a second in it (server/videos/recordings.ts). One row per
-- video id, whichever event links it (the owner's stream or FIRST's liveStreamUrl). Public data only.
CREATE TABLE video_meta (
  video_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- ok | unavailable | error
  start TEXT,                    -- UTC ISO: the broadcast's start (null: not a live broadcast)
  end TEXT,                      -- UTC ISO: its end (null: still live, or not a broadcast)
  duration INTEGER,              -- seconds of video (not "length": a row's own length is its column count)
  live INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL
);
`,
  },
  {
    version: 44,
    name: "youtube video timing read again",
    sql: `
-- The first reads (migration 43) took YouTube's "confirm you're not a bot" sign-in wall, shown to the server,
-- for removed videos, which hid their players. That wall is now an error tried again later; every video marked
-- removed is read again.
DELETE FROM video_meta WHERE status = 'unavailable';
`,
  },
  {
    version: 45,
    name: "match score sheets",
    sql: `
-- Each alliance's full score sheet from FIRST's /scores breakdown (the rows server/data/seasons.ts SHEETS lists
-- for the season: auto leave/park/hive, TeleOp hive/flower/garden/park, foul counts), as JSON
-- {field: number}. NULL: a season with no sheet, a totals-only source, or a match synced before this.
ALTER TABLE matches ADD COLUMN red_detail TEXT;
ALTER TABLE matches ADD COLUMN blue_detail TEXT;
`,
  },
  {
    version: 46,
    name: "workspace match scouting assignments",
    sql: `
-- Match scouting assignments (server/scout/assignments.ts, docs/assignments.md): a member watches a slot, an
-- alliance or all four teams for a run of quals at an event ("Priya: Red 1, Q1–Q30"). The team assignments of
-- migration 19 stay as they are (pit scouting). watching: JSON as src/shared/scoutMatch.ts Watching.
-- from_match / to_match: normalized qual labels ("Q1"), NULL for an open end. Names are copied when written,
-- like workspace_assignments. version: 1 when created, +1 on every edit.
CREATE TABLE workspace_match_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  season INTEGER NOT NULL,
  event_code TEXT NOT NULL,
  watching TEXT NOT NULL,
  from_match TEXT,
  to_match TEXT,
  assignee_account_id INTEGER NOT NULL,
  assignee_name TEXT NOT NULL DEFAULT '',
  created_by_account_id INTEGER NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX workspace_match_assignments_event ON workspace_match_assignments (workspace_id, season, event_code);
`,
  },
  {
    version: 47,
    name: "provisional event info from regional sites",
    sql: `
-- Event details and registered teams from a region's own site (server/sources/ftcnj.ts: FTC New Jersey),
-- kept apart from FIRST's fields in events/event_teams, which they never overwrite. The event page shows a
-- row, labelled, only while FIRST has no team list and no schedule for the event (api/events.ts).
-- schedule, notes: JSON string arrays as the site words them. teams: JSON
-- [{team, name, status: registered|pending, session: AM|PM|null}]. Each read replaces the rows of the events it shows.
CREATE TABLE event_provisional (
  season INTEGER NOT NULL,
  code TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  nickname TEXT,
  hosts TEXT,
  venue TEXT,
  address TEXT,
  capacity TEXT,
  schedule TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '[]',
  closed INTEGER NOT NULL DEFAULT 0,
  teams TEXT NOT NULL DEFAULT '[]',
  session_unknown INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (season, code, source)
);
`,
  },
  {
    version: 48,
    name: "FIRST pre-event registrations and event addresses",
    sql: `
-- FIRST's registered teams for upcoming events (server/data/registrations.ts: /teams?eventCode=X), read before
-- rankings or a schedule exist. Kept apart from event_teams, which the event bundle replaces whole on every fetch:
-- the event page shows these as the event's teams only while event_teams has none (api/events.ts). Each read
-- replaces the event's rows.
CREATE TABLE event_registrations (
  season INTEGER NOT NULL,
  code TEXT NOT NULL,
  team INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (season, code, team)
);
-- The venue's street address from FIRST's event list (dropped by the sync until now).
ALTER TABLE events ADD COLUMN address TEXT;
`,
  },
  {
    version: 49,
    name: "Registrations shared by an event's AM and PM sessions",
    sql: `
-- An AM/PM event is two FIRST events, but FIRST can file the whole event's registrations under one of them
-- (e.g. USNJNEM2 listed both sessions' 17 teams, USNJNEM3 none). shared = 1 marks such a list: it says who
-- registered for the pair, not who plays this session, so it is never this event's team list
-- (data/registrations.ts markSharedSessions, ROSTER).
ALTER TABLE event_registrations ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    version: 50,
    name: "weekly email digest",
    sql: `
-- The weekly email digest (server/digest/, docs/digest.md). One row per account that has ever touched the
-- Settings switch: enabled is the switch (off by default: no row means off). token: the account's
-- one-click unsubscribe link (random, unguessable, no expiry); a new one is issued each time the
-- switch is turned back on, so an old email's link can never turn it off again. bounced_at: the
-- provider reported a hard bounce (the switch went off with it). Times are ISO.
CREATE TABLE digest_prefs (
  user_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  token TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL,
  bounced_at TEXT,
  unsubscribed_at TEXT
);
-- The send log: one row per account and week (the Monday, New York date), written before the email
-- goes out, so a re-run of the same week sends nothing twice. status: sending | sent | failed |
-- skipped-empty | skipped-toggle-off | skipped-bounce | bounced. sections: JSON list of the sections the email held.
-- email_id: the provider's id for the message (bounce reports name it).
CREATE TABLE digest_sends (
  user_id INTEGER NOT NULL,
  week TEXT NOT NULL,
  status TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  sections TEXT NOT NULL DEFAULT '[]',
  subject TEXT,
  error TEXT,
  email_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, week)
);
CREATE INDEX digest_sends_week ON digest_sends (week, status);
CREATE INDEX digest_sends_email ON digest_sends (email_id);
`,
  },  {
    version: 51,
    name: "power rankings: week 42's season, plain week names",
    sql: `
-- Automatic power-rankings weeks are tagged by the season their dates fall in (server/powerRankings/auto.ts
-- weekSeason). Week 2026-w42 (Oct 12-18, 2026) went out tagged 2025, because no 2026-27 team was rated yet
-- and its list was ranked on 2025-26 numbers: it becomes a 2026 week. Its packet keeps season 2025 (the
-- season its numbers come from), so the page says so and its frozen numbers, order and names stay as written.
UPDATE power_rankings_refreshes SET season = 2026 WHERE season = 2025 AND week = '2026-w42'
  AND NOT EXISTS (SELECT 1 FROM power_rankings_generated WHERE season = 2026 AND week = '2026-w42');
UPDATE power_rankings_generated SET season = 2026 WHERE season = 2025 AND week = '2026-w42'
  AND NOT EXISTS (SELECT 1 FROM power_rankings_generated WHERE season = 2026 AND week = '2026-w42');
-- The intros named the week by its id ("week 2026-w43"): written as the page does ("week 43"), and the
-- season as "2026–27". New weeks get this from the generator (factCheck.ts plainWeekText).
UPDATE power_rankings_generated SET
  intro = REPLACE(REPLACE(intro, 'week 2026-w42 of the 2025 season', 'week 42, ranked on the 2025–26 season'), 'week 2026-w42', 'week 42'),
  entries = REPLACE(entries, 'week 2026-w42', 'week 42'),
  rev = rev + 1
WHERE week = '2026-w42' AND (intro LIKE '%2026-w42%' OR entries LIKE '%2026-w42%');
UPDATE power_rankings_generated SET
  intro = REPLACE(REPLACE(intro, 'week 2026-w43 of the season', 'week 43 of the 2026–27 season'), 'week 2026-w43', 'week 43'),
  entries = REPLACE(entries, 'week 2026-w43', 'week 43'),
  rev = rev + 1
WHERE week = '2026-w43' AND (intro LIKE '%2026-w43%' OR entries LIKE '%2026-w43%');
`,
  },
  {
    version: 52,
    name: "owner audit: old and new values, append-only",
    sql: `
-- The owner console's audit log (server/portal/audit.ts) records what a change replaced and what it set:
-- old_value and new_value (JSON; NULL for actions that start something rather than change a value).
ALTER TABLE owner_audit ADD COLUMN old_value TEXT;
ALTER TABLE owner_audit ADD COLUMN new_value TEXT;
-- Append-only, enforced here and not just by the console having no edit button: a row can't be deleted,
-- and the only change a row takes is its result, filled in once when a background job finishes (from
-- empty or "started" to its outcome); a finished or refused result is final.
CREATE TRIGGER owner_audit_no_delete BEFORE DELETE ON owner_audit BEGIN SELECT RAISE(ABORT, 'owner_audit is append-only'); END;
CREATE TRIGGER owner_audit_no_edit BEFORE UPDATE ON owner_audit WHEN NEW.id IS NOT OLD.id OR NEW.at IS NOT OLD.at OR NEW.actor IS NOT OLD.actor OR NEW.action IS NOT OLD.action OR NEW.details IS NOT OLD.details OR NEW.old_value IS NOT OLD.old_value OR NEW.new_value IS NOT OLD.new_value OR (NEW.result IS NOT OLD.result AND OLD.result IS NOT NULL AND OLD.result IS NOT 'started') BEGIN SELECT RAISE(ABORT, 'owner_audit is append-only'); END;
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

let primaryClient: Client | null = null;
/**
 * The database itself, bypassing the embedded replica: for the few small reads that must see another
 * server's write within seconds (feature flags), not after the replica's next sync (minutes).
 * Without a replica this is just db().
 */
export function primaryDb(): Client {
  if (!replicaClient || client !== replicaClient) return db();
  primaryClient ??= createClient({ url: env.databaseUrl, authToken: env.databaseToken ?? undefined });
  return primaryClient;
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

/** Apply every migration not applied yet (`upTo`: only those up to that version; tests of a later migration). */
export async function migrate(c: Client = db(), upTo = Infinity): Promise<number[]> {
  await configure(c);
  await c.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL)");
  const done = new Set((await c.execute("SELECT version FROM schema_version")).rows.map((r) => Number(r.version)));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version) || m.version > upTo) continue;
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
