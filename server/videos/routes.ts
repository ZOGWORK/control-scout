// /api/videos/*: match videos people add (docs/contributors.md). Every answer is for the one viewer asking, so it is
// never cached anywhere shared (no-store, app.ts). Reads are open to everyone, signed out included; adding, liking,
// reporting and getting verified need an account with a username and an actual name.
// Writes are JSON only (CSRF: SameSite=Lax cookies, and a cross-site form can't send JSON without a preflight).
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { currentUser, type User } from "../auth/session.js";
import { storedEventCode } from "../eventCodes.js";
import { isEventCodeParam } from "../../src/shared/eventCode.js";
import { eventView } from "../api/eventView.js";
import {
  addVideo, contributorProfile, coverageOf, editOwnVideo, eventVideos, matchKey, ownVideosOn, parseMatchKey, removeOwnVideo, reportVideo, setLike, statusOf, viewerOf,
  type MatchId,
} from "./contributors.js";
import { claimInvite, readInvite, requestFromInvite, submitApplication, withdrawApplication } from "./verification.js";
import type { EventContributorVideos } from "../../src/shared/contributors.js";

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};

/** :season and :code as stored (an address may spell the code in any case), or null when they can't be one. */
async function eventOf(req: Request): Promise<{ season: number; code: string } | null> {
  const s = Number(req.params.season), raw = String(req.params.code ?? "");
  if (!Number.isInteger(s) || s < 2000 || s > 2100 || !isEventCodeParam(raw)) return null;
  return { season: s, code: await storedEventCode(s, raw) };
}
async function matchOf(req: Request): Promise<MatchId | null> {
  const e = await eventOf(req);
  const k = parseMatchKey(String(req.params.key ?? ""));
  return e && k ? { ...e, ...k } : null;
}
const idOf = (req: Request) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };

export function videosRouter(limit: (perMinute: number) => express.RequestHandler): Router {
  const r = express.Router();
  r.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET" && !req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
    next();
  });
  /** Signed in, or 401 (the app asks them to sign in). */
  const signedIn = (fn: (req: Request, res: Response, user: User) => Promise<unknown>) => h(async (req, res) => {
    const u = await currentUser(req);
    if (!u) { res.status(401).json({ error: "Sign in first.", code: "signin" }); return; }
    return fn(req, res, u);
  });

  // An event's videos for this viewer: each match's winning contributor link, and how much of the event they can watch.
  r.get("/event/:season/:code", limit(120), h(async (req, res): Promise<EventContributorVideos | void> => {
    const e = await eventOf(req);
    if (!e) { res.status(400).json({ error: "Not an event" }); return; }
    const [detail, user] = await Promise.all([eventView(e.season, e.code), currentUser(req)]);
    if (!detail) { res.status(404).json({ error: "No such event" }); return; }
    const videos = await eventVideos(e.season, e.code, await viewerOf(user));
    const matches = Object.fromEntries(videos);
    return { matches, coverage: coverageOf(detail.matches.map((m) => ({ key: m.key, played: m.played, video: m.video, clip: m.clip })), videos) };
  }));

  // One match: its winning link for this viewer, and (signed in) their own links on it and their contributor status.
  r.get("/match/:season/:code/:key", limit(120), h(async (req, res) => {
    const m = await matchOf(req);
    if (!m) { res.status(400).json({ error: "Not a match" }); return; }
    const user = await currentUser(req);
    const v = await viewerOf(user);
    const video = (await eventVideos(m.season, m.code, v)).get(matchKey(m)) ?? null;
    if (!user) return { video };
    const [own, me] = await Promise.all([ownVideosOn(user, m), statusOf(user)]);
    return { video, own, me };
  }));

  r.post("/match/:season/:code/:key", limit(30), signedIn(async (req, res, user) => {
    const m = await matchOf(req);
    if (!m) { res.status(400).json({ error: "Not a match" }); return; }
    const b = req.body ?? {};
    if (typeof b.url !== "string" || b.url.length > 500) { res.status(400).json({ error: "That doesn't look like a YouTube link.", field: "url" }); return; }
    const out = await addVideo(user, m, { url: b.url, team: b.team ?? null, t: b.t ?? null, confirmDuplicate: b.confirmDuplicate === true, confirmLong: b.confirmLong === true });
    if (!out.ok) { res.status(out.status).json(out); return; }
    return out;
  }));

  r.patch("/:id", limit(30), signedIn(async (req, res, user) => {
    const id = idOf(req);
    const b = req.body ?? {};
    if (!id || typeof b.url !== "string") { res.status(400).json({ error: "Send the new link." }); return; }
    const out = await editOwnVideo(user, id, { url: b.url, t: b.t ?? null, confirmDuplicate: b.confirmDuplicate === true, confirmLong: b.confirmLong === true });
    if (!out) { res.status(404).json({ error: "That video isn't yours, or isn't here any more." }); return; }
    if (!out.ok) { res.status(out.status).json(out); return; }
    return out;
  }));
  r.delete("/:id", limit(30), signedIn(async (req, res, user) => {
    const id = idOf(req);
    if (!id || !(await removeOwnVideo(user, id))) { res.status(404).json({ error: "That video isn't yours, or isn't here any more." }); return; }
    return { ok: true };
  }));

  // Likes: signed in, one per account, and only on a link this viewer may see (404 otherwise, as if it didn't exist).
  const like = (on: boolean) => signedIn(async (req, res, user) => {
    const id = idOf(req);
    if (!user.username || !user.displayName?.trim()) { res.status(428).json({ error: "Add a username first.", code: "setup" }); return; }
    const out = id ? await setLike(user, id, on) : null;
    if (!out) { res.status(404).json({ error: "No such video." }); return; }
    return out;
  });
  r.put("/:id/like", limit(60), like(true));
  r.delete("/:id/like", limit(60), like(false));

  r.post("/:id/report", limit(30), signedIn(async (req, res, user) => {
    const id = idOf(req);
    if (!user.username || !user.displayName?.trim()) { res.status(428).json({ error: "Add a username first.", code: "setup" }); return; }
    const out = id ? await reportVideo(user, id, req.body?.reason, req.body?.note) : { ok: false as const, status: 404, error: "No such video." };
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    return { ok: true, already: out.already, message: out.already ? "Already reported. Thanks." : "Reported. Thanks: the site owner will look at it." };
  }));

  // The contributor's own status (Get Verified / Review Pending / verified, and their teams).
  r.get("/me", signedIn(async (_req, _res, user) => statusOf(user)));

  // "Get Verified": the application, and withdrawing a pending one.
  r.post("/apply", limit(10), signedIn(async (req, res, user) => {
    const out = await submitApplication(user, req.body ?? {});
    if (!out.ok) { res.status(out.status).json(out); return; }
    return { ok: true, status: await statusOf(user) };
  }));
  r.post("/apply/withdraw", limit(10), signedIn(async (_req, res, user) => {
    if (!(await withdrawApplication(user))) { res.status(404).json({ error: "There's no application waiting." }); return; }
    return { ok: true, status: await statusOf(user) };
  }));

  // An invite link: read without signing in (the page says what it is), claimed and requested signed in.
  r.get("/invite", limit(30), h(async (req) => readInvite(String(req.query.token ?? ""), await currentUser(req))));
  r.post("/invite/claim", limit(10), signedIn(async (req, res, user) => {
    const out = await claimInvite(user, String(req.body?.token ?? ""));
    if (!out.ok) { res.status(out.status).json({ error: out.error, code: out.code }); return; }
    return { ok: true, status: await statusOf(user) };
  }));
  r.post("/invite/request", limit(10), signedIn(async (req, res, user) => {
    const out = await requestFromInvite(user, String(req.body?.token ?? ""));
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    return { ok: true, already: out.already, status: await statusOf(user) };
  }));

  // A contributor's profile: their name, badge, teams and the videos THIS viewer may see. 404 for an unknown username.
  r.get("/contributors/:username", limit(60), h(async (req, res) => {
    const u = String(req.params.username ?? "");
    const p = /^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(u) ? await contributorProfile(u, await currentUser(req)) : null;
    if (!p) { res.status(404).json({ error: "No such contributor" }); return; }
    return p;
  }));
  return r;
}
