// First boot with no data: restore the shipped public snapshot (data/snapshot.db.br,
// built by `npm run snapshot`) into the local database file. Streams, so it
// stays light on a small instance. Skipped when the database is remote (Turso)
// or already has data — real data always wins over the snapshot.
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress } from "node:zlib";
import { createClient } from "@libsql/client";
import { env } from "../env.js";

export const SNAPSHOT = join(process.cwd(), "data", "snapshot.db.br");

/** Local file path of the database, or null when it's remote (libsql://, https://). */
export function localDbPath(url = env.databaseUrl): string | null {
  if (!url.startsWith("file:")) return null;
  return url.slice("file:".length);
}

async function hasTeams(path: string): Promise<boolean> {
  if (!existsSync(path) || statSync(path).size === 0) return false;
  const c = createClient({ url: `file:${path}` });
  try { return Number((await c.execute("SELECT COUNT(*) n FROM teams")).rows[0].n) > 0; }
  catch { return false; } // no schema yet
  finally { c.close(); }
}

/** Returns what happened, for the startup log. Call before the database is first opened. */
export async function restoreSnapshotIfEmpty(): Promise<string> {
  const path = localDbPath();
  if (!path) return "remote database: snapshot not used";
  if (!existsSync(SNAPSHOT)) return "no snapshot shipped";
  if (await hasTeams(path)) return "database has data: snapshot not used";
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.restoring`;
  await pipeline(createReadStream(SNAPSHOT), createBrotliDecompress(), createWriteStream(tmp));
  for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
  renameSync(tmp, path);
  return `restored the shipped snapshot (${(statSync(path).size / 1e6).toFixed(0)} MB)`;
}
