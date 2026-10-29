// The owner console's Overview, its landing tab: the site's health first (up, last data sync, the
// engine in production, the live ledger's headline, the pack manifest, recent errors), then accounts,
// Control Point links, workspaces, scout entries, storage and what's waiting in the inboxes. Read-only.
//
// Workspaces and their shared entries arrive with workspace scouting: until those tables exist
// on this database their counts are null (shown as "—"), never a made-up zero.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { all, get, kvGet } from "../db.js";
import { RELEASE } from "../release.js";
import { CP_PROVIDER } from "../auth/controlPoint.js";
import { lockHolder } from "../data/lock.js";
import { localDbPath } from "../data/snapshot.js";
import { packsDir } from "../packs/routes.js";
import type { Manifest } from "../packs/build.js";
import { trackRecord } from "../api/accuracy.js";
import type { OwnerOverview } from "../../src/shared/owner.js";

const STARTED_AT = new Date();

const count = async (sql: string, args: (string | number)[] = []) => Number((await get<{ n: number }>(sql, args))?.n ?? 0);

/** Tables present in this database (optional features check before reading theirs). */
export async function tablesPresent(): Promise<Set<string>> {
  return new Set((await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => String(r.name)));
}

/** Bytes the database takes: its pages, plus the write-ahead log for a local file. */
async function databaseBytes(): Promise<number | null> {
  try {
    const pages = await get<{ page_count: number }>("PRAGMA page_count");
    const size = await get<{ page_size: number }>("PRAGMA page_size");
    let bytes = Number(pages?.page_count ?? 0) * Number(size?.page_size ?? 0);
    const file = localDbPath();
    if (file && existsSync(`${file}-wal`)) bytes += statSync(`${file}-wal`).size;
    return bytes || null;
  } catch { return null; }
}

/** The offline packs directory: total bytes and pack files (null when none was ever built here). */
function packsUsage(): { bytes: number | null; files: number } {
  try {
    const dir = packsDir();
    if (!existsSync(dir)) return { bytes: null, files: 0 };
    let bytes = 0, files = 0;
    for (const f of readdirSync(dir)) {
      const s = statSync(join(dir, f));
      if (!s.isFile()) continue;
      bytes += s.size;
      if (f.startsWith("scout-pack-")) files++;
    }
    return { bytes, files };
  } catch { return { bytes: null, files: 0 }; }
}

/** The pack manifest the app polls (latest.json), as the console shows it; null when none was built here. */
function packManifest(): OwnerOverview["health"]["packManifest"] {
  try {
    const m = JSON.parse(readFileSync(join(packsDir(), "latest.json"), "utf8")) as Manifest;
    return { version: m.version, builtAt: m.builtAt, dataAsOf: m.dataAsOf ?? null, engineVersion: m.engineVersion };
  } catch { return null; }
}

/** The live ledger's headline (the public track record's), or null while it can't be built. Never waits long:
 *  the first build after a start takes a second or two, and the overview shouldn't. */
async function ledgerHeadline(): Promise<OwnerOverview["health"]["ledger"]> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500).unref?.());
  const tr = await Promise.race([trackRecord().catch(() => null), timeout]);
  return tr?.headline ?? null;
}

/** Error reports seen, and server errors (5xx) answered, over the last day and week. */
async function recentErrors(now: number): Promise<OwnerOverview["health"]["errors"]> {
  const since = (days: number) => new Date(now - days * 864e5).toISOString();
  const day = (days: number) => new Date(now - days * 864e5).toISOString().slice(0, 10);
  const [r1, r7, s1, s7] = await Promise.all([
    count("SELECT COUNT(*) n FROM error_reports WHERE last_seen >= ?", [since(1)]),
    count("SELECT COUNT(*) n FROM error_reports WHERE last_seen >= ?", [since(7)]),
    // Per UTC day: "today" is today's UTC day so far, "this week" the last seven days including it.
    count("SELECT COALESCE(SUM(errors), 0) n FROM request_metrics_daily WHERE day >= ?", [day(0)]),
    count("SELECT COALESCE(SUM(errors), 0) n FROM request_metrics_daily WHERE day >= ?", [day(6)]),
  ]);
  return { reports24h: r1, reports7d: r7, server5xxToday: s1, server5xx7d: s7 };
}

export async function ownerOverview(now = Date.now()): Promise<OwnerOverview> {
  const tables = await tablesPresent();
  const since = (days: number) => new Date(now - days * 864e5).toISOString();
  const [total, active30d, new7d, linked] = await Promise.all([
    count("SELECT COUNT(*) n FROM users"),
    count("SELECT COUNT(*) n FROM users WHERE last_seen >= ?", [since(30)]),
    count("SELECT COUNT(*) n FROM users WHERE created_at >= ?", [since(7)]),
    count("SELECT COUNT(DISTINCT user_id) n FROM identities WHERE provider = ?", [CP_PROVIDER]),
  ]);
  const personal = await count("SELECT COUNT(*) n FROM scout_entries WHERE deleted = 0");
  const workspaces = tables.has("workspaces") ? await count("SELECT COUNT(*) n FROM workspaces") : null;
  const orphanedWorkspaces = tables.has("workspaces") && tables.has("workspace_former_members") ? await count("SELECT COUNT(*) n FROM workspaces WHERE orphaned_at IS NOT NULL") : null;
  const workspaceEntries = tables.has("workspace_scout_entries") ? await count("SELECT COUNT(*) n FROM workspace_scout_entries WHERE deleted = 0") : null;
  const [openFeedback, errorReports, unfiledErrors] = await Promise.all([
    count("SELECT COUNT(*) n FROM contact_messages WHERE status = 'open'"),
    count("SELECT COUNT(*) n FROM error_reports"),
    count("SELECT COUNT(*) n FROM error_reports WHERE issue_number IS NULL"),
  ]);
  const [sync, stats, records, packsAt, writer] = await Promise.all([
    kvGet<{ at: string }>("sync:last"), kvGet<{ at: string }>("stats:last"), kvGet<{ at: string }>("records:last"),
    kvGet<string>("packs:last"), lockHolder(),
  ]);
  const statsAt = [stats?.at, records?.at].filter((x): x is string => !!x).sort().pop() ?? null;
  const packs = packsUsage();
  const [ledger, errors] = await Promise.all([ledgerHeadline(), recentErrors(now)]);
  return {
    accounts: { total, active30d, new7d },
    controlPointLinked: linked,
    workspaces,
    orphanedWorkspaces,
    scoutEntries: { personal, workspace: workspaceEntries },
    storage: { databaseBytes: await databaseBytes(), databaseLocal: !!localDbPath(), packsBytes: packs.bytes, packFiles: packs.files },
    inbox: { openFeedback, errorReports, unfiledErrors },
    health: {
      release: RELEASE, engineVersion: ENGINE_VERSION, startedAt: STARTED_AT.toISOString(), uptimeSeconds: Math.round((now - STARTED_AT.getTime()) / 1000),
      dataAsOf: sync?.at ?? null, statsAt, packsAt: packsAt ?? null,
      writer: writer ? { what: writer.what, until: new Date(writer.until).toISOString() } : null,
      ledger, packManifest: packManifest(), errors,
    },
  };
}
