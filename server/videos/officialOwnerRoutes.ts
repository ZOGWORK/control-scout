// /api/owner/official-videos/*: Owner › Official videos (behind the owner gate in server/portal/routes.ts): the
// auto-watcher's review queue, its runs and quota, and the watched channels. Every decision is audited where it's
// made (./officialWatch.ts).
import type { NextFunction, Request, Response, Router } from "express";
import { isEventCodeParam } from "../../src/shared/eventCode.js";
import { markCoverageReviewed, openCoverageCount, ownerClipCoverage } from "./coverageCheck.js";
import { approveWatched, ownerOfficial, pendingCount, rejectWatched, removeChannel, removeOfficial, runNow, saveChannel } from "./officialWatch.js";

type H = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** /api/owner/clip-coverage: Owner > Clip coverage (server/videos/coverageCheck.ts): every event with a played match
 *  missing a clip, its days and videos checked and each match's reason; marking one reviewed is audited. */
export function clipCoverageOwnerRoutes(r: Router, h: H, actor: (req: Request) => string): void {
  r.get("/clip-coverage", h(async (req) => {
    // ?after=<season>/<code>: the page after that event.
    const m = /^(\d{4})\/(.{1,40})$/.exec(String(req.query.after ?? ""));
    return ownerClipCoverage({ reviewed: req.query.list === "reviewed", after: m ? { season: Number(m[1]), code: m[2] } : null });
  }));
  r.get("/clip-coverage/counts", h(async () => ({ open: await openCoverageCount() })));
  r.post("/clip-coverage/:season/:code/reviewed", h(async (req, res) => {
    const season = Number(req.params.season), code = String(req.params.code), version = str(req.body?.version, 64);
    if (!Number.isInteger(season) || !isEventCodeParam(code)) { res.status(400).json({ error: "Not an event." }); return; }
    const out = await markCoverageReviewed(season, code, version, actor(req));
    if (out === "none") { res.status(404).json({ error: "Not waiting for review." }); return; }
    if (out === "changed") { res.status(409).json({ error: "Its missing list changed since you opened it: look again." }); return; }
    return ownerClipCoverage();
  }));
}

export function officialVideoOwnerRoutes(r: Router, h: H, actor: (req: Request) => string, log: (s: string) => void = () => {}): void {
  r.get("/official-videos", h(async () => ownerOfficial()));
  r.get("/official-videos/counts", h(async () => ({ pending: await pendingCount() })));

  const one = (fn: (id: string, req: Request) => Promise<{ ok: true } | { ok: false; error: string }>) => h(async (req, res) => {
    const id = String(req.params.videoId);
    if (!VIDEO_ID.test(id)) { res.status(400).json({ error: "Not a YouTube video id." }); return; }
    const out = await fn(id, req);
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return ownerOfficial();
  });
  r.post("/official-videos/:videoId/approve", one((id, req) => approveWatched(id, req.body ?? {}, actor(req))));
  r.post("/official-videos/:videoId/reject", one((id, req) => rejectWatched(id, str(req.body?.reason, 200) || null, actor(req))));
  r.post("/official-videos/:videoId/remove", one((id, req) => removeOfficial(id, actor(req))));

  r.put("/official-videos/channels", h(async (req, res) => {
    const out = await saveChannel(req.body ?? {}, actor(req));
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return ownerOfficial();
  }));
  r.delete("/official-videos/channels/:channelId", h(async (req, res) => {
    const out = await removeChannel(String(req.params.channelId), actor(req));
    if (!out.ok) { res.status(404).json({ error: out.error }); return; }
    return ownerOfficial();
  }));
  r.post("/official-videos/run", h(async (req, res) => {
    const out = await runNow(actor(req), log);
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return { run: out.run, ...(await ownerOfficial()) };
  }));
}
