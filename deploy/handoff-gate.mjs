// May a new release take over from the live server with a moment of overlap (deploy/lanes.sh handoff), or must the
// live one stop first (restart)?
//
//   node deploy/handoff-gate.mjs <release dir> <env file>      (as the app user, from the new release's folder)
//
// Prints "handoff", or "restart: <why>". Anything it can't tell (no local database, an error) prints restart too:
// that's the deploy every release had before the lanes.
//
// The overlap is safe because the writers that must never run twice take the writer lease (server/data/lock.ts:
// the data cycle, also when it runs in a child process, and the live lane), and the rest of the schedule
// (server/index.ts) starts a minute or more after the new server is ready, by when the old one has gone. Two things a
// new server does before it's ready are not covered, and both would leave the old server's code running against what
// it changed:
//   - a migration (server/db.ts MIGRATIONS) the database hasn't had yet: the old code would run on the new schema;
//   - a search index rebuild (SEARCH_INDEX_SCHEMA in server/api/search.ts above the stored search:schema): a data
//     cycle the old server is running could write its own index over the new one afterwards.
// For those this says restart.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The migration versions in server/db.ts's MIGRATIONS (null when it can't be read). */
export function migrationVersions(dbTs) {
  const start = dbTs.indexOf("export const MIGRATIONS");
  if (start < 0) return null;
  const end = dbTs.indexOf("\n];", start);
  const list = dbTs.slice(start, end < 0 ? undefined : end);
  const versions = [...list.matchAll(/^\s*version:\s*(\d+),/gm)].map((m) => Number(m[1]));
  return versions.length ? versions : null;
}

/** SEARCH_INDEX_SCHEMA in server/api/search.ts (null when it can't be read). */
export function searchSchema(searchTs) {
  const m = /export const SEARCH_INDEX_SCHEMA = (\d+);/.exec(searchTs);
  return m ? Number(m[1]) : null;
}

/** DATABASE_URL from an env file (the last one wins, as the shell reading it would). */
export function databaseUrl(envText) {
  let url = null;
  for (const line of envText.split("\n")) {
    const m = /^DATABASE_URL=(.*)$/.exec(line.trim());
    if (m) url = m[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return url;
}

/**
 * Why the release must not overlap the live server ([] = it may).
 * `migrations`: the release's versions; `applied`: the ones the database has; `storedSearch`: its search:schema
 * (null if none).
 */
export function restartReasons({ migrations, applied, schema, storedSearch }) {
  const why = [];
  if (migrations == null) why.push("can't read the release's migrations");
  else {
    const have = new Set(applied);
    const pending = migrations.filter((v) => !have.has(v));
    if (pending.length) why.push(`migration ${pending.join(", ")} not applied yet`);
  }
  if (schema == null) why.push("can't read the release's search index schema");
  else if (Number(storedSearch ?? 0) < schema) why.push(`search index rebuilt at start (schema ${storedSearch ?? "none"} → ${schema})`);
  return why;
}

async function main(relDir, envFile) {
  const url = databaseUrl(readFileSync(envFile, "utf8"));
  if (!url || !url.startsWith("file:")) return ["no local database to check"];
  const migrations = migrationVersions(readFileSync(join(relDir, "server/db.ts"), "utf8"));
  const schema = searchSchema(readFileSync(join(relDir, "server/api/search.ts"), "utf8"));
  const { createClient } = await import("@libsql/client");
  const c = createClient({ url });
  try {
    const applied = (await c.execute("SELECT version FROM schema_version")).rows.map((r) => Number(r.version));
    const kv = (await c.execute("SELECT value FROM kv WHERE key = 'search:schema'")).rows[0];
    return restartReasons({ migrations, applied, schema, storedSearch: kv ? Number(JSON.parse(String(kv.value))) : null });
  } finally {
    c.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [relDir, envFile] = process.argv.slice(2);
  main(relDir, envFile)
    .then((why) => console.log(why.length ? `restart: ${why.join("; ")}` : "handoff"))
    .catch((e) => console.log(`restart: couldn't check (${e?.message ?? e})`));
}
