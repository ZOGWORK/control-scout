// The owner's side of match videos (Owner › Video contributors, docs/contributors.md): one queue of verification
// requests (invite claims and applications together, oldest first), the contributors and their links, the reports
// (grouped by link, most-reported first, then oldest), the invites and the roster. And the actions on one link:
// remove, hide, show again, make team-only, make only-theirs, publish, pick it for its match, play it before FIRST's.
// Nothing happens to a link on reports alone, at any count: only the owner removes or hides one.
import { all, db, get, run } from "../db.js";
import { recordAudit } from "../portal/audit.js";
import { notifyContributor } from "../inbox/inbox.js";
import { nameHistory } from "../auth/username.js";
import { membershipOf } from "./membership.js";
import { readVideoFacts } from "./linkChecks.js";
import { APP_COLS, CV_COLS, INVITE_COLS, VC_COLS, matchKey, queueCounts, refreshOwnerAlerts, tierOf } from "./contributors.js";
import { inviteState } from "./verification.js";
import { AGREEMENTS, REPORT_FLAG_AT, VIDEO_REPORT_REASON_LABEL, type MembershipTeam, type VideoReportReason, type VideoTier } from "../../src/shared/contributors.js";

const iso = () => new Date().toISOString();
const person = (r: any) => ({ id: Number(r.uid ?? r.user_id ?? r.id), name: r.display_name ?? null, username: r.username ?? null, email: r.email ?? null });

export interface OwnerLink {
  id: number; match: string; label: string; event: string; href: string; videoId: string; url: string; t: number;
  contributor: { id: number; name: string | null; username: string | null; email: string | null };
  tier: VideoTier; team: number | null; status: string; createdAt: string; overFirst: boolean; preferred: boolean;
  /** Also linked to another match (a confirmed duplicate), by link id. */
  alsoOn: { id: number; label: string; event: string }[];
  facts: { status: string; length: number | null; region?: boolean; at: string } | null;
  openReports: number; likes: number; removedBy: string | null;
}

async function linkRows(where: string, args: unknown[], limit = 300): Promise<OwnerLink[]> {
  const rows = await all<any>(
    `SELECT ${CV_COLS.split(", ").map((c) => `cv.${c}`).join(", ")}, u.display_name, u.username, u.email, vc.status vstatus, m.label, e.name ename,
       (SELECT COUNT(*) FROM contributor_video_reports r WHERE r.video_id = cv.id AND r.resolved_at IS NULL) open_reports,
       (SELECT COUNT(*) FROM contributor_video_likes l WHERE l.video_id = cv.id) likes
     FROM contributor_videos cv JOIN users u ON u.id = cv.contributor_user_id LEFT JOIN video_contributors vc ON vc.user_id = cv.contributor_user_id
     LEFT JOIN matches m ON m.season = cv.season AND m.code = cv.code AND m.level = cv.level AND m.series = cv.series AND m.number = cv.number
     LEFT JOIN events e ON e.season = cv.season AND e.code = cv.code
     WHERE ${where} ORDER BY cv.created_at DESC LIMIT ${limit}`, args as any[]);
  // Confirmed duplicates both ways: the same video live on another match.
  const vids = [...new Set(rows.map((r) => String(r.video_id)))];
  const others = vids.length ? await all<any>(
    `SELECT cv.id, cv.video_id, cv.season, cv.code, cv.level, cv.series, cv.number, m.label, e.name ename FROM contributor_videos cv
       LEFT JOIN matches m ON m.season = cv.season AND m.code = cv.code AND m.level = cv.level AND m.series = cv.series AND m.number = cv.number
       LEFT JOIN events e ON e.season = cv.season AND e.code = cv.code
      WHERE cv.status = 'live' AND cv.video_id IN (${vids.map(() => "?").join(", ")})`, vids) : [];
  return rows.map((r): OwnerLink => {
    let facts = null;
    try { facts = r.facts_json ? JSON.parse(r.facts_json) : null; } catch { /* unreadable: none */ }
    const ref = `${r.season}:${r.code}:${matchKey(r)}`;
    return {
      id: Number(r.id), match: ref, label: String(r.label ?? matchKey(r)), event: String(r.ename ?? r.code), href: `/events/${r.season}/${encodeURIComponent(r.code)}?match=${matchKey(r)}`,
      videoId: String(r.video_id), url: String(r.url), t: Number(r.t) || 0,
      contributor: { id: Number(r.contributor_user_id), name: r.display_name ?? null, username: r.username ?? null, email: r.email ?? null },
      tier: tierOf(r), team: r.team_number == null ? null : Number(r.team_number), status: String(r.status), createdAt: String(r.created_at),
      overFirst: !!Number(r.over_first), preferred: !!r.preferred_at,
      alsoOn: others.filter((o) => String(o.video_id) === String(r.video_id) && Number(o.id) !== Number(r.id) && `${o.season}:${o.code}:${matchKey(o)}` !== ref)
        .map((o) => ({ id: Number(o.id), label: String(o.label ?? matchKey(o)), event: String(o.ename ?? o.code) })),
      facts, openReports: Number(r.open_reports) || 0, likes: Number(r.likes) || 0, removedBy: r.removed_by ?? null,
    };
  });
}

export interface OwnerRequest {
  user: { id: number; name: string | null; username: string | null; email: string | null };
  source: "invite" | "application"; since: string;
  teams: MembershipTeam[];
  invite: { intendedEmail: string; note: string | null; claimedAt: string | null; emailMatches: boolean } | null;
  application: Record<string, unknown> | null;
  /** Every application this account has sent (a spam pattern shows here). */
  history: { id: number; status: string; submittedAt: string }[];
}

export async function ownerContributors() {
  const pending = await all<any>(
    `SELECT ${VC_COLS.split(", ").map((c) => `vc.${c}`).join(", ")}, u.id uid, u.display_name, u.username, u.email FROM video_contributors vc JOIN users u ON u.id = vc.user_id WHERE vc.status = 'pending' ORDER BY vc.requested_at ASC`);
  const requests: OwnerRequest[] = [];
  for (const p of pending) {
    const [teams, inv, app, history] = await Promise.all([
      membershipOf(Number(p.user_id)),
      p.invite_hash ? get<any>(`SELECT ${INVITE_COLS} FROM contributor_invites WHERE token_hash = ?`, [p.invite_hash]) : Promise.resolve(null),
      p.application_id ? get<any>(`SELECT ${APP_COLS} FROM verification_applications WHERE id = ?`, [p.application_id]) : Promise.resolve(null),
      all<any>("SELECT id, status, submitted_at FROM verification_applications WHERE user_id = ? ORDER BY id", [p.user_id]),
    ]);
    requests.push({
      user: person(p), source: p.source === "invite" ? "invite" : "application", since: String(p.requested_at), teams,
      invite: inv ? { intendedEmail: inv.email, note: inv.note ?? null, claimedAt: inv.claimed_at ?? null, emailMatches: String(inv.email).toLowerCase() === String(p.email ?? "").toLowerCase() } : null,
      application: app ? {
        id: Number(app.id), teamNumber: Number(app.team_number), teamName: app.team_name, role: app.role, roleOther: app.role_other, events: app.events_text,
        channelUrl: app.channel_url, channelCheck: app.channel_check, sampleUrl: app.sample_video_url, sampleVideoId: app.sample_video_id, recorded: app.recorded_self,
        why: app.why_text, extra: app.extra_text, agreements: AGREEMENTS.map(([k, text]) => ({ text, checked: JSON.parse(app.agreements_json ?? "{}")[k] === true })),
        submittedAt: app.submitted_at,
      } : null,
      history: history.map((h) => ({ id: Number(h.id), status: String(h.status), submittedAt: String(h.submitted_at) })),
    });
  }
  const people = await all<any>(
    `SELECT ${VC_COLS.split(", ").map((c) => `vc.${c}`).join(", ")}, u.id uid, u.display_name, u.username, u.email,
       (SELECT COUNT(*) FROM contributor_videos cv WHERE cv.contributor_user_id = vc.user_id AND cv.status = 'live') live
     FROM video_contributors vc JOIN users u ON u.id = vc.user_id WHERE vc.status <> 'pending' ORDER BY COALESCE(vc.decided_at, vc.requested_at) DESC LIMIT 300`);
  const contributors = await Promise.all(people.map(async (p) => ({
    user: person(p), status: String(p.status), source: String(p.source), decidedAt: p.decided_at ?? null, decidedBy: p.decided_by ?? null,
    reasonShared: p.decision_note ?? null, privateNote: p.private_note ?? null, reapplyAfter: p.reapply_after ?? null, revokedAt: p.revoked_at ?? null, revokeReason: p.revoke_reason ?? null,
    promoted: Number(p.promoted) || 0, liveLinks: Number(p.live) || 0, teams: await membershipOf(Number(p.user_id)), names: await nameHistory(Number(p.user_id)),
    noName: !String(p.display_name ?? "").trim(),
  })));
  // Team-only contributors (never asked to be verified) are in the links list.
  const links = await linkRows("cv.status IN ('live', 'hidden')", []);
  const recentlyRemoved = await linkRows("cv.status = 'removed'", [], 50);
  const reports = await ownerReports();
  const invites = (await all<any>(`SELECT ${INVITE_COLS} FROM contributor_invites ORDER BY created_at DESC LIMIT 100`)).map(async (i) => {
    const claimer = i.claimed_by_user_id != null ? await get<any>("SELECT id, display_name, username, email FROM users WHERE id = ?", [i.claimed_by_user_id]) : null;
    const target = await get<any>("SELECT u.id, vc.status FROM users u LEFT JOIN video_contributors vc ON vc.user_id = u.id WHERE lower(u.email) = ?", [i.email]);
    const state = inviteState(i);
    return {
      id: String(i.token_hash).slice(0, 16), email: i.email, note: i.note ?? null, createdAt: i.created_at, expiresAt: i.expires_at, state,
      claimedBy: claimer ? person(claimer) : null, claimedAt: i.claimed_at ?? null,
      /** The person it was for is verified another way: the invite isn't needed. */
      noLongerNeeded: state === "valid" && target?.status === "verified",
    };
  });
  const roster = (await all<any>(
    `SELECT r.team_number, r.user_id, r.granted_by, r.granted_at, r.revoked_at, r.note, u.display_name, u.username, u.email, t.name team_name FROM team_members r JOIN users u ON u.id = r.user_id LEFT JOIN teams t ON t.number = r.team_number ORDER BY r.revoked_at IS NOT NULL, r.team_number, r.granted_at`)).map((r) => ({
    team: Number(r.team_number), teamName: r.team_name ?? null, user: person(r), grantedBy: r.granted_by, grantedAt: r.granted_at, revokedAt: r.revoked_at ?? null, note: r.note ?? null,
  }));
  return { counts: await queueCounts(), requests, contributors, links, recentlyRemoved, reports, invites: await Promise.all(invites), roster };
}

/** Open reports grouped by link: most-reported first, then the oldest report first; 5+ flagged. Each reporter's
 *  dismissed-report count shows a false-report pattern (nothing is done about it automatically). */
export async function ownerReports() {
  const rows = await all<any>(
    `SELECT r.id, r.video_id, r.reporter_user_id, r.reason, r.note, r.created_at, u.display_name, u.username, u.email,
       (SELECT COUNT(*) FROM contributor_video_reports d WHERE d.reporter_user_id = r.reporter_user_id AND d.resolution = 'dismissed') dismissed
     FROM contributor_video_reports r JOIN users u ON u.id = r.reporter_user_id WHERE r.resolved_at IS NULL ORDER BY r.created_at`);
  const byLink = new Map<number, any[]>();
  for (const r of rows) { const k = Number(r.video_id); (byLink.get(k) ?? byLink.set(k, []).get(k)!).push(r); }
  if (!byLink.size) return [];
  const links = await linkRows(`cv.id IN (${[...byLink.keys()].map(() => "?").join(", ")})`, [...byLink.keys()], 500);
  return links.map((l) => {
    const rs = byLink.get(l.id) ?? [];
    const counts: Partial<Record<VideoReportReason, number>> = {};
    for (const r of rs) counts[r.reason as VideoReportReason] = (counts[r.reason as VideoReportReason] ?? 0) + 1;
    return {
      link: l, open: rs.length, flagged: rs.length >= REPORT_FLAG_AT, oldest: String(rs[0]?.created_at ?? ""),
      reasons: Object.entries(counts).map(([reason, n]) => ({ reason, label: VIDEO_REPORT_REASON_LABEL[reason as VideoReportReason] ?? reason, n })),
      reports: rs.map((r) => ({ id: Number(r.id), reason: r.reason, label: VIDEO_REPORT_REASON_LABEL[r.reason as VideoReportReason] ?? r.reason, note: r.note || null, at: r.created_at, reporter: person({ ...r, uid: r.reporter_user_id }), reporterDismissed: Number(r.dismissed) || 0 })),
    };
  }).sort((a, b) => b.open - a.open || a.oldest.localeCompare(b.oldest));
}

export type LinkAction = "remove" | "hide" | "unhide" | "teamOnly" | "selfOnly" | "publish" | "prefer" | "overFirst" | "underFirst" | "dismiss" | "check";
export const LINK_ACTIONS: LinkAction[] = ["remove", "hide", "unhide", "teamOnly", "selfOnly", "publish", "prefer", "overFirst", "underFirst", "dismiss", "check"];

/** One owner action on one link; every one audited with the reason and the reports it resolved. */
export async function ownerLinkAction(id: number, action: LinkAction, by: string, reason: string | null): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const r = await get<any>(`SELECT ${CV_COLS.split(", ").map((c) => `cv.${c}`).join(", ")}, m.label, e.name ename, vc.status vstatus FROM contributor_videos cv LEFT JOIN video_contributors vc ON vc.user_id = cv.contributor_user_id LEFT JOIN matches m ON m.season = cv.season AND m.code = cv.code AND m.level = cv.level AND m.series = cv.series AND m.number = cv.number LEFT JOIN events e ON e.season = cv.season AND e.code = cv.code WHERE cv.id = ?`, [id]);
  if (!r) return { ok: false, status: 404, error: "No such video link." };
  const at = iso();
  const label = `${r.label ?? matchKey(r)} at ${r.ename ?? r.code}`;
  const href = `/events/${r.season}/${encodeURIComponent(r.code)}?match=${matchKey(r)}`;
  const open = Number((await get<{ n: number }>("SELECT COUNT(*) n FROM contributor_video_reports WHERE video_id = ? AND resolved_at IS NULL", [id]))?.n ?? 0);
  const resolve = (resolution: string) => ({ sql: "UPDATE contributor_video_reports SET resolved_at = ?, resolved_by = ?, resolution = ? WHERE video_id = ? AND resolved_at IS NULL", args: [at, by, resolution, id] });
  const tierBefore = tierOf(r);
  let notice: { title: string; type: string } | null = null;
  switch (action) {
    case "remove":
      if (r.status === "removed") return { ok: false, status: 409, error: "Already removed." };
      await db().batch([
        { sql: "UPDATE contributor_videos SET status = 'removed', removed_by = ?, removed_reason = ?, updated_at = ? WHERE id = ?", args: [by, reason, at, id] },
        { sql: "DELETE FROM contributor_video_likes WHERE video_id = ?", args: [id] }, resolve("removed"),
      ], "write");
      notice = { type: "video.removed", title: `One of your videos was removed: ${label}` };
      break;
    case "hide":
      await db().batch([{ sql: "UPDATE contributor_videos SET status = 'hidden', removed_by = ?, removed_reason = ?, updated_at = ? WHERE id = ? AND status = 'live'", args: [by, reason, at, id] }, resolve("hidden")], "write");
      notice = { type: "video.hidden", title: `Your video of ${label} is now hidden` };
      break;
    case "unhide":
      await run("UPDATE contributor_videos SET status = 'live', removed_by = NULL, removed_reason = NULL, updated_at = ? WHERE id = ? AND status = 'hidden'", [at, id]);
      break;
    case "teamOnly":
      if (r.team_number == null) return { ok: false, status: 400, error: "This link has no team to keep it to: make it only theirs instead." };
      await db().batch([{ sql: "UPDATE contributor_videos SET team_only = 1, self_only = 0, self_reason = NULL, updated_at = ? WHERE id = ?", args: [at, id] }, resolve("demoted")], "write");
      notice = { type: "video.demoted", title: `Your video of ${label} is now visible to your team only` };
      break;
    case "selfOnly":
      await db().batch([{ sql: "UPDATE contributor_videos SET self_only = 1, self_reason = 'owner', updated_at = ? WHERE id = ?", args: [at, id] }, resolve("demoted")], "write");
      notice = { type: "video.demoted", title: `Your video of ${label} is now visible to you only` };
      break;
    case "publish":
      // Back to what the contributor's status gives it (public when they're verified).
      await run("UPDATE contributor_videos SET team_only = 0, self_only = 0, self_reason = NULL, updated_at = ? WHERE id = ?", [at, id]);
      if (r.vstatus === "verified") notice = { type: "video.published", title: `Your video of ${label} is now public` };
      break;
    case "prefer":
      await run("UPDATE contributor_videos SET preferred_at = ?, updated_at = ? WHERE id = ?", [at, at, id]);
      break;
    case "overFirst": case "underFirst":
      await run("UPDATE contributor_videos SET over_first = ?, updated_at = ? WHERE id = ?", [action === "overFirst" ? 1 : 0, at, id]);
      break;
    case "dismiss":
      if (!open) return { ok: false, status: 409, error: "No open reports on it." };
      await db().batch([resolve("dismissed")], "write");
      break;
    case "check": {
      const f = await readVideoFacts(String(r.video_id));
      await run("UPDATE contributor_videos SET facts_json = ? WHERE id = ?", [JSON.stringify({ status: f.status, length: f.length, ...(f.region ? { region: true } : {}), at }), id]);
      break;
    }
  }
  await recordAudit(by, `video.${action}`, { link: id, videoId: r.video_id, match: `${r.season}:${r.code}:${matchKey(r)}`, contributor: Number(r.contributor_user_id), reason, reportsResolved: ["remove", "hide", "teamOnly", "selfOnly", "dismiss"].includes(action) ? open : 0, tierBefore });
  if (notice) await notifyContributor(Number(r.contributor_user_id), { ...notice, body: action === "remove" ? "It no longer shows on Control Scout." : "", link: href });
  void refreshOwnerAlerts();
  return { ok: true };
}
