// Control Scout server: API + (in production) the built web app, plus the
// background schedule — sync daily, every 15–60 min on event days (stats and
// the prediction ledger after every sync), and every minute for events that
// are on right now (the live fast lane).
import "./env.js";
import { env } from "./env.js";
import { migrate, all, isRemote, openReplicaIfRemote } from "./db.js";
import { packsDir } from "./packs/routes.js";
import { backfillDue, runCycle, runCycleInChild } from "./data/cycle.js";
import { startLiveSync } from "./data/live.js";
import express from "express";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { createApp } from "./app.js";
import { RELEASE } from "./release.js";
import { forecasterFor, refreshForecasters } from "./predict/engine.js";
import { CURRENT_SEASON } from "./data/seasons.js";
import { warmTrackRecord } from "./api/accuracy.js";
import { installShippedPacks, restoreSnapshotIfEmpty } from "./data/snapshot.js";
import { drainOnSigterm, systemdSocket } from "./listen.js";
import { closeAllStreams } from "./scout/stream.js";
import type { Server } from "node:http";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

// Open the port first (hosts like Render restart a service that doesn't bind
// quickly), then prepare the data: restore the shipped snapshot into an empty
// local database (before anything opens that file) and run migrations. Until
// then the app's pages load and its API answers 503 "starting up".
// On the VM systemd already holds the port open (server/listen.ts), so the
// server takes it only once it's ready: requests during a deploy's restart
// wait a few seconds in the socket's queue instead of getting a 502 or 503.
const socket = systemdSocket();
for (const k of ["LISTEN_FDS", "LISTEN_PID", "LISTEN_FDNAMES"]) delete process.env[k]; // not for child processes
let http: Server | null = null;
// Live scout streams end first, so their connections don't hold the drain (clients reconnect to the next server).
process.once("SIGTERM", closeAllStreams);
drainOnSigterm(() => http, log);
let ready = false;
const server = express();
server.get("/api/health", (_req, res) => res.json({ ok: true, engine: ENGINE_VERSION, release: RELEASE, ready }));
server.use("/api", (_req, res, next) => {
  if (ready) return next();
  res.setHeader("Retry-After", "15");
  res.setHeader("Cache-Control", "no-store"); // never cache "starting up"
  res.status(503).json({ error: "Control Scout is starting up. Try again in a few seconds." });
});
const app = createApp();
server.use(app);
const listening = (where: string) => () => log(`Control Scout listening on ${where}${env.production ? "" : " (dev)"}`);
if (!socket) http = server.listen(env.port, listening(`:${env.port}`));
log(`data: ${await restoreSnapshotIfEmpty().catch((e) => `snapshot restore failed: ${(e as Error).message}`)}`);
log(`packs: ${(() => { try { return installShippedPacks(packsDir()); } catch (e) { return `shipped packs failed: ${(e as Error).message}`; } })()}`);
await openReplicaIfRemote(log);
await migrate();
ready = true;
if (socket) http = server.listen(socket, listening("the systemd socket"));
log("ready");

// Warm the current season's ratings so the first prediction is fast.
forecasterFor(CURRENT_SEASON).then(() => log("ratings ready")).catch((e) => log(`ratings not ready: ${(e as Error).message}`));
// And the track record (every scored prediction: about a second and a half cold).
warmTrackRecord().then(() => log("track record ready")).catch((e) => log(`track record not ready: ${(e as Error).message}`));
// After a sync (often in a child process) the data version moves: rebuild the
// ratings in use and the track record right away, in the background, so no
// visitor's request is the one that waits for them (pages keep the previous
// ones until they're done).
setInterval(() => { refreshForecasters().catch(() => {}).then(() => warmTrackRecord()).catch(() => {}); }, 15_000).unref();

/** The data cycle runs in a child process (DATA_CYCLE=child), which needs a local database file. */
function childCycle(): boolean { return process.env.DATA_CYCLE === "child" && !isRemote(env.databaseUrl); }

let running = false;
async function cycle(reason: string) {
  if (running || process.env.CS_NO_SCHEDULER) return;
  running = true;
  try {
    // A child needs the local file; with a remote database (or its embedded replica) the cycle stays here.
    const child = childCycle();
    log(`sync (${reason}${child ? ", in a child process" : ""})`);
    if (child) await runCycleInChild(); else await runCycle(log);
  } catch (e) {
    log(`sync failed: ${(e as Error).message}`);
  } finally { running = false; }
}

/** Is any event running today ±1 day? (event days sync often; other days daily) */
async function eventDay(): Promise<boolean> {
  const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const r = await all("SELECT 1 FROM events WHERE season = ? AND start <= ? AND COALESCE(end, start) >= ? AND type NOT IN ('Kickoff','Workshop','DemoExhibition') LIMIT 1", [CURRENT_SEASON, d(1), d(-1)]);
  return r.length > 0;
}

// On event days, sync often enough that a freshly published schedule gets its
// pre-match (live) predictions logged before the first matches start: every
// 15 min where the cycle runs in a child process (the VM), hourly where it
// runs in the server process (Render's 0.15 CPU would stall pages).
// EVENT_DAY_SYNC_MINUTES overrides either.
// The same test cycle() uses: the child process needs a local database file.
const configuredMinutes = Number(process.env.EVENT_DAY_SYNC_MINUTES);
const eventDayMinutes = Number.isFinite(configuredMinutes) && configuredMinutes >= 1 ? configuredMinutes : (childCycle() ? 15 : 60);
let last = 0;
setInterval(async () => {
  const gap = (await eventDay().catch(() => false)) ? eventDayMinutes * 60_000 : 24 * 3600_000;
  if (Date.now() - last >= gap) { last = Date.now(); cycle(gap < 864e5 ? `every ${eventDayMinutes} min, event day` : "daily"); }
  // 2019–2022 not fetched yet: back-to-back cycles through the quiet hours (one season each) until done,
  // whenever the server happened to start and whatever the regular schedule.
  else if (await backfillDue().catch(() => false)) cycle("backfill");
}, Math.min(5, eventDayMinutes) * 60_000).unref();
// The live fast lane: events on today, every LIVE_SYNC_SECONDS (60), results within about a minute
// (server/data/live.ts). It shares a writer lease with the cycle above, so the two never write at once.
startLiveSync(log);
// First cycle shortly after boot (not at boot: let the server answer first).
setTimeout(() => { last = Date.now(); cycle("startup"); }, 60_000).unref();
