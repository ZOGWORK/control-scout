// Control Scout server: API + (in production) the built web app, plus the
// background schedule — sync daily, every 15–60 min on event days (stats and
// the prediction ledger after every sync), and every minute for events that
// are on right now (the live fast lane).
import { sweepBugReports } from "./bugReports.js";
import { backfillVideoMeta } from "./videos/recordings.js";
import { resolveStreamLinks } from "./videos/streamLinks.js";
import { resolveChannelStreams } from "./videos/channelStreams.js";
import "./env.js";
import { env } from "./env.js";
import { migrate, all, openReplicaIfRemote } from "./db.js";
import { packsDir } from "./packs/routes.js";
import { backfillDue } from "./data/cycle.js";
import { childCycle, cycleRunning, runDataCycle } from "./data/jobs.js";
import { flushMetrics } from "./metrics.js";
import { flushSearchFailures, startSearchFailureJobs } from "./searchFailures.js";
import { flushAbuse } from "./moderation.js";
import { startLiveSync } from "./data/live.js";
import { REFRESH_EVERY_MS, refreshCoinFlips } from "./api/coinFlips.js";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { createApp, createServer } from "./app.js";
import { RELEASE } from "./release.js";
import { forecasterFor, refreshForecasters } from "./predict/engine.js";
import { CURRENT_SEASON } from "./data/seasons.js";
import { warmTrackRecord } from "./api/accuracy.js";
import { warmSpelling } from "./api/spelling.js";
import { ensureSearchIndex, warmTypoIndex } from "./api/search.js";
import { rebuildSearch } from "./stats/job.js";
import { scheduleCycles, warmUp } from "./warm.js";
import { names as warmNames } from "./api/query/names.js";
import { warmPageRenderer } from "./firstPaint.js";
import { refreshSearchSeason } from "./api/answers/season.js";
import { seasonCutoffs } from "./api/matchReport.js";
import { installShippedPacks, restoreSnapshotIfEmpty } from "./data/snapshot.js";
import { drainOnSigterm, systemdSocket } from "./listen.js";
import { closeAllStreams } from "./scout/stream.js";
import { closeInboxStreams } from "./inbox/routes.js";
import { closeProjectionStreams } from "./projections/routes.js";
import { startProjections } from "./projections/job.js";
import { deliverOwnerAlerts, inboxSettled, pruneInbox } from "./inbox/inbox.js";
import { settleAlliances } from "./scout/alliances.js";
import { photoSchedulerTick } from "./scout/photos.js";
import { pruneActivity } from "./scout/activityLog.js";
import { pruneSentLog, pushTick } from "./push/push.js";
import { digestTick } from "./digest/job.js";
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
// On the way out, failed searches still in memory (settling or buffered) are written to the table too.
drainOnSigterm(() => http, log, 10_000, () => Promise.all([inboxSettled(), flushSearchFailures(Date.now(), true).catch(() => 0)]));
let ready = false;
// Every warm-up step done (server/warm.ts): `ready` waits for them only up to WARM_CAP_MS; this says when the rest are.
let warm = false;
const app = createApp();
const server = createServer(app, () => ({ ok: true, engine: ENGINE_VERSION, release: RELEASE, ready, warm }), () => ready);
const listening = (where: string) => () => log(`Control Scout listening on ${where}${env.production ? "" : " (dev)"}`);
if (!socket) http = server.listen(env.port, listening(`:${env.port}`));
log(`data: ${await restoreSnapshotIfEmpty().catch((e) => `snapshot restore failed: ${(e as Error).message}`)}`);
log(`packs: ${(() => { try { return installShippedPacks(packsDir()); } catch (e) { return `shipped packs failed: ${(e as Error).message}`; } })()}`);
await openReplicaIfRemote(log);
await migrate();

// Warm before answering (server/warm.ts): built on a cold process while a deploy's queued requests poured in, these
// held its event loop for minutes. Search's index first when the code that builds it changed (SEARCH_INDEX_SCHEMA):
// rebuilt here, once, not on a visitor's search; its names and typo index after it, since a rebuild resets them.
const indexed = ensureSearchIndex(rebuildSearch);
const afterIndex = () => indexed.catch(() => { /* its own step says it failed */ });
// The current season's ratings, so the first prediction is fast: in the background, never held for (about 20 s cold,
// and only predictions need them; held for, every queued search would wait on them).
// Then the season a search with none named reads (the latest completed one, server/api/answers/season.ts): its
// predictions ("4215 vs 7149 who wins") otherwise built the whole season on a visitor's request, 10–20 s cold.
const rated = warmUp([["ratings", () => forecasterFor(CURRENT_SEASON).then(() => refreshSearchSeason()).then((s) => (s !== CURRENT_SEASON ? forecasterFor(s) : null))]], log, Infinity, Date.now, "warm (background)");
const warming = await warmUp([
  // The track record (every scored prediction: about a second and a half cold), then the match report's flag
  // cutoffs (two scans of a season) for this season and last.
  ["track record and report cutoffs", () => warmTrackRecord().then(() => seasonCutoffs(CURRENT_SEASON)).then(() => seasonCutoffs(CURRENT_SEASON - 1))],
  ["search index", () => indexed],
  // Search's spelling vocabulary (every team, event and place word: about a second cold), then its typo index (every
  // name's words, numbered: about a second cold), and the names it reads queries with.
  ["spelling and typo index", () => afterIndex().then(() => warmSpelling()).then(() => warmTypoIndex())],
  ["search names", () => afterIndex().then(() => warmNames())],
  // The server-side page render (server/firstPaint.ts): its bundle compiled before the first team or event page asks.
  ["page renderer", () => warmPageRenderer()],
], log);
void Promise.all([warming.settled, rated.then((r) => r.settled)]).then(() => { warm = true; });
ready = true;
if (socket) http = server.listen(socket, listening("the systemd socket"));
log("ready");
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
setInterval(() => {
  flushMetrics().catch((e) => log(`metrics: ${(e as Error).message}`));
  flushAbuse().catch((e) => log(`moderation: ${(e as Error).message}`));
  flushSearchFailures().catch((e) => log(`search-failures: ${(e as Error).message}`));
}, 60_000).unref();

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
// The first cycle STARTUP_CYCLE_MS after boot, then the regular schedule, which never starts one before it
// (server/warm.ts scheduleCycles).
scheduleCycles({ cycle, eventDay, backfillDue, eventDayMinutes });
// Entry photos (docs/r2-photos.md): every 15 min release uploads that never finished; once a day (after
// 08:00 UTC, one server only) expire photos of events that ended over 2 days ago, total the bucket and
// check the free-tier guardrails. Nothing without R2 configured; off with the rest of the schedule.
if (!process.env.CS_NO_SCHEDULER) {
  // Bug reports: email what's due and unsent (a failed or interrupted send), clear abandoned uploads, every 10 minutes (server/bugReports.ts).
  setInterval(() => { sweepBugReports().catch((e) => log(`bug reports: sweep failed: ${(e as Error)?.message ?? e}`)); }, 10 * 60_000).unref();
  // Failed searches → GitHub issues, every 10 minutes (server/searchFailures.ts).
  startSearchFailureJobs(log);
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
  // Scouting alliances (docs/alliances.md): links whose event is over end (and make the copies both sides agreed to), hourly.
  const settleLinks = () => { settleAlliances().then((n) => { if (n) log(`alliances: ended ${n}`); }).catch((e) => log(`alliances: ${(e as Error).message}`)); };
  setTimeout(settleLinks, 110_000).unref();
  setInterval(settleLinks, 3600_000).unref();
  // Web push (server/push/push.ts, docs/push.md): every minute, match reminders 15 min ahead, upsets and event
  // starts for subscribed devices. Nothing at all without the VAPID settings or with the owner's push switch off.
  setInterval(() => { pushTick(Date.now(), log).catch((e) => log(`push: ${(e as Error).message}`)); }, 60_000).unref();
  setInterval(() => { pruneSentLog().catch((e) => log(`push: ${(e as Error).message}`)); }, 6 * 3600_000).unref();
  // The email digest: three times a week at random times (server/digest/schedule.ts, docs/digest.md). Checked every 5 minutes.
  setInterval(() => { digestTick(Date.now(), log).catch((e) => log(`digest: ${(e as Error).message}`)); }, 5 * 60_000).unref();
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
  // Event recordings (server/videos/recordings.ts): YouTube's timing for each linked video, so matches link to their
  // second in it. New links soon after boot and every 5 minutes (a live broadcast is read again on that beat). Short
  // stream links of events on now are followed first (server/videos/streamLinks.ts), so the video they lead to is read too.
  const recordings = () => {
    resolveStreamLinks(log).catch((e) => log(`recordings: ${(e as Error).message}`))
      .then(() => resolveChannelStreams(log)).catch((e) => log(`recordings: ${(e as Error).message}`))
      .then(() => backfillVideoMeta(log)).catch((e) => log(`recordings: ${(e as Error).message}`));
  };
  setTimeout(recordings, 150_000).unref();
  setInterval(recordings, 5 * 60_000).unref();
}
// The live fast lane: events on today, every LIVE_SYNC_SECONDS (60), results within about a minute
// (server/data/live.ts). It shares a writer lease with the cycle above, so the two never write at once.
startLiveSync(log);
// Monte Carlo projections of live and upcoming events, re-run when their results move (server/projections/job.ts).
startProjections(log);

