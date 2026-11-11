// Becoming a verified contributor (docs/contributors.md "Getting verified"): two ways in, one place they end.
//   Invite       the owner makes a link for one person (single use, 14 days, only its hash kept); they claim it signed
//                in, then send a one-tap request.
//   Application  anyone signed in fills "Get Verified" (team, events, channel, a sample video, five agreements).
// Either is a pending row in video_contributors, in ONE owner queue, oldest first, labelled Invite or Application.
// The owner approves (verified: their videos go public) or rejects (with a reason they may share; 7 days before they
// can apply again). The owner can also verify someone directly, and revoke anyone. Every decision is audited, and the
// person is told in their inbox.
import { createHash, randomBytes } from "node:crypto";
import { all, db, get, run } from "../db.js";
import { recordAudit } from "../portal/audit.js";
import { accountActor } from "../auth/username.js";
import { notifyContributor } from "../inbox/inbox.js";
import { membershipOf, forgetMembership } from "./membership.js";
import { channelExists, channelUrl, checkVideoLink, LINK_TEXT } from "./linkChecks.js";
import { INVITE_COLS, refreshOwnerAlerts, VC_COLS } from "./contributors.js";
import type { User } from "../auth/session.js";
import {
  AGREEMENTS, APPLICANT_ROLES, APPLICATIONS_PER_30_DAYS, INVITE_DAYS, NOT_APPROVED_TEXT, RECORDED_CHOICES, REJECT_COOLDOWN_DAYS, TEXT_MAX, WHY_MIN,
  type ApplicationField, type ApplicationInput,
} from "../../src/shared/contributors.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const iso = (t: number) => new Date(t).toISOString();
const DAY = 864e5;

// --- Invites ----------------------------------------------------------------------------------------------

export type { InviteState } from "../../src/shared/contributors.js";
import type { InviteState } from "../../src/shared/contributors.js";

/** Make an invite for an account's email (the account must exist). The raw link is returned once and never kept. */
export async function createInvite(email: string, note: string | null, by: string, now = Date.now()): Promise<{ ok: true; token: string; expiresAt: string; account: { id: number; name: string | null } } | { ok: false; error: string }> {
  const e = email.trim().toLowerCase();
  const acct = await get<{ id: number; display_name: string | null }>("SELECT id, display_name FROM users WHERE lower(email) = ?", [e]);
  if (!acct) return { ok: false, error: "No Control Scout account has that email. They need to sign up first." };
  const token = randomBytes(32).toString("base64url");
  const expiresAt = iso(now + INVITE_DAYS * DAY);
  await run("INSERT INTO contributor_invites (token_hash, email, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    [sha(token), e, note?.trim().slice(0, 200) || null, by, iso(now), expiresAt]);
  await recordAudit(by, "contributor.invite", { email: e, hash: sha(token).slice(0, 12), expiresAt, note: note?.trim() || null });
  return { ok: true, token, expiresAt, account: { id: Number(acct.id), name: acct.display_name ?? null } };
}

async function inviteByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return get<any>(`SELECT ${INVITE_COLS} FROM contributor_invites WHERE token_hash = ?`, [sha(token)]);
}

export function inviteState(row: any, now = Date.now()): InviteState {
  if (!row) return "invalid";
  if (row.revoked_at) return "revoked";
  if (row.claimed_by_user_id != null) return "claimed";
  if (Date.parse(row.expires_at) <= now) return "expired";
  return "valid";
}

/** What the invite page shows, signed in or not (no login wall before the token is read). */
export async function readInvite(token: string, viewer: User | null, now = Date.now()): Promise<{ state: InviteState; mine?: boolean; expiresAt?: string }> {
  const row = await inviteByToken(token);
  const state = inviteState(row, now);
  return { state, ...(row ? { expiresAt: row.expires_at } : {}), ...(state === "claimed" && viewer ? { mine: Number(row.claimed_by_user_id) === viewer.id } : {}) };
}

/** Claim it for this account (signed in, with a username and actual name). Binds it to them; the request comes next. */
export async function claimInvite(user: User, token: string, now = Date.now()): Promise<{ ok: true } | { ok: false; status: number; code: string; error: string }> {
  if (!user.username || !user.displayName?.trim()) return { ok: false, status: 428, code: "setup", error: "Add a username and your actual name first." };
  const row = await inviteByToken(token);
  const state = inviteState(row, now);
  if (state === "claimed" && Number(row.claimed_by_user_id) === user.id) return { ok: true };
  if (state === "claimed") return { ok: false, status: 409, code: "claimed", error: "This invite was already claimed." };
  if (state !== "valid") return { ok: false, status: 410, code: state, error: "This link is no longer valid." };
  const c = await get<any>(`SELECT ${VC_COLS} FROM video_contributors WHERE user_id = ?`, [user.id]);
  if (c?.status === "verified") return { ok: false, status: 409, code: "verified", error: "You're already verified." };
  if (c?.status === "rejected" && c.reapply_after && Date.parse(c.reapply_after) > now) {
    return { ok: false, status: 429, code: "cooldown", error: `You can re-apply after ${dayText(c.reapply_after)}.` };
  }
  // First claim wins: the update only takes an unclaimed, unrevoked, unexpired row.
  const took = await run("UPDATE contributor_invites SET claimed_by_user_id = ?, claimed_at = ? WHERE token_hash = ? AND claimed_by_user_id IS NULL AND revoked_at IS NULL AND expires_at > ?",
    [user.id, iso(now), sha(token), iso(now)]);
  if (!took) return { ok: false, status: 409, code: "claimed", error: "This invite was already claimed." };
  await recordAudit(accountActor(user), "contributor.invite_claim", { userId: user.id, hash: sha(token).slice(0, 12), intended: row.email, claimedBy: user.email });
  return { ok: true };
}

/** The one-tap request after claiming. A pending application is withdrawn ("withdrawn — claimed an invite"); a request
 *  already pending (from an earlier invite) is reused, never a second one. */
export async function requestFromInvite(user: User, token: string, now = Date.now()): Promise<{ ok: true; already: boolean } | { ok: false; status: number; error: string }> {
  const row = await inviteByToken(token);
  if (!row || Number(row.claimed_by_user_id) !== user.id || row.revoked_at) return { ok: false, status: 403, error: "Claim the invite first." };
  const c = await get<any>(`SELECT ${VC_COLS} FROM video_contributors WHERE user_id = ?`, [user.id]);
  if (c?.status === "verified") return { ok: false, status: 409, error: "You're already verified." };
  if (c?.status === "pending" && c.source === "invite") return { ok: true, already: true };
  if (c?.status === "rejected" && c.reapply_after && Date.parse(c.reapply_after) > now) return { ok: false, status: 429, error: `You can re-apply after ${dayText(c.reapply_after)}.` };
  const stmts = [];
  const pendingApp = await get<{ id: number }>("SELECT id FROM verification_applications WHERE user_id = ? AND status = 'pending'", [user.id]);
  if (pendingApp) stmts.push({ sql: "UPDATE verification_applications SET status = 'withdrawn', withdrawn_reason = 'claimed an invite', decided_at = ? WHERE id = ?", args: [iso(now), pendingApp.id] });
  stmts.push({
    sql: `INSERT INTO video_contributors (user_id, status, source, application_id, invite_hash, requested_at) VALUES (?, 'pending', 'invite', NULL, ?, ?)
          ON CONFLICT (user_id) DO UPDATE SET status = 'pending', source = 'invite', application_id = NULL, invite_hash = excluded.invite_hash, requested_at = excluded.requested_at,
            decided_at = NULL, decided_by = NULL, decision_note = NULL, private_note = NULL, reapply_after = NULL`,
    args: [user.id, row.token_hash, iso(now)],
  });
  await db().batch(stmts, "write");
  if (pendingApp) await recordAudit(accountActor(user), "contributor.application_withdraw", { userId: user.id, application: pendingApp.id, reason: "withdrawn — claimed an invite" });
  await recordAudit(accountActor(user), "contributor.request", { userId: user.id, source: "invite", hash: String(row.token_hash).slice(0, 12) });
  void refreshOwnerAlerts();
  return { ok: true, already: false };
}

export async function revokeInvite(hashPrefix: string, by: string): Promise<boolean> {
  if (!/^[0-9a-f]{12,64}$/.test(hashPrefix)) return false;
  const r = await get<{ token_hash: string }>("SELECT token_hash FROM contributor_invites WHERE token_hash LIKE ? AND revoked_at IS NULL AND claimed_by_user_id IS NULL", [`${hashPrefix}%`]);
  if (!r) return false;
  await run("UPDATE contributor_invites SET revoked_at = ? WHERE token_hash = ?", [iso(Date.now()), r.token_hash]);
  await recordAudit(by, "contributor.invite_revoke", { hash: r.token_hash.slice(0, 12) });
  return true;
}

// --- Applications ----------------------------------------------------------------------------------------

export type ApplyResult = { ok: true; id: number } | { ok: false; status: number; error: string; errors?: Partial<Record<ApplicationField, string>>; code?: string };

const dayText = (isoDate: string) => new Date(isoDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Check the form, field by field, then the account's limits; write it only when everything holds. */
export async function submitApplication(user: User, input: Partial<ApplicationInput>, opts: { fetchImpl?: typeof fetch; now?: number } = {}): Promise<ApplyResult> {
  const now = opts.now ?? Date.now();
  if (!user.username || !user.displayName?.trim()) return { ok: false, status: 428, code: "setup", error: "Add a username and your actual name first." };
  const c = await get<any>(`SELECT ${VC_COLS} FROM video_contributors WHERE user_id = ?`, [user.id]);
  if (c?.status === "verified") return { ok: false, status: 409, error: "You're already verified." };
  if (c?.status === "pending") return { ok: false, status: 409, code: "pending", error: "You already have an application waiting for review." };
  if (c?.status === "rejected" && c.reapply_after && Date.parse(c.reapply_after) > now) return { ok: false, status: 429, code: "cooldown", error: `You can re-apply after ${dayText(c.reapply_after)}.` };
  const recent = await get<{ n: number }>("SELECT COUNT(*) n FROM verification_applications WHERE user_id = ? AND submitted_at > ?", [user.id, iso(now - 30 * DAY)]);
  if (Number(recent?.n ?? 0) >= APPLICATIONS_PER_30_DAYS) return { ok: false, status: 429, code: "spam", error: "You've applied a few times recently — check back later." };

  const errors: Partial<Record<ApplicationField, string>> = {};
  const s = (v: unknown, max = TEXT_MAX) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const team = Number(input.teamNumber);
  const teamName = s(input.teamName, 120), roleOther = s(input.roleOther, 80), events = s(input.events), why = s(input.why), extra = s(input.extra);
  const role = typeof input.role === "string" && (APPLICANT_ROLES as readonly string[]).includes(input.role) ? input.role : null;
  const recorded = typeof input.recorded === "string" && (RECORDED_CHOICES as readonly string[]).includes(input.recorded) ? input.recorded : null;
  if (!Number.isInteger(team) || team <= 0 || team > 999_999) errors.teamNumber = "Add your FTC team number.";
  else if (!(await get("SELECT 1 FROM teams WHERE number = ?", [team]))) errors.teamNumber = `There's no FTC team ${team}.`;
  if (!teamName) errors.teamName = "Add your team's name.";
  if (!role) errors.role = "Pick your role on the team.";
  else if (role === "other" && !roleOther) errors.roleOther = "Say what your role is.";
  if (!events) errors.events = "Name at least one event you've recorded or plan to record.";
  const chan = channelUrl(s(input.channelUrl, 300));
  if (!s(input.channelUrl, 300)) errors.channelUrl = "Add your YouTube channel's link.";
  else if (!chan) errors.channelUrl = LINK_TEXT.channel;
  const sample = s(input.sampleUrl, 500);
  if (!sample) errors.sampleUrl = "Add one link to a match video you recorded.";
  if (!recorded) errors.recorded = "Pick one.";
  if (why.length < WHY_MIN) errors.why = "Tell us a little more — at least a sentence";
  if (typeof input.why === "string" && input.why.trim().length > TEXT_MAX) errors.why = `Keep it under ${TEXT_MAX} characters.`;
  if (typeof input.extra === "string" && input.extra.trim().length > TEXT_MAX) errors.extra = `Keep it under ${TEXT_MAX} characters.`;
  const ag = input.agreements ?? {};
  if (!AGREEMENTS.every(([k]) => ag[k] === true)) errors.agreements = "Tick all five to apply.";
  // The network checks only when the rest holds (a failed form shouldn't wait on YouTube).
  let channelCheck: "yes" | "no" | "unknown" = "unknown", sampleId: string | null = null;
  if ((chan && !errors.channelUrl) || sample) {
    const [ch, sv] = await Promise.all([
      chan && !errors.channelUrl ? channelExists(chan, opts.fetchImpl) : Promise.resolve("unknown" as const),
      sample ? checkVideoLink(sample, { fetchImpl: opts.fetchImpl, now }) : Promise.resolve(null),
    ]);
    channelCheck = ch;
    if (ch === "no") errors.channelUrl = LINK_TEXT.channel;
    if (sv && !sv.ok) errors.sampleUrl = sv.error;
    sampleId = sv?.videoId ?? null;
  }
  if (Object.keys(errors).length) return { ok: false, status: 400, error: "Some answers need a fix.", errors };

  const agreements = Object.fromEntries(AGREEMENTS.map(([k]) => [k, true]));
  try {
    const r = await get<{ id: number }>(
      `INSERT INTO verification_applications (user_id, status, team_number, team_name, role, role_other, events_text, channel_url, channel_check, sample_video_url, sample_video_id,
         recorded_self, why_text, extra_text, agreements_json, submitted_at)
       SELECT ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM verification_applications WHERE user_id = ? AND submitted_at > ?) < ?
       RETURNING id`,
      [user.id, team, teamName, role, role === "other" ? roleOther : null, events, chan, channelCheck, sample, sampleId, recorded, why, extra || null, JSON.stringify(agreements), iso(now),
        user.id, iso(now - 30 * DAY), APPLICATIONS_PER_30_DAYS]);
    // The 30-day cap is in the insert itself, so applications sent at once can't each pass a separate count.
    if (!r) return { ok: false, status: 429, code: "spam", error: "You've applied a few times recently — check back later." };
    const id = Number(r.id);
    await run(`INSERT INTO video_contributors (user_id, status, source, application_id, requested_at) VALUES (?, 'pending', 'application', ?, ?)
               ON CONFLICT (user_id) DO UPDATE SET status = 'pending', source = 'application', application_id = excluded.application_id, invite_hash = NULL,
                 requested_at = excluded.requested_at, decided_at = NULL, decided_by = NULL, decision_note = NULL, private_note = NULL, reapply_after = NULL`, [user.id, id, iso(now)]);
    await recordAudit(accountActor(user), "contributor.apply", { userId: user.id, application: id, team });
    void refreshOwnerAlerts();
    return { ok: true, id };
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message))) return { ok: false, status: 409, code: "pending", error: "You already have an application waiting for review." };
    throw e;
  }
}

/** Withdraw a pending application: no cooldown, they may apply again at once. */
export async function withdrawApplication(user: User, now = Date.now()): Promise<boolean> {
  const a = await get<{ id: number }>("SELECT id FROM verification_applications WHERE user_id = ? AND status = 'pending'", [user.id]);
  if (!a) return false;
  await db().batch([
    { sql: "UPDATE verification_applications SET status = 'withdrawn', withdrawn_reason = 'withdrawn by the applicant', decided_at = ? WHERE id = ?", args: [iso(now), a.id] },
    { sql: "DELETE FROM video_contributors WHERE user_id = ? AND status = 'pending' AND source = 'application'", args: [user.id] },
  ], "write");
  await recordAudit(accountActor(user), "contributor.application_withdraw", { userId: user.id, application: a.id, reason: "withdrawn by the applicant" });
  void refreshOwnerAlerts();
  return true;
}

// --- The owner's decisions -----------------------------------------------------------------------------------

/** Links that go public when this account is verified now: team-only ones the owner didn't make team-only, and
 *  links a revocation made only-theirs (back to public on re-verifying). */
async function promotable(userId: number): Promise<number> {
  const r = await get<{ n: number }>(
    "SELECT COUNT(*) n FROM contributor_videos WHERE contributor_user_id = ? AND status = 'live' AND team_only = 0 AND (self_only = 0 OR self_reason = 'revoke')", [userId]);
  return Number(r?.n ?? 0);
}

/** Approve a pending request, or verify an account directly (the owner's escape hatch). A pending application is marked
 *  approved (source direct when the owner verified without it). `self`: the owner verifying their own account. */
export async function approve(userId: number, by: string, opts: { direct?: boolean; now?: number } = {}): Promise<{ ok: true; promoted: number; self: boolean } | { ok: false; error: string }> {
  const now = opts.now ?? Date.now();
  const user = await get<any>("SELECT id, email FROM users WHERE id = ?", [userId]);
  if (!user) return { ok: false, error: "No such account." };
  const c = await get<any>(`SELECT ${VC_COLS} FROM video_contributors WHERE user_id = ?`, [userId]);
  if (c?.status === "verified") return { ok: false, error: "Already verified." };
  if (!opts.direct && c?.status !== "pending") return { ok: false, error: "There's no pending request for that account." };
  const promoted = await promotable(userId);
  const source = c?.status === "pending" && !opts.direct ? c.source : "direct";
  const app = await get<{ id: number }>("SELECT id FROM verification_applications WHERE user_id = ? AND status = 'pending'", [userId]);
  await db().batch([
    {
      sql: `INSERT INTO video_contributors (user_id, status, source, application_id, requested_at, decided_at, decided_by, promoted) VALUES (?, 'verified', ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET status = 'verified', source = excluded.source, decided_at = excluded.decided_at, decided_by = excluded.decided_by,
              decision_note = NULL, revoked_at = NULL, revoke_reason = NULL, reapply_after = NULL, promoted = excluded.promoted`,
      args: [userId, source, app?.id ?? c?.application_id ?? null, c?.requested_at ?? iso(now), iso(now), by, promoted],
    },
    ...(app ? [{ sql: "UPDATE verification_applications SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?", args: [iso(now), by, app.id] }] : []),
    // A revocation had made some only-theirs: verified again, they're public again.
    { sql: "UPDATE contributor_videos SET self_only = 0, self_reason = NULL, updated_at = ? WHERE contributor_user_id = ? AND self_reason = 'revoke'", args: [iso(now), userId] },
  ], "write");
  const self = !!user.email && by.toLowerCase() === String(user.email).toLowerCase();
  await recordAudit(by, self ? "contributor.self_approve" : "contributor.approve", { userId, source, application: app?.id ?? null, promoted }, null, { from: c?.status ?? "none", to: "verified" });
  await notifyContributor(userId, { type: "contributor.verified", title: "You're verified — your video links now go public", body: promoted ? `${promoted} video${promoted === 1 ? "" : "s"} you'd shared with your team ${promoted === 1 ? "is" : "are"} now public.` : "Videos you add to matches now show for everyone.", link: "/settings?section=account#videos" });
  void refreshOwnerAlerts();
  return { ok: true, promoted, self };
}

/** Reject a pending request. `reason`: shown to them (optional); `privateNote`: the owner's own, never shown. */
export async function reject(userId: number, by: string, reason: string | null, privateNote: string | null, now = Date.now()): Promise<{ ok: true; reapplyAfter: string } | { ok: false; error: string }> {
  const c = await get<any>(`SELECT ${VC_COLS} FROM video_contributors WHERE user_id = ?`, [userId]);
  if (c?.status !== "pending") return { ok: false, error: "There's no pending request for that account." };
  const why = reason?.trim().slice(0, TEXT_MAX) || null, note = privateNote?.trim().slice(0, TEXT_MAX) || null;
  const reapplyAfter = iso(now + REJECT_COOLDOWN_DAYS * DAY);
  const app = await get<{ id: number }>("SELECT id FROM verification_applications WHERE user_id = ? AND status = 'pending'", [userId]);
  await db().batch([
    { sql: "UPDATE video_contributors SET status = 'rejected', decided_at = ?, decided_by = ?, decision_note = ?, private_note = ?, reapply_after = ? WHERE user_id = ?", args: [iso(now), by, why, note, reapplyAfter, userId] },
    ...(app ? [{ sql: "UPDATE verification_applications SET status = 'rejected', decided_at = ?, decided_by = ?, decision_note = ?, private_note = ?, reapply_after = ? WHERE id = ?", args: [iso(now), by, why, note, reapplyAfter, app.id] }] : []),
  ], "write");
  await recordAudit(by, "contributor.reject", { userId, source: c.source, application: app?.id ?? null, reasonShared: !!why, reapplyAfter }, null, { from: "pending", to: "rejected" });
  await notifyContributor(userId, { type: "contributor.rejected", title: "Your verification request wasn't approved", body: why ?? NOT_APPROVED_TEXT, link: "/get-verified" });
  void refreshOwnerAlerts();
  return { ok: true, reapplyAfter };
}

/** Revoke a verified contributor. Their public links drop to team-only for the link's team when they're still on it,
 *  else to only-theirs (marked, so verifying again brings them back). Team sharing stays open to them. */
export async function revoke(userId: number, by: string, reason: string, now = Date.now()): Promise<{ ok: true; toTeam: number; toSelf: number } | { ok: false; error: string }> {
  const why = reason.trim().slice(0, TEXT_MAX);
  if (!why) return { ok: false, error: "Say why (the contributor isn't shown it)." };
  const c = await get<any>(`SELECT ${VC_COLS} FROM video_contributors WHERE user_id = ?`, [userId]);
  if (c?.status !== "verified") return { ok: false, error: "That account isn't verified." };
  forgetMembership(userId);
  const teams = (await membershipOf(userId)).map((t) => t.number);
  const links = await all<{ id: number; team_number: number | null }>("SELECT id, team_number FROM contributor_videos WHERE contributor_user_id = ? AND status = 'live' AND self_only = 0 AND team_only = 0", [userId]);
  const lost = links.filter((l) => l.team_number == null || !teams.includes(Number(l.team_number))).map((l) => Number(l.id));
  await db().batch([
    { sql: "UPDATE video_contributors SET status = 'revoked', revoked_at = ?, revoke_reason = ?, decided_by = ? WHERE user_id = ?", args: [iso(now), why, by, userId] },
    ...(lost.length ? [{ sql: `UPDATE contributor_videos SET self_only = 1, self_reason = 'revoke', updated_at = ? WHERE id IN (${lost.map(() => "?").join(", ")})`, args: [iso(now), ...lost] }] : []),
  ], "write");
  await recordAudit(by, "contributor.revoke", { userId, reason: why, links: links.length, toTeam: links.length - lost.length, toSelf: lost.length }, null, { from: "verified", to: "revoked" });
  void refreshOwnerAlerts();
  return { ok: true, toTeam: links.length - lost.length, toSelf: lost.length };
}

// --- The roster ------------------------------------------------------------------------------------------------

export async function grantRoster(email: string, team: number, note: string | null, by: string): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  const u = await get<{ id: number }>("SELECT id FROM users WHERE lower(email) = ?", [email.trim().toLowerCase()]);
  if (!u) return { ok: false, error: "No Control Scout account has that email." };
  if (!Number.isInteger(team) || !(await get("SELECT 1 FROM teams WHERE number = ?", [team]))) return { ok: false, error: `There's no FTC team ${team}.` };
  await run(`INSERT INTO team_members (team_number, user_id, granted_by, granted_at, note) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (team_number, user_id) DO UPDATE SET granted_by = excluded.granted_by, granted_at = excluded.granted_at, revoked_at = NULL, revoked_by = NULL, note = excluded.note`,
    [team, u.id, by, iso(Date.now()), note?.trim().slice(0, 200) || null]);
  forgetMembership(Number(u.id));
  await recordAudit(by, "roster.grant", { team, userId: Number(u.id), note: note?.trim() || null });
  return { ok: true, userId: Number(u.id) };
}

export async function revokeRoster(team: number, userId: number, by: string): Promise<boolean> {
  const n = await run("UPDATE team_members SET revoked_at = ?, revoked_by = ? WHERE team_number = ? AND user_id = ? AND revoked_at IS NULL", [iso(Date.now()), by, team, userId]);
  forgetMembership(userId);
  if (n) await recordAudit(by, "roster.revoke", { team, userId });
  return n > 0;
}
