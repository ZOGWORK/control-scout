// /api/owner/contributors/*: Owner › Video contributors (behind the owner gate in server/portal/routes.ts). Every
// change is audited where it's made (./verification.ts, ./moderation.ts).
import type { NextFunction, Request, Response, Router } from "express";
import { env } from "../env.js";
import { get } from "../db.js";
import { approve, createInvite, grantRoster, reject, revoke, revokeInvite, revokeRoster } from "./verification.js";
import { LINK_ACTIONS, ownerContributors, ownerLinkAction, type LinkAction } from "./moderation.js";
import { membershipOf } from "./membership.js";
import { queueCounts } from "./contributors.js";

type H = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const uid = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export function contributorOwnerRoutes(r: Router, h: H, actor: (req: Request) => string): void {
  r.get("/contributors", h(async () => ownerContributors()));
  r.get("/contributors/counts", h(async () => queueCounts()));

  // Find an account by email (invites and roster rows need one that exists), with its teams.
  r.get("/contributors/account", h(async (req, res) => {
    const e = str(req.query.email, 200).toLowerCase();
    const u = e ? await get<any>("SELECT id, email, display_name, username FROM users WHERE lower(email) = ?", [e]) : null;
    if (!u) { res.status(404).json({ error: "No Control Scout account has that email." }); return; }
    return { id: Number(u.id), email: u.email, name: u.display_name ?? null, username: u.username ?? null, teams: await membershipOf(Number(u.id)) };
  }));

  r.post("/contributors/invites", h(async (req, res) => {
    const out = await createInvite(str(req.body?.email, 200), str(req.body?.note, 200) || null, actor(req));
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    // The link is shown this once: only its hash is kept.
    return { link: `${env.appUrl.replace(/\/$/, "")}/verify-video?token=${out.token}`, expiresAt: out.expiresAt, account: out.account };
  }));
  r.delete("/contributors/invites/:id", h(async (req, res) => {
    if (!(await revokeInvite(String(req.params.id), actor(req)))) { res.status(404).json({ error: "No unclaimed invite with that id." }); return; }
    return { ok: true };
  }));

  r.post("/contributors/:userId/approve", h(async (req, res) => {
    const id = uid(req.params.userId);
    const out = id ? await approve(id, actor(req), { direct: req.body?.direct === true }) : { ok: false as const, error: "No such account." };
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return out;
  }));
  r.post("/contributors/:userId/reject", h(async (req, res) => {
    const id = uid(req.params.userId);
    const out = id ? await reject(id, actor(req), str(req.body?.reason) || null, str(req.body?.privateNote) || null) : { ok: false as const, error: "No such account." };
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return out;
  }));
  r.post("/contributors/:userId/revoke", h(async (req, res) => {
    const id = uid(req.params.userId);
    const out = id ? await revoke(id, actor(req), str(req.body?.reason)) : { ok: false as const, error: "No such account." };
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return out;
  }));
  // Direct approve by email: someone the owner already knows, with no invite or application.
  r.post("/contributors/verify-by-email", h(async (req, res) => {
    const u = await get<{ id: number }>("SELECT id FROM users WHERE lower(email) = ?", [str(req.body?.email, 200).toLowerCase()]);
    if (!u) { res.status(404).json({ error: "No Control Scout account has that email." }); return; }
    const out = await approve(Number(u.id), actor(req), { direct: true });
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return out;
  }));

  r.post("/contributors/roster", h(async (req, res) => {
    const out = await grantRoster(str(req.body?.email, 200), Number(req.body?.team), str(req.body?.note, 200) || null, actor(req));
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    return out;
  }));
  r.delete("/contributors/roster/:team/:userId", h(async (req, res) => {
    const team = uid(req.params.team), id = uid(req.params.userId);
    if (!team || !id || !(await revokeRoster(team, id, actor(req)))) { res.status(404).json({ error: "No such roster row." }); return; }
    return { ok: true };
  }));

  r.post("/contributors/links/:id", h(async (req, res) => {
    const id = uid(req.params.id);
    const action = req.body?.action as LinkAction;
    if (!id || !LINK_ACTIONS.includes(action)) { res.status(400).json({ error: `action must be one of ${LINK_ACTIONS.join(", ")}` }); return; }
    const out = await ownerLinkAction(id, action, actor(req), str(req.body?.reason) || null);
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    return out;
  }));
}
