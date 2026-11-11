// Match videos people add (docs/contributors.md): who may see each, which one a match plays, and adding, editing,
// removing, liking and reporting them. Every read is for one viewer and decided here, in the data layer: a viewer
// who may not see a link never receives anything about it (no video id, no thumbnail, no count, no credit), and
// these reads are never kept in a shared cache (the routes answer no-store).
//
// A link's tier is worked out when it is read, from the contributor's status now:
//   public  the contributor is verified and the owner hasn't made the link team-only or only-them
//   team    otherwise, when it has a team (team_number) and isn't only-them: that team's members (./membership.ts)
//   self    otherwise: the contributor alone
// The credit is the contributor's actual name (users.display_name) as it is now; a link whose contributor has no name
// isn't served until they set one. The username never leaves the server with a link (only their profile's address).
import type { InStatement } from "@libsql/client";
import { all, db, get, run } from "../db.js";
import { membershipOf, teamNumbersOf } from "./membership.js";
import { checkVideoLink, LINK_TEXT, type LinkCheck } from "./linkChecks.js";
import { recordAudit } from "../portal/audit.js";
import { accountActor } from "../auth/username.js";
import type { User } from "../auth/session.js";
import { linkStart } from "../../src/shared/recording.js";
import { youtubeId } from "../../src/shared/personal.js";
import {
  isVideoReportReason, LINKS_PER_DAY, LINKS_PER_MATCH_PER_DAY, NOT_APPROVED_TEXT, TEXT_MAX,
  type ContributorProfile, type ContributorStatus, type ContributorVideo, type ContributorSource, type EventCoverage, type MyContributorStatus, type ProfileVideo, type VideoTier,
} from "../../src/shared/contributors.js";
import { creditLine } from "../../src/shared/username.js";

/** The tables' columns, named (none read as a star select: server/selectStar.test.ts). */
export const VC_COLS = "user_id, status, source, application_id, invite_hash, requested_at, decided_at, decided_by, decision_note, private_note, revoked_at, revoke_reason, reapply_after, promoted";
export const INVITE_COLS = "token_hash, email, note, created_by, created_at, expires_at, claimed_by_user_id, claimed_at, revoked_at";
export const APP_COLS = "id, user_id, status, team_number, team_name, role, role_other, events_text, channel_url, channel_check, sample_video_url, sample_video_id, recorded_self, why_text, extra_text, agreements_json, submitted_at, decided_at, decided_by, decision_note, private_note, reapply_after, withdrawn_reason";
export const CV_COLS = "id, season, code, level, series, number, video_id, url, t, contributor_user_id, team_number, team_only, self_only, self_reason, status, preferred_at, over_first, facts_json, duplicate_of, created_at, updated_at, removed_by, removed_reason";

/** Who is looking: their account (null signed out) and the teams the server counts them on. */
export interface Viewer { userId: number | null; teams: number[] }
export const SIGNED_OUT: Viewer = { userId: null, teams: [] };
export async function viewerOf(user: User | null): Promise<Viewer> {
  return user ? { userId: user.id, teams: await teamNumbersOf(user.id) } : SIGNED_OUT;
}

/** A match, as its key in an event ("qual:0:6") and its parts. */
export interface MatchId { season: number; code: string; level: string; series: number; number: number }
export const matchKey = (m: Pick<MatchId, "level" | "series" | "number">) => `${m.level}:${m.series}:${m.number}`;
export function parseMatchKey(key: string): Pick<MatchId, "level" | "series" | "number"> | null {
  const m = /^(qual|playoff):(\d{1,3}):(\d{1,4})$/.exec(key);
  return m ? { level: m[1], series: Number(m[2]), number: Number(m[3]) } : null;
}

interface Row {
  id: number; season: number; code: string; level: string; series: number; number: number; video_id: string; t: number;
  team_number: number | null; team_only: number; self_only: number; over_first: number; preferred_at: string | null;
  contributor_user_id: number; display_name: string | null; username: string | null; vstatus: string | null; likes: number; liked: number; created_at: string;
}

const SELECT = `SELECT cv.id, cv.season, cv.code, cv.level, cv.series, cv.number, cv.video_id, cv.t, cv.team_number, cv.team_only, cv.self_only,
    cv.over_first, cv.preferred_at, cv.contributor_user_id, cv.created_at, u.display_name, u.username, vc.status vstatus,
    (SELECT COUNT(*) FROM contributor_video_likes l WHERE l.video_id = cv.id) likes,
    EXISTS (SELECT 1 FROM contributor_video_likes l WHERE l.video_id = cv.id AND l.user_id = ?) liked
  FROM contributor_videos cv JOIN users u ON u.id = cv.contributor_user_id
  LEFT JOIN video_contributors vc ON vc.user_id = cv.contributor_user_id
  WHERE cv.status = 'live' AND TRIM(COALESCE(u.display_name, '')) <> ''`;

/** The link's tier now. */
export function tierOf(r: Pick<Row, "vstatus" | "team_only" | "self_only" | "team_number">): VideoTier {
  if (r.vstatus === "verified" && !r.team_only && !r.self_only) return "public";
  if (r.team_number != null && !r.self_only) return "team";
  return "self";
}

/** May this viewer see it? */
export function canSee(r: Pick<Row, "vstatus" | "team_only" | "self_only" | "team_number" | "contributor_user_id">, v: Viewer): boolean {
  const tier = tierOf(r);
  if (tier === "public") return true;
  if (v.userId != null && v.userId === Number(r.contributor_user_id)) return true;
  return tier === "team" && v.userId != null && v.teams.includes(Number(r.team_number));
}

const TIER_ORDER: Record<VideoTier, number> = { public: 0, team: 1, self: 2 };

function toVideo(r: Row, v: Viewer): ContributorVideo & { overFirst: boolean } {
  const tier = tierOf(r);
  return {
    id: Number(r.id), videoId: String(r.video_id), t: Number(r.t) || 0, tier, team: r.team_number == null ? null : Number(r.team_number),
    name: String(r.display_name).trim(), verified: tier === "public", profile: r.username ? `/contributors/${encodeURIComponent(r.username)}` : null,
    likes: Number(r.likes) || 0, liked: !!Number(r.liked), mine: v.userId != null && v.userId === Number(r.contributor_user_id), overFirst: !!Number(r.over_first),
  };
}

/** The winning link per match among those this viewer may see: public before team before only-them, then the owner's
 *  pick, then the first added. */
function winners(rows: Row[], v: Viewer): Map<string, ContributorVideo & { overFirst: boolean }> {
  const best = new Map<string, Row>();
  const rank = (r: Row) => [TIER_ORDER[tierOf(r)], r.preferred_at ? -Date.parse(r.preferred_at) : 0, Number(r.id)];
  const before = (a: Row, b: Row) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
  for (const r of rows) {
    if (!canSee(r, v)) continue;
    const k = `${r.season}:${r.code}:${matchKey(r)}`;
    const cur = best.get(k);
    if (!cur || before(r, cur)) best.set(k, r);
  }
  return new Map([...best].map(([k, r]) => [k, toVideo(r, v)]));
}

/** Every match's winning link at one event, for this viewer, by match key. */
export async function eventVideos(season: number, code: string, v: Viewer): Promise<Map<string, ContributorVideo & { overFirst: boolean }>> {
  const rows = await all<Row>(`${SELECT} AND cv.season = ? AND cv.code = ?`, [v.userId, season, code]);
  const w = winners(rows, v);
  return new Map([...w].map(([k, x]) => [k.split(":").slice(2).join(":"), x]));
}

/** The winning link for each of these matches ("season:code:level:series:number"), for this viewer. */
export async function matchVideos(refs: string[], v: Viewer): Promise<Map<string, ContributorVideo & { overFirst: boolean }>> {
  const ids = [...new Set(refs)].slice(0, 400).map((r) => r.split(":")).filter((p) => p.length === 5 && /^\d{4}$/.test(p[0]));
  if (!ids.length) return new Map();
  // One read per event (the index covers season, code, …), then the matches asked for.
  const events = [...new Set(ids.map((p) => `${p[0]}:${p[1]}`))].slice(0, 40);
  const rows = await all<Row>(`${SELECT} AND (${events.map(() => "(cv.season = ? AND cv.code = ?)").join(" OR ")})`,
    [v.userId, ...events.flatMap((e) => { const [s, c] = e.split(":"); return [Number(s), c]; })]);
  const want = new Set(ids.map((p) => p.join(":")));
  return new Map([...winners(rows, v)].filter(([k]) => want.has(k)));
}

/** How much of an event this viewer can watch: its played matches, and those with FIRST's video, a place in the
 *  recording, or a contributor link they may see. */
export function coverageOf(matches: { key: string; played: boolean; video: string | null; clip?: unknown }[], contributed: Map<string, unknown>): EventCoverage {
  let played = 0, withVideo = 0;
  for (const m of matches) {
    if (!m.played) continue;
    played++;
    if (m.video || m.clip || contributed.has(m.key)) withVideo++;
  }
  return { played, withVideo };
}

// --- The contributor's own status ------------------------------------------------------------------------

export async function contributorRow(userId: number) {
  return get<any>(`SELECT ${VC_COLS} FROM video_contributors WHERE user_id = ?`, [userId]);
}

export async function statusOf(user: User, now = Date.now()): Promise<MyContributorStatus> {
  const [row, teams, pendingApp] = await Promise.all([
    contributorRow(user.id), membershipOf(user.id),
    get<any>("SELECT submitted_at FROM verification_applications WHERE user_id = ? AND status = 'pending'", [user.id]),
  ]);
  const status: ContributorStatus = (row?.status as ContributorStatus) ?? "none";
  const ready = !!user.username && !!user.displayName?.trim();
  const rejected = status === "rejected" ? { reason: row.decision_note ?? null, reapplyAfter: row.reapply_after && Date.parse(row.reapply_after) > now ? row.reapply_after : null } : null;
  return {
    status, source: (row?.source as ContributorSource) ?? null, teams,
    pending: status === "pending" ? { since: pendingApp?.submitted_at ?? row.requested_at, source: row.source } : null,
    rejected, ready, credit: user.displayName?.trim() ? creditLine(user.displayName.trim()) : null,
  };
}
export { NOT_APPROVED_TEXT };

// --- Adding a link -------------------------------------------------------------------------------------------

export type AddResult =
  | { ok: true; video: ContributorVideo; shown: boolean; occupiedBy?: string; firstPlays?: boolean; warnings: LinkCheck["warnings"] }
  | { ok: false; status: number; code: string; error: string; field?: string; duplicate?: { label: string; event: string; href: string }; warnings?: LinkCheck["warnings"] };

export interface AddInput { url: string; team?: number | null; t?: number | null; confirmDuplicate?: boolean; confirmLong?: boolean }

/** The match, when it exists and was played (its label and event name for the words). */
async function playedMatch(m: MatchId) {
  return get<{ played: number; label: string; name: string; video: string | null }>(
    "SELECT m.played, m.label, e.name, m.video FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE m.season = ? AND m.code = ? AND m.level = ? AND m.series = ? AND m.number = ?",
    [m.season, m.code, m.level, m.series, m.number]);
}

/** Add a link to a match. Verified: public at once. Not verified: for one of their teams (checked here, never taken
 *  from the client), at once. No team: refused (the app keeps it as a personal link instead). */
export async function addVideo(user: User, m: MatchId, input: AddInput, opts: { fetchImpl?: typeof fetch; now?: number } = {}): Promise<AddResult> {
  const now = opts.now ?? Date.now();
  if (!user.username || !user.displayName?.trim()) return { ok: false, status: 428, code: "setup", error: "Add a username and your actual name first." };
  const match = await playedMatch(m);
  if (!match) return { ok: false, status: 404, code: "match", error: "That match isn't in Control Scout." };
  if (!match.played) return { ok: false, status: 400, code: "unplayed", error: "That match hasn't been played yet." };
  const row = await contributorRow(user.id);
  const verified = row?.status === "verified";
  const teams = await teamNumbersOf(user.id);
  let team: number | null = input.team != null ? Number(input.team) : null;
  if (team != null && !teams.includes(team)) return { ok: false, status: 403, code: "team", error: "You're not on that team in Control Scout.", field: "team" };
  if (!verified && team == null) {
    if (!teams.length) return { ok: false, status: 403, code: "noTeam", error: "You need a team to share with your team, or get verified to share with everyone." };
    team = teams[0];
  }
  if (verified && team == null) team = teams[0] ?? null; // where it falls back to, should they ever be revoked
  const t = Math.max(0, Math.floor(Number(input.t) || linkStart(input.url.trim()) || 0));
  const check = await checkVideoLink(input.url, { t, fetchImpl: opts.fetchImpl, now });
  if (!check.ok) return { ok: false, status: 400, code: "link", error: check.error!, field: "url" };
  if (check.warnings.includes("long") && !input.confirmLong) return { ok: false, status: 409, code: "long", error: LINK_TEXT.long, field: "url", warnings: check.warnings };
  // The same video live on a different match: the wrong-match paste. Asked first, never silently allowed.
  const dup = await get<any>(
    `SELECT cv.id, cv.season, cv.code, cv.level, cv.series, cv.number, m.label, e.name FROM contributor_videos cv
       LEFT JOIN matches m ON m.season = cv.season AND m.code = cv.code AND m.level = cv.level AND m.series = cv.series AND m.number = cv.number
       LEFT JOIN events e ON e.season = cv.season AND e.code = cv.code
      WHERE cv.video_id = ? AND cv.status = 'live' AND NOT (cv.season = ? AND cv.code = ? AND cv.level = ? AND cv.series = ? AND cv.number = ?) ORDER BY cv.id LIMIT 1`,
    [check.videoId!, m.season, m.code, m.level, m.series, m.number]);
  const dupInfo = dup ? { label: String(dup.label ?? matchKey(dup)), event: String(dup.name ?? dup.code), href: `/events/${dup.season}/${encodeURIComponent(dup.code)}?match=${matchKey(dup)}` } : undefined;
  if (dup && !input.confirmDuplicate) {
    return { ok: false, status: 409, code: "duplicate", error: `This video is already linked to ${dupInfo!.label} at ${dupInfo!.event} — are you sure it's ${match.label}?`, duplicate: dupInfo };
  }
  const since = new Date(now - 864e5).toISOString(), at = new Date(now).toISOString();
  // The day's limits are in the insert itself, so links sent at once can't each pass a separate count.
  const inserted = await get<{ id: number }>(
    `INSERT INTO contributor_videos (season, code, level, series, number, video_id, url, t, contributor_user_id, team_number, facts_json, duplicate_of, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM contributor_videos WHERE contributor_user_id = ? AND created_at > ?) < ?
        AND (SELECT COUNT(*) FROM contributor_videos WHERE contributor_user_id = ? AND created_at > ? AND season = ? AND code = ? AND level = ? AND series = ? AND number = ?) < ?
     RETURNING id`,
    [m.season, m.code, m.level, m.series, m.number, check.videoId!, input.url.trim().slice(0, 500), t, user.id, team, JSON.stringify(check.facts ?? null), dup ? Number(dup.id) : null, at, at,
      user.id, since, LINKS_PER_DAY, user.id, since, m.season, m.code, m.level, m.series, m.number, LINKS_PER_MATCH_PER_DAY]);
  if (!inserted) return { ok: false, status: 429, code: "slowDown", error: "Slow down — that's a lot of videos for one day. Try again tomorrow." };
  const id = Number(inserted.id);
  if (dup) await recordAudit(accountActor(user), "video.duplicate_confirmed", { videoId: check.videoId, link: id, also: Number(dup.id), match: `${m.season}:${m.code}:${matchKey(m)}`, otherMatch: `${dup.season}:${dup.code}:${matchKey(dup)}` });
  await recordAudit(accountActor(user), "video.add", { link: id, videoId: check.videoId, match: `${m.season}:${m.code}:${matchKey(m)}`, tier: verified ? "public" : "team", team });
  const v: Viewer = { userId: user.id, teams };
  const all_ = await eventVideos(m.season, m.code, v);
  const win = all_.get(matchKey(m));
  const mine = (await all<Row>(`${SELECT} AND cv.id = ?`, [user.id, id]))[0];
  const video = toVideo(mine, v);
  // FIRST's own video plays first unless the owner chose this link over it (pickMatchVideo): then it's saved, not shown.
  const firstPlays = !!match.video && !win?.overFirst;
  return { ok: true, video, shown: win?.id === id && !firstPlays, ...(firstPlays ? { firstPlays: true } : win && win.id !== id ? { occupiedBy: win.name } : {}), warnings: check.warnings };
}

// --- The contributor's own link ------------------------------------------------------------------------

async function ownLive(user: User, id: number) {
  return get<any>(`SELECT ${CV_COLS} FROM contributor_videos WHERE id = ? AND contributor_user_id = ? AND status IN ('live', 'hidden')`, [id, user.id]);
}

/** Remove their own link, for everyone, at once. Its likes go with it; its open reports are resolved as removed
 *  (kept for the owner). Nobody is notified: it's their own action. */
export async function removeOwnVideo(user: User, id: number): Promise<boolean> {
  const r = await ownLive(user, id);
  if (!r) return false;
  const at = new Date().toISOString();
  await db().batch([
    { sql: "UPDATE contributor_videos SET status = 'removed', removed_by = 'contributor', removed_reason = NULL, updated_at = ? WHERE id = ?", args: [at, id] },
    { sql: "DELETE FROM contributor_video_likes WHERE video_id = ?", args: [id] },
    { sql: "UPDATE contributor_video_reports SET resolved_at = ?, resolved_by = 'contributor', resolution = 'removed' WHERE video_id = ? AND resolved_at IS NULL", args: [at, id] },
  ], "write");
  await recordAudit(accountActor(user), "video.remove_own", { link: id, videoId: r.video_id, match: `${r.season}:${r.code}:${matchKey(r)}` });
  return true;
}

/** Change their own link's video (the same checks as adding; the long-video and duplicate questions too). */
export async function editOwnVideo(user: User, id: number, input: AddInput, opts: { fetchImpl?: typeof fetch } = {}): Promise<AddResult | null> {
  const r = await ownLive(user, id);
  if (!r) return null;
  const t = Math.max(0, Math.floor(Number(input.t) || linkStart(input.url.trim()) || 0));
  const check = await checkVideoLink(input.url, { t, fetchImpl: opts.fetchImpl });
  if (!check.ok) return { ok: false, status: 400, code: "link", error: check.error!, field: "url" };
  if (check.warnings.includes("long") && !input.confirmLong) return { ok: false, status: 409, code: "long", error: LINK_TEXT.long, field: "url", warnings: check.warnings };
  const dup = check.videoId !== r.video_id ? await get<any>(
    `SELECT cv.id, cv.season, cv.code, cv.level, cv.series, cv.number, m.label, e.name FROM contributor_videos cv
       LEFT JOIN matches m ON m.season = cv.season AND m.code = cv.code AND m.level = cv.level AND m.series = cv.series AND m.number = cv.number
       LEFT JOIN events e ON e.season = cv.season AND e.code = cv.code
      WHERE cv.video_id = ? AND cv.status = 'live' AND cv.id <> ? AND NOT (cv.season = ? AND cv.code = ? AND cv.level = ? AND cv.series = ? AND cv.number = ?) LIMIT 1`,
    [check.videoId!, id, r.season, r.code, r.level, r.series, r.number]) : null;
  if (dup && !input.confirmDuplicate) {
    const label = String(dup.label ?? matchKey(dup));
    return { ok: false, status: 409, code: "duplicate", error: `This video is already linked to ${label} at ${dup.name ?? dup.code} — are you sure it's this match?`, duplicate: { label, event: String(dup.name ?? dup.code), href: `/events/${dup.season}/${encodeURIComponent(dup.code)}?match=${matchKey(dup)}` } };
  }
  await run("UPDATE contributor_videos SET video_id = ?, url = ?, t = ?, facts_json = ?, duplicate_of = ?, updated_at = ? WHERE id = ?",
    [check.videoId!, input.url.trim().slice(0, 500), t, JSON.stringify(check.facts ?? null), dup ? Number(dup.id) : r.duplicate_of ?? null, new Date().toISOString(), id]);
  await recordAudit(accountActor(user), "video.edit", { link: id, from: r.video_id, to: check.videoId });
  const v = await viewerOf(user);
  const mine = (await all<Row>(`${SELECT} AND cv.id = ?`, [user.id, id]))[0];
  return { ok: true, video: toVideo(mine, v), shown: true, warnings: check.warnings };
}

/** The contributor's own live links on a match (every one, the winner or not), for their panel. */
export async function ownVideosOn(user: User, m: MatchId): Promise<(ContributorVideo & { shown: boolean })[]> {
  const v = await viewerOf(user);
  const rows = await all<Row>(`${SELECT} AND cv.season = ? AND cv.code = ? AND cv.level = ? AND cv.series = ? AND cv.number = ? AND cv.contributor_user_id = ? ORDER BY cv.id`,
    [user.id, m.season, m.code, m.level, m.series, m.number, user.id]);
  const [win, match] = await Promise.all([eventVideos(m.season, m.code, v).then((x) => x.get(matchKey(m))), playedMatch(m)]);
  const firstPlays = !!match?.video && !win?.overFirst;
  return rows.map((r) => ({ ...toVideo(r, v), shown: win?.id === Number(r.id) && !firstPlays }));
}

// --- Likes and reports: only on a link the viewer may see (else 404, as if it didn't exist) -------------------

/** The live link, when this viewer may see it. */
export async function visibleVideo(id: number, v: Viewer): Promise<Row | null> {
  const r = (await all<Row>(`${SELECT} AND cv.id = ?`, [v.userId, id]))[0];
  return r && canSee(r, v) ? r : null;
}

export async function setLike(user: User, id: number, on: boolean): Promise<{ likes: number; liked: boolean } | null> {
  const v = await viewerOf(user);
  if (!(await visibleVideo(id, v))) return null;
  if (on) await run("INSERT OR IGNORE INTO contributor_video_likes (video_id, user_id, created_at) VALUES (?, ?, ?)", [id, user.id, new Date().toISOString()]);
  else await run("DELETE FROM contributor_video_likes WHERE video_id = ? AND user_id = ?", [id, user.id]);
  const n = await get<{ c: number }>("SELECT COUNT(*) c FROM contributor_video_likes WHERE video_id = ?", [id]);
  return { likes: Number(n?.c ?? 0), liked: on };
}

export const REPORTS_PER_DAY = 20;
export type ReportResult = { ok: true; already: boolean } | { ok: false; status: number; error: string };

export async function reportVideo(user: User, id: number, reason: unknown, note: unknown, now = new Date()): Promise<ReportResult> {
  if (!isVideoReportReason(reason)) return { ok: false, status: 400, error: "Pick what's wrong with it." };
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > TEXT_MAX) return { ok: false, status: 400, error: `Keep the note under ${TEXT_MAX} characters.` };
  const v = await viewerOf(user);
  const r = await visibleVideo(id, v);
  if (!r) return { ok: false, status: 404, error: "That video isn't here any more." };
  if (Number(r.contributor_user_id) === user.id) return { ok: false, status: 400, error: "That's your own video: edit or remove it instead." };
  const since = new Date(now.getTime() - 864e5).toISOString();
  const wrote = await run(
    `INSERT INTO contributor_video_reports (video_id, reporter_user_id, reason, note, created_at)
     SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM contributor_video_reports WHERE reporter_user_id = ? AND created_at > ?) < ?
     ON CONFLICT (video_id, reporter_user_id) WHERE resolved_at IS NULL DO NOTHING`,
    [id, user.id, reason, text, now.toISOString(), user.id, since, REPORTS_PER_DAY]);
  if (wrote) { void refreshOwnerAlerts(); return { ok: true, already: false }; }
  const open = await get("SELECT 1 FROM contributor_video_reports WHERE video_id = ? AND reporter_user_id = ? AND resolved_at IS NULL", [id, user.id]);
  return open ? { ok: true, already: true } : { ok: false, status: 429, error: "That's a lot of reports for one day. Thanks: they're being looked at. Try again tomorrow." };
}

// --- The contributor's profile --------------------------------------------------------------------------------

export async function contributorProfile(username: string, viewerUser: User | null): Promise<ContributorProfile | null> {
  const u = await get<any>("SELECT id, display_name, username FROM users WHERE lower(username) = lower(?)", [username]);
  if (!u || !String(u.display_name ?? "").trim()) return null;
  const v = await viewerOf(viewerUser);
  const [row, teams] = await Promise.all([contributorRow(Number(u.id)), membershipOf(Number(u.id))]);
  const rows = await all<Row & { label: string | null; ename: string | null; red_score: number | null; blue_score: number | null }>(
    `${SELECT.replace("FROM contributor_videos cv", ", m.label, e.name ename, m.red_total red_score, m.blue_total blue_score FROM contributor_videos cv")
      .replace("WHERE cv.status", `LEFT JOIN matches m ON m.season = cv.season AND m.code = cv.code AND m.level = cv.level AND m.series = cv.series AND m.number = cv.number
       LEFT JOIN events e ON e.season = cv.season AND e.code = cv.code WHERE cv.status`)} AND cv.contributor_user_id = ? ORDER BY cv.created_at DESC LIMIT 300`,
    [v.userId, Number(u.id)]);
  const videos = rows.filter((r) => canSee(r, v)).map((r): ProfileVideo => ({
    ...toVideo(r, v), season: Number(r.season), code: String(r.code), key: matchKey(r), label: String(r.label ?? matchKey(r)), event: String(r.ename ?? r.code),
    red: r.red_score == null ? null : Number(r.red_score), blue: r.blue_score == null ? null : Number(r.blue_score),
    href: `/events/${r.season}/${encodeURIComponent(r.code)}?match=${matchKey(r)}`,
  }));
  const verified = row?.status === "verified";
  return {
    name: String(u.display_name).trim(), username: String(u.username), verified,
    status: verified ? "verified" : videos.some((x) => x.tier === "team") ? "team" : "none",
    teams: teams.map((t) => ({ number: t.number, name: t.name })), videos, likes: videos.reduce((s, x) => s + x.likes, 0),
    pending: viewerUser?.id === Number(u.id) && row?.status === "pending",
  };
}

// --- Owner alerts: one per queue, the count in its words, closed when the queue is empty ---------------------

export async function queueCounts(): Promise<{ requests: number; reports: number }> {
  const r = await get<{ q: number; rep: number }>(
    `SELECT (SELECT COUNT(*) FROM video_contributors WHERE status = 'pending') q,
            (SELECT COUNT(DISTINCT video_id) FROM contributor_video_reports WHERE resolved_at IS NULL) rep`);
  return { requests: Number(r?.q ?? 0), reports: Number(r?.rep ?? 0) };
}

let alerting: Promise<void> = Promise.resolve();
/** Raise, refresh or resolve the two owner alerts from the queues as they stand. Never throws. */
export function refreshOwnerAlerts(): Promise<void> {
  alerting = alerting.then(async () => {
    try {
      const { raiseAlert, resolveAlert, openAlert } = await import("../portal/alerts.js");
      const c = await queueCounts();
      const openReports = Number((await get<{ n: number }>("SELECT COUNT(*) n FROM contributor_video_reports WHERE resolved_at IS NULL"))?.n ?? 0);
      const sync = async (kind: string, n: number, title: string, body: string) => {
        if (n > 0) { const o = await openAlert(kind); if (!o || o.title !== title) await raiseAlert(kind, "info", title, body, { count: n }); }
        else await resolveAlert(kind);
      };
      await sync("video-verification", c.requests, `${c.requests} video verification request${c.requests === 1 ? "" : "s"} waiting`, "Oldest first, in Owner › Video contributors.");
      await sync("video-reports", openReports, `${openReports} open video report${openReports === 1 ? "" : "s"}`, `On ${c.reports} video${c.reports === 1 ? "" : "s"}, most-reported first, in Owner › Video contributors › Reports.`);
    } catch (e) { console.error("[contributors] owner alerts", e); }
  });
  return alerting;
}

/** For the routes: statements a batch helper may need. */
export type { InStatement };
export { youtubeId };
