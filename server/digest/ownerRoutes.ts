// /api/owner/digest: the email digest's card in the owner console (docs/digest.md). Mounted inside the owner router,
// so only a signed-in owner reaches it (server/portal/routes.ts).
//
//   GET  /api/owner/digest        → OwnerDigest: subscribers, the next send time, the owner's own setting, the last send
//   POST /api/owner/digest/send   { kind: "digest" | "welcome", confirm: true } → OwnerDigestSendResult
//
// "Send" only ever emails the owner's own account: a digest built and logged exactly like a scheduled one (its period,
// its send-log row, so the next scheduled send doesn't repeat it), or the welcome email. It works with the owner's
// weeklyDigest switch off (a test is the owner's own action), but never without email set up. Audited.
import type { Request, Response, Router } from "express";
import { all, get } from "../db.js";
import { emailEnabled } from "../auth/email.js";
import { cleanValue, EMPTY_STATE } from "../../src/shared/personal.js";
import type { OwnerDigest, OwnerDigestSendResult } from "../../src/shared/digest.js";
import { recordAudit } from "../portal/audit.js";
import { digestAvailable } from "./routes.js";
import { followedTeams, runDigest } from "./job.js";
import { nextSlot, slotAt } from "./schedule.js";
import { sendWelcome } from "./welcome.js";

type Handler = (req: Request, res: Response) => Promise<unknown>;

const parse = <K extends "myTeam" | "tracked">(key: K, raw: unknown) => {
  if (typeof raw !== "string") return null;
  try { return cleanValue(key, JSON.parse(raw)); } catch { return null; }
};

async function ownerDigest(userId: number, now = Date.now()): Promise<OwnerDigest> {
  const [available, subs, mine, state, last] = await Promise.all([
    digestAvailable(),
    get<{ n: number }>("SELECT COUNT(*) n FROM digest_prefs WHERE enabled = 1 AND bounced_at IS NULL"),
    get<{ enabled: number }>("SELECT enabled FROM digest_prefs WHERE user_id = ?", [userId]),
    all<{ key: string; value: string }>("SELECT key, value FROM user_state WHERE user_id = ? AND key IN ('myTeam', 'tracked')", [userId]),
    get<{ week: string }>("SELECT week FROM digest_sends ORDER BY created_at DESC, week DESC LIMIT 1"),
  ]);
  const raw = Object.fromEntries(state.map((r) => [r.key, r.value]));
  const counts = last
    ? Object.fromEntries((await all<{ status: string; n: number }>("SELECT status, COUNT(*) n FROM digest_sends WHERE week = ? GROUP BY status", [last.week])).map((r) => [r.status, Number(r.n)]))
    : null;
  return {
    available, subscribers: Number(subs?.n ?? 0), nextSend: new Date(nextSlot(now).at).toISOString(),
    mine: { enabled: Number(mine?.enabled ?? 0) === 1, followed: followedTeams(parse("myTeam", raw.myTeam) ?? null, (parse("tracked", raw.tracked) ?? EMPTY_STATE.tracked).teams).length },
    lastSend: last && counts ? { key: last.week, counts } : null,
  };
}

/** Send the owner's own account a digest now, or its welcome email. */
export async function sendToOwner(userId: number, kind: "digest" | "welcome", now = Date.now()): Promise<OwnerDigestSendResult> {
  if (kind === "welcome") {
    const out = await sendWelcome(userId, { force: true });
    return {
      kind, outcome: out,
      message: out === "sent" ? "Welcome email sent to your account's address."
        : out === "failed" ? "The welcome email couldn't be sent: the email provider refused it (see the server log)."
        : "Turn on the email digest in Settings first: the welcome email goes to your account, with its unsubscribe link.",
    };
  }
  const slot = slotAt(now);
  const s = await runDigest(slot, { only: [userId], allowed: async () => true, gapMs: 0 });
  if (s.sent) return { kind, outcome: "sent", message: "Digest sent to your account's address. The next scheduled one starts from today, so nothing repeats." };
  if (s.failed) return { kind, outcome: "failed", message: "The digest couldn't be sent: the email provider refused it (the send log has the reason)." };
  if (s.skippedEmpty) return { kind, outcome: "nothing", message: "Nothing to report for your teams since your last digest (up to 7 days back), so nothing was sent." };
  if (s.already) return { kind, outcome: "skipped", message: "A digest for this minute is already logged. Try again in a minute." };
  return { kind, outcome: "skipped", message: "Turn on the email digest in Settings and follow a team first: the test goes to your own account." };
}

export function digestOwnerRoutes(r: Router, h: (fn: Handler) => (req: Request, res: Response, next: (e?: unknown) => void) => void, actor: (req: Request) => string, ownerId: (req: Request) => number) {
  r.get("/digest", h(async (req) => ownerDigest(ownerId(req))));

  r.post("/digest/send", h(async (req, res) => {
    const kind = req.body?.kind;
    if (kind !== "digest" && kind !== "welcome") { res.status(400).json({ error: "Send {\"kind\": \"digest\" | \"welcome\", \"confirm\": true}" }); return; }
    if (req.body?.confirm !== true) { res.status(400).json({ error: "Confirm with {\"confirm\": true}" }); return; }
    if (!emailEnabled()) { res.status(409).json({ error: "Email isn't set up on this server (RESEND_API_KEY)." }); return; }
    const out = await sendToOwner(ownerId(req), kind);
    await recordAudit(actor(req), "digest.send", { kind }, out.outcome === "sent" ? null : `${out.outcome}: ${out.message}`);
    return { result: out, digest: await ownerDigest(ownerId(req)) };
  }));
}
