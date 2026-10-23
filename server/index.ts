// Control Scout server: API + (in production) the built web app, plus the
// background schedule — sync daily, every 15–60 min on event days (stats and
// the prediction ledger after every sync), and every minute for events that
// are on right now (the live fast lane).
import "./env.js";
import { env } from "./env.js";
import { migrate, all, openReplicaIfRemote } from "./db.js";
import { packsDir } from "./packs/routes.js";
import { backfillDue } from "./data/cycle.js";
import { childCycle, cycleRunning, runDataCycle } from "./data/jobs.js";
import { flushMetrics } from "./metrics.js";
import { startLiveSync } from "./data/live.js";
import { REFRESH_EVERY_MS, refreshCoinFlips } from "./api/coinFlips.js";
import express from "express";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { createApp } from "./app.js";
import { RELEASE } from "./release.js";
import { forecasterFor, refreshForecasters } from "./predict/engine.js";
import { CURRENT_SEASON } from "./data/seasons.js";
import { warmTrackRecord } from "./api/accuracy.js";
import { seasonCutoffs } from "./api/matchReport.js";
import { installShippedPacks, restoreSnapshotIfEmpty } from "./data/snapshot.js";
import { drainOnSigterm, systemdSocket } from "./listen.js";
import { closeAllStreams } from "./scout/stream.js";
import { closeInboxStreams } from "./inbox/routes.js";
import { closeProjectionStreams } from "./projections/routes.js";
import { startProjections } from "./projections/job.js";
import { deliverOwnerAlerts, inboxSettled, pruneInbox } from "./inbox/inbox.js";
import { photoSchedulerTick } from "./scout/photos.js";
import { pruneActivity } from "./scout/activityLog.js";
import { pruneSentLog, pushTick } from "./push/push.js";
import { autoPowerRankingsTick } from "./powerRankings/auto.js";
import { dailyRefreshTick } from "./powerRankings/refresh.js";
import { pingIndexNow } from "./indexNow.js";
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
process.once("SIGTERM", () => { closeAllStreams(); closeInboxStreams(); closeProjectionStreams(); });
// Queued inbox fan-outs (activity already written) finish before the process exits.
drainOnSigterm(() => http, log, 10_000, inboxSettled);
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
warmTrackRecord().then(() => log("track record ready")).catch((e) => log(`track record not ready: ${(e as Error).message}`))
  // Then the match report's flag cutoffs (two scans of a season) for this season and last, so a first report doesn't wait for them.
  .then(() => seasonCutoffs(CURRENT_SEASON)).then(() => seasonCutoffs(CURRENT_SEASON - 1)).catch(() => { /* built on the first report instead */ });
// After a sync (often in a child process) the data version moves: rebuild the
// ratings in use and the track record right away, in the background, so no
// visitor's request is the one that waits for them (pages keep the previous
// ones until they're done).
setInterval(() => { refreshForecasters().catch(() => {}).then(() => warmTrackRecord()).catch(() => {}); }, 15_000).unref();

// One cycle at a time in this process, whether the schedule or the owner portal started it (data/jobs.ts).
async function cycle(reason: string) {
  if (cycleRunning() || process.env.CS_NO_SCHEDULER) return;
  try {
    await runDataCycle(reason, log);
  } catch (e) {
    log(`sync failed: ${(e as Error).message}`);
  }
  indexNow();
}

// IndexNow (server/indexNow.ts): after each sync, soon after boot (a deploy), and hourly; at most one ping an
// hour whatever asks. Nothing at all unless INDEXNOW=1.
function indexNow() {
  if (!env.indexNowEnabled || process.env.CS_NO_SCHEDULER) return;
  void pingIndexNow().then((r) => log(`indexnow: ${r}`));
}

// Request metrics for the owner portal: the counters held in memory go to the database every minute.
setInterval(() => { flushMetrics().catch((e) => log(`metrics: ${(e as Error).message}`)); }, 60_000).unref();

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
// Entry photos (docs/r2-photos.md): every 15 min release uploads that never finished; once a day (after
// 08:00 UTC, one server only) expire photos of events that ended over 2 days ago, total the bucket and
// check the free-tier guardrails. Nothing without R2 configured; off with the rest of the schedule.
if (!process.env.CS_NO_SCHEDULER) {
  setInterval(() => { photoSchedulerTick(log).catch((e) => log(`photos: ${(e as Error).message}`)); }, 15 * 60_000).unref();
  // Workspace activity feeds keep 90 days (server/scout/activityLog.ts): a small indexed delete, every 6 hours, and once soon after boot.
  const prune = () => { pruneActivity().then((n) => { if (n) log(`activity: pruned ${n} items older than 90 days`); }).catch((e) => log(`activity: ${(e as Error).message}`)); };
  setTimeout(prune, 90_000).unref();
  setInterval(prune, 6 * 3600_000).unref();
  // The notification inbox keeps 90 days too (server/inbox/inbox.ts); owner alerts still waiting for an owner
  // account (none had signed up when the alert was raised) are delivered on the same beat.
  const pruneNotes = () => {
    pruneInbox().then((n) => { if (n) log(`inbox: pruned ${n} items older than 90 days`); }).catch((e) => log(`inbox: ${(e as Error).message}`));
    void deliverOwnerAlerts();
  };
  setTimeout(pruneNotes, 100_000).unref();
  setInterval(pruneNotes, 6 * 3600_000).unref();
  // Web push (server/push/push.ts, docs/push.md): every minute, match reminders 15 min ahead, upsets and event
  // starts for subscribed devices. Nothing at all without the VAPID settings or with the owner's push switch off.
  setInterval(() => { pushTick(Date.now(), log).catch((e) => log(`push: ${(e as Error).message}`)); }, 60_000).unref();
  setInterval(() => { pruneSentLog().catch((e) => log(`push: ${(e as Error).message}`)); }, 6 * 3600_000).unref();
  // Power rankings (server/powerRankings/auto.ts, docs/power-rankings.md): every Friday at 00:00 New York time a
  // top 25 from the live world ranking, blurbs by Bruno. Checked every 5 minutes, so a server that was down at
  // midnight catches up on its next tick (until the week ends); one week per season and week, never two.
  // Then the daily refresh (server/powerRankings/refresh.ts): the current week checked again once per New York
  // day from 00:00, catching up the same way; only its date moves when nothing shown changed.
  let prBusy = false;
  const powerRankings = () => {
    if (prBusy) return;
    prBusy = true;
    autoPowerRankingsTick(Date.now(), log).catch((e) => log(`power rankings: ${(e as Error).message}`))
      .then(() => dailyRefreshTick(Date.now(), log)).catch((e) => log(`power rankings refresh: ${(e as Error).message}`))
      .finally(() => { prBusy = false; });
  };
  setTimeout(powerRankings, 120_000).unref();
  setInterval(powerRankings, 5 * 60_000).unref();
  setTimeout(indexNow, 3 * 60_000).unref();
  setInterval(indexNow, 3600_000).unref();
  // The home page's coin-flip radar (server/api/coinFlips.ts): gathered again after every sync and live result,
  // and every 5 minutes here too, so a venue's own midnight and the matches the clock moves past show within minutes.
  let radarBusy = false;
  const radar = () => {
    if (radarBusy) return;
    radarBusy = true;
    void refreshCoinFlips(log).finally(() => { radarBusy = false; });
  };
  setTimeout(radar, 75_000).unref();
  setInterval(radar, REFRESH_EVERY_MS).unref();
}
// The live fast lane: events on today, every LIVE_SYNC_SECONDS (60), results within about a minute
// (server/data/live.ts). It shares a writer lease with the cycle above, so the two never write at once.
startLiveSync(log);
// Monte Carlo projections of live and upcoming events, re-run when their results move (server/projections/job.ts).
startProjections(log);
// First cycle shortly after boot (not at boot: let the server answer first).
setTimeout(() => { last = Date.now(); cycle("startup"); }, 60_000).unref();
