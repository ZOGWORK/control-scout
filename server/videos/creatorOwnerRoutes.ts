// /api/owner/creators/*: Owner › Creator videos (behind the owner gate in server/portal/routes.ts). The watched creator
// channels (list, add, deactivate), the intake's runs and quota, and the automatic team tags with the one action on
// them: remove a wrong tag (remembered, never derived again). There is no review queue: tags go live as found. Every
// action is audited where it's made (./creatorVideos.ts).
import type { NextFunction, Request, Response, Router } from "express";
import { addCreatorChannel, deactivateCreatorChannel, ownerCreators, ownerTags, removeCreatorTag, runCreatorNow } from "./creatorVideos.js";

type H = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;

export function creatorOwnerRoutes(r: Router, h: H, actor: (req: Request) => string, log: (s: string) => void = () => {}): void {
  const tagQuery = (req: Request) => {
    const team = Number(req.query.team);
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    return { ...(Number.isInteger(team) && team > 0 ? { team } : {}), ...(q ? { q } : {}) };
  };
  const full = async (req: Request) => ({ ...(await ownerCreators()), tags: await ownerTags(tagQuery(req)) });
  r.get("/creators", h(async (req) => full(req)));
  // ?team=<number> or ?q=<words of the title>: the tags narrowed.
  r.get("/creators/tags", h(async (req) => ({ tags: await ownerTags(tagQuery(req)) })));
  // { channel }: its address, @handle or UC… id.
  r.post("/creators/channels", h(async (req, res) => {
    const out = await addCreatorChannel(req.body?.channel, actor(req));
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return full(req);
  }));
  r.post("/creators/channels/:channelId/deactivate", h(async (req, res) => {
    const out = await deactivateCreatorChannel(String(req.params.channelId), actor(req));
    if (!out.ok) { res.status(404).json({ error: out.error }); return; }
    return full(req);
  }));
  // { videoId, team }.
  r.post("/creators/tags/remove", h(async (req, res) => {
    const out = await removeCreatorTag(String(req.body?.videoId ?? ""), Number(req.body?.team), actor(req));
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return full(req);
  }));
  r.post("/creators/run", h(async (req, res) => {
    const out = await runCreatorNow(actor(req), log);
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return { run: out.run, ...(await full(req)) };
  }));
}
