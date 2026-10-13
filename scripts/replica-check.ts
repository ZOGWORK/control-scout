// Check the Turso embedded replica before deploying it: open a fresh replica
// in a temp folder, time the first sync, then time the queries an event page
// makes, read locally. Uses DATABASE_URL + DATABASE_AUTH_TOKEN from the
// environment (never printed).
//
//   npm run replica:check
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cs-replica-"));
process.env.CS_SKIP_DOTENV = "1";
const { env } = await import("../server/env.js");
if (!/^(libsql|https?):\/\//.test(env.databaseUrl)) { console.error("Set DATABASE_URL to the Turso libsql:// URL (and DATABASE_AUTH_TOKEN)."); process.exit(1); }
const { openReplicaIfRemote, db, migrate, all } = await import("../server/db.js");

await openReplicaIfRemote((m) => console.log(m));
await migrate();
const t = async (label: string, f: () => Promise<unknown>) => { const t0 = Date.now(); await f(); console.log(`  ${label}: ${Date.now() - t0} ms`); };
await t("count teams", () => all("SELECT COUNT(*) FROM teams"));
await t("season 2025 matches", () => all("SELECT * FROM matches WHERE season = 2025"));
const { matchViews } = await import("../server/api/matches.js");
await t("event page matches (AUBRQ2, with predictions)", () => matchViews({ season: 2025, code: "AUBRQ2" }, { predictUnplayed: true }));
await t("event page matches again (warm)", () => matchViews({ season: 2025, code: "AUBRQ2" }, { predictUnplayed: true }));
const { search } = await import("../server/api/search.js");
await t("search 4215", () => search("4215", 5));
console.log("OK");
db().close();
process.exit(0);
