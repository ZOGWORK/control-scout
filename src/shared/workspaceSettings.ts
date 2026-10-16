// Workspace settings (Task 6, Tier 2 of docs/settings.md): shared by every member of a Control
// Point workspace, written by its admins only, stored on the workspace mirror row's settings JSON
// next to the scout template (server/scout/settings.ts). Shared by server and web app so both
// validate the same way.
//
// The three tiers, and who wins (docs/settings.md):
// - Tier 1, personal (src/shared/personal.ts): theme, density, notifications, … per account. Always
//   the individual's, inside a workspace too. Nothing here can set them: cleanSettingsPatch drops
//   those keys, and viewSettings() reads them from the personal settings only.
// - Tier 2, workspace (this file + the template): shared behaviour inside the workspace's scout space.
// - Tier 3, device-only (DEVICE_ONLY_KEYS): local UI state, never sent to the server.

/** Default season and event for new entries in the workspace's scout space. Null: no default (the app's own). */
export interface WorkspaceDefaults { season: number | null; eventCode: string | null }

/**
 * Who may do what with the workspace's entries. Fixed for now (Task 3's rules, enforced by the server
 * in server/scout/entries.ts mayWrite); stored explicitly so it can grow later without a migration.
 */
export interface EntryPolicy {
  /** Who creates entries. */
  create: "members";
  /** Who edits a live entry: any member (anyone's). */
  edit: "members";
  /** Who deletes an entry: its author, or an admin (any entry). */
  delete: "author-or-admin";
}
export const ENTRY_POLICY: EntryPolicy = Object.freeze({ create: "members", edit: "members", delete: "author-or-admin" }) as EntryPolicy;

/** GET /api/scout/workspaces/:id/settings (the template has its own route: /template). */
export interface WorkspaceSettings {
  workspaceId: string;
  /** The workspace row's settings version: bumped by every admin change (settings or template). 0: never written. */
  settingsVersion: number;
  defaults: WorkspaceDefaults;
  entryPolicy: EntryPolicy;
  /** The last change to the defaults (null: never set). */
  updatedAt: string | null;
  updatedBy: string | null;
}

export const NO_DEFAULTS: WorkspaceDefaults = Object.freeze({ season: null, eventCode: null }) as WorkspaceDefaults;

export const SEASON_MIN = 2000, SEASON_MAX = 2100;
const EVENT_CODE = /^[A-Z0-9_-]{2,24}$/;

/** Personal (Tier 1) settings a workspace may never set: they're dropped from any workspace write. */
export const PERSONAL_ONLY = ["theme", "density", "ambient", "notify"] as const;

export interface DroppedSetting { field: string; reason: string }

/** One default season: an integer season in range, else unusable (undefined). Null clears it. */
function cleanSeason(v: unknown): number | null | undefined {
  if (v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= SEASON_MIN && n <= SEASON_MAX ? n : undefined;
}
/** One default event code: trimmed, upper-cased, FIRST's shape, else unusable (undefined). Null or "" clears it. */
function cleanEventCode(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim().toUpperCase();
  if (!t) return null;
  return EVENT_CODE.test(t) ? t : undefined;
}

/** Defaults as stored, read leniently: each field on its own (a bad one is null, the other kept). */
export function readDefaults(raw: unknown): WorkspaceDefaults {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return { season: cleanSeason(o.season) ?? null, eventCode: cleanEventCode(o.eventCode) ?? null };
}

/**
 * An admin's change, field by field, in the cleanValue spirit: a usable field is taken, a bad one is
 * dropped (and reported) while the rest are kept, unknown fields are dropped, and personal settings
 * (theme, density, notifications) are refused outright. `defaults` fields: absent keeps the current
 * value, null clears it. `entryPolicy` is fixed: anything sent for it is ignored (reported if it differs).
 */
export function cleanSettingsPatch(body: unknown): { defaults: Partial<WorkspaceDefaults>; dropped: DroppedSetting[] } {
  const dropped: DroppedSetting[] = [];
  const defaults: Partial<WorkspaceDefaults> = {};
  const o = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "baseVersion") continue;
    if (k === "defaults") {
      if (!v || typeof v !== "object" || Array.isArray(v)) { dropped.push({ field: "defaults", reason: "must be an object" }); continue; }
      for (const [f, fv] of Object.entries(v as Record<string, unknown>)) {
        if (f === "season") {
          const s = cleanSeason(fv);
          if (s === undefined) dropped.push({ field: "defaults.season", reason: `must be a season from ${SEASON_MIN} to ${SEASON_MAX}` });
          else defaults.season = s;
        } else if (f === "eventCode") {
          const c = cleanEventCode(fv);
          if (c === undefined) dropped.push({ field: "defaults.eventCode", reason: "must be an event code (2 to 24 letters, digits, - or _)" });
          else defaults.eventCode = c;
        } else dropped.push({ field: `defaults.${f}`, reason: "unknown field" });
      }
    } else if (k === "entryPolicy") {
      if (JSON.stringify(v) !== JSON.stringify(ENTRY_POLICY)) dropped.push({ field: "entryPolicy", reason: "fixed for now: members create and edit, authors or admins delete" });
    } else if ((PERSONAL_ONLY as readonly string[]).includes(k)) {
      dropped.push({ field: k, reason: "personal: each member sets their own" });
    } else dropped.push({ field: k, reason: "unknown field" });
  }
  return { defaults, dropped };
}

/** Personal view settings, the only thing that sets the individual's view (Tier 1 beats any workspace). */
export interface ViewSettings { theme: string; density: string; ambient: boolean; notify: Record<string, boolean> }

/**
 * Precedence, in code: inside a workspace's scout space the workspace gives the shared behaviour
 * (its defaults; the template comes from /template), and the person's own settings give the view.
 * Whatever a workspace object carries, the view is the personal one.
 */
export function scoutSpaceSettings<V extends ViewSettings>(personal: V, workspace: Pick<WorkspaceSettings, "defaults"> | null): { view: V; defaults: WorkspaceDefaults } {
  return { view: personal, defaults: workspace ? readDefaults(workspace.defaults) : NO_DEFAULTS };
}

/**
 * Tier 3: what the web app keeps on the device only (localStorage). Never part of a personal sync
 * (PUT /api/me/state, POST /api/me/migrate) or any other request; the queue's entries go up as
 * entries (that's their job), never the queue key itself. Prefixes end with ":".
 */
export const DEVICE_ONLY_KEYS = [
  "cs-scout-space", // the scout space last shown here (src/lib/scoutSpace.ts)
  "cs-shortlist-view", // list or grid (src/lib/shortlist.ts)
  "cs-scout-dirty", // Personal entries waiting to sync (src/lib/scouting.ts)
  "cs-scout-ws-dirty:", // a workspace's entries waiting to sync
  "cs-account-cache", // the signed-in account as /api/auth/me last answered, for opening offline (src/lib/personal.tsx)
  "cs-scout-lost:", // edits this device lost to newer ones, kept to restore (src/lib/lostEdits.ts)
  "cs-tour", // the first-run tour was finished or skipped here (src/lib/tour.ts)
  "cs-tour-demo", // automation opt-in that lets a driven browser see the tour (npm run shots -- --tour)
] as const;
