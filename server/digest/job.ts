// The weekly digest job (docs/digest.md): Mondays at 08:00 New York time (./schedule.ts), from the scheduler in
// server/index.ts. Never on request and never on a page load.
//
// Who: every account with a digest_prefs row (anyone who has ever turned it on). Of those, an account gets an email
// only when all three hold: the switch is on, its address hasn't hard-bounced, and it follows at least one team (my
// team or a tracked team, the same follows push and My team read). An account that follows nobody is left out
// entirely: no log row, no email.
//
// The send log (digest_sends) has one row per account and week, written before the email goes out: the status, the
// template version and the sections it holds. That row is the idempotency key: a job that crashes and runs again,
// or a second server running the same Monday, finds it and sends nothing twice. Skips are logged too ("skipped-empty",
// "skipped-toggle-off", "skipped-bounce"), so "I didn't get it" is answerable from the log.
//
// One account's failure never stops the batch: it's logged as "failed" (with the provider's reason, never the address)
// and the job moves on. Sends are spaced SEND_GAP_MS apart to stay inside Resend's request rate.
import { all, get, run } from "../db.js";
import { env } from "../env.js";
import { isEnabled } from "../flags.js";
import { emailEnabled, sendEmail } from "../auth/email.js";
import { cleanValue, EMPTY_STATE } from "../../src/shared/personal.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { latestRankings } from "../powerRankings/store.js";
import type { PowerRankingsResponse } from "../../src/shared/powerRankings.js";
import { buildDigest, hasNews, sectionsOf, type DigestData } from "./build.js";
import { renderDigest, TEMPLATE_VERSION } from "./template.js";
import { dueWeek } from "./schedule.js";

type Log = (m: string) => void;
const quiet: Log = () => {};

/** Spacing between two sends (Resend allows a few requests a second). */
export const SEND_GAP_MS = 600;
/** Send-log rows older than this are pruned. */
export const KEEP_DAYS = 400;

export type SendStatus = "sending" | "sent" | "failed" | "skipped-empty" | "skipped-toggle-off" | "skipped-bounce" | "bounced";

export interface RunSummary { week: string; sent: number; failed: number; skippedEmpty: number; skippedOff: number; skippedBounce: number; already: number }

/** The public site links point at: the canonical origin (controlscout.org in production). */
export const siteUrl = () => env.canonicalUrl.replace(/\/$/, "");
export const unsubscribeUrl = (token: string) => `${siteUrl()}/api/digest/unsubscribe?t=${encodeURIComponent(token)}`;

/** First name from the display name, for "Hi Sushil," (null: "Hi there,"). */
export function firstName(display: string | null | undefined): string | null {
  const w = display?.trim().split(/\s+/)[0];
  return w && w.length <= 40 && !w.includes("@") ? w : null;
}

const parse = <K extends "myTeam" | "tracked">(key: K, raw: unknown) => {
  if (typeof raw !== "string") return null;
  try { return cleanValue(key, JSON.parse(raw)); } catch { return null; }
};

/** My team first, then tracked teams in the order they were followed. */
export function followedTeams(myTeam: number | null, tracked: number[]): number[] {
  return [...new Set([...(myTeam ? [myTeam] : []), ...tracked])];
}

/** Claim this account's row for the week. False: it already has one (sent, skipped or in flight). */
async function claim(userId: number, week: string, status: SendStatus, sections: string[] = [], subject: string | null = null): Promise<boolean> {
  const at = new Date().toISOString();
  return (await run(
    `INSERT INTO digest_sends (user_id, week, status, template_version, sections, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, week) DO NOTHING`,
    [userId, week, status, TEMPLATE_VERSION, JSON.stringify(sections), subject, at, at])) === 1;
}

const settle = (userId: number, week: string, status: SendStatus, extra: { error?: string; emailId?: string } = {}) =>
  run("UPDATE digest_sends SET status = ?, error = ?, email_id = ?, updated_at = ? WHERE user_id = ? AND week = ?",
    [status, extra.error ?? null, extra.emailId ?? null, new Date().toISOString(), userId, week]);

export interface RunOptions {
  log?: Log;
  /** Spacing between sends, ms (tests: 0). */
  gapMs?: number;
  /** Tests: the power rankings as published. */
  rankings?: PowerRankingsResponse;
  /** Tests: the season. */
  season?: number;
}

/** Build and send one week's digests. Safe to run again for the same week: each account goes out at most once. */
export async function runDigestWeek(week: string, o: RunOptions = {}): Promise<RunSummary> {
  const log = o.log ?? quiet, gap = o.gapMs ?? SEND_GAP_MS;
  const s: RunSummary = { week, sent: 0, failed: 0, skippedEmpty: 0, skippedOff: 0, skippedBounce: 0, already: 0 };
  const rows = await all<any>(
    `SELECT d.user_id, d.enabled, d.token, d.bounced_at, u.email, u.display_name,
       (SELECT value FROM user_state x WHERE x.user_id = d.user_id AND x.key = 'myTeam') my_team,
       (SELECT value FROM user_state x WHERE x.user_id = d.user_id AND x.key = 'tracked') tracked
     FROM digest_prefs d JOIN users u ON u.id = d.user_id ORDER BY d.user_id`);
  const rankings = o.rankings ?? await latestRankings(week);
  let first = true;
  for (const r of rows) {
    const userId = Number(r.user_id);
    try {
      if (r.bounced_at != null) { if (await claim(userId, week, "skipped-bounce")) s.skippedBounce++; else s.already++; continue; }
      if (Number(r.enabled) !== 1) { if (await claim(userId, week, "skipped-toggle-off")) s.skippedOff++; else s.already++; continue; }
      const followed = followedTeams(parse("myTeam", r.my_team) ?? null, (parse("tracked", r.tracked) ?? EMPTY_STATE.tracked).teams);
      if (!followed.length || !r.email) continue; // never enters the queue
      if (await get("SELECT 1 FROM digest_sends WHERE user_id = ? AND week = ?", [userId, week])) { s.already++; continue; }
      const data: DigestData = await buildDigest({ week, season: o.season ?? CURRENT_SEASON, followed, name: firstName(r.display_name), rankings });
      const sections = sectionsOf(data);
      if (!hasNews(data)) { if (await claim(userId, week, "skipped-empty")) s.skippedEmpty++; else s.already++; continue; }
      const unsub = unsubscribeUrl(String(r.token));
      const mail = renderDigest(data, { site: siteUrl(), unsubscribe: unsub, email: String(r.email) });
      if (!(await claim(userId, week, "sending", sections, mail.subject))) { s.already++; continue; }
      if (!first && gap) await new Promise((res) => setTimeout(res, gap));
      first = false;
      try {
        const out = await sendEmail(String(r.email), mail.subject, mail.text, mail.html, {
          // RFC 8058 one-click unsubscribe: the mail app's own Unsubscribe button posts to the same link.
          headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        });
        await settle(userId, week, "sent", { emailId: out && typeof out === "object" ? out.id : undefined });
        s.sent++;
      } catch (e) {
        await settle(userId, week, "failed", { error: String((e as Error)?.message ?? e).slice(0, 300) });
        s.failed++;
      }
    } catch (e) {
      // A bad row (or a database hiccup) for one account never stops the rest.
      s.failed++;
      log(`digest ${week}: account ${userId} failed: ${(e as Error)?.message ?? e}`);
    }
  }
  log(`digest ${week}: ${s.sent} sent, ${s.failed} failed, skipped ${s.skippedEmpty} empty / ${s.skippedOff} switched off / ${s.skippedBounce} bounced${s.already ? `, ${s.already} already done` : ""}`);
  return s;
}

let running: Promise<RunSummary | null> | null = null;
let doneWeek: string | null = null;

/** The scheduler's tick (every few minutes): run this Monday's digests once, when they're due and allowed. */
export async function digestTick(now = Date.now(), log: Log = quiet): Promise<RunSummary | null> {
  const week = dueWeek(now);
  if (!week || week === doneWeek || running) return null;
  if (!emailEnabled() || !(await isEnabled("weeklyDigest"))) return null;
  running = (async () => {
    try {
      const out = await runDigestWeek(week, { log });
      doneWeek = week;
      await run("DELETE FROM digest_sends WHERE created_at < ?", [new Date(now - KEEP_DAYS * 86_400_000).toISOString()]);
      return out;
    } finally { running = null; }
  })();
  return running;
}

/** Tests: forget which week this process already ran. */
export function resetDigestTick(): void { doneWeek = null; running = null; }
