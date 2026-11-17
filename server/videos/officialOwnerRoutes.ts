// /api/owner/official-videos/*: Owner › Official videos (behind the owner gate in server/portal/routes.ts): the
// auto-watcher's review queue, its runs and quota, and the watched channels. Every decision is audited where it's
// made (./officialWatch.ts).
import type { NextFunction, Request, Response, Router } from "express";
import { isEventCodeParam } from "../../src/shared/eventCode.js";
import { markCoverageBulkReviewed, markCoverageReviewed, openCoverageCount, ownerClipCoverage, TRIAGES } from "./coverageCheck.js";
import type { CoverageTriage } from "../../src/shared/api.js";
import { approveWatched, ownerOfficial, pendingCount, rejectWatched, removeChannel, removeOfficial, runNow, saveChannel } from "./officialWatch.js";
import { dismissFinding, ownerAudit, queueFinding, runChannelAudit } from "./officialAudit.js";

type H = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** /api/owner/clip-coverage: Owner > Clip coverage (server/videos/coverageCheck.ts): every event with a played match
 *  missing a clip, triaged (actionable is the "To review"), its days and videos checked and each match's reason;
 *  marking one or a whole category or season reviewed is audited. */
export function clipCoverageOwnerRoutes(r: Router, h: H, actor: (req: Request) => string): void {
  r.get("/clip-coverage", h(async (req) => {
    // ?list=<category>|reviewed (actionable by default: the "To review"); ?after=<season>/<code>: the page after that event.
    const m = /^(\d{4})\/(.{1,40})$/.exec(String(req.query.after ?? ""));
    const l = String(req.query.list ?? "");
    const list = l === "reviewed" || (TRIAGES as string[]).includes(l) ? l as CoverageTriage | "reviewed" : "actionable";
    return ownerClipCoverage({ list, after: m ? { season: Number(m[1]), code: m[2] } : null });
  }));
  // Bulk Reviewed: { category?: a category or "non-actionable", season?, expected: the count the owner confirmed }.
  r.post("/clip-coverage/bulk-reviewed", h(async (req, res) => {
    const c = req.body?.category, s = req.body?.season, expected = Number(req.body?.expected);
    const category = c == null ? undefined : c === "non-actionable" || (TRIAGES as unknown[]).includes(c) ? c as CoverageTriage | "non-actionable" : null;
    const season = s == null ? undefined : Number.isInteger(s) && s >= 2000 && s <= 2100 ? Number(s) : null;
    if (category === null || season === null || (category === undefined && season === undefined) || !Number.isInteger(expected) || expected < 1) {
      res.status(400).json({ error: "Pick a category or a season, and confirm how many." }); return;
    }
    const out = await markCoverageBulkReviewed({ category, season }, expected, actor(req));
    if (out.status === "changed") { res.status(409).json({ error: `The list changed since you confirmed: ${out.count} now. Look again.`, count: out.count }); return; }
    return { marked: out.count, ...(await ownerClipCoverage()) };
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
  // The panel's data: the watcher's, and the channel audit's (server/videos/officialAudit.ts).
  const full = async () => ({ ...(await ownerOfficial()), audit: await ownerAudit() });
  r.get("/official-videos", h(async () => full()));
  r.get("/official-videos/counts", h(async () => ({ pending: await pendingCount() })));

  const one = (fn: (id: string, req: Request) => Promise<{ ok: true } | { ok: false; error: string }>) => h(async (req, res) => {
    const id = String(req.params.videoId);
    if (!VIDEO_ID.test(id)) { res.status(400).json({ error: "Not a YouTube video id." }); return; }
    const out = await fn(id, req);
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return full();
  });
  r.post("/official-videos/:videoId/approve", one((id, req) => approveWatched(id, req.body ?? {}, actor(req))));
  r.post("/official-videos/:videoId/reject", one((id, req) => rejectWatched(id, str(req.body?.reason, 200) || null, actor(req))));
  r.post("/official-videos/:videoId/remove", one((id, req) => removeOfficial(id, actor(req))));
  // A channel-audit finding: to the review queue, or not a recording (why required).
  r.post("/official-videos/audit/:videoId/queue", one((id, req) => queueFinding(id, actor(req))));
  r.post("/official-videos/audit/:videoId/dismiss", one((id, req) => dismissFinding(id, str(req.body?.reason, 300), actor(req))));

  r.put("/official-videos/channels", h(async (req, res) => {
    const out = await saveChannel(req.body ?? {}, actor(req));
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return full();
  }));
  r.delete("/official-videos/channels/:channelId", h(async (req, res) => {
    const out = await removeChannel(String(req.params.channelId), actor(req));
    if (!out.ok) { res.status(404).json({ error: out.error }); return; }
    return full();
  }));
  r.post("/official-videos/run", h(async (req, res) => {
    const out = await runNow(actor(req), log);
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    // The audit follows, as after a scheduled run; the panel shows it on its next load.
    void runChannelAudit(log).catch((e) => log(`official videos: audit: ${(e as Error).message}`));
    return { run: out.run, ...(await full()) };
  }));
}
