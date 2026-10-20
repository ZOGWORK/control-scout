// The notification inbox (docs/inbox.md): per account, across workspaces, with read state kept on the
// server so every device agrees. Items come from two places:
//
// 1. Workspace activity (server/scout/activityLog.ts). Every item the feed logs is handed here right
//    after its write commits (publishLogged → queueInboxFanOut), and turned into inbox items for the
//    accounts it concerns. The actor is never notified about their own action.
//
//      type (category)                         who gets it
//      assignment.*        (assignments)       details.assigneeAccountId (Task 10: assignment.created)
//      entry.edited / entry.deleted /
//      entry.restored / entry.version_restored /
//      photo.added /
//      photo.removed       (edits)             the entry's author (workspace_scout_entries.author_account_id)
//      comment.created / comment.added
//                          (comments)          the entry's author (details.uuid, else subject entry:<uuid>)
//    Every recipient must still be a (cached) member of the workspace when the item is written, except for
//    member.left (it's about losing membership).
//
//      template.changed /
//      settings.changed    (template)          every cached member of the workspace (an admin changed how
//                                              everyone scouts: the fields, or the defaults for new entries)
//      member.joined / member.left
//                          (membership)        the member it's about (details.accountId)
//      picklist.*          (picklist)          every cached member of the workspace; an unread pick list
//                                              item is replaced by the newer one, so a busy list makes one line
//
//    A coalesced edit (details.firstId) replaces the recipient's item for the edits it stands for. An item
//    replaced this way (or a replaced unread pick list line) hands its follow-up flag to the one replacing it.
//
// 2. Owner alerts (server/portal/alerts.ts): deliverOwnerAlerts makes one item per owner account
//    (OWNER_EMAILS) for each open alert not yet delivered, and stores the first item's id in
//    owner_alerts.inbox_item_id (0 when every owner has the switch off), so each alert notifies once.
//    Resolving the alert marks its items read.
//
// Read and follow-up are separate (docs/inbox.md): read_at is "seen", follow_up_at is "still to do". Mark
// unread puts an item back in the count; the follow-up flag never changes the count; mark all read keeps flags.
//
// Per-kind switches: settings.notify.inbox* (src/shared/inbox.ts), read here from the account's synced
// settings (user_state) when the item would be made. A switched-off kind makes no item at all; switching it
// back on doesn't bring back what was skipped.
//
// Fan-outs run one at a time, in the order the feed logged them, after the write they describe; a failure is
// logged and never reaches the change itself. Retention: 90 days (pruneInbox, from the scheduler).
import type { InStatement } from "@libsql/client";
import { all, db, get, run } from "../db.js";
import { env } from "../env.js";
import { cleanValue } from "../../src/shared/personal.js";
import {
  INBOX_PAGE, INBOX_PAGE_MAX, INBOX_RETENTION_MS, inboxCategory, inboxCategoryOn, inboxLink, inboxText,
  type InboxCategory, type InboxFilter, type InboxItem, type InboxPage,
} from "../../src/shared/inbox.js";
import type { ActivityNotice } from "../scout/bus.js";

const CP_PROVIDER = "control-point";

// --- Live: who's listening -------------------------------------------------------------------

export interface InboxNotice { unread: number; latest: number | null; followUp: number }
type Listener = (n: InboxNotice) => void;
const listeners = new Map<number, Set<Listener>>();

/** Listen to one account's inbox (new items, read changes); returns the unsubscribe. */
export function subscribeInbox(userId: number, fn: Listener): () => void {
  let s = listeners.get(userId);
  if (!s) { s = new Set(); listeners.set(userId, s); }
  s.add(fn);
  return () => {
    const x = listeners.get(userId);
    if (!x) return;
    x.delete(fn);
    if (!x.size) listeners.delete(userId);
  };
}

/** Items of these accounts changed in place (e.g. a comment's text in its notification, comments.ts): their open inboxes refetch. */
export const notifyInboxChanged = (userIds: Iterable<number>): Promise<void> => notifyUsers(userIds);

async function notifyUsers(userIds: Iterable<number>): Promise<void> {
  for (const id of new Set(userIds)) {
    const subs = listeners.get(id);
    if (!subs?.size) continue;
    try {
      const n = await inboxCounts(id);
      for (const fn of [...subs]) { try { fn(n); } catch (e) { console.error("[inbox] listener failed", e); } }
    } catch (e) { console.error("[inbox] couldn't count", e); }
  }
}

export async function inboxCounts(userId: number): Promise<InboxNotice> {
  const since = Date.now() - INBOX_RETENTION_MS;
  const r = await get<{ unread: number; latest: number | null; follow_up: number }>(
    `SELECT (SELECT COUNT(*) FROM inbox_items WHERE user_id = ? AND read_at IS NULL AND at >= ?) unread, (SELECT MAX(id) FROM inbox_items WHERE user_id = ?) latest,
            (SELECT COUNT(*) FROM inbox_items WHERE user_id = ? AND follow_up_at IS NOT NULL AND at >= ?) follow_up`,
    [userId, since, userId, userId, since]);
  return { unread: Number(r?.unread ?? 0), latest: r?.latest == null ? null : Number(r.latest), followUp: Number(r?.follow_up ?? 0) };
}

// --- Reading and marking read ----------------------------------------------------------------

const toItem = (r: any): InboxItem => ({
  id: Number(r.id), at: Number(r.at), workspaceId: r.workspace_id == null ? null : String(r.workspace_id), workspaceName: String(r.workspace_name ?? ""),
  category: r.category as InboxCategory, type: String(r.type), actorName: String(r.actor_name ?? ""),
  title: String(r.title), body: String(r.body ?? ""), link: String(r.link ?? ""), read: r.read_at != null, followUp: r.follow_up_at != null,
});

/** A page of an account's inbox, newest first: items with id < before (null: from the newest); `filter` "followUp": flagged items only. */
export async function listInbox(userId: number, before: number | null, limit = INBOX_PAGE, filter: InboxFilter = "all"): Promise<InboxPage> {
  const n = Math.max(1, Math.min(INBOX_PAGE_MAX, Math.floor(limit)));
  const rows = await all<any>(
    `SELECT * FROM inbox_items WHERE user_id = ? AND at >= ? ${filter === "followUp" ? "AND follow_up_at IS NOT NULL" : ""} ${before != null ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`,
    [userId, Date.now() - INBOX_RETENTION_MS, ...(before != null ? [before] : []), n + 1]);
  const c = await inboxCounts(userId);
  return { items: rows.slice(0, n).map(toItem), more: rows.length > n, unread: c.unread, followUp: c.followUp };
}

export async function unreadCount(userId: number): Promise<number> {
  return (await inboxCounts(userId)).unread;
}

/**
 * Mark items read: the given ids, or all of them (up to `upTo`, the newest id the reader has seen, so an
 * item that arrived meanwhile stays unread). Only the account's own items. Returns the unread count after.
 */
export async function markRead(userId: number, what: { ids: number[] } | { all: true; upTo?: number | null }): Promise<number> {
  const now = Date.now();
  let changed = 0;
  if ("ids" in what) {
    if (what.ids.length) changed = await run(`UPDATE inbox_items SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${what.ids.map(() => "?").join(", ")})`, [now, userId, ...what.ids]);
  } else {
    changed = await run(`UPDATE inbox_items SET read_at = ? WHERE user_id = ? AND read_at IS NULL${what.upTo != null ? " AND id <= ?" : ""}`, [now, userId, ...(what.upTo != null ? [what.upTo] : [])]);
  }
  if (changed) await notifyUsers([userId]);
  return unreadCount(userId);
}

/** Mark the account's own items unread again (they count in the badge). Returns the unread count after. */
export async function markUnread(userId: number, ids: number[]): Promise<number> {
  if (!ids.length) return unreadCount(userId);
  const changed = await run(`UPDATE inbox_items SET read_at = NULL WHERE user_id = ? AND read_at IS NOT NULL AND id IN (${ids.map(() => "?").join(", ")})`, [userId, ...ids]);
  if (changed) await notifyUsers([userId]);
  return unreadCount(userId);
}

/** Flag (on) or unflag the account's own items for follow-up. Read state and the unread count stay as they are. */
export async function setFollowUp(userId: number, ids: number[], on: boolean): Promise<InboxNotice> {
  if (ids.length) {
    const ph = ids.map(() => "?").join(", ");
    const changed = on
      ? await run(`UPDATE inbox_items SET follow_up_at = ? WHERE user_id = ? AND follow_up_at IS NULL AND id IN (${ph})`, [Date.now(), userId, ...ids])
      : await run(`UPDATE inbox_items SET follow_up_at = NULL WHERE user_id = ? AND follow_up_at IS NOT NULL AND id IN (${ph})`, [userId, ...ids]);
    if (changed) await notifyUsers([userId]);
  }
  return inboxCounts(userId);
}

/** Delete items older than 90 days (the scheduler). Returns how many went. */
export async function pruneInbox(now = Date.now()): Promise<number> {
  return run("DELETE FROM inbox_items WHERE at < ?", [now - INBOX_RETENTION_MS]);
}

// --- Recipients and their switches -----------------------------------------------------------

interface Recipient { userId: number; accountId: number; admin: boolean }

const parseSettings = (raw: unknown) => {
  if (typeof raw !== "string") return null;
  try { return cleanValue("settings", JSON.parse(raw)); } catch { return null; }
};

/** The Scout accounts linked to these Control Point accounts that have this kind switched on. */
async function linkedRecipients(accounts: { accountId: number; admin: boolean }[], category: InboxCategory): Promise<Recipient[]> {
  if (!accounts.length) return [];
  const rows = await all<{ subject: string; user_id: number; value: string | null }>(
    `SELECT i.subject, i.user_id, s.value FROM identities i LEFT JOIN user_state s ON s.user_id = i.user_id AND s.key = 'settings'
      WHERE i.provider = ? AND i.subject IN (${accounts.map(() => "?").join(", ")})`,
    [CP_PROVIDER, ...accounts.map((a) => String(a.accountId))]);
  const out: Recipient[] = [];
  for (const r of rows) {
    const a = accounts.find((x) => String(x.accountId) === String(r.subject));
    if (!a || !inboxCategoryOn(parseSettings(r.value)?.notify, category)) continue;
    out.push({ userId: Number(r.user_id), accountId: a.accountId, admin: a.admin });
  }
  return out;
}

const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : null);

/** Which Control Point accounts an activity item concerns (before switches, actor included). */
async function concerned(item: ActivityNotice, category: InboxCategory): Promise<{ accountId: number; admin: boolean }[]> {
  const d = item.details;
  switch (category) {
    case "edits":
    case "comments": {
      const uuid = (typeof d.uuid === "string" && d.uuid) || (typeof d.entryUuid === "string" && d.entryUuid) || (item.subject.startsWith("entry:") ? item.subject.slice(6) : "");
      if (!uuid) return [];
      const r = await get<{ author_account_id: number }>(
        `SELECT e.author_account_id FROM workspace_scout_entries e JOIN workspaces w ON w.id = e.workspace_id WHERE w.cp_workspace_id = ? AND e.uuid = ?`,
        [item.workspaceId, uuid]);
      return r ? [{ accountId: Number(r.author_account_id), admin: false }] : [];
    }
    case "assignments": {
      const ids = [int(d.assigneeAccountId), ...(Array.isArray(d.assigneeAccountIds) ? d.assigneeAccountIds.map(int) : [])].filter((x): x is number => x != null);
      return [...new Set(ids)].map((accountId) => ({ accountId, admin: false }));
    }
    case "membership": {
      const id = int(d.accountId) ?? (item.subject.startsWith("member:") ? int(item.subject.slice(7)) : null);
      return id == null ? [] : [{ accountId: id, admin: d.role === "admin" }];
    }
    case "template":
    case "picklist": {
      const rows = await all<{ account_id: number; role: string }>("SELECT account_id, role FROM workspace_members WHERE cp_workspace_id = ?", [item.workspaceId]);
      return rows.map((r) => ({ accountId: Number(r.account_id), admin: r.role === "admin" }));
    }
    default: return [];
  }
}

// --- Fan-out from workspace activity ---------------------------------------------------------

let chain: Promise<void> = Promise.resolve();

/** Hand activity items just logged (and committed) to the inbox. Returns at once; never throws. */
export function queueInboxFanOut(workspaceId: string, items: ActivityNotice[]): void {
  const relevant = items.filter((i) => inboxCategory(i.type));
  if (!relevant.length) return;
  chain = chain.then(async () => {
    for (const item of relevant) {
      try { await fanOut({ ...item, workspaceId }); } catch (e) { console.error(`[inbox] couldn't deliver ${item.type}`, e); }
    }
  });
}

/** Resolves once every fan-out queued so far has finished (tests, shutdown). */
export const inboxSettled = (): Promise<void> => chain;

/** Make the inbox items for one activity item. Returns the ids of the accounts (users) that got one. */
export async function fanOut(item: ActivityNotice): Promise<number[]> {
  const category = inboxCategory(item.type);
  if (!category) return [];
  const actor = item.actor.accountId;
  const accounts = (await concerned(item, category)).filter((a) => a.accountId !== actor);
  const recipients = await linkedRecipients(accounts, category);
  if (!recipients.length) return [];
  const ws = await get<{ name: string }>(
    "SELECT COALESCE(NULLIF((SELECT name FROM workspaces WHERE cp_workspace_id = ?), ''), (SELECT workspace_name FROM workspace_members WHERE cp_workspace_id = ? AND workspace_name <> '' LIMIT 1), '') name",
    [item.workspaceId, item.workspaceId]);
  const workspaceName = String(ws?.name ?? "");
  const { title, body } = inboxText(item.type, item.details, item.actor.name, workspaceName);
  const firstId = int(item.details.firstId);
  const stmts: InStatement[] = [];
  for (const r of recipients) {
    // What this item replaces: a coalesced edit stands for the earlier ones (their items go, this one, unread and
    // newest, takes their place), and the pick list changes in bursts (one unread line per workspace, the latest).
    const replaced: { where: string; args: (string | number | null)[] }[] = [];
    if (firstId != null && firstId < item.id) {
      replaced.push({ where: "user_id = ? AND source_activity_id >= ? AND source_activity_id < ? AND type = ? AND subject = ? AND actor_account_id IS ?", args: [r.userId, firstId, item.id, item.type, item.subject, actor] });
    }
    if (category === "picklist") {
      replaced.push({ where: "user_id = ? AND workspace_id = ? AND category = 'picklist' AND read_at IS NULL AND source_activity_id IS NOT ?", args: [r.userId, item.workspaceId, item.id] });
    }
    // A follow-up flag on a replaced item carries over to the one replacing it (the work it stands for isn't done).
    const flag = replaced.length
      ? { sql: `(SELECT MAX(follow_up_at) FROM inbox_items WHERE ${replaced.map((x) => `(${x.where})`).join(" OR ")})`, args: replaced.flatMap((x) => x.args) }
      : { sql: "NULL", args: [] as (string | number | null)[] };
    // Checked in the insert itself, so nothing slips in between: the account still exists (one deleted meanwhile
    // gets nothing), and it's still a member of the workspace (the cached membership, as every read checks), except
    // for the membership items themselves (being removed is news to someone who's no longer a member).
    const member = category === "membership" ? "" : " AND EXISTS (SELECT 1 FROM workspace_members WHERE account_id = ? AND cp_workspace_id = ?)";
    stmts.push({
      sql: `INSERT OR IGNORE INTO inbox_items (user_id, at, workspace_id, workspace_name, category, type, subject, actor_account_id, actor_name, title, body, link, source_activity_id, follow_up_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${flag.sql} WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)${member}`,
      args: [r.userId, item.at, item.workspaceId, workspaceName.slice(0, 120), category, item.type, item.subject.slice(0, 120), actor, item.actor.name.slice(0, 80),
        title.slice(0, 200), body.slice(0, 400), inboxLink(item.workspaceId, item.type, item.details, { admin: r.admin }), item.id, ...flag.args,
        r.userId, ...(member ? [r.accountId, item.workspaceId] : [])],
    });
    // Then the replaced items go (the insert has read their flag).
    for (const x of replaced) stmts.push({ sql: `DELETE FROM inbox_items WHERE ${x.where}`, args: x.args });
  }
  await db().batch(stmts, "write");
  const users = recipients.map((r) => r.userId);
  await notifyUsers(users);
  return users;
}

// --- Owner alerts (the hand-off from server/portal/alerts.ts) --------------------------------

const alertLink = (kind: string) => (kind === "photo-storage" ? "/owner?panel=storage" : "/owner");

/**
 * Deliver every open owner alert not delivered yet: one item per owner account with the switch on, then
 * owner_alerts.inbox_item_id is set (the first item's id, or 0 when every owner has it off), so an alert
 * notifies once however often this runs. With no owner account signed up yet, alerts wait for one.
 * Returns how many alerts were delivered. Never throws.
 */
let delivering: Promise<number> | null = null;
export function deliverOwnerAlerts(): Promise<number> {
  // One run at a time; a call during a run waits for it, then runs again (it may have missed a new alert).
  const run = async () => {
    try { return await deliver(); } catch (e) { console.error("[inbox] owner alerts", e); return 0; }
  };
  const p: Promise<number> = (delivering ?? Promise.resolve(0)).then(run, run);
  delivering = p;
  void p.finally(() => { if (delivering === p) delivering = null; });
  return p;
}

async function deliver(): Promise<number> {
  const emails = env.ownerEmails;
  if (!emails.length) return 0;
  const alerts = await all<any>("SELECT id, kind, title, body, created_at FROM owner_alerts WHERE resolved_at IS NULL AND inbox_item_id IS NULL ORDER BY id");
  if (!alerts.length) return 0;
  const owners = await all<{ id: number; value: string | null }>(
    `SELECT u.id, s.value FROM users u LEFT JOIN user_state s ON s.user_id = u.id AND s.key = 'settings' WHERE lower(u.email) IN (${emails.map(() => "?").join(", ")})`, emails);
  if (!owners.length) return 0;
  const on = owners.filter((o) => inboxCategoryOn(parseSettings(o.value)?.notify, "ownerAlerts")).map((o) => Number(o.id));
  const stmts: InStatement[] = [];
  for (const a of alerts) {
    const at = Date.parse(a.created_at) || Date.now();
    for (const userId of on) {
      // Only while the alert is still open (resolveAlert closes it before marking its items read, so an item
      // is either made before that and marked read, or not made at all) and the account still exists.
      stmts.push({
        sql: `INSERT OR IGNORE INTO inbox_items (user_id, at, workspace_id, workspace_name, category, type, subject, actor_name, title, body, link, source_alert_id)
              SELECT ?, ?, NULL, '', 'ownerAlerts', 'owner.alert', ?, 'Control Scout', ?, ?, ?, ?
               WHERE EXISTS (SELECT 1 FROM owner_alerts WHERE id = ? AND resolved_at IS NULL) AND EXISTS (SELECT 1 FROM users WHERE id = ?)`,
        args: [userId, at, `alert:${a.kind}`.slice(0, 120), String(a.title).slice(0, 200), String(a.body).slice(0, 400), alertLink(String(a.kind)), Number(a.id), Number(a.id), userId],
      });
    }
    stmts.push({
      sql: "UPDATE owner_alerts SET inbox_item_id = COALESCE((SELECT MIN(id) FROM inbox_items WHERE source_alert_id = ?), 0) WHERE id = ? AND inbox_item_id IS NULL",
      args: [Number(a.id), Number(a.id)],
    });
  }
  await db().batch(stmts, "write");
  await notifyUsers(on);
  return alerts.length;
}

/** An alert was resolved: its inbox items have nothing left to act on, so they're marked read. */
export async function closeAlertItems(alertIds: number[]): Promise<void> {
  if (!alertIds.length) return;
  const ph = alertIds.map(() => "?").join(", ");
  const users = await all<{ user_id: number }>(`SELECT DISTINCT user_id FROM inbox_items WHERE source_alert_id IN (${ph}) AND read_at IS NULL`, alertIds);
  if (!users.length) return;
  await run(`UPDATE inbox_items SET read_at = ? WHERE source_alert_id IN (${ph}) AND read_at IS NULL`, [Date.now(), ...alertIds]);
  await notifyUsers(users.map((u) => Number(u.user_id)));
}
