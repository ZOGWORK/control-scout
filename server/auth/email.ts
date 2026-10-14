// Email sign-in codes (Resend). A 6-digit code, stored only as a hash,
// valid 10 minutes, 5 tries; at most 5 sends per address per hour and one
// every 30 s. Codes beat magic links here: email scanners can't burn them.
import { randomInt } from "node:crypto";
import { get, run } from "../db.js";
import { env } from "../env.js";
import { codeEmail } from "./emailTemplate.js";
import { sha256 } from "./session.js";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;
const RESEND_COOLDOWN_MS = 30_000;

export type Mailer = (to: string, subject: string, text: string, html: string) => Promise<void>;

const resendMailer: Mailer = async (to, subject, text, html) => {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    // Resend's reason (e.g. "API key is invalid", "domain is not verified"): never the key or the address.
    const why = await res.json().then((j: { message?: unknown }) => (typeof j?.message === "string" ? j.message.slice(0, 200) : ""), () => "");
    throw new Error(`email provider error ${res.status}${why ? `: ${why}` : ""}`);
  }
};

let mailer: Mailer = resendMailer;
/** Tests swap the mailer; production uses Resend. */
export function setMailer(m: Mailer | null): void { mailer = m ?? resendMailer; }
export const emailEnabled = () => !!env.resendKey || mailer !== resendMailer;

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const codeHash = (email: string, code: string) => sha256(`${email}:${code}`);

export type StartResult = { ok: true } | { ok: false; reason: "invalid" | "cooldown" | "limit" | "send-failed" | "disabled"; retryAfter?: number };

export async function startEmailSignIn(rawEmail: string): Promise<StartResult> {
  if (!emailEnabled()) return { ok: false, reason: "disabled" };
  const email = normalizeEmail(rawEmail);
  if (!validEmail(email)) return { ok: false, reason: "invalid" };
  const now = Date.now();
  const prev = await get<any>("SELECT * FROM email_codes WHERE email = ?", [email]);
  let sent = 1, windowStart = new Date(now).toISOString();
  if (prev) {
    const lastSent = Date.parse(prev.expires_at) - CODE_TTL_MS;
    if (now - lastSent < RESEND_COOLDOWN_MS) return { ok: false, reason: "cooldown", retryAfter: Math.ceil((RESEND_COOLDOWN_MS - (now - lastSent)) / 1000) };
    if (now - Date.parse(prev.window_start) < 3600_000) {
      if (prev.sent_count >= MAX_SENDS_PER_HOUR) return { ok: false, reason: "limit", retryAfter: Math.ceil((3600_000 - (now - Date.parse(prev.window_start))) / 1000) };
      sent = prev.sent_count + 1; windowStart = prev.window_start;
    }
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await run(
    `INSERT INTO email_codes (email, code_hash, expires_at, attempts, sent_count, window_start) VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_count = excluded.sent_count, window_start = excluded.window_start`,
    [email, codeHash(email, code), new Date(now + CODE_TTL_MS).toISOString(), sent, windowStart],
  );
  const { subject, text, html } = codeEmail(code, { minutes: CODE_TTL_MS / 60_000, siteUrl: env.appUrl });
  try { await mailer(email, subject, text, html); }
  catch (e) {
    console.warn(`[email] sign-in code not sent: ${(e as Error)?.name === "TimeoutError" ? "timeout" : (e as Error)?.message ?? "unknown"}`);
    await run("DELETE FROM email_codes WHERE email = ?", [email]);
    return { ok: false, reason: "send-failed" };
  }
  return { ok: true };
}

export type VerifyResult = { ok: true; email: string } | { ok: false; reason: "invalid" | "expired" | "attempts" };

export async function verifyEmailCode(rawEmail: string, rawCode: string): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, reason: "invalid" };
  const now = new Date().toISOString();
  // Reserve one attempt atomically: concurrent guesses can't all slip past the limit.
  const reserved = await get<any>(
    "UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND attempts < ? AND expires_at > ? AND code_hash != '' RETURNING code_hash, attempts",
    [email, MAX_ATTEMPTS, now],
  );
  if (!reserved) {
    const row = await get<any>("SELECT expires_at, attempts, code_hash FROM email_codes WHERE email = ?", [email]);
    if (!row || !row.code_hash) return { ok: false, reason: "invalid" };
    return { ok: false, reason: Date.parse(row.expires_at) <= Date.now() ? "expired" : "attempts" };
  }
  const hash = codeHash(email, code);
  if (reserved.code_hash !== hash) return { ok: false, reason: Number(reserved.attempts) >= MAX_ATTEMPTS ? "attempts" : "invalid" };
  // Consume exactly this code, once: only the request that clears it may sign in
  // (a newer code issued meanwhile has a different hash and stays valid).
  const consumed = await run("UPDATE email_codes SET code_hash = '' WHERE email = ? AND code_hash = ?", [email, hash]);
  if (consumed !== 1) return { ok: false, reason: "invalid" };
  return { ok: true, email };
}
