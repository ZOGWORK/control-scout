// Owner console settings (owner_settings, migration 56): one JSON value per key, set from the console and
// audited there. Today one key:
//   publicUsage  publish the home page's "in use" section (/api/public-usage). Until the owner chooses in the
//                console, PUBLIC_USAGE_ENABLED decides (off when unset), as it did before.
// Reads go through a short cache (SETTINGS_TTL_MS) from the primary database, like the feature flags: a
// choice made on one host counts on another within seconds. A database that can't be read keeps the last
// known value (or the env default).
import { db, primaryDb } from "./db.js";
import { env } from "./env.js";
import { registerCache } from "./caches.js";
import type { PublishUsageSetting } from "../src/shared/owner.js";

export const SETTINGS_TTL_MS = 10_000;

interface Row { value: string; updated_at: string; updated_by: string }
let cached: { at: number; row: Row | null } | null = null;

async function load(): Promise<Row | null> {
  const r = (await primaryDb().execute({ sql: "SELECT value, updated_at, updated_by FROM owner_settings WHERE key = 'publicUsage'", args: [] })).rows[0];
  return r ? { value: String(r.value), updated_at: String(r.updated_at), updated_by: String(r.updated_by) } : null;
}

/** Whether the home page's "in use" section is published, and who chose it. */
export async function publishUsageSetting(now = Date.now()): Promise<PublishUsageSetting> {
  if (!cached || now - cached.at >= SETTINGS_TTL_MS) {
    try { cached = { at: now, row: await load() }; } catch (e) {
      console.warn(`[settings] couldn't read owner settings, keeping the last known values: ${(e as Error)?.message ?? e}`);
      cached = { at: now, row: cached?.row ?? null };
    }
  }
  const envDefault = env.publicUsageEnabled;
  const row = cached.row;
  if (!row) return { enabled: envDefault, source: "env", envDefault, updatedAt: null, updatedBy: null };
  let enabled = envDefault;
  try { enabled = JSON.parse(row.value) === true; } catch { /* unreadable: the env default stands */ }
  return { enabled, source: "owner", envDefault, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

/**
 * Publish (or stop publishing) the "in use" section; this process sees it at once. Returns the value it
 * replaced, read in the same transaction (the env default when the console had never set it).
 */
export async function setPublishUsage(enabled: boolean, by: string, now = new Date()): Promise<{ was: boolean; source: "owner" | "env" }> {
  const [read] = await db().batch([
    { sql: "SELECT value FROM owner_settings WHERE key = 'publicUsage'", args: [] },
    {
      sql: `INSERT INTO owner_settings (key, value, updated_at, updated_by) VALUES ('publicUsage', ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      args: [JSON.stringify(enabled), now.toISOString(), by.slice(0, 200)],
    },
  ], "write");
  cached = null;
  const before = read.rows[0] as unknown as { value: string } | undefined;
  if (!before) return { was: env.publicUsageEnabled, source: "env" };
  let was = env.publicUsageEnabled;
  try { was = JSON.parse(String(before.value)) === true; } catch { /* unreadable: the env default stood */ }
  return { was, source: "owner" };
}

/** Drop the cache (tests, and the console's "clear caches"). */
export function invalidateOwnerSettings(): void { cached = null; }
registerCache("Owner settings", invalidateOwnerSettings);
