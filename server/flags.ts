// Runtime feature flags: the owner console's feature toggles and kill switches (src/shared/flags.ts), no deploy needed.
//
// Global values live in feature_flags (a missing row means on); workspace-scoped flags also take
// per-workspace overrides in workspace_flag_overrides (migration 53; no row: the workspace follows the
// global switch). Resolution (isEnabledFor): the workspace's override, else the global switch, else on;
// a key that isn't registered is never gated.
//
// Both tables are read through one small cache: a read is at most FLAG_TTL_MS old, and a write here drops
// this process's cache at once. Other processes (the data cycle's child, the Discord bot, a second host)
// see the change within FLAG_TTL_MS. A database that can't be read never turns a feature off: the last
// known values (or the defaults, on) stand.
//
// Gating a route: requireFeature("coinFlips") as middleware, or `if (!(await isEnabledFor(flag, ws))) return featureDisabled(res, flag)`.
// Either way the answer is 403 {error: "feature_disabled", feature} with Cache-Control: no-store.
import type { NextFunction, Request, Response } from "express";
import { db, primaryDb } from "./db.js";
import { registerCache } from "./caches.js";
import { DEFAULT_FLAGS, FEATURE_DISABLED, FLAGS, featureOffMessage, isFlag, isWorkspaceFlag, type FeatureDisabledBody, type Flag, type FlagSet } from "../src/shared/flags.js";

export { FLAGS, type Flag, type FlagSet } from "../src/shared/flags.js";

/** How stale a flag read may be. */
export const FLAG_TTL_MS = 10_000;

/** The global values, and each workspace's overrides (workspace id → flag → on/off). */
interface FlagState { flags: FlagSet; overrides: Map<string, Map<Flag, boolean>> }

let cached: { at: number; state: FlagState } | null = null;
let loading: Promise<FlagState> | null = null;

async function load(): Promise<FlagState> {
  // From the primary, not an embedded replica (minutes behind): a switch flipped on another host counts within FLAG_TTL_MS.
  const [g, o] = await Promise.all([
    primaryDb().execute("SELECT name, enabled FROM feature_flags"),
    primaryDb().execute("SELECT cp_workspace_id, name, enabled FROM workspace_flag_overrides"),
  ]);
  const flags = { ...DEFAULT_FLAGS };
  for (const r of g.rows as unknown as { name: string; enabled: number }[]) if (isFlag(r.name)) flags[r.name] = Number(r.enabled) === 1;
  const overrides = new Map<string, Map<Flag, boolean>>();
  for (const r of o.rows as unknown as { cp_workspace_id: string; name: string; enabled: number }[]) {
    // Only workspace-scoped flags take overrides: a stray row for another flag is never read.
    if (!isFlag(r.name) || !isWorkspaceFlag(r.name)) continue;
    const id = String(r.cp_workspace_id);
    if (!overrides.has(id)) overrides.set(id, new Map());
    overrides.get(id)!.set(r.name, Number(r.enabled) === 1);
  }
  return { flags, overrides };
}

async function state(now = Date.now()): Promise<FlagState> {
  if (cached && now - cached.at < FLAG_TTL_MS) return cached.state;
  if (!loading) {
    const p = load().then(
      (s) => { if (loading === p) { cached = { at: Date.now(), state: s }; loading = null; } return s; },
      (e) => {
        const s = cached?.state ?? { flags: { ...DEFAULT_FLAGS }, overrides: new Map() };
        // Kept for a TTL too, so a database that's down isn't asked again on every request.
        if (loading === p) { cached = { at: Date.now(), state: s }; loading = null; }
        console.warn(`[flags] couldn't read feature flags, keeping the last known values: ${(e as Error)?.message ?? e}`);
        return s;
      },
    );
    loading = p;
  }
  return loading;
}

/** Every flag's global value (cached up to FLAG_TTL_MS). */
export async function allFlags(now = Date.now()): Promise<FlagSet> {
  return (await state(now)).flags;
}

/** Is this feature switched on globally? (Defaults to on.) For a workspace-scoped flag with a workspace at hand, use isEnabledFor. */
export async function isEnabled(flag: Flag): Promise<boolean> {
  return (await allFlags())[flag];
}

/**
 * Is `flag` on for this workspace (null: no workspace, the global value)? The workspace's override (workspace-scoped
 * flags only), else the global switch, else on. A key that isn't registered is never gated.
 */
export async function isEnabledFor(flag: string, workspaceId: string | null, now = Date.now()): Promise<boolean> {
  if (!isFlag(flag)) return true;
  const s = await state(now);
  if (workspaceId != null && isWorkspaceFlag(flag)) {
    const o = s.overrides.get(workspaceId)?.get(flag);
    if (o !== undefined) return o;
  }
  return s.flags[flag];
}

/** Does any workspace have an override right now? (Cached like the flags.) */
export async function hasWorkspaceOverrides(): Promise<boolean> {
  return (await state()).overrides.size > 0;
}

/** The workspace-scoped flags resolved for each of these workspaces (GET /api/flags, for the signed-in account's own). */
export async function workspaceFlags(ids: readonly string[]): Promise<Record<string, Partial<FlagSet>>> {
  const s = await state();
  const out: Record<string, Partial<FlagSet>> = {};
  for (const id of ids) {
    const o: Partial<FlagSet> = {};
    for (const f of FLAGS) if (isWorkspaceFlag(f)) o[f] = s.overrides.get(id)?.get(f) ?? s.flags[f];
    out[id] = o;
  }
  return out;
}

/** Turn a flag on or off globally; this process sees it at once. Returns the value it had just before, read in the
 *  same transaction as the write, so two overlapping flips each record what they really replaced. */
export async function setFlag(flag: Flag, enabled: boolean, by: string): Promise<boolean> {
  const [before] = await db().batch([
    { sql: "SELECT enabled FROM feature_flags WHERE name = ?", args: [flag] },
    {
      sql: `INSERT INTO feature_flags (name, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      args: [flag, enabled ? 1 : 0, new Date().toISOString(), by],
    },
  ], "write");
  invalidateFlags();
  const row = before.rows[0] as unknown as { enabled: number } | undefined;
  return row ? Number(row.enabled) === 1 : DEFAULT_FLAGS[flag];
}

/**
 * Set one workspace's override of a workspace-scoped flag (null: remove it, so the workspace follows the global switch).
 * Returns the override it had just before (null: none), read in the same transaction as the write.
 */
export async function setWorkspaceOverride(flag: Flag, workspaceId: string, enabled: boolean | null, by: string): Promise<boolean | null> {
  if (!isWorkspaceFlag(flag)) throw new Error(`${flag} doesn't take per-workspace overrides`);
  const write = enabled === null
    ? { sql: "DELETE FROM workspace_flag_overrides WHERE cp_workspace_id = ? AND name = ?", args: [workspaceId, flag] }
    : {
      sql: `INSERT INTO workspace_flag_overrides (cp_workspace_id, name, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (cp_workspace_id, name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      args: [workspaceId, flag, enabled ? 1 : 0, new Date().toISOString(), by],
    };
  const [before] = await db().batch([
    { sql: "SELECT enabled FROM workspace_flag_overrides WHERE cp_workspace_id = ? AND name = ?", args: [workspaceId, flag] },
    write,
  ], "write");
  invalidateFlags();
  const row = before.rows[0] as unknown as { enabled: number } | undefined;
  return row ? Number(row.enabled) === 1 : null;
}

export interface FlagDetail { name: Flag; enabled: boolean; updatedAt: string | null; updatedBy: string | null }
export interface OverrideDetail { workspaceId: string; flag: Flag; enabled: boolean; updatedAt: string; updatedBy: string }

/** The flags with who changed each last, for the owner console. */
export async function flagDetails(): Promise<FlagDetail[]> {
  const rows = (await primaryDb().execute("SELECT * FROM feature_flags")).rows as unknown as { name: string; enabled: number; updated_at: string; updated_by: string }[];
  return FLAGS.map((name) => {
    const r = rows.find((x) => x.name === name);
    return { name, enabled: r ? Number(r.enabled) === 1 : DEFAULT_FLAGS[name], updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null };
  });
}

/** Every stored per-workspace override, for the owner console. */
export async function overrideDetails(): Promise<OverrideDetail[]> {
  const rows = (await primaryDb().execute("SELECT * FROM workspace_flag_overrides ORDER BY name, cp_workspace_id")).rows as unknown as { cp_workspace_id: string; name: string; enabled: number; updated_at: string; updated_by: string }[];
  return rows.filter((r) => isFlag(r.name) && isWorkspaceFlag(r.name))
    .map((r) => ({ workspaceId: String(r.cp_workspace_id), flag: r.name as Flag, enabled: Number(r.enabled) === 1, updatedAt: r.updated_at, updatedBy: r.updated_by }));
}

/** Answer that `flag` is switched off: 403 {error: "feature_disabled", feature}, never cached. Returns undefined (for `return featureDisabled(...)`). */
export function featureDisabled(res: Response, flag: Flag, extra: Partial<FeatureDisabledBody> = {}): undefined {
  res.set("Cache-Control", "no-store");
  const body: FeatureDisabledBody = { ...extra, error: FEATURE_DISABLED, feature: flag, message: featureOffMessage(flag) };
  res.status(403).json(body);
  return undefined;
}

/** Middleware: the route only runs while `flag` is on (globally: for a workspace-scoped flag, resolve per workspace in the handler). */
export function requireFeature(flag: Flag) {
  return (_req: Request, res: Response, next: NextFunction) => {
    isEnabledFor(flag, null).then((on) => { if (on) next(); else featureDisabled(res, flag); }, next);
  };
}

/** Forget the cached values (a write here, the portal's "clear caches", tests). */
export function invalidateFlags(): void { cached = null; loading = null; }
registerCache("Feature flags", invalidateFlags);
