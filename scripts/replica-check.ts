// Check the Turso embedded replica before deploying it: open a fresh replica
// in a temp folder, time the first sync, then time the queries an event page
// makes, read locally. Uses DATABASE_URL + DATABASE_AUTH_TOKEN from the
// environment (never printed). Fails unless a replica really synced; always
// deletes its temp copy.
//
//   npm run replica:check
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "cs-replica-"));
process.env.DATA_DIR = dir;
process.env.CS_SKIP_DOTENV = "1";
delete process.env.DATABASE_REPLICA; // this check is about the replica
let ok = false;
let close: (() => void) | null = null;
try {
  const { env } = await import("../server/env.js");
  if (!/^(libsql|https?):\/\//.test(env.databaseUrl)) throw new Error("Set DATABASE_URL to the Turso libsql:// URL (and DATABASE_AUTH_TOKEN).");
  const { openReplicaIfRemote, db, migrate, all } = await import("../server/db.js");
  close = () => db().close();
  const mode = await openReplicaIfRemote((m) => console.log(m));
  if (mode !== "replica") throw new Error(`no replica (mode: ${mode}); see the line above`);
  await migrate();
  const t = async (label: string, f: () => Promise<unknown>) => { const t0 = Date.now(); await f(); console.log(`  ${label}: ${Date.now() - t0} ms`); };
  await t("count teams", () => all("SELECT COUNT(*) FROM teams"));
  await t("season 2025 matches", () => all("SELECT * FROM matches WHERE season = 2025"));
  const { matchViews } = await import("../server/api/matches.js");
  await t("event page matches (AUBRQ2, with predictions)", () => matchViews({ season: 2025, code: "AUBRQ2" }, { predictUnplayed: true }));
  await t("event page matches again (warm)", () => matchViews({ season: 2025, code: "AUBRQ2" }, { predictUnplayed: true }));
  const { search } = await import("../server/api/search.js");
  await t("search 4215", () => search("4215", 5));
  ok = true;
  console.log("OK: replica synced and served every query locally");
} catch (e) {
  console.error(`FAILED: ${(e as Error).message}`);
} finally {
  try { close?.(); } catch { /* ignore */ }
  // Windows can hold the just-closed database file for a moment: retry briefly.
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { console.error(`could not remove ${dir}: ${(e as Error).message}`); }
}
process.exit(ok ? 0 : 1);
