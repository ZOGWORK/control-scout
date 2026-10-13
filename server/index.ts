// Control Scout server: API + (in production) the built web app, plus the
// background schedule — sync daily, hourly while events are running; stats
// and the prediction ledger after every sync.
import "./env.js";
import { env } from "./env.js";
import { migrate, all, isRemote, openReplicaIfRemote } from "./db.js";
import { packsDir } from "./packs/routes.js";
import { runCycle, runCycleInChild } from "./data/cycle.js";
import express from "express";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { createApp } from "./app.js";
import { forecasterFor } from "./predict/engine.js";
import { CURRENT_SEASON } from "./data/seasons.js";
import { installShippedPacks, restoreSnapshotIfEmpty } from "./data/snapshot.js";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

// Open the port first (hosts like Render restart a service that doesn't bind
// quickly), then prepare the data: restore the shipped snapshot into an empty
// local database (before anything opens that file) and run migrations. Until
// then the app's pages load and its API answers 503 "starting up".
let ready = false;
const server = express();
server.get("/api/health", (_req, res) => res.json({ ok: true, engine: ENGINE_VERSION, ready }));
server.use("/api", (_req, res, next) => {
  if (ready) return next();
  res.setHeader("Retry-After", "15");
  res.status(503).json({ error: "Control Scout is starting up. Try again in a few seconds." });
});
const app = createApp();
server.use(app);
server.listen(env.port, () => log(`Control Scout listening on :${env.port}${env.production ? "" : " (dev)"}`));
log(`data: ${await restoreSnapshotIfEmpty().catch((e) => `snapshot restore failed: ${(e as Error).message}`)}`);
log(`packs: ${(() => { try { return installShippedPacks(packsDir()); } catch (e) { return `shipped packs failed: ${(e as Error).message}`; } })()}`);
await openReplicaIfRemote(log);
await migrate();
ready = true;
log("ready");

// Warm the current season's ratings so the first prediction is fast.
forecasterFor(CURRENT_SEASON).then(() => log("ratings ready")).catch((e) => log(`ratings not ready: ${(e as Error).message}`));

let running = false;
async function cycle(reason: string) {
  if (running || process.env.CS_NO_SCHEDULER) return;
  running = true;
  try {
    // A child needs the local file; with a remote database (or its embedded replica) the cycle stays here.
    const child = process.env.DATA_CYCLE === "child" && !isRemote(env.databaseUrl);
    log(`sync (${reason}${child ? ", in a child process" : ""})`);
    if (child) await runCycleInChild(); else await runCycle(log);
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
