// Comments on workspace scout entries (Task 15).
//
//   GET    /api/scout/workspaces/:workspaceId/entries/:uuid/comments        the thread, oldest first: { comments, entryDeleted }
//   POST   /api/scout/workspaces/:workspaceId/entries/:uuid/comments        { body } → 201 CommentEvent (action "created")
//   PATCH  /api/scout/workspaces/:workspaceId/entries/:uuid/comments/:id    { body } → CommentEvent (action "edited")
//   DELETE /api/scout/workspaces/:workspaceId/entries/:uuid/comments/:id    → CommentEvent (action "deleted")
//   GET    /api/scout/workspaces/:workspaceId/comment-counts                { counts: { <uuid>: n } }, entries with any
//
// Every route: 401 signed out, 503 while workspace scouting is paused, 400 a bad id, 403 not a member
// (workspaceAccess: membership comes from Control Point). Writes are JSON only (CSRF: the session
// cookie is SameSite=Lax and a cross-site form can't send application/json; a DELETE can't be sent
// cross-site at all without a preflight this server never answers).
//
// Rules, enforced here in the statement that writes (so a check and its write can't be split):
// - Any member comments on any entry the server has that isn't deleted (404 not synced yet, 409 deleted).
// - A comment's author edits it; its author or a workspace admin deletes it (403 otherwise).
// - Body: plain text, trimmed, 1 to COMMENT_MAX characters (src/shared/comments.ts); never HTML.
// - Posting and editing are rate limited per account (COMMENT_RATE), 429 with Retry-After.
// - A deleted comment disappears from the thread: its row stays (ids are never reused) with the
//   body cleared, and it's never sent again.
//
// Live: each change is published to the workspace's streams as `event: comment` (bus.ts, stream.ts),
// one at a time per workspace so the counts they carry arrive in order.
//
// Activity (activityLog.ts): a new comment logs comment.created, subject entry:<uuid>, details
// { uuid, season, team, kind, eventCode, matchLabel, commentId, excerpt }: the feed's line, and the
// entry author's inbox item (server/inbox/inbox.ts; the commenter never gets one). An admin deleting
// someone else's comment logs comment.deleted (moderation is visible to the workspace); edits and
// deleting your own comment log nothing, so the feed stays quiet. When a comment is edited or deleted,
// the excerpt its comment.created item (and the inbox items made from it) carry follows: the new text,
// or none once deleted.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { InStatement } from "@libsql/client";
import { all, db, get } from "../db.js";
import { isWorkspaceId, type Membership } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { publishComment, serialized } from "./bus.js";
import { entryDetails, logActivity } from "./activityLog.js";
import { accessError, isWrite, workspaceAccess, workspacePaused, writerName } from "./entries.js";
import { inboxText } from "../../src/shared/inbox.js";
import { inboxSettled, notifyInboxChanged } from "../inbox/inbox.js";
import { cleanCommentBody, commentExcerpt, type CommentEvent, type EntryComment } from "../../src/shared/comments.js";

/** Comments (posts and edits) one account may write: a burst of `burst`, refilling at `perMinute`. */
export const COMMENT_RATE = { burst: 10, perMinute: 10 };
/** The most comments a thread returns (a thread this long is a chat; the oldest beyond it aren't sent). */
export const THREAD_MAX = 500;

const buckets = new Map<number, { tokens: number; at: number }>();
/** Take one comment write from the account's allowance; returns the seconds to wait when there's none. */
export function takeCommentToken(accountId: number, now = Date.now()): number | null {
  const { burst, perMinute } = COMMENT_RATE;
  const refilled = (v: { tokens: number; at: number }) => Math.min(burst, v.tokens + (Math.max(0, now - v.at) / 60_000) * perMinute);
  // Too many tracked: forget every other account whose allowance has refilled by now (as good as a fresh one).
  if (buckets.size >= 20_000) { for (const [k, v] of buckets) if (k !== accountId && refilled(v) >= burst) buckets.delete(k); }
  const b = buckets.get(accountId) ?? { tokens: burst, at: now };
  b.tokens = refilled(b);
  b.at = now;
  buckets.set(accountId, b);
  if (b.tokens < 1) return Math.max(1, Math.ceil(((1 - b.tokens) / perMinute) * 60));
  b.tokens -= 1;
  return null;
}
/** Tests: a fresh allowance for everyone. */
export const resetCommentRate = () => buckets.clear();

const UUID = /^[A-Za-z0-9_-]{8,64}$/;
const COLUMNS = "c.id, c.entry_uuid, c.author_account_id, c.author_name, c.body, c.created_at, c.edited_at";
const RETURNING = "RETURNING id, entry_uuid, author_account_id, author_name, body, created_at, edited_at";

const toComment = (workspaceId: string, r: any): EntryComment => ({
  id: Number(r.id), workspaceId, entryUuid: String(r.entry_uuid), authorAccountId: Number(r.author_account_id), authorName: String(r.author_name ?? ""),
  body: String(r.body ?? ""), createdAt: Number(r.created_at), editedAt: r.edited_at == null ? null : Number(r.edited_at),
});

type Fail = { ok: false; status: number; error: string; retryAfter?: number };
const fail = (status: number, error: string, retryAfter?: number): Fail => ({ ok: false, status, error, ...(retryAfter ? { retryAfter } : {}) });

export const NOT_SYNCED = "Sync this entry first, then comment on it.";
export const ENTRY_DELETED = "This entry was deleted, so it can't take new comments.";
export const NOT_YOURS_EDIT = "You can only edit your own comments.";
export const NOT_YOURS_DELETE = "You can delete your own comments. A workspace admin can delete any comment.";
export const TOO_FAST = "You're commenting very quickly. Wait a moment and try again.";

interface EntryRow { workspace_id: number; uuid: string; season: number; team: number; kind: string; event_code: string | null; match_label: string | null; deleted: number }
async function entryRow(workspaceId: string, uuid: string): Promise<EntryRow | undefined> {
  return get<EntryRow>(
    `SELECT e.workspace_id, e.uuid, e.season, e.team, e.kind, e.event_code, e.match_label, e.deleted
       FROM workspace_scout_entries e JOIN workspaces w ON w.id = e.workspace_id WHERE w.cp_workspace_id = ? AND e.uuid = ?`, [workspaceId, uuid]);
}
const detailsOf = (e: EntryRow) => entryDetails({ uuid: e.uuid, season: Number(e.season), team: Number(e.team), kind: e.kind, eventCode: e.event_code, matchLabel: e.match_label });

const countStatement = (wsDbId: number, uuid: string): InStatement =>
  ({ sql: "SELECT COUNT(*) n FROM workspace_entry_comments WHERE workspace_id = ? AND entry_uuid = ? AND deleted_at IS NULL", args: [wsDbId, uuid] });

/** The thread of one entry, oldest first (the newest THREAD_MAX). */
export async function listComments(workspaceId: string, uuid: string): Promise<{ comments: EntryComment[]; entryDeleted: boolean } | Fail> {
  const e = await entryRow(workspaceId, uuid);
  if (!e) return fail(404, NOT_SYNCED);
  const rows = await all<any>(
    `SELECT ${COLUMNS} FROM workspace_entry_comments c WHERE c.workspace_id = ? AND c.entry_uuid = ? AND c.deleted_at IS NULL ORDER BY c.id DESC LIMIT ?`,
    [e.workspace_id, uuid, THREAD_MAX]);
  return { comments: rows.reverse().map((r) => toComment(workspaceId, r)), entryDeleted: !!Number(e.deleted) };
}

/** How many comments each of the workspace's entries has (only entries with any). */
export async function commentCounts(workspaceId: string): Promise<Record<string, number>> {
  const rows = await all<{ entry_uuid: string; n: number }>(
    `SELECT c.entry_uuid, COUNT(*) n FROM workspace_entry_comments c JOIN workspaces w ON w.id = c.workspace_id
      WHERE w.cp_workspace_id = ? AND c.deleted_at IS NULL GROUP BY c.entry_uuid`, [workspaceId]);
  return Object.fromEntries(rows.map((r) => [String(r.entry_uuid), Number(r.n)]));
}

/**
 * Each change's place in the server's order of comment changes (CommentEvent.rev): increasing, and
 * time-based so it keeps increasing across restarts. Devices apply a change to a comment or a count
 * only if it's newer than the last one they applied, so a slow reply never undoes a later change.
 */
let lastRev = 0;
const nextRev = () => (lastRev = Math.max(lastRev + 1, Date.now() * 1000));

/**
 * Run one change to a workspace's threads after the ones before it: write it (`fn`, which stamps
 * the event's rev), publish it, then `after` (the activity feed and the inbox), still in that order,
 * so the feed's record of a comment (its excerpt) can't be changed before it exists, or out of turn.
 */
function change(m: Membership, fn: (rev: number) => Promise<CommentEvent | Fail>, after: (e: CommentEvent) => Promise<void>): Promise<CommentEvent | Fail> {
  return serialized(`comments:${m.workspaceId}`, async () => {
    const out = await fn(nextRev());
    if ("ok" in out) return out;
    publishComment(m.workspaceId, out);
    await after(out); // never throws (logActivity and followExcerpt catch their own)
    return out;
  });
}

export async function postComment(user: User, m: Membership, uuid: string, raw: unknown, now = Date.now()): Promise<CommentEvent | Fail> {
  const clean = cleanCommentBody(raw);
  if (!clean.ok) return fail(400, clean.error);
  const e = await entryRow(m.workspaceId, uuid);
  if (!e) return fail(404, NOT_SYNCED);
  if (Number(e.deleted)) return fail(409, ENTRY_DELETED);
  const wait = takeCommentToken(m.accountId, now);
  if (wait != null) return fail(429, TOO_FAST, wait);
  return change(m, async (rev) => {
    // The entry must still be there, and not deleted, when the comment is written: checked in the insert itself.
    const [ins, cnt] = await db().batch([
      {
        sql: `INSERT INTO workspace_entry_comments (workspace_id, entry_uuid, author_account_id, author_name, body, created_at)
              SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspace_scout_entries WHERE workspace_id = ? AND uuid = ? AND deleted = 0) ${RETURNING}`,
        args: [e.workspace_id, uuid, m.accountId, writerName(user), clean.body, now, e.workspace_id, uuid],
      },
      countStatement(e.workspace_id, uuid),
    ], "write");
    if (!ins.rows.length) return fail(409, ENTRY_DELETED);
    const comment = toComment(m.workspaceId, ins.rows[0]);
    return { action: "created", workspaceId: m.workspaceId, entryUuid: uuid, commentId: comment.id, count: Number(cnt.rows[0].n), rev, comment } satisfies CommentEvent;
  }, async (out) => {
    // The feed and the entry author's inbox (after the comment has committed and streamed).
    await logActivity(m.workspaceId, { accountId: m.accountId, name: writerName(user) }, "comment.created", `entry:${uuid}`,
      { ...detailsOf(e), commentId: out.commentId, excerpt: commentExcerpt(clean.body) });
  });
}

const commentId = (raw: unknown) => { const n = Number(raw); return typeof raw === "string" && /^\d{1,15}$/.test(raw) && Number.isSafeInteger(n) && n > 0 ? n : null; };

async function commentRow(wsDbId: number, uuid: string, id: number) {
  return get<any>("SELECT * FROM workspace_entry_comments WHERE id = ? AND workspace_id = ? AND entry_uuid = ? AND deleted_at IS NULL", [id, wsDbId, uuid]);
}

export async function editComment(m: Membership, uuid: string, rawId: unknown, raw: unknown, now = Date.now()): Promise<CommentEvent | Fail> {
  const id = commentId(rawId);
  if (id == null) return fail(400, "No such comment.");
  const clean = cleanCommentBody(raw);
  if (!clean.ok) return fail(400, clean.error);
  const e = await entryRow(m.workspaceId, uuid);
  if (!e) return fail(404, NOT_SYNCED);
  const before = await commentRow(e.workspace_id, uuid, id);
  if (!before) return fail(404, "That comment was deleted.");
  if (Number(before.author_account_id) !== m.accountId) return fail(403, NOT_YOURS_EDIT);
  if (Number(e.deleted)) return fail(409, ENTRY_DELETED);
  // The same text again: nothing changes (not even "edited").
  if (String(before.body) === clean.body) {
    const n = await get<{ n: number }>("SELECT COUNT(*) n FROM workspace_entry_comments WHERE workspace_id = ? AND entry_uuid = ? AND deleted_at IS NULL", [e.workspace_id, uuid]);
    // rev 0: nothing new, so a device never prefers it over a change it has already applied.
    return { action: "edited", workspaceId: m.workspaceId, entryUuid: uuid, commentId: id, count: Number(n?.n ?? 0), rev: 0, comment: toComment(m.workspaceId, before) };
  }
  const wait = takeCommentToken(m.accountId, now);
  if (wait != null) return fail(429, TOO_FAST, wait);
  return change(m, async (rev) => {
    const [upd, cnt] = await db().batch([
      {
        sql: `UPDATE workspace_entry_comments SET body = ?, edited_at = ?
               WHERE id = ? AND workspace_id = ? AND entry_uuid = ? AND deleted_at IS NULL AND author_account_id = ?
                 AND EXISTS (SELECT 1 FROM workspace_scout_entries WHERE workspace_id = ? AND uuid = ? AND deleted = 0) ${RETURNING}`,
        args: [clean.body, now, id, e.workspace_id, uuid, m.accountId, e.workspace_id, uuid],
      },
      countStatement(e.workspace_id, uuid),
    ], "write");
    if (!upd.rows.length) return fail(409, "That comment or its entry was deleted meanwhile.");
    return { action: "edited", workspaceId: m.workspaceId, entryUuid: uuid, commentId: id, count: Number(cnt.rows[0].n), rev, comment: toComment(m.workspaceId, upd.rows[0]) } satisfies CommentEvent;
  }, () => followExcerpt(m.workspaceId, uuid, id, commentExcerpt(clean.body)));
}

export async function deleteComment(user: User, m: Membership, uuid: string, rawId: unknown): Promise<CommentEvent | Fail> {
  const id = commentId(rawId);
  if (id == null) return fail(400, "No such comment.");
  const e = await entryRow(m.workspaceId, uuid);
  if (!e) return fail(404, NOT_SYNCED);
  const before = await commentRow(e.workspace_id, uuid, id);
  if (!before) return fail(404, "That comment was already deleted.");
  const admin = m.role === "admin";
  if (!admin && Number(before.author_account_id) !== m.accountId) return fail(403, NOT_YOURS_DELETE);
  return change(m, async (rev) => {
    const [del, cnt] = await db().batch([
      {
        sql: `UPDATE workspace_entry_comments SET body = '', deleted_at = ?
               WHERE id = ? AND workspace_id = ? AND entry_uuid = ? AND deleted_at IS NULL AND (? = 1 OR author_account_id = ?) RETURNING id`,
        args: [Date.now(), id, e.workspace_id, uuid, admin ? 1 : 0, m.accountId],
      },
      countStatement(e.workspace_id, uuid),
    ], "write");
    if (!del.rows.length) return fail(404, "That comment was already deleted.");
    return { action: "deleted", workspaceId: m.workspaceId, entryUuid: uuid, commentId: id, count: Number(cnt.rows[0].n), rev } satisfies CommentEvent;
  }, async () => {
    await followExcerpt(m.workspaceId, uuid, id, null);
    // Moderation is visible: an admin removing someone else's comment says so in the feed (no inbox item).
    if (Number(before.author_account_id) !== m.accountId) {
      await logActivity(m.workspaceId, { accountId: m.accountId, name: writerName(user) }, "comment.deleted", `entry:${uuid}`,
        { ...detailsOf(e), commentId: id, authorName: String(before.author_name ?? "") });
    }
  });
}

/**
 * Keep what the comment's comment.created item and the inbox items made from it say in step with the
 * comment: the edited text's excerpt, or none once it's deleted. Never throws (it's tidying after the change).
 */
async function followExcerpt(workspaceId: string, uuid: string, id: number, excerpt: string | null): Promise<void> {
  try {
    await inboxSettled(); // the comment's own fan-out first (it may still be queued), so its items are there to change
    const rows = await all<{ id: number; details: string; actor_name: string }>(
      `SELECT a.id, a.details, a.actor_name FROM workspace_activity a JOIN workspaces w ON w.id = a.workspace_id
        WHERE w.cp_workspace_id = ? AND a.subject = ? AND a.type = 'comment.created' AND json_extract(a.details, '$.commentId') = ?`,
      [workspaceId, `entry:${uuid}`, id]);
    if (!rows.length) return;
    const stmts: InStatement[] = [];
    for (const r of rows) {
      let d: Record<string, unknown> = {};
      try { d = JSON.parse(r.details) ?? {}; } catch { /* rewritten below */ }
      const { excerpt: _old, ...rest } = d;
      const next = excerpt == null ? { ...rest, deleted: true } : { ...rest, excerpt };
      stmts.push({ sql: "UPDATE workspace_activity SET details = ? WHERE id = ?", args: [JSON.stringify(next), r.id] });
      stmts.push({ sql: "UPDATE inbox_items SET body = ? WHERE source_activity_id = ? AND body <> ? RETURNING user_id", args: [inboxText("comment.created", next, r.actor_name, "").body, r.id, inboxText("comment.created", next, r.actor_name, "").body] });
    }
    const results = await db().batch(stmts, "write");
    // Open inboxes of the items that changed refetch, so the old text doesn't stay on screen.
    const users = results.flatMap((res) => res.rows.map((row) => Number(row.user_id))).filter(Number.isSafeInteger);
    if (users.length) await notifyInboxChanged(users);
  } catch (e) {
    console.error("[comments] couldn't update the comment's activity", e);
  }
}

// --- Routes ---------------------------------------------------------------------------------

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};
const jsonOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
  next();
};

/** Signed in, workspace scouting on, a good workspace (and entry) id, a member: or the answer has been sent. */
async function member(req: Request, res: Response, needEntry = true): Promise<{ user: User; m: Membership; uuid: string } | null> {
  res.set("Cache-Control", "no-store");
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Sign in first." }); return null; }
  if (await workspacePaused(res)) return null;
  const workspaceId = req.params.workspaceId;
  if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return null; }
  const uuid = String(req.params.uuid ?? "");
  if (needEntry && !UUID.test(uuid)) { res.status(400).json({ error: "No such entry." }); return null; }
  const access = await workspaceAccess(user, workspaceId, { write: isWrite(req) });
  if (!access.ok) { res.status(access.status).json(accessError(access)); return null; }
  return { user, m: access.membership, uuid };
}

const answer = (res: Response, out: CommentEvent | Fail | { comments: EntryComment[]; entryDeleted: boolean }, status = 200) => {
  if ("ok" in out) {
    if (out.retryAfter) res.set("Retry-After", String(out.retryAfter));
    res.status(out.status).json({ error: out.error });
    return undefined;
  }
  res.status(status);
  return out;
};

/** Mounted on /api/scout. */
export function commentsRouter(): Router {
  const r = express.Router();
  const thread = "/workspaces/:workspaceId/entries/:uuid/comments";
  r.get(thread, h(async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    return answer(res, await listComments(who.m.workspaceId, who.uuid));
  }));
  r.post(thread, jsonOnly, h(async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    return answer(res, await postComment(who.user, who.m, who.uuid, req.body?.body), 201);
  }));
  r.patch(`${thread}/:id`, jsonOnly, h(async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    return answer(res, await editComment(who.m, who.uuid, req.params.id, req.body?.body));
  }));
  r.delete(`${thread}/:id`, h(async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    return answer(res, await deleteComment(who.user, who.m, who.uuid, req.params.id));
  }));
  r.get("/workspaces/:workspaceId/comment-counts", h(async (req, res) => {
    const who = await member(req, res, false);
    if (!who) return;
    return { counts: await commentCounts(who.m.workspaceId) };
  }));
  return r;
}
