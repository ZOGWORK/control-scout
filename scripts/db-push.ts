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
];
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
  const sql = `INSERT OR ${ledger ? "IGNORE" : "REPLACE"} INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  let copied = 0;
  for (let last = -1; ;) {
    const rows = (await source.execute({ sql: `SELECT rowid AS _rid, ${cols.join(", ")} FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ${BATCH}`, args: [last] })).rows;
    if (!rows.length) break;
    await to.batch(rows.map((r) => ({ sql, args: cols.map((c) => r[c] ?? null) })), "write");
    last = Number(rows[rows.length - 1]._rid);
    copied += rows.length;
  }
  console.log(`  ${table}: ${copied.toLocaleString()} rows`);
}
console.log("Rebuilding search…");
await rebuildSearch((m) => console.log(`  ${m}`));
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
source.close();
