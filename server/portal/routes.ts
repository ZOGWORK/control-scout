// /api/owner/*: the owner portal's API (the /owner page). Only for a signed-in account whose email is
// in OWNER_EMAILS (server/owner.ts); everyone else gets the same 404 as any unknown API path, so the
// portal's existence isn't revealed. Changes need JSON bodies (CSRF: the session cookie is SameSite=Lax
// and a cross-site form can't send JSON without a preflight we never allow), and every change is
// written to the audit log.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { ownerOf } from "../owner.js";
import type { User } from "../auth/session.js";
import { listErrorReports } from "../errorReports.js";
import { flagDetails, setFlag } from "../flags.js";
import { flushMetrics, usageSummary } from "../metrics.js";
import { liveConnections } from "../liveConnections.js";
import { statsSummary } from "../analytics.js";
import { isFlag } from "../../src/shared/flags.js";
import type { OwnerUsage } from "../../src/shared/owner.js";
import { listAudit, recordAudit } from "./audit.js";
import { isFeedbackStatus, listFeedback, setFeedbackStatus } from "./feedback.js";
import { isOp, opsStatus, startOp } from "./ops.js";
import { ownerOverview } from "./overview.js";
import { predictionHealth } from "./predictionHealth.js";
import { ownerStorage, purgeEvent, runPhotoMaintenance } from "../scout/photos.js";
import { r2 } from "../scout/r2.js";

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
  // The gate: 404 (as for any unknown path) unless the signed-in account is an owner.
  r.use((req, res, next) => {
    ownerOf(req).then((u) => {
      if (!u) { res.status(404).json({ error: "Not found" }); return; }
      (req as Request & { owner: User }).owner = u;
      next();
    }, next);
  });
  r.use((req, res, next) => {
    if (req.method !== "GET" && !req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
    next();
  });

  r.get("/overview", h(async () => ownerOverview()));

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
    await setFlag(name, req.body.enabled, actor(req));
    await recordAudit(actor(req), "flag.set", { flag: name, enabled: req.body.enabled });
    return { flags: await flagDetails() };
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
    const m = await setFeedbackStatus(id, status);
    if (!m) { res.status(404).json({ error: "No such message" }); return; }
    await recordAudit(actor(req), "feedback.status", { id, status });
    return { message: m };
  }));

  r.get("/errors", h(async (req) => ({ reports: await listErrorReports(num(req.query.limit, 50, 1, 200)) })));

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

  r.get("/audit", h(async (req) => ({ entries: await listAudit(num(req.query.limit, 100, 1, 500)) })));
  return r;
}
