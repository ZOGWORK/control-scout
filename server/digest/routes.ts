// /api/digest: the weekly email digest (docs/digest.md).
//
//   GET  /api/digest                  → DigestStatus                       signed in
//   PUT  /api/digest   { enabled }    → DigestStatus                       signed in (JSON)
//   GET  /api/digest/unsubscribe?t=…  → 303 to /digest/unsubscribed       anyone with the link: off in this request
//   POST /api/digest/unsubscribe?t=…  → 200                               RFC 8058 one-click (the mail app's button)
//   POST /api/digest/webhook          → 200                               Resend's bounce and complaint reports, signed
//
// The unsubscribe link needs no sign-in, works on any device and after forwarding, and never expires; turning the
// digest back on in Settings issues a new link, so an old email's link can't switch it off again (prefs.ts).
// Every answer is no-store (app.ts treats /api/digest as personal).
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { currentUser, type User } from "../auth/session.js";
import { all, run } from "../db.js";
import { env } from "../env.js";
import { isEnabled } from "../flags.js";
import { emailEnabled } from "../auth/email.js";
import { cleanValue, EMPTY_STATE } from "../../src/shared/personal.js";
import type { DigestStatus, UnsubscribeStatus } from "../../src/shared/digest.js";
import { prefsFor, setDigest, stopForAddress, unsubscribe } from "./prefs.js";
import { followedTeams } from "./job.js";

const signedIn = (fn: (req: Request, res: Response, user: User) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  (async () => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in to manage the weekly digest." }); return; }
    const b = await fn(req, res, user);
    if (!res.headersSent && b !== undefined) res.json(b);
  })().catch(next);
};

export const digestAvailable = async () => emailEnabled() && (await isEnabled("weeklyDigest"));

export async function digestStatus(user: User): Promise<DigestStatus> {
  const [prefs, available, state] = await Promise.all([
    prefsFor(user.id), digestAvailable(),
    all<{ key: string; value: string }>("SELECT key, value FROM user_state WHERE user_id = ? AND key IN ('myTeam', 'tracked')", [user.id]),
  ]);
  const raw = Object.fromEntries(state.map((r) => [r.key, r.value]));
  const read = <K extends "myTeam" | "tracked">(k: K) => { try { return raw[k] ? cleanValue(k, JSON.parse(raw[k])) : null; } catch { return null; } };
  return {
    available, enabled: prefs?.enabled ?? false, email: user.email, bounced: prefs?.bounced ?? false,
    followedTeams: followedTeams(read("myTeam") ?? null, (read("tracked") ?? EMPTY_STATE.tracked).teams),
  };
}

/**
 * A Resend (Svix) webhook signature: base64 HMAC-SHA256 of "id.timestamp.body" under the secret's key, one of the
 * space-separated "v1,<sig>" entries, with the timestamp within five minutes either way (no replays).
 */
export function verifyWebhook(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, body: string, now = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const want = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [v, sig] = part.split(",");
    if (v !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

const landing = (status: UnsubscribeStatus) => `/digest/unsubscribed?status=${status}`;

export function digestRouter(): Router {
  const r = express.Router();

  r.get("/", signedIn(async (_req, _res, user) => digestStatus(user)));

  r.put("/", signedIn(async (req, res, user) => {
    if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
    const on = (req.body as { enabled?: unknown } | null)?.enabled;
    if (typeof on !== "boolean") { res.status(400).json({ error: "enabled must be true or false" }); return; }
    if (on && !(await digestAvailable())) { res.status(503).json({ error: "The weekly digest isn't available on this server right now." }); return; }
    if (on && !user.email) { res.status(409).json({ error: "Your account has no email address to send it to." }); return; }
    await setDigest(user.id, on);
    return digestStatus(user);
  }));

  // The link in the email: off in this same request, then a plain confirmation page (no sign-in, no second click).
  r.get("/unsubscribe", (req, res, next) => {
    unsubscribe(req.query.t).then((ok) => res.redirect(303, landing(ok ? "done" : "invalid")), next);
  });
  // The mail app's own Unsubscribe button (List-Unsubscribe-Post): same effect, no page.
  r.post("/unsubscribe", (req, res, next) => {
    unsubscribe(req.query.t).then((ok) => res.status(ok ? 200 : 404).type("text/plain").send(ok ? "Unsubscribed from the weekly digest." : "This unsubscribe link isn't active."), next);
  });

  // Resend's delivery reports. Without RESEND_WEBHOOK_SECRET the endpoint doesn't exist (bounces then rest on
  // Resend's own suppression list). The raw body is needed for the signature (app.ts skips the JSON parser here).
  r.post("/webhook", express.text({ type: "*/*", limit: "256kb" }), (req, res, next) => {
    (async () => {
      const secret = env.resendWebhookSecret;
      if (!secret) { res.status(404).json({ error: "Not found" }); return; }
      const body = typeof req.body === "string" ? req.body : "";
      if (!verifyWebhook(secret, { id: req.get("svix-id"), timestamp: req.get("svix-timestamp"), signature: req.get("svix-signature") }, body)) {
        res.status(401).json({ error: "Bad signature" }); return;
      }
      let ev: { type?: unknown; data?: { email_id?: unknown; to?: unknown; bounce?: { type?: unknown } } };
      try { ev = JSON.parse(body); } catch { res.status(400).json({ error: "Bad JSON" }); return; }
      const to = Array.isArray(ev.data?.to) ? ev.data!.to.filter((x): x is string => typeof x === "string") : [];
      const emailId = typeof ev.data?.email_id === "string" ? ev.data.email_id : null;
      // A hard ("Permanent") bounce or a spam complaint stops the digest; a soft bounce changes nothing (next week retries).
      const hard = ev.type === "email.bounced" && ev.data?.bounce?.type === "Permanent";
      const complaint = ev.type === "email.complained";
      if (hard || complaint) {
        for (const addr of to) await stopForAddress(addr, hard ? "bounce" : "complaint");
        if (emailId) await run("UPDATE digest_sends SET status = 'bounced', error = ?, updated_at = ? WHERE email_id = ?", [hard ? "hard bounce" : "spam complaint", new Date().toISOString(), emailId]);
      }
      res.json({ ok: true });
    })().catch(next);
  });
  return r;
}
