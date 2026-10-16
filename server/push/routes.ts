// /api/push: web push subscriptions for the signed-in account (push.ts, docs/push.md).
//
//   GET    /api/push/config          { available, publicKey }   anyone (the public VAPID key only)
//   POST   /api/push/subscriptions   PushSubscription.toJSON() → { ok: true }     signed in
//   POST   /api/push/subscriptions/check  { endpoint } → { subscribed }          signed in
//   DELETE /api/push/subscriptions   { endpoint } → { ok, removed }               signed in
//
// 401 signed out (push needs an account: the server reads what you follow from your synced data).
// 503 on subscribe while push is unavailable (no VAPID settings, or the owner switched it off); deleting
// always works. Writes are JSON only (CSRF: SameSite=Lax cookie + no cross-site JSON). Every answer is no-store.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { currentUser, type User } from "../auth/session.js";
import { cleanSubscription } from "../../src/shared/push.js";
import { hasSubscription, pushAvailable, pushConfig, removeSubscription, saveSubscription } from "./push.js";

const h = (fn: (req: Request, res: Response, user: User) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  (async () => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in to turn on notifications." }); return; }
    const b = await fn(req, res, user);
    if (!res.headersSent && b !== undefined) res.json(b);
  })().catch(next);
};

const endpointOf = (body: unknown) => {
  const e = (body as { endpoint?: unknown } | null)?.endpoint;
  return typeof e === "string" && e.length > 0 && e.length <= 1000 ? e : null;
};

export function pushRouter(): Router {
  const r = express.Router();
  r.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "GET" && !req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
    next();
  });

  r.get("/config", (_req, res, next) => { pushConfig().then((c) => res.json(c), next); });

  r.post("/subscriptions", h(async (req, res, user) => {
    const sub = cleanSubscription(req.body);
    if (!sub) { res.status(400).json({ error: "That isn't a usable push subscription." }); return; }
    if (!(await pushAvailable())) { res.status(503).json({ error: "Notifications aren't available on this server right now." }); return; }
    await saveSubscription(user.id, sub, req.get("User-Agent"));
    return { ok: true };
  }));

  r.post("/subscriptions/check", h(async (req, res, user) => {
    const endpoint = endpointOf(req.body);
    if (!endpoint) { res.status(400).json({ error: "endpoint is required" }); return; }
    return { subscribed: await hasSubscription(user.id, endpoint) };
  }));

  r.delete("/subscriptions", h(async (req, res, user) => {
    const endpoint = endpointOf(req.body);
    if (!endpoint) { res.status(400).json({ error: "endpoint is required" }); return; }
    return { ok: true, removed: await removeSubscription(user.id, endpoint) };
  }));
  return r;
}
