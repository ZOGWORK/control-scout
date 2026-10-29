// Runtime feature flags: kill switches the owner flips in the portal, no deploy needed.
//
// Stored in feature_flags (a missing row means on) and read through a small cache:
// a read is at most FLAG_TTL_MS old, and a write through setFlag drops this
// process's cache at once. Other processes (the data cycle's child, a second host)
// see the change within FLAG_TTL_MS.
//
// For other features:  if (!(await isEnabled("realtime"))) { …refuse politely… }
// A database that can't be read never turns a feature off: the last known value
// (or the default, on) stands.
import { primaryDb, readThenWrite } from "./db.js";
import { registerCache } from "./caches.js";
import { DEFAULT_FLAGS, FLAGS, isFlag, type Flag, type FlagSet } from "../src/shared/flags.js";

export { FLAGS, type Flag, type FlagSet } from "../src/shared/flags.js";

/** How stale a flag read may be. */
export const FLAG_TTL_MS = 10_000;

let cached: { at: number; flags: FlagSet } | null = null;
let loading: Promise<FlagSet> | null = null;

async function load(): Promise<FlagSet> {
  // From the primary, not an embedded replica (minutes behind): a switch flipped on another host counts within FLAG_TTL_MS.
  const rows = (await primaryDb().execute("SELECT name, enabled FROM feature_flags")).rows as unknown as { name: string; enabled: number }[];
  const flags = { ...DEFAULT_FLAGS };
  for (const r of rows) if (isFlag(r.name)) flags[r.name] = Number(r.enabled) === 1;
  return flags;
}

/** Every flag's current value (cached up to FLAG_TTL_MS). */
export async function allFlags(now = Date.now()): Promise<FlagSet> {
  if (cached && now - cached.at < FLAG_TTL_MS) return cached.flags;
  if (!loading) {
    const p = load().then(
      (flags) => { if (loading === p) { cached = { at: Date.now(), flags }; loading = null; } return flags; },
      (e) => {
        const flags = cached?.flags ?? { ...DEFAULT_FLAGS };
        // Kept for a TTL too, so a database that's down isn't asked again on every request.
        if (loading === p) { cached = { at: Date.now(), flags }; loading = null; }
        console.warn(`[flags] couldn't read feature flags, keeping the last known values: ${(e as Error)?.message ?? e}`);
        return flags;
      },
    );
    loading = p;
  }
  return loading;
}

/** Is this feature switched on? (Defaults to on.) */
export async function isEnabled(flag: Flag): Promise<boolean> {
  return (await allFlags())[flag];
}

/** Turn a flag on or off; this process sees it at once. Returns the value it replaced (read in the same transaction). */
export async function setFlag(flag: Flag, enabled: boolean, by: string): Promise<boolean> {
  const { before } = await readThenWrite<{ enabled: number }>({ sql: "SELECT enabled FROM feature_flags WHERE name = ?", args: [flag] }, [{
    sql: `INSERT INTO feature_flags (name, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    args: [flag, enabled ? 1 : 0, new Date().toISOString(), by],
  }]);
  invalidateFlags();
  return before ? Number(before.enabled) === 1 : DEFAULT_FLAGS[flag];
}

/** The flags with who changed each last, for the owner portal. */
export async function flagDetails(): Promise<{ name: Flag; enabled: boolean; updatedAt: string | null; updatedBy: string | null }[]> {
  const rows = (await primaryDb().execute("SELECT * FROM feature_flags")).rows as unknown as { name: string; enabled: number; updated_at: string; updated_by: string }[];
  return FLAGS.map((name) => {
    const r = rows.find((x) => x.name === name);
    return { name, enabled: r ? Number(r.enabled) === 1 : DEFAULT_FLAGS[name], updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null };
  });
}

/** Forget the cached values (a write here, the portal's "clear caches", tests). */
export function invalidateFlags(): void { cached = null; loading = null; }
registerCache("Feature flags", invalidateFlags);
