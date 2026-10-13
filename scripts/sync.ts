// Sync data from FIRST (primary) / FTC Scout (fallback) into the database.
//
//   npm run sync                       all seasons (current first; frozen ones skipped)
//   npm run sync -- --season 2025      one season
//   npm run sync -- --upgrade-scout    re-fetch FTC-Scout-seeded events from FIRST
//   npm run sync -- --limit 20         at most 20 event fetches per season
//   npm run sync -- --event 2025:USNJQ1  one event
import "../server/env.js";
import { migrate } from "../server/db.js";
import { ensureSeasons, syncAll, syncEvent } from "../server/sync.js";
import { firstEvents, firstStats, setFirstConcurrency } from "../server/sources/first.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? undefined : process.argv[i + 1]; };
const flag = (n: string) => process.argv.includes(`--${n}`);
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

await migrate();
await ensureSeasons();
const t0 = Date.now();
const one = arg("event");
if (one) {
  const [season, code] = one.split(":");
  const meta = (await firstEvents(Number(season))).find((e) => e.code === code);
  if (!meta) throw new Error(`event ${one} not found in FIRST's list`);
  log(`${one}: ${await syncEvent(meta, log)}`);
} else {
  const conc = Number(arg("concurrency") ?? 4);
  setFirstConcurrency(conc * 3);
  const reports = await syncAll({
    seasons: arg("season") ? [Number(arg("season"))] : undefined,
    force: flag("force"), upgradeScout: flag("upgrade-scout"), skipTeams: flag("skip-teams"),
    limit: arg("limit") ? Number(arg("limit")) : undefined, concurrency: conc, log,
  });
  for (const r of reports) {
    log(`${r.season}: listed ${r.listed}, fetched ${r.detailed} (${r.fallback} via FTC Scout), failed ${r.failed.length}`);
    for (const f of r.failed.slice(0, 5)) log(`   ✗ ${f.code}: ${f.error}`);
  }
}
log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s · FIRST requests ${firstStats.requests}, retries ${firstStats.retries}, 404 ${firstStats.notFound}`);
