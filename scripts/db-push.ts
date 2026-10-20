// Copy the local database's public data into another libSQL database (Turso),
// then rebuild its search index there.
//
//   PUSH_DATABASE_URL=libsql://control-scout-….turso.io \
//   PUSH_DATABASE_AUTH_TOKEN=… npm run db:push
//
// The target's schema comes from our own migrations (not copied), and only
// public data moves: accounts, sessions, email codes, personal state and
// scouting entries stay on this machine. Safe to re-run: data rows are
// replaced, while predictions already logged on the target are kept.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const target = process.env.PUSH_DATABASE_URL;
if (!target) { console.error("Set PUSH_DATABASE_URL (and PUSH_DATABASE_AUTH_TOKEN for Turso)."); process.exit(1); }
// Point the app's own db module at the target before it is first used.
process.env.DATABASE_URL = target;
process.env.DATABASE_AUTH_TOKEN = process.env.PUSH_DATABASE_AUTH_TOKEN ?? "";

const PUBLIC_TABLES = [
  "seasons", "teams", "team_seasons", "events", "event_teams", "matches", "match_teams",
  "alliances", "awards", "advancement", "team_event_stats", "team_season_stats", "predictions", "kv",
  "team_event_records", "team_season_records", "match_records",
];
/** WITHOUT ROWID tables (no rowid to page by): their primary key order instead. */
const KEY_ORDER: Record<string, string> = {
  team_event_records: "season, code, team", team_season_records: "season, team", match_records: "season, code, level, series, number",
};
const BATCH = 400;

const { migrate, db } = await import("../server/db.js");
const { rebuildSearch } = await import("../server/stats/job.js");

const dataDir = process.env.DATA_DIR ?? join(process.cwd(), ".data");
const sourcePath = [join(dataDir, "scout-export.db"), join(dataDir, "scout.db")].find(existsSync);
if (!sourcePath) { console.error(`No local database in ${dataDir}`); process.exit(1); }
const source = createClient({ url: `file:${sourcePath.replace(/\\/g, "/")}` });
console.log(`Source: ${sourcePath}`);

const to = db();
await migrate(to);
const t0 = Date.now();
for (const table of PUBLIC_TABLES) {
  let cols = (await source.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));
  if (!cols.length) { console.log(`  ${table}: not in source, skipped`); continue; }
  // The prediction ledger is first-write-wins and its ids are local: copy rows
  // without ids and keep any call the target already logged for the same match
  // (UNIQUE kind+match). Everything else is plain data: newest copy wins.
  const ledger = table === "predictions";
  if (ledger) cols = cols.filter((c) => c !== "id");
  const values = cols.map(() => "?").join(", ");
  // A live call can later be reclassified late, so live/late are one call per
  // match: if the target has either, it keeps its own and the copy is skipped.
  const sql = ledger
    ? `INSERT OR IGNORE INTO predictions (${cols.join(", ")}) SELECT ${values} WHERE NOT EXISTS (SELECT 1 FROM predictions WHERE season = ? AND code = ? AND level = ? AND series = ? AND number = ? AND kind IN (?, ?))`
    : `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${values})`;
  const argsFor = (r: Record<string, unknown>) => {
    const base = cols.map((c) => (r[c] ?? null) as never);
    if (!ledger) return base;
    const family = r.kind === "live" || r.kind === "late" ? ["live", "late"] : [r.kind, r.kind];
    return [...base, r.season, r.code, r.level, r.series, r.number, ...family] as never[];
  };
  let copied = 0;
  for (let last = -1; ;) {
    const page = KEY_ORDER[table]
      ? { sql: `SELECT ${cols.join(", ")} FROM ${table} ORDER BY ${KEY_ORDER[table]} LIMIT ${BATCH} OFFSET ?`, args: [copied] }
      : { sql: `SELECT rowid AS _rid, ${cols.join(", ")} FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ${BATCH}`, args: [last] };
    const rows = (await source.execute(page)).rows;
    if (!rows.length) break;
    await to.batch(rows.map((r) => ({ sql, args: argsFor(r) })), "write");
    if (!KEY_ORDER[table]) last = Number(rows[rows.length - 1]._rid);
    copied += rows.length;
  }
  console.log(`  ${table}: ${copied.toLocaleString()} rows`);
}
// Official result changes (server/data/resultChanges.ts) travel with the matches they describe. Per watched
// event, its watch row, history, matches and lineups are read in one read transaction (one snapshot of the
// source, even if a sync is writing meanwhile) and replace the target's in one write transaction: an
// interrupted push leaves each event either as it was or fully copied, and the target's next poll diffs
// against exactly the state its history ends with. Ids are local and dropped; diff keys aren't (they chain
// on the previous change's key). The per-event cap and pruned stay true on the target.
if ((await source.execute("SELECT 1 FROM sqlite_master WHERE name = 'result_watch'")).rows.length) {
  const colsOf = async (t: string) => (await source.execute(`PRAGMA table_info(${t})`)).rows.map((r) => String(r.name));
  const tables = { result_watch: await colsOf("result_watch"), result_changes: (await colsOf("result_changes")).filter((c) => c !== "id"), matches: await colsOf("matches"), match_teams: await colsOf("match_teams") };
  const insert = (t: keyof typeof tables) => `INSERT INTO ${t} (${tables[t].join(", ")}) VALUES (${tables[t].map(() => "?").join(", ")})`;
  const argsOf = (t: keyof typeof tables, r: Record<string, unknown>) => tables[t].map((c) => (r[c] ?? null) as never);
  let events = 0, rows = 0;
  for (const w of (await source.execute("SELECT season, code FROM result_watch")).rows) {
    const k = [w.season, w.code] as never[];
    const read = await source.transaction("read");
    const snap: Record<string, Record<string, unknown>[]> = {};
    try {
      for (const t of Object.keys(tables) as (keyof typeof tables)[]) {
        snap[t] = (await read.execute({ sql: `SELECT ${tables[t].join(", ")} FROM ${t} WHERE season = ? AND code = ?${t === "result_changes" ? " ORDER BY id" : ""}`, args: k })).rows as never;
      }
    } finally { read.close(); }
    await to.batch([
      ...(["result_changes", "result_watch", "match_teams", "matches"] as const).map((t) => ({ sql: `DELETE FROM ${t} WHERE season = ? AND code = ?`, args: k })),
      ...(["matches", "match_teams", "result_watch", "result_changes"] as const).flatMap((t) => snap[t].map((r) => ({ sql: insert(t), args: argsOf(t, r) }))),
    ], "write");
    events++; rows += snap.result_changes.length;
  }
  console.log(`  result changes: ${rows.toLocaleString()} rows for ${events.toLocaleString()} watched events (with their matches, from one snapshot each)`);
}
console.log("Rebuilding search…");
await rebuildSearch((m) => console.log(`  ${m}`));
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
source.close();
