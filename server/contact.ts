// POST /api/contact: the /contact page's form. Each message is stored
// (contact_messages, no IP address) and, when CONTACT_TO is set, emailed
// there through the sign-in mailer (Resend) with Reply-To set to the sender.
// CONTACT_TO is read only here and never sent to the browser.
//
// Spam: a hidden "website" field (people leave it empty; bots fill it in and
// get a normal-looking success with nothing stored or sent) and a per-IP limit.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { get, run } from "./db.js";
import { env } from "./env.js";
import { emailEnabled, normalizeEmail, sendEmail, validEmail } from "./auth/email.js";
import { CONTACT_LIMITS, CONTACT_TOPICS, type ContactTopic } from "../src/shared/contact.js";

/** Per IP: at most this many messages per window (only messages actually accepted count). */
export const CONTACT_RATE = { max: 5, windowMs: 60 * 60_000 };

const sent = new Map<string, number[]>();
/** Tests: forget every IP's recent messages. */
export const resetContactLimits = () => sent.clear();

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? "?";
  const now = Date.now();
  const recent = (sent.get(ip) ?? []).filter((t) => now - t < CONTACT_RATE.windowMs);
  if (recent.length >= CONTACT_RATE.max) {
    const retryAfter = Math.ceil((CONTACT_RATE.windowMs - (now - recent[0])) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "You've sent several messages in the last hour. Please try again later.", retryAfter });
    return;
  }
  sent.set(ip, recent);
  next();
}

function record(ip: string) {
  if (sent.size > 10_000) sent.clear();
  sent.set(ip, [...(sent.get(ip) ?? []), Date.now()]);
}

export type FieldErrors = Partial<Record<"name" | "email" | "topic" | "message", string>>;
export interface ContactInput { name: string | null; email: string; topic: ContactTopic; message: string }

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Checks a submitted form: the cleaned message, or what's wrong with each field. */
export function validateContact(body: unknown): { ok: true; value: ContactInput } | { ok: false; fields: FieldErrors } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fields: FieldErrors = {};
  const name = text(b.name);
  const email = normalizeEmail(text(b.email));
  const topic = text(b.topic);
  const message = text(b.message);
  if (name.length > CONTACT_LIMITS.name) fields.name = `Keep your name under ${CONTACT_LIMITS.name} characters.`;
  if (!email) fields.email = "Enter your email so we can reply.";
  else if (!validEmail(email)) fields.email = "That doesn't look like an email address.";
  if (!CONTACT_TOPICS.some((t) => t.id === topic)) fields.topic = "Choose a topic.";
  if (message.length < CONTACT_LIMITS.messageMin) fields.message = `Tell us a little more (at least ${CONTACT_LIMITS.messageMin} characters).`;
  else if (message.length > CONTACT_LIMITS.messageMax) fields.message = `Keep it under ${CONTACT_LIMITS.messageMax.toLocaleString("en-US")} characters.`;
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { name: name || null, email, topic: topic as ContactTopic, message } };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email to the team: subject, plain text and a simple HTML copy. */
export function contactEmail(m: ContactInput, id: number) {
  const topic = CONTACT_TOPICS.find((t) => t.id === m.topic)!.label;
  const first = m.message.replace(/\s+/g, " ").slice(0, 60);
  const subject = `[Control Scout] ${topic}: ${first}${m.message.length > 60 ? "…" : ""}`;
  const from = m.name ? `${m.name} <${m.email}>` : m.email;
  const textBody = `${topic} — message #${id} from the Control Scout contact form\nFrom: ${from}\n\n${m.message}\n\nReply to this email to answer them.`;
  const html = `<p><strong>${esc(topic)}</strong> — message #${id} from the Control Scout contact form<br>From: ${esc(from)}</p>`
    + `<p style="white-space:pre-wrap">${esc(m.message)}</p><p style="color:#71717a">Reply to this email to answer them.</p>`;
  return { subject, text: textBody, html };
}

export function contactRouter(): Router {
  const r = express.Router();
  r.post("/", (req, res, next) => {
    // JSON only: a cross-site form can't post JSON without a preflight we never allow.
    if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
    next();
  }, rateLimit, (req, res, next) => {
    (async () => {
      // Honeypot filled: look like success, keep and send nothing (but count it, so a bot is still slowed).
      if (text(req.body?.website)) { record(req.ip ?? "?"); return res.json({ ok: true }); }
      const v = validateContact(req.body);
      if (!v.ok) return res.status(400).json({ error: "Check the highlighted fields.", fields: v.fields });
      const m = v.value;
      // Counted before the first await, so parallel requests can't all slip under the limit.
      record(req.ip ?? "?");
      const row = await get<{ id: number }>(
        "INSERT INTO contact_messages (created_at, topic, name, email, message, emailed) VALUES (?, ?, ?, ?, ?, 0) RETURNING id",
        [new Date().toISOString(), m.topic, m.name, m.email, m.message],
      );
      const id = Number(row!.id);
      const to = env.contactTo;
      if (to && emailEnabled()) {
        const { subject, text: body, html } = contactEmail(m, id);
        try {
          await sendEmail(to, subject, body, html, { replyTo: m.email });
          await run("UPDATE contact_messages SET emailed = 1 WHERE id = ?", [id]);
        } catch (e) {
          // Stored either way; the reason only (never an address).
          console.warn(`[contact] message #${id} stored but not emailed: ${(e as Error)?.name === "TimeoutError" ? "timeout" : (e as Error)?.message ?? "unknown"}`);
        }
      }
      return res.json({ ok: true });
    })().catch(next);
  });
  return r;
}
