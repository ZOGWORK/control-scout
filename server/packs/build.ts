// Offline pack builder.
//
//   lite  — scout-pack-<version>-lite.json.gz : every season's rating book
//           (RatingBookData) + team names. Runs match predictions on a device
//           with no server (same engine). Target < 10 MB.
//   full  — scout-pack-<version>-<season>.db : one SQLite file per season with
//           events, teams, rankings, matches (scores, breakdowns, penalties),
//           lineups, alliances, awards, advancement and computed stats.
//   latest.json — the manifest the app polls (version, size, sha256, seasons).
//
// Versions are dated (YYYY-MM-DD.N); the last few are kept so a device that
// started a download mid-release still finishes it.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createClient } from "@libsql/client";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { all, kvGet } from "../db.js";
import { SEASON_NUMBERS, seasonInfo } from "../data/seasons.js";
import { forecasterFor } from "../predict/engine.js";
import { packsDir } from "./routes.js";

export const PACK_FORMAT = 1;
const KEEP_VERSIONS = 3;

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

export interface BuiltFile { name: string; url: string; bytes: number; sha256: string; seasons: number[]; kind: "lite" | "full"; contents: string }
export interface Manifest { format: number; version: string; builtAt: string; engineVersion: string; dataAsOf: string | null; lite: BuiltFile | null; full: BuiltFile[] }

async function nextVersion(dir: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const prev = existsSync(join(dir, "latest.json")) ? (JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")) as Manifest).version : "";
  const n = prev.startsWith(day) ? Number(prev.split(".").pop()) + 1 : 1;
  return `${day}.${n}`;
}

export async function buildLite(version: string, dir: string, log: (m: string) => void): Promise<BuiltFile> {
  const books: Record<string, unknown> = {};
  for (const s of SEASON_NUMBERS) {
    const f = await forecasterFor(s);
    const b = f.book(s);
    if (b) books[String(s)] = b.toData();
  }
  const teams = (await all<any>("SELECT number, name, city, state, country FROM teams ORDER BY number"))
    .map((t) => [Number(t.number), t.name ?? null, [t.city, t.state, t.country].filter(Boolean).join(", ") || null]);
  const json = JSON.stringify({ format: PACK_FORMAT, version, builtAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, books, teams });
  const gz = gzipSync(Buffer.from(json), { level: 9 });
  const name = `scout-pack-${version.replace(/\./g, "-")}-lite.json.gz`;
  writeFileSync(join(dir, name), gz);
  log(`lite: ${(json.length / 1e6).toFixed(1)} MB raw → ${(gz.length / 1e6).toFixed(2)} MB gz (${Object.keys(books).length} seasons, ${teams.length} teams)`);
  return { name, url: `/packs/${name}`, bytes: gz.length, sha256: sha256(gz), seasons: Object.keys(books).map(Number), kind: "lite",
    contents: `Every team's prediction rating for ${Object.keys(books).length} seasons plus team names — enough to predict any match on this device with no connection.` };
}

const FULL_TABLES: { name: string; ddl: string; teamsJoin?: boolean }[] = [
  { name: "events", ddl: "CREATE TABLE events (season INTEGER, code TEXT, name TEXT, type TEXT, division_code TEXT, region TEXT, league TEXT, venue TEXT, city TEXT, state TEXT, country TEXT, start TEXT, \"end\" TEXT, timezone TEXT, remote INTEGER, hybrid INTEGER, website TEXT, livestream TEXT, source TEXT, PRIMARY KEY (season, code))" },
  { name: "event_teams", ddl: "CREATE TABLE event_teams (season INTEGER, code TEXT, team INTEGER, rank INTEGER, rp REAL, tbp REAL, wins INTEGER, losses INTEGER, ties INTEGER, qual_played INTEGER, dq INTEGER, PRIMARY KEY (season, code, team))" },
  { name: "matches", ddl: "CREATE TABLE matches (season INTEGER, code TEXT, level TEXT, series INTEGER, number INTEGER, label TEXT, description TEXT, time TEXT, played INTEGER, red_total INTEGER, red_np INTEGER, red_auto INTEGER, red_teleop INTEGER, red_endgame INTEGER, red_pen INTEGER, red_bonus TEXT, blue_total INTEGER, blue_np INTEGER, blue_auto INTEGER, blue_teleop INTEGER, blue_endgame INTEGER, blue_pen INTEGER, blue_bonus TEXT, video TEXT, source TEXT, PRIMARY KEY (season, code, level, series, number))" },
  { name: "match_teams", ddl: "CREATE TABLE match_teams (season INTEGER, code TEXT, level TEXT, series INTEGER, number INTEGER, team INTEGER, alliance TEXT, station INTEGER, surrogate INTEGER, dq INTEGER, on_field INTEGER, PRIMARY KEY (season, code, level, series, number, team))" },
  { name: "alliances", ddl: "CREATE TABLE alliances (season INTEGER, code TEXT, number INTEGER, name TEXT, captain INTEGER, pick1 INTEGER, pick2 INTEGER, backup INTEGER, PRIMARY KEY (season, code, number))" },
  { name: "awards", ddl: "CREATE TABLE awards (season INTEGER, code TEXT, type TEXT, placement INTEGER, team INTEGER, name TEXT, PRIMARY KEY (season, code, type, placement, team))" },
  { name: "advancement", ddl: "CREATE TABLE advancement (season INTEGER, code TEXT, slots INTEGER, advances_to TEXT, rows TEXT, PRIMARY KEY (season, code))" },
  { name: "team_event_stats", ddl: "CREATE TABLE team_event_stats (season INTEGER, code TEXT, team INTEGER, opr_np REAL, opr_auto REAL, opr_teleop REAL, opr_endgame REAL, opr_pen REAL, avg_score REAL, avg_np REAL, avg_pen REAL, matches INTEGER, wins INTEGER, losses INTEGER, ties INTEGER, PRIMARY KEY (season, code, team))" },
  { name: "team_season_stats", ddl: "CREATE TABLE team_season_stats (season INTEGER, team INTEGER, opr_np REAL, opr_auto REAL, opr_teleop REAL, opr_endgame REAL, opr_pen REAL, rank_np INTEGER, rank_auto INTEGER, rank_teleop INTEGER, rank_endgame INTEGER, ranked_teams INTEGER, rating_np REAL, rating_auto REAL, rating_teleop REAL, rating_endgame REAL, rating_pen REAL, rating_sd REAL, rating_matches INTEGER, rating_rank INTEGER, events INTEGER, matches INTEGER, wins INTEGER, losses INTEGER, ties INTEGER, avg_np REAL, avg_score REAL, avg_pen REAL, PRIMARY KEY (season, team))" },
];

export async function buildFull(season: number, version: string, dir: string, log: (m: string) => void): Promise<BuiltFile | null> {
  const n = await all<{ c: number }>("SELECT COUNT(*) c FROM matches WHERE season = ?", [season]);
  if (!Number(n[0]?.c)) return null;
  const name = `scout-pack-${version.replace(/\./g, "-")}-${season}.db`;
  const tmp = join(dir, `${name}.tmp`);
  if (existsSync(tmp)) { try { rmSync(tmp); } catch { /* in use */ } }
  const out = createClient({ url: `file:${tmp.replace(/\\/g, "/")}` });
  await out.execute("PRAGMA journal_mode = OFF");
  await out.execute("CREATE TABLE pack_info (key TEXT PRIMARY KEY, value TEXT)");
  await out.batch([
    { sql: "INSERT INTO pack_info VALUES ('format', ?)", args: [String(PACK_FORMAT)] },
    { sql: "INSERT INTO pack_info VALUES ('version', ?)", args: [version] },
    { sql: "INSERT INTO pack_info VALUES ('season', ?)", args: [String(season)] },
    { sql: "INSERT INTO pack_info VALUES ('game', ?)", args: [seasonInfo(season).game] },
    { sql: "INSERT INTO pack_info VALUES ('built_at', ?)", args: [new Date().toISOString()] },
    { sql: "INSERT INTO pack_info VALUES ('source', 'FIRST Events API (primary), FTC Scout (fallback)')", args: [] },
  ], "write");
  await out.execute("CREATE TABLE teams (number INTEGER PRIMARY KEY, name TEXT, full_name TEXT, school TEXT, sponsors TEXT, city TEXT, state TEXT, country TEXT, rookie_year INTEGER, website TEXT, home_region TEXT)");
  let rows = 0;
  for (const t of FULL_TABLES) {
    await out.execute(t.ddl);
    const data = await all<any>(`SELECT * FROM ${t.name} WHERE season = ?`, [season]);
    // Column names: everything between "(" and ", PRIMARY KEY".
    const cols = t.ddl.slice(t.ddl.indexOf("(") + 1, t.ddl.indexOf(", PRIMARY KEY")).split(",").map((c) => c.trim().split(" ")[0].replace(/"/g, ""));
    for (let i = 0; i < data.length; i += 1000) {
      await out.batch(data.slice(i, i + 1000).map((r) => ({ sql: `INSERT INTO ${t.name} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`, args: cols.map((c) => r[c] ?? null) })), "write");
    }
    rows += data.length;
  }
  const teams = await all<any>(`SELECT * FROM teams WHERE number IN (SELECT team FROM team_seasons WHERE season = ? UNION SELECT team FROM event_teams WHERE season = ?)`, [season, season]);
  for (let i = 0; i < teams.length; i += 1000) {
    await out.batch(teams.slice(i, i + 1000).map((r) => ({ sql: "INSERT INTO teams VALUES (?,?,?,?,?,?,?,?,?,?,?)", args: [r.number, r.name, r.full_name, r.school, r.sponsors, r.city, r.state, r.country, r.rookie_year, r.website, r.home_region] })), "write");
  }
  await out.execute("CREATE INDEX match_teams_team ON match_teams (team)");
  await out.execute("CREATE INDEX event_teams_team ON event_teams (team)");
  await out.execute("VACUUM");
  out.close();
  // Windows can hold the file briefly after close: copy, then clean up the temp file.
  copyFileSync(tmp, join(dir, name));
  try { rmSync(tmp); } catch { /* removed on the next build */ }
  const buf = readFileSync(join(dir, name));
  log(`full ${season}: ${rows + teams.length} rows → ${(buf.length / 1e6).toFixed(1)} MB`);
  return { name, url: `/packs/${name}`, bytes: buf.length, sha256: sha256(buf), seasons: [season], kind: "full",
    contents: `Every ${seasonInfo(season).label} ${seasonInfo(season).game} event, team, match (scores, breakdowns, penalties, lineups), ranking, alliance, award and computed stat — a plain SQLite file.` };
}

export async function buildPacks(log: (m: string) => void = () => {}): Promise<Manifest> {
  const dir = packsDir();
  mkdirSync(dir, { recursive: true });
  const version = await nextVersion(dir);
  const lite = await buildLite(version, dir, log);
  const full: BuiltFile[] = [];
  for (const s of [...SEASON_NUMBERS].sort((a, b) => b - a)) { const f = await buildFull(s, version, dir, log); if (f) full.push(f); }
  const sync = await kvGet<{ at: string }>("sync:last");
  const manifest: Manifest = { format: PACK_FORMAT, version, builtAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, dataAsOf: sync?.at ?? null, lite, full };
  writeFileSync(join(dir, "latest.json.tmp"), JSON.stringify(manifest, null, 2));
  renameSync(join(dir, "latest.json.tmp"), join(dir, "latest.json"));
  // Keep the newest KEEP_VERSIONS releases.
  for (const f of readdirSync(dir)) if (f.endsWith(".tmp")) { try { rmSync(join(dir, f)); } catch { /* in use */ } }
  const versions = [...new Set(readdirSync(dir).map((f) => /^scout-pack-(\d{4}-\d{2}-\d{2}-\d+)-/.exec(f)?.[1]).filter(Boolean) as string[])].sort().reverse();
  for (const old of versions.slice(KEEP_VERSIONS)) for (const f of readdirSync(dir)) if (f.startsWith(`scout-pack-${old}-`)) rmSync(join(dir, f));
  log(`manifest ${version}: lite ${(lite.bytes / 1e6).toFixed(2)} MB, ${full.length} full packs (${(full.reduce((s, f) => s + f.bytes, 0) / 1e6).toFixed(1)} MB)`);
  return manifest;
}
