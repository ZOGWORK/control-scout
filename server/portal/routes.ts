// /api/owner/*: the owner console's API (the /owner page). Only for a signed-in account whose email is
// in OWNER_EMAILS (server/owner.ts); everyone else, signed in or not, gets 403 on every path under it
// (known or not), before any handler runs. Changes need JSON bodies (CSRF: the session cookie is SameSite=Lax
// and a cross-site form can't send JSON without a preflight we never allow), and every change is
// written to the audit log.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { ownerOf } from "../owner.js";
import type { User } from "../auth/session.js";
import { listErrorReports, OWNER_NOTE_MAX, setErrorNote } from "../errorReports.js";
import { abuseSummary, flushAbuse } from "../moderation.js";
import { publishUsageSetting, setPublishUsage } from "../ownerSettings.js";
import { ownerAnalytics } from "./ownerAnalytics.js";
import { flagDetails, setFlag } from "../flags.js";
import { flushMetrics, usageSummary } from "../metrics.js";
import { liveConnections } from "../liveConnections.js";
import { statsSummary } from "../analytics.js";
import { isFlag } from "../../src/shared/flags.js";
import type { OwnerUsage } from "../../src/shared/owner.js";
import { listAudit, recordAudit } from "./audit.js";
import { isFeedbackStatus, isTriageState, listFeedback, setFeedbackStatus, setTriage, TriageError, triageQueue } from "./feedback.js";
import { isOp, opsStatus, startOp } from "./ops.js";
import { ownerOverview } from "./overview.js";
import { listUsers, listWorkspaces, userDetail } from "./people.js";
import { predictionHealth } from "./predictionHealth.js";
import { ownerStorage, purgeEvent, runPhotoMaintenance } from "../scout/photos.js";
import { r2 } from "../scout/r2.js";
import { listOrphaned } from "../scout/orphans.js";
import { powerRankingsOwnerRoutes } from "../powerRankings/ownerRoutes.js";
import { StreamError, listStreams, setEventStream } from "./streams.js";

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};
const owner = (req: Request) => (req as Request & { owner: User }).owner;
const actor = (req: Request) => owner(req).email ?? `account ${owner(req).id}`;
const num = (x: unknown, fallback: number, min: number, max: number) => {
  const n = Math.floor(Number(x));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function ownerRouter(): Router {
  const r = express.Router();
  // The gate: 403 for anyone who isn't a signed-in owner, on every path (the owner's brief: a non-owner
  // gets 403, direct URL or not). The feature toggles never apply here, so switching a feature off can't
  // lock the owner out of the console.
  r.use((req, res, next) => {
    ownerOf(req).then((u) => {
      if (!u) { res.status(403).json({ error: "forbidden" }); return; }
      (req as Request & { owner: User }).owner = u;
      next();
    }, next);
  });
  r.use((req, res, next) => {
    if (req.method !== "GET" && !req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
    next();
  });

  r.get("/overview", h(async () => ownerOverview()));

  // Accounts and Scout spaces, read-only (server/portal/people.ts).
  r.get("/users", h(async (req) => listUsers(typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim().slice(0, 80) : null, num(req.query.limit, 300, 1, 1000))));
  r.get("/users/:id", h(async (req, res) => {
    const id = Number(req.params.id);
    const u = Number.isInteger(id) && id > 0 ? await userDetail(id) : null;
    if (!u) { res.status(404).json({ error: "No such account" }); return; }
    return u;
  }));
  r.get("/workspaces", h(async () => ({ workspaces: await listWorkspaces() })));

  r.get("/usage", h(async (req): Promise<OwnerUsage> => {
    const days = num(req.query.days, 14, 1, 90);
    // Today's numbers so far: what's still in memory goes in first.
    await flushMetrics().catch(() => {});
    const [usage, views] = await Promise.all([usageSummary(days), statsSummary(days)]);
    return { ...usage, live: liveConnections(), pageViews: views.daily.map((d) => ({ day: d.day, views: Number(d.views) })) };
  }));

  r.get("/predictions", h(async (req) => {
    const kind = req.query.kind === "backtest" ? "backtest" : "live";
    const season = req.query.season ? num(req.query.season, 0, 2000, 2100) : null;
    return predictionHealth(kind, season);
  }));

  r.get("/flags", h(async () => ({ flags: await flagDetails() })));
  r.put("/flags/:name", h(async (req, res) => {
    const name = req.params.name;
    if (!isFlag(name)) { res.status(404).json({ error: "No such flag" }); return; }
    if (typeof req.body?.enabled !== "boolean") { res.status(400).json({ error: "Send {\"enabled\": true | false}" }); return; }
    // The value replaced is read in the same transaction as the write: two flips at once each log what they changed.
    const was = await setFlag(name, req.body.enabled, actor(req));
    await recordAudit(actor(req), "flag.set", { flag: name, enabled: req.body.enabled }, null, { from: was, to: req.body.enabled });
    return { flags: await flagDetails() };
  }));

  // Event live streams (server/portal/streams.ts): the list, and set / remove one (an empty url removes it).
  r.get("/streams", h(async () => ({ streams: await listStreams() })));
  r.put("/streams/:season/:code", h(async (req, res) => {
    const season = num(req.params.season, 0, 2000, 2100);
    const code = String(req.params.code).toUpperCase();
    if (!/^[A-Z0-9_-]{1,40}$/.test(code)) { res.status(400).json({ error: "Not an event code" }); return; }
    if (typeof req.body?.url !== "string") { res.status(400).json({ error: "Send {\"url\": \"https://youtube.com/…\"} (empty to remove)" }); return; }
    try {
      const { stream, was } = await setEventStream(season, code, req.body.url, actor(req));
      await recordAudit(actor(req), stream ? "stream.set" : "stream.remove", { season, code, ...(stream ? { videoId: stream.videoId } : {}) }, null, { from: was, to: stream?.videoId ?? null });
      return { stream, streams: await listStreams() };
    } catch (e) {
      if (e instanceof StreamError) { res.status(e.message.startsWith("No event") ? 404 : 400).json({ error: e.message }); return; }
      throw e;
    }
  }));

  r.get("/feedback", h(async (req) => {
    const s = req.query.status;
    const before = req.query.before ? num(req.query.before, 0, 1, Number.MAX_SAFE_INTEGER) : null;
    return listFeedback(s === "all" || isFeedbackStatus(s) ? s : "open", num(req.query.limit, 100, 1, 500), before);
  }));
  r.patch("/feedback/:id", h(async (req, res) => {
    const id = num(req.params.id, 0, 0, Number.MAX_SAFE_INTEGER);
    const status = req.body?.status;
    if (!isFeedbackStatus(status)) { res.status(400).json({ error: "status must be open, resolved or archived" }); return; }
    const out = await setFeedbackStatus(id, status);
    if (!out) { res.status(404).json({ error: "No such message" }); return; }
    await recordAudit(actor(req), "feedback.status", { id, status }, null, { from: out.was, to: status });
    return { message: out.message };
  }));

  r.get("/errors", h(async (req) => ({ reports: await listErrorReports(num(req.query.limit, 50, 1, 200)) })));
  // The owner's note on an error report (an empty note clears it). Console only: never sent to GitHub.
  r.put("/errors/:fingerprint/note", h(async (req, res) => {
    const fp = String(req.params.fingerprint);
    if (!/^[0-9a-f]{8,64}$/.test(fp)) { res.status(404).json({ error: "No such report" }); return; }
    const note = req.body?.note;
    if (typeof note !== "string" || note.length > OWNER_NOTE_MAX) { res.status(400).json({ error: `Send {"note": "…"} (up to ${OWNER_NOTE_MAX} characters; empty to clear)` }); return; }
    const out = await setErrorNote(fp, note);
    if (!out) { res.status(404).json({ error: "No such report" }); return; }
    await recordAudit(actor(req), "error.note", { fingerprint: fp }, null, { from: out.was, to: out.report.ownerNote });
    return { report: out.report };
  }));

  // Moderation: abuse signals per coarse network range (server/moderation.ts) and the triage queue.
  r.get("/moderation", h(async (req) => {
    // Today's numbers so far: what's still in memory goes in first.
    await flushAbuse().catch(() => {});
    const [abuse, triage] = await Promise.all([abuseSummary(num(req.query.days, 14, 1, 90)), triageQueue()]);
    return { abuse, triage };
  }));
  // Triage a bug report, data correction or idea: accepted | rejected | fixed, or null to undo. Never edits
  // match records: an accepted data correction is fixed by a re-sync from FIRST (Data & sync).
  r.patch("/feedback/:id/triage", h(async (req, res) => {
    const id = num(req.params.id, 0, 0, Number.MAX_SAFE_INTEGER);
    const to = req.body?.triage;
    if (!(to === null || isTriageState(to))) { res.status(400).json({ error: "triage must be accepted, rejected, fixed or null" }); return; }
    try {
      const { before, after } = await setTriage(id, to);
      // The change is the triage decision; the inbox list it moved the message between goes in the details.
      await recordAudit(actor(req), "feedback.triage", { id, topic: before.topic, triage: after.triage, statusFrom: before.status, statusTo: after.status }, null,
        { from: before.triage, to: after.triage });
      return { message: after };
    } catch (e) {
      if (e instanceof TriageError) { res.status(e.status).json({ error: e.message }); return; }
      throw e;
    }
  }));

  // Analytics: page views, sessions, prediction calls and ledger counts, and the home page's "in use" choice.
  r.get("/analytics", h(async (req) => {
    await flushMetrics().catch(() => {});
    return ownerAnalytics(num(req.query.days, 14, 1, 90));
  }));
  r.put("/settings/public-usage", h(async (req, res) => {
    if (req.body?.confirm !== true) { res.status(400).json({ error: "Confirm with {\"confirm\": true}" }); return; }
    if (typeof req.body?.enabled !== "boolean") { res.status(400).json({ error: "Send {\"enabled\": true | false, \"confirm\": true}" }); return; }
    const was = await setPublishUsage(req.body.enabled, actor(req));
    await recordAudit(actor(req), "settings.publicUsage", { source: was.source }, null, { from: was.was, to: req.body.enabled });
    return { publishUsage: await publishUsageSetting() };
  }));

  r.get("/ops", h(async () => opsStatus()));
  r.post("/ops/:op", h(async (req, res) => {
    const op = req.params.op;
    if (!isOp(op)) { res.status(404).json({ error: "No such operation" }); return; }
    // The confirmation dialog sends this: a stray request without it does nothing.
    if (req.body?.confirm !== true) { res.status(400).json({ error: "Confirm with {\"confirm\": true}" }); return; }
    const out = await startOp(op, actor(req));
    if (!out.ok) { res.status(409).json({ error: out.error }); return; }
    res.status(202);
    return { job: out.job, status: await opsStatus() };
  }));

  // Photo storage (R2, docs/r2-photos.md): usage against the free tier, per event, and the owner's purge.
  r.get("/storage", h(async () => ownerStorage()));
  r.post("/storage/purge", h(async (req, res) => {
    if (req.body?.confirm !== true) { res.status(400).json({ error: "Confirm with {\"confirm\": true}" }); return; }
    const season = num(req.body?.season, 0, 0, 2100), eventCode = req.body?.eventCode;
    if (season < 2000 || typeof eventCode !== "string" || eventCode.length > 32) { res.status(400).json({ error: "season and eventCode required" }); return; }
    if (!r2()) { res.status(409).json({ error: "Photo storage isn't configured on this server." }); return; }
    const out = await purgeEvent(season, eventCode);
    await recordAudit(actor(req), "storage.purge", { season, eventCode, photos: out.photos, bytes: out.bytes }, out.failures ? `failed: ${out.failures} couldn't be deleted (tried again tonight)` : null);
    return { purged: out, storage: await ownerStorage() };
  }));
  r.post("/storage/maintenance", h(async (req, res) => {
    if (req.body?.confirm !== true) { res.status(400).json({ error: "Confirm with {\"confirm\": true}" }); return; }
    if (!r2()) { res.status(409).json({ error: "Photo storage isn't configured on this server." }); return; }
    const out = await runPhotoMaintenance();
    await recordAudit(actor(req), "storage.maintenance", out ? { expired: out.expired, removed: out.removed, orphans: out.orphans, usedBytes: out.usedBytes } : null,
      out?.failures ? `failed: ${out.failures} couldn't be deleted (tried again tonight)` : null);
    return { result: out, storage: await ownerStorage() };
  }));

  // Scout spaces left read-only (Task 19, scout/orphans.ts): listed only. Nothing is deleted from here:
  // former members still read and export them, and a workspace re-created in Control Point comes back.
  r.get("/orphaned-workspaces", h(async () => ({ workspaces: await listOrphaned() })));

  // Automatic power rankings (server/powerRankings/auto.ts): the generated weeks and their controls.
  powerRankingsOwnerRoutes(r, h, actor);

  r.get("/audit", h(async (req) => ({ entries: await listAudit(num(req.query.limit, 100, 1, 500)) })));
  return r;
}
