// First boot with no data: restore the shipped public snapshot (data/snapshot.db.br,
// built by `npm run snapshot`) into the local database file. Streams, so it
// stays light on a small instance. Skipped when the database is remote (Turso)
// or already has data — real data always wins over the snapshot.
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
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

/** Tables holding people's own data, never in the snapshot. */
export const PRIVATE_TABLES = ["users", "sessions", "identities", "email_codes", "user_state", "scout_entries"];

/** True only when replacing the file can't lose anything: it's missing or zero
 *  bytes, has no tables at all, or has no teams AND no rows in any private
 *  table. Any error reading it means "keep it", never "replace it". */
export async function safeToReplace(path: string): Promise<boolean> {
  if (!existsSync(path) || statSync(path).size === 0) return true;
  const c = createClient({ url: `file:${path}` });
  try {
    const tables = new Set((await c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((r) => String(r.name)));
    if (!tables.size) return true;
    for (const t of ["teams", ...PRIVATE_TABLES]) {
      if (!tables.has(t)) continue;
      if (Number((await c.execute(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n) > 0) return false;
    }
    return true;
  } catch {
    return false;
  } finally { c.close(); }
}

/** Returns what happened, for the startup log. Call before the database is first opened. */
export async function restoreSnapshotIfEmpty(): Promise<string> {
  const path = localDbPath();
  if (!path) return "remote database: snapshot not used";
  if (!existsSync(SNAPSHOT)) return "no snapshot shipped";
  if (!(await safeToReplace(path))) return "database already holds data: snapshot not used";
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.restoring`;
  await pipeline(createReadStream(SNAPSHOT), createBrotliDecompress(), createWriteStream(tmp));
  for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
  renameSync(tmp, path);
  return `restored the shipped snapshot (${(statSync(path).size / 1e6).toFixed(0)} MB)`;
}

/** Offline packs shipped with the app (data/packs: the lite pack plus the
 *  current season's full pack, with their own manifest), for hosts that don't
 *  build packs (CS_PACKS=off, e.g. Render's free plan with a throwaway disk).
 *  Copied into the packs directory only when it has no manifest of its own. */
export const SHIPPED_PACKS = join(process.cwd(), "data", "packs");

export function installShippedPacks(packsDir: string): string {
  const manifest = join(SHIPPED_PACKS, "latest.json");
  if (!existsSync(manifest)) return "no packs shipped";
  if (existsSync(join(packsDir, "latest.json"))) return "packs present: shipped packs not used";
  const m = JSON.parse(readFileSync(manifest, "utf8")) as { lite: { name: string } | null; full: { name: string }[] };
  const files = [m.lite, ...m.full].filter((f): f is { name: string } => !!f).map((f) => f.name);
  const missing = files.filter((f) => !existsSync(join(SHIPPED_PACKS, f)));
  if (missing.length) return `shipped packs incomplete (missing ${missing.join(", ")}): not installed`;
  mkdirSync(packsDir, { recursive: true });
  for (const f of files) copyFileSync(join(SHIPPED_PACKS, f), join(packsDir, f));
  copyFileSync(manifest, join(packsDir, "latest.json")); // last: the manifest only appears once its files are there
  return `installed shipped packs (${files.length} files)`;
}
