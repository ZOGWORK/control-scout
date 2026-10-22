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
import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, linkSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createClient } from "@libsql/client";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { all, kvGet } from "../db.js";
import { CURRENT_SEASON, PREDICT_SEASONS, SEASON_NUMBERS, seasonInfo } from "../data/seasons.js";
import { ScoutForecaster, forecasterFor } from "../predict/engine.js";
import { partnershipPrefix } from "../predict/partnerships.js";
import { encodeLitePairs } from "../../src/shared/litePairs.js";
import { LEARNED_DAYS, type LiteLearned } from "../../src/shared/liteLearned.js";
import { packsDir } from "./routes.js";
import { PACK_INDEXES, PACK_TABLES as FULL_TABLES, PACK_TEAMS_DDL } from "../../src/shared/packSchema.js";

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

/** A season's events that ended on or after `since`, each with the match keys the forecaster folded into its ratings. */
export function learnedEvents(f: Pick<ScoutForecaster, "seasonEvents" | "storedPlayedKeys">, season: number, since: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of f.seasonEvents(season)) if ((e.end || e.start) >= since) out[e.code] = [...f.storedPlayedKeys(season, e.code)].sort();
  return out;
}

export async function buildLite(version: string, dir: string, log: (m: string) => void): Promise<BuiltFile> {
  const books: Record<string, unknown> = {};
  // Each season's bonus-RP model as the server serves it, so offline qualification predictions show the same bonus odds.
  const bonus: Record<string, unknown> = {};
  // Which results those ratings learned, per recent event (src/shared/liteLearned.ts): the device's local
  // estimate folds in exactly the others, as the server's forecaster does.
  const builtAt = new Date();
  const learned: LiteLearned = { since: new Date(builtAt.getTime() - LEARNED_DAYS * 864e5).toISOString().slice(0, 10), events: {} };
  for (const s of PREDICT_SEASONS) { // legacy seasons have no ratings
    const f = await forecasterFor(s);
    const b = f.book(s);
    if (b) books[String(s)] = b.toData();
    const recent = learnedEvents(f, s, learned.since);
    if (Object.keys(recent).length) learned.events[String(s)] = recent;
    const bm = f.bonusModel(s);
    if (bm) bonus[String(s)] = bm;
  }
  // Pair history (engine 2.4) through the newest season, the finished seasons' part included.
  let pf = await forecasterFor(CURRENT_SEASON);
  if (!pf.partnershipComplete && (await partnershipPrefix(pf.seasons[0] ?? pf.anchor, { wait: true }))) { pf = new ScoutForecaster(pf.anchor); await pf.rebuild(); }
  // Only a small cut ships (src/shared/litePairs.ts): the pack is downloaded at venues, and the history is a reason only.
  const pairs = pf.partnershipData ? encodeLitePairs(pf.partnershipData) : null;
  const teams = (await all<any>("SELECT number, name, city, state, country FROM teams ORDER BY number"))
    .map((t) => [Number(t.number), t.name ?? null, [t.city, t.state, t.country].filter(Boolean).join(", ") || null]);
  const json = JSON.stringify({ format: PACK_FORMAT, version, builtAt: builtAt.toISOString(), engineVersion: ENGINE_VERSION, books, bonus, teams, pairs, learned });
  const gz = gzipSync(Buffer.from(json), { level: 9 });
  const name = `scout-pack-${version.replace(/\./g, "-")}-lite.json.gz`;
  writeFileSync(join(dir, name), gz);
  const pairBytes = pairs ? gzipSync(Buffer.from(JSON.stringify(pairs)), { level: 9 }).length : 0;
  log(`lite: ${(json.length / 1e6).toFixed(1)} MB raw → ${(gz.length / 1e6).toFixed(2)} MB gz (${Object.keys(books).length} seasons, ${teams.length} teams; pair history ${pairs ? `${pairs.rows.length} pairs, ~${(pairBytes / 1e3).toFixed(0)} KB gz` : "none"})`);
  return { name, url: `/packs/${name}`, bytes: gz.length, sha256: sha256(gz), seasons: Object.keys(books).map(Number), kind: "lite",
    contents: `Every team's prediction rating for ${Object.keys(books).length} seasons plus team names — enough to predict any match on this device with no connection.` };
}

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
  await out.execute(PACK_TEAMS_DDL);
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
  for (const ix of PACK_INDEXES) await out.execute(ix);
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

/** Lock shared by every build path (the scheduler and `npm run packs`), so two
 *  builds never pick the same version and overwrite each other's files. The
 *  lock records its owner (host + pid): a lock whose process is gone (a restart
 *  mid-build) is taken over at once; any lock older than LOCK_STALE_MS is too. */
const LOCK_STALE_MS = 2 * 3600_000;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
let holding = false; // this process is building right now
/** The lock's content if it is stale (its owner is gone), else null. */
function staleLock(lock: string): string | null {
  try {
    const age = Date.now() - statSync(lock).mtimeMs;
    const text = readFileSync(lock, "utf8");
    if (age > LOCK_STALE_MS) return text;
    if (!text) return age > 10_000 ? text : null; // just created; its owner is still writing
    const owner = JSON.parse(text) as { host?: string; pid?: number };
    if (owner.host !== hostname() || typeof owner.pid !== "number") return null;
    // Our own pid but not building: a previous run (e.g. a restarted container reusing the pid).
    if (owner.pid === process.pid) return holding ? null : text;
    return alive(owner.pid) ? null : text;
  } catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? null : ""; }
}

/** Recover a stale lock without ever removing a lock someone else just took:
 *  move it aside atomically, and if what we moved isn't the stale lock we
 *  judged (another process recovered it first and re-locked), put it back. */
export function recover(lock: string, staleText: string) {
  const aside = `${lock}.${process.pid}.${randomUUID()}`;
  try { renameSync(lock, aside); } catch { return; } // gone already
  if (readFileSync(aside, "utf8") === staleText) { rmSync(aside, { force: true }); return; }
  try { linkSync(aside, lock); } catch { /* a third builder took it; theirs stands */ }
  rmSync(aside, { force: true });
}

export async function withPackLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, ".build.lock");
  const stale = existsSync(lock) ? staleLock(lock) : null;
  if (stale !== null) recover(lock, stale);
  let fd: number;
  try { fd = openSync(lock, "wx"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Another pack build is running; skipped.");
    throw e;
  }
  // A nonce makes every lock's content unique, so recovery can tell them apart.
  try { writeSync(fd, JSON.stringify({ host: hostname(), pid: process.pid, at: new Date().toISOString(), nonce: randomUUID() })); } finally { closeSync(fd); }
  holding = true;
  try { return await fn(); } finally { holding = false; rmSync(lock, { force: true }); }
}

export async function buildPacks(log: (m: string) => void = () => {}): Promise<Manifest> {
  return withPackLock(packsDir(), () => buildPacksUnlocked(log));
}

async function buildPacksUnlocked(log: (m: string) => void): Promise<Manifest> {
  const dir = packsDir();
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
