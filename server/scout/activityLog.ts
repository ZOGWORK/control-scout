// A workspace's activity feed (Task 13): what happened in its scout space, who
// did it and when, visible to every member (GET /api/scout/workspaces/:id/activity,
// activity.ts) and streamed live (`event: activity`, stream.ts).
//
// The log is one table, workspace_activity (migration 16): `type` + `subject` +
// JSON `details`, so later kinds of event need no schema change. Logged today:
//
//   entry.added / entry.edited / entry.deleted / entry.restored
//       subject entry:<uuid>; details { uuid, season, team, kind, eventCode, matchLabel, changed? }
//       (entries.ts, after the write commits, for entries the write actually changed: a refused
//       write, an older version beaten by a newer one, or a resend with nothing new logs nothing)
//   entry.version_restored
//       subject entry:<uuid>; details as above plus { fromAt, fromVersion, fromName, undeleted? }: a write that
//       restores an earlier version (history.ts), in place of the edited / restored item it would otherwise be.
//       fromVersion null: an edit that never reached the server (kept on the loser's device).
//   template.changed   subject template:<season>; details { season, version, kinds: ["match" | "pit"] } (templates.ts)
//   settings.changed   subject settings; details { settingsVersion, changed: ["season" | "eventCode"], defaults: { season, eventCode } } (settings.ts)
//   photo.added / photo.removed   subject entry:<uuid>; details as entries' plus photoId (photos.ts)
//   member.joined / member.left   subject member:<accountId>; details { accountId, name, role }; actor
//       Control Point (controlPoint.ts, from the membership refresh, in the same transaction as the
//       cache write; only for workspaces that already have a scout space).
//       A removal made in Scout (Settings → Workspace → Members, Task 9) is member.left too, with the
//       admin as actor and details.origin "control-scout" (details.self when they removed themselves),
//       logged with the cache row's delete (controlPoint.ts dropMembership), so the refresh after it
//       finds nothing left to log.
//   comment.created   subject entry:<uuid>; details { uuid, season, team, kind, eventCode, matchLabel, commentId, excerpt }
//       (comments.ts; reaches the entry author's inbox). The excerpt follows later edits and goes (details.deleted) with the comment.
//   comment.deleted   subject entry:<uuid>; details as entries' plus commentId, authorName: only an admin deleting someone else's.
//
// Later tasks append their own with logActivity(): assignment.created / assignment.completed,
// picklist.changed, comment.created, ... Readers show an unknown type generically.
// Some also reach the notification inbox (server/inbox/inbox.ts; docs/inbox.md lists the types and the
// details each needs to find its recipients).
//
// Edit coalescing: an edit to an entry by the same person within COALESCE_MS (5 minutes) of their last
// edit to it, with nothing else logged about that entry in between, replaces that "edited" item instead of
// adding another: the old row goes and a new one (newest, so the feed stays in time order) carries
// details.edits (how many edits it stands for), details.firstId (the id of the first item it replaced:
// a reader drops any item of the same type, subject and actor with an id from firstId up to the new one),
// details.firstAt and the union of the fields changed. Any logActivity call can opt in with { coalesce: true }.
//
// Retention: 90 days (RETENTION_MS); pruneActivity runs from the scheduler (server/index.ts).
import type { InStatement, InValue } from "@libsql/client";
import { all, db, get, run } from "../db.js";
import { publishActivity, serialized, type ActivityNotice } from "./bus.js";
import { queueInboxFanOut } from "../inbox/inbox.js";

export interface ActivityActor { accountId: number | null; name: string }
/** Membership changes come from Control Point's answer, not from a person Scout can name. */
export const CONTROL_POINT_ACTOR: ActivityActor = { accountId: null, name: "Control Point" };

/** The kinds logged now. Later tasks add their own strings (no schema change). */
export const ACTIVITY_TYPES = [
  "entry.added", "entry.edited", "entry.deleted", "entry.restored", "entry.version_restored",
  "template.changed", "settings.changed", "photo.added", "photo.removed", "member.joined", "member.left",
  // Task 10 (assignments.ts): subject assignment:<id>; details { assigneeAccountId, assigneeName, team, season, eventCode,
  // assignmentId } (a create for several teams at once: teams[] and assignmentIds[], team = the first).
  "assignment.created", "assignment.completed", "assignment.reopened", "assignment.deleted",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number] | (string & {});

export type ActivityItem = ActivityNotice;

export const COALESCE_MS = 5 * 60_000;
export const RETENTION_MS = 90 * 24 * 3600_000;
export const PAGE_LIMIT = 50, PAGE_MAX = 100;

const RETURNING = "RETURNING id, workspace_id, at, actor_account_id, actor_name, type, subject, details";

const parseDetails = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== "string" || !raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
};

/** A stored row as the API and the stream send it. */
export const toItem = (workspaceId: string, r: any): ActivityItem => ({
  id: Number(r.id), workspaceId, at: Number(r.at),
  actor: { accountId: r.actor_account_id == null ? null : Number(r.actor_account_id), name: String(r.actor_name ?? "") },
  type: String(r.type), subject: String(r.subject ?? ""), details: parseDetails(r.details),
});

/**
 * The statement that logs one item, for a caller that wants it in the same transaction as its change
 * (it returns the new row: publish it with publishLogged once that transaction commits). Logs nothing
 * for a workspace with no scout space yet (no mirror row): there's no feed to show it in.
 */
export function activityStatement(workspaceId: string, actor: ActivityActor, type: ActivityType, subject: string, details: Record<string, unknown> = {}, at = Date.now(),
  /** An extra condition, checked in the same statement (e.g. "only if this is still news"). */
  onlyIf?: { sql: string; args: InValue[] }): InStatement {
  return {
    sql: `INSERT INTO workspace_activity (workspace_id, at, actor_account_id, actor_name, type, subject, details)
          SELECT id, ?, ?, ?, ?, ?, ? FROM workspaces WHERE cp_workspace_id = ?${onlyIf ? ` AND (${onlyIf.sql})` : ""} ${RETURNING}`,
    args: [at, actor.accountId, actor.name.slice(0, 80), type, subject.slice(0, 120), JSON.stringify(details), workspaceId, ...(onlyIf?.args ?? [])],
  };
}

/** Publish rows a batch returned (from activityStatement) to the workspace's live streams. */
export function publishLogged(workspaceId: string, rows: unknown[]): ActivityItem[] {
  const items = rows.map((r) => toItem(workspaceId, r));
  for (const it of items) publishActivity(workspaceId, it);
  // And to the notification inbox of whoever it concerns (server/inbox/inbox.ts), after this returns.
  queueInboxFanOut(workspaceId, items);
  return items;
}

export interface LogOptions {
  /** Merge into the actor's own item of the same type and subject when it's the newest about that subject and under COALESCE_MS old. */
  coalesce?: boolean;
  /** For coalesced items: how to merge the earlier item's details into the new one (default: the new details). */
  merge?: (earlier: Record<string, unknown>, next: Record<string, unknown>) => Record<string, unknown>;
  at?: number;
}

/**
 * Log one item in a workspace's feed and stream it, right after the change it describes has committed.
 * For Tasks 9, 10, 11 and 15 (assignments, pick list, comments):
 *   await logActivity(workspaceId, { accountId: m.accountId, name: writerName(user) }, "assignment.created", `team:${team}`, { team, assignee });
 * Never throws (a feed that can't be written must not fail the change it describes; it's logged to the console).
 * Returns the item, or null when nothing was logged (no scout space yet, or the write failed).
 */
export async function logActivity(workspaceId: string, actor: ActivityActor, type: ActivityType, subject: string, details: Record<string, unknown> = {}, opts: LogOptions = {}): Promise<ActivityItem | null> {
  try {
    // One writer per workspace feed at a time, so a coalesce can't race another item about the same subject.
    return await serialized(`activity:${workspaceId}`, async () => {
      const at = opts.at ?? Date.now();
      let replaced: number | null = null;
      if (opts.coalesce && actor.accountId != null) {
        const last = await get<any>(
          `SELECT a.* FROM workspace_activity a JOIN workspaces w ON w.id = a.workspace_id
            WHERE w.cp_workspace_id = ? AND a.subject = ? ORDER BY a.id DESC LIMIT 1`, [workspaceId, subject]);
        if (last && last.type === type && Number(last.actor_account_id) === actor.accountId && at - Number(last.at) < COALESCE_MS) {
          const earlier = parseDetails(last.details);
          const merged = opts.merge ? opts.merge(earlier, details) : details;
          details = {
            ...merged,
            edits: (Number(earlier.edits) || 1) + 1,
            firstId: Number(earlier.firstId) || Number(last.id),
            firstAt: Number(earlier.firstAt) || Number(last.at),
          };
          replaced = Number(last.id);
        }
      }
      const stmts: InStatement[] = [];
      if (replaced != null) stmts.push({ sql: "DELETE FROM workspace_activity WHERE id = ?", args: [replaced] });
      stmts.push(activityStatement(workspaceId, actor, type, subject, details, at));
      const res = await db().batch(stmts, "write");
      const rows = res.at(-1)!.rows;
      return publishLogged(workspaceId, [...rows])[0] ?? null;
    });
  } catch (e) {
    console.error(`[activity] couldn't log ${type}`, e);
    return null;
  }
}

/** A page of the feed, newest first: items with id < before (none: from the newest). */
export async function listActivity(workspaceId: string, before: number | null, limit = PAGE_LIMIT): Promise<{ items: ActivityItem[]; more: boolean }> {
  const n = Math.max(1, Math.min(PAGE_MAX, Math.floor(limit)));
  const rows = await all<any>(
    `SELECT a.* FROM workspace_activity a JOIN workspaces w ON w.id = a.workspace_id
      WHERE w.cp_workspace_id = ? AND a.at >= ? ${before != null ? "AND a.id < ?" : ""} ORDER BY a.id DESC LIMIT ?`,
    [workspaceId, Date.now() - RETENTION_MS, ...(before != null ? [before] : []), n + 1]);
  return { items: rows.slice(0, n).map((r) => toItem(workspaceId, r)), more: rows.length > n };
}

/** Delete items older than 90 days (the scheduler, daily). Returns how many went. */
export async function pruneActivity(now = Date.now()): Promise<number> {
  return run("DELETE FROM workspace_activity WHERE at < ?", [now - RETENTION_MS]);
}

// --- Entries ----------------------------------------------------------------------------------

/** What an entry looked like before a write (the stored row), for telling what the write did. */
export interface EntryBefore { deleted: boolean; season: number; team: number; eventCode: string | null; matchLabel: string | null; kind: string; data: string; notes: string; templateId?: string | null; templateVersion?: number | null }
/** And after it (as stored). */
export interface EntryAfter { uuid: string; deleted: boolean; season: number; team: number; eventCode: string | null; matchLabel: string | null; kind: string; data: Record<string, unknown>; notes: string }

/** Which parts of an entry an edit changed: "team", "match", "event", "kind", "season", "notes", and each answer's field id. */
export function changedParts(before: EntryBefore, after: EntryAfter): string[] {
  const out: string[] = [];
  if (before.team !== after.team) out.push("team");
  if (before.season !== after.season) out.push("season");
  if (before.kind !== after.kind) out.push("kind");
  if ((before.eventCode ?? "") !== (after.eventCode ?? "")) out.push("event");
  if ((before.matchLabel ?? "") !== (after.matchLabel ?? "")) out.push("match");
  if (before.notes !== after.notes) out.push("notes");
  let old: Record<string, unknown> = {};
  try { old = JSON.parse(before.data) ?? {}; } catch { /* unreadable: every answer counts as changed */ }
  for (const k of new Set([...Object.keys(old), ...Object.keys(after.data)])) {
    if (JSON.stringify(old[k]) !== JSON.stringify(after.data[k])) out.push(k);
  }
  return out;
}

/**
 * What a write did to an entry, as an activity type: null for nothing worth a line (a tombstone for an
 * entry the workspace never saw, a delete of a deleted one, an edit that changed nothing).
 */
export function entryChange(before: EntryBefore | undefined, after: EntryAfter): { type: ActivityType; changed?: string[] } | null {
  if (!before) return after.deleted ? null : { type: "entry.added" };
  if (before.deleted) return after.deleted ? null : { type: "entry.restored" };
  if (after.deleted) return { type: "entry.deleted" };
  const changed = changedParts(before, after);
  return changed.length ? { type: "entry.edited", changed } : null;
}

/** The details every entry item carries (what the feed shows and how a tap opens the entry). */
export const entryDetails = (e: Pick<EntryAfter, "uuid" | "season" | "team" | "kind" | "eventCode" | "matchLabel">) =>
  ({ uuid: e.uuid, season: e.season, team: e.team, kind: e.kind, eventCode: e.eventCode, matchLabel: e.matchLabel });

const MAX_CHANGED = 20;
const mergeChanged = (earlier: Record<string, unknown>, next: Record<string, unknown>) => ({
  ...next,
  changed: [...new Set([...(Array.isArray(earlier.changed) ? earlier.changed.map(String) : []), ...(Array.isArray(next.changed) ? next.changed.map(String) : [])])].slice(0, MAX_CHANGED),
});

/** Log what one push did to each entry it wrote (entries.ts calls this after the write commits). */
export async function logEntryWrites(workspaceId: string, actor: ActivityActor,
  writes: { before: EntryBefore | undefined; after: EntryAfter; restore?: { fromAt: number; fromVersion: number | null; fromName: string | null } }[]): Promise<void> {
  for (const { before, after, restore } of writes) {
    const c = entryChange(before, after);
    if (!c) continue;
    // A restore of an earlier version (never a delete: that's logged as the delete it is).
    if (restore && !after.deleted) {
      const details = {
        ...entryDetails(after), fromAt: restore.fromAt, fromVersion: restore.fromVersion, fromName: restore.fromName,
        ...(c.changed ? { changed: c.changed.slice(0, MAX_CHANGED) } : {}), ...(c.type === "entry.restored" ? { undeleted: true } : {}),
      };
      await logActivity(workspaceId, actor, "entry.version_restored", `entry:${after.uuid}`, details);
      continue;
    }
    const details = { ...entryDetails(after), ...(c.changed ? { changed: c.changed.slice(0, MAX_CHANGED) } : {}) };
    await logActivity(workspaceId, actor, c.type, `entry:${after.uuid}`, details, c.type === "entry.edited" ? { coalesce: true, merge: mergeChanged } : {});
  }
}
