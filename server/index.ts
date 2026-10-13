// Control Scout server: API + (in production) the built web app, plus the
// background schedule — sync daily, hourly while events are running; stats
// and the prediction ledger after every sync.
import "./env.js";
import { env, hasFirst } from "./env.js";
import { migrate, all, kvGet, kvSet } from "./db.js";
import { buildPacks } from "./packs/build.js";
import { packsPresent } from "./packs/routes.js";
import { createApp } from "./app.js";
import { syncAll } from "./sync.js";
import { runStats } from "./stats/job.js";
import { forecasterFor } from "./predict/engine.js";
import { CURRENT_SEASON } from "./data/seasons.js";
import { restoreSnapshotIfEmpty } from "./data/snapshot.js";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

// A fresh server with an empty local database starts from the shipped public
// snapshot (before anything opens the database file).
log(`data: ${await restoreSnapshotIfEmpty().catch((e) => `snapshot restore failed: ${(e as Error).message}`)}`);
await migrate();
const app = createApp();
app.listen(env.port, () => log(`Control Scout API on :${env.port}${env.production ? "" : " (dev)"}`));

// Warm the current season's ratings so the first prediction is fast.
forecasterFor(CURRENT_SEASON).then(() => log("ratings ready")).catch((e) => log(`ratings not ready: ${(e as Error).message}`));

let running = false;
async function cycle(reason: string) {
  if (running || process.env.CS_NO_SCHEDULER) return;
  running = true;
  try {
    log(`sync (${reason})`);
    if (hasFirst()) await syncAll({ seasons: [CURRENT_SEASON], log: (m) => log(`  ${m}`) });
    else log("  FIRST credentials missing — sync skipped (FTC Scout fallback runs per event only)");
    await runStats({ seasons: [CURRENT_SEASON], log: (m) => log(`  ${m}`) });
    // Offline packs: rebuilt at most daily (they're versioned; devices see "new data available").
    // The timestamp alone isn't enough: an imported database carries
    // packs:last without the pack files, so also require a readable manifest.
    // CS_PACKS=off: hosts with a throwaway disk (Render free) skip packs; /download says none are built.
    const lastPacks = await kvGet<string>("packs:last");
    if (process.env.CS_PACKS !== "off" && (!lastPacks || Date.now() - Date.parse(lastPacks) > 23 * 3600_000 || !packsPresent())) {
      try {
        await buildPacks((m) => log(`  ${m}`));
        await kvSet("packs:last", new Date().toISOString());
      } catch (e) { log(`  packs: ${(e as Error).message}`); } // e.g. a manual build holds the lock
    }
  } catch (e) {
    log(`sync failed: ${(e as Error).message}`);
  } finally { running = false; }
}

/** Hourly on event days (any event running today ±1 day), otherwise daily. */
async function eventDay(): Promise<boolean> {
  const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const r = await all("SELECT 1 FROM events WHERE season = ? AND start <= ? AND COALESCE(end, start) >= ? AND type NOT IN ('Kickoff','Workshop','DemoExhibition') LIMIT 1", [CURRENT_SEASON, d(1), d(-1)]);
  return r.length > 0;
}

let last = 0;
setInterval(async () => {
  const gap = (await eventDay().catch(() => false)) ? 3600_000 : 24 * 3600_000;
  if (Date.now() - last >= gap) { last = Date.now(); cycle(gap < 864e5 ? "hourly, event day" : "daily"); }
}, 5 * 60_000).unref();
// First cycle shortly after boot (not at boot: let the server answer first).
setTimeout(() => { last = Date.now(); cycle("startup"); }, 60_000).unref();
