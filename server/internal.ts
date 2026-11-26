// Scout's own internal API for Control Point (docs/shared-accounts.md, "Scout's internal API"). Control Point's
// /internal/* routes are its own; these are the calls the other way, with the same shared secret: Scout's
// CONTROL_POINT_INTERNAL_KEY is Control Point's CONTROL_SCOUT_INTERNAL_KEY. Header X-Internal-Key, compared in
// constant time. Without a key (or one shorter than 32 characters) every route here answers 404; a wrong or missing
// key 401. Public data only, read-only.
import { createHash, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { env } from "./env.js";
import { teamVideos } from "./videos/teamVideos.js";

export const MIN_INTERNAL_KEY_LENGTH = 32;

const digest = (s: string) => createHash("sha256").update(s).digest();
/** Equal keys, compared in constant time (both hashed first, so lengths never leak either). */
export function sameKey(given: string, key: string): boolean { return timingSafeEqual(digest(given), digest(key)); }

function guard(req: Request, res: Response, next: NextFunction) {
  const key = env.controlPointInternalKey ?? "";
  if (key.length < MIN_INTERNAL_KEY_LENGTH) { res.status(404).json({ error: "Not found" }); return; }
  if (!sameKey(req.get("X-Internal-Key") ?? "", key)) { res.status(401).json({ error: "unauthorized" }); return; }
  res.setHeader("Cache-Control", "no-store");
  next();
}

export function internalRouter() {
  const r = express.Router();
  r.use(guard);
  /** GET /internal/teams/:n/videos → { featured, clips } (server/videos/teamVideos.ts). */
  r.get("/teams/:n/videos", async (req, res, next) => {
    const raw = String(req.params.n);
    const n = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1) { res.status(400).json({ error: "invalid_team" }); return; }
    try { res.json(await teamVideos(n)); } catch (e) { next(e); }
  });
  r.use((_req, res) => { res.status(404).json({ error: "Not found" }); });
  return r;
}
