// Email sign-in codes (Resend). A 6-digit code, stored only as a hash,
// valid 10 minutes, 5 tries; at most 5 sends per address per hour and one
// every 30 s. Codes beat magic links here: email scanners can't burn them.
import { randomInt } from "node:crypto";
import { get, run } from "../db.js";
import { env } from "../env.js";
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
  if (!res.ok) throw new Error(`email provider error ${res.status}`);
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
  const text = `Your FTC Control Scout sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, ignore this email — nobody can sign in without the code.`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;background:#0a0a0b;color:#f4f4f5;padding:32px">
  <div style="max-width:420px;margin:0 auto;background:#111113;border:1px solid #ffffff14;border-radius:16px;padding:28px">
    <div style="font-weight:700;font-size:15px;letter-spacing:.02em;color:#ffc700">FTC Control Scout</div>
    <p style="font-size:15px;color:#a1a1aa;margin:20px 0 8px">Your sign-in code</p>
    <div style="font-family:'JetBrains Mono',monospace;font-size:34px;font-weight:700;letter-spacing:.3em;color:#f4f4f5">${code}</div>
    <p style="font-size:13px;color:#a1a1aa;margin-top:20px">Expires in 10 minutes. If you didn't ask for this, ignore it — nobody can sign in without the code.</p>
  </div></div>`;
  try { await mailer(email, `${code} is your Control Scout code`, text, html); }
  catch { await run("DELETE FROM email_codes WHERE email = ?", [email]); return { ok: false, reason: "send-failed" }; }
  return { ok: true };
}

export type VerifyResult = { ok: true; email: string } | { ok: false; reason: "invalid" | "expired" | "attempts" };

export async function verifyEmailCode(rawEmail: string, rawCode: string): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode ?? "").replace(/\D/g, "");
  const row = await get<any>("SELECT * FROM email_codes WHERE email = ?", [email]);
  if (!row || code.length !== 6) return { ok: false, reason: "invalid" };
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "attempts" };
  if (row.code_hash !== codeHash(email, code)) {
    await run("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?", [email]);
    return { ok: false, reason: row.attempts + 1 >= MAX_ATTEMPTS ? "attempts" : "invalid" };
  }
  // Single use: keep the row (for the hourly send limit) but make the code unusable.
  await run("UPDATE email_codes SET code_hash = '', attempts = ? WHERE email = ?", [MAX_ATTEMPTS, email]);
  return { ok: true, email };
}
