// Seed history from a local FTC Scout raw cache (eventByCode responses, the
// layout Control Point's research store uses: <dir>/<season>/<CODE>.json).
// Real data, imported as source "ftc-scout"; events already fetched from
// FIRST are left alone. FIRST then upgrades them on `npm run sync -- --upgrade-scout`.
//
//   npm run seed:scout -- <dir> [seasons…]
import "../server/env.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { all, migrate, writeBatch } from "../server/db.js";
import { bundleStatements } from "../server/data/bundle.js";
import { ensureSeasons } from "../server/sync.js";
import { bundleFromScout } from "../server/sources/ftcScout.js";

const dirs = [process.argv[2], process.env.SCOUT_CACHE_DIR, "C:/Users/mksus/StudioProjects/control-point/.data/predict/scout", "C:/Users/mksus/StudioProjects/control-point/.cache/predict/scout"].filter(Boolean) as string[];
const seasons = process.argv.slice(3).map(Number).filter(Boolean);
await migrate();
await ensureSeasons();
for (const season of seasons.length ? seasons : [2023, 2024, 2025]) {
  // Prefer the newest layout (with team names) when several caches have the season.
  const dir = dirs.map((d) => join(d, String(season))).find((d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith(".json") && !f.startsWith("_")));
  if (!dir) { console.log(`${season}: no cache found`); continue; }
  const fromFirst = new Set((await all<{ code: string }>("SELECT code FROM events WHERE season = ? AND source = 'first' AND detail_synced_at IS NOT NULL", [season])).map((r) => r.code));
  let n = 0, skipped = 0, stmts: any[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    const b = bundleFromScout(JSON.parse(readFileSync(join(dir, f), "utf8")), season);
    if (!b) continue;
    if (fromFirst.has(b.event.code)) { skipped++; continue; }
    stmts.push(...bundleStatements(b));
    n++;
    if (stmts.length > 20000) { await writeBatch(stmts); stmts = []; }
  }
  await writeBatch(stmts);
  console.log(`${season}: imported ${n} events from ${dir} (${skipped} already from FIRST)`);
}
