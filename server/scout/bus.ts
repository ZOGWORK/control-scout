// The in-process bus for live workspace entries: pushWorkspaceEntries
// (entries.ts) publishes every entry it actually wrote, in the workspace's
// write order (`seq`), right after the write; each open stream (stream.ts)
// listens to its workspace.
//
// In-process is enough: the VM runs one server process, and nothing else
// writes workspace entries (the data cycle's child process only syncs FIRST
// data, stats and packs). A deploy with several server instances would need a
// shared bus (Redis pub/sub, Postgres LISTEN/NOTIFY, …) behind publishEntries
// and subscribe, and a shared order for `serialized`; the stream protocol would
// not change.
import type { WorkspaceEntryOut } from "./entries.js";
import type { PickList } from "../../src/shared/picklist.js";
import type { AssignmentNotice, MatchAssignmentNotice } from "../../src/shared/assignments.js";
import type { CommentEvent } from "../../src/shared/comments.js";
import type { OrphanState } from "../../src/shared/orphaned.js";

/** A written entry with its place in the workspace's write order. */
export type LiveEntry = WorkspaceEntryOut & { seq: number };

type Listener = (e: LiveEntry) => void;
const channels = new Map<string, Set<Listener>>();

// Server-side caches derived from a workspace's entries (scout consensus: consensus.ts) hear every write,
// whether or not any stream is open.
type WriteHook = (workspaceId: string, entries: LiveEntry[]) => void;
const writeHooks = new Set<WriteHook>();
/** Hear every workspace's entry writes (process-wide; never removed). */
export function onEntriesWritten(fn: WriteHook): void { writeHooks.add(fn); }

/** Tell every open stream of the workspace about entries just written (in seq order). Never throws. */
export function publishEntries(workspaceId: string, entries: LiveEntry[]): void {
  if (entries.length) for (const fn of writeHooks) { try { fn(workspaceId, entries); } catch (err) { console.error("[live] write hook failed", err); } }
  const subs = channels.get(workspaceId);
  if (!subs?.size) return;
  for (const e of entries) for (const fn of [...subs]) { try { fn(e); } catch (err) { console.error("[live] listener failed", err); } }
}

/** Listen to a workspace's writes; returns the unsubscribe. */
export function subscribe(workspaceId: string, fn: Listener): () => void {
  let subs = channels.get(workspaceId);
  if (!subs) { subs = new Set(); channels.set(workspaceId, subs); }
  subs.add(fn);
  return () => {
    const s = channels.get(workspaceId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) channels.delete(workspaceId);
  };
}

/** Listeners per workspace right now (tests, owner portal). */
export const subscriberCount = (workspaceId?: string) =>
  workspaceId ? channels.get(workspaceId)?.size ?? 0 : [...channels.values()].reduce((n, s) => n + s.size, 0);

// Writes to one workspace run one at a time, so they are published in seq order.
const queues = new Map<string, Promise<unknown>>();
/** Run `fn` after every earlier call for the same workspace has finished. */
export function serialized<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(workspaceId) ?? Promise.resolve();
  const p = prev.then(fn, fn);
  const tail = p.catch(() => undefined);
  queues.set(workspaceId, tail);
  void tail.then(() => { if (queues.get(workspaceId) === tail) queues.delete(workspaceId); });
  return p;
}

// Template changes (templates.ts): a small notice, not an entry. Open streams pass it on as
// `event: template` so open forms refetch the workspace's template; it carries no field data.
export interface TemplateNotice { season: number; version: number; settingsVersion: number }
type TemplateListener = (n: TemplateNotice) => void;
const templateChannels = new Map<string, Set<TemplateListener>>();

/** Tell every open stream of the workspace that its template changed. Never throws. */
export function publishTemplate(workspaceId: string, n: TemplateNotice): void {
  for (const fn of [...(templateChannels.get(workspaceId) ?? [])]) { try { fn(n); } catch (err) { console.error("[live] template listener failed", err); } }
}

// Workspace settings changes (settings.ts, Task 6): a notice with the new settings version only.
// Open streams pass it on as `event: settings`; clients refetch GET /api/scout/workspaces/:id/settings.
export interface SettingsNotice { settingsVersion: number }
type SettingsListener = (n: SettingsNotice) => void;
const settingsChannels = new Map<string, Set<SettingsListener>>();

/** Tell every open stream of the workspace that its settings changed. Never throws. */
export function publishSettings(workspaceId: string, n: SettingsNotice): void {
  for (const fn of [...(settingsChannels.get(workspaceId) ?? [])]) { try { fn(n); } catch (err) { console.error("[live] settings listener failed", err); } }
}

/** Listen to a workspace's settings changes; returns the unsubscribe. */
export function subscribeSettings(workspaceId: string, fn: SettingsListener): () => void {
  let subs = settingsChannels.get(workspaceId);
  if (!subs) { subs = new Set(); settingsChannels.set(workspaceId, subs); }
  subs.add(fn);
  return () => {
    const s = settingsChannels.get(workspaceId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) settingsChannels.delete(workspaceId);
  };
}

/** Listen to a workspace's template changes; returns the unsubscribe. */
export function subscribeTemplate(workspaceId: string, fn: TemplateListener): () => void {
  let subs = templateChannels.get(workspaceId);
  if (!subs) { subs = new Set(); templateChannels.set(workspaceId, subs); }
  subs.add(fn);
  return () => {
    const s = templateChannels.get(workspaceId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) templateChannels.delete(workspaceId);
  };
}

// Activity feed items (activityLog.ts): each one logged is passed on by open streams as `event: activity`
// (no id: the feed has its own order, so it never moves the entry cursor).
export interface ActivityNotice {
  id: number; workspaceId: string; at: number; actor: { accountId: number | null; name: string };
  type: string; subject: string; details: Record<string, unknown>;
}
type ActivityListener = (a: ActivityNotice) => void;
const activityChannels = new Map<string, Set<ActivityListener>>();

/** Tell every open stream of the workspace about an activity item just logged. Never throws. */
export function publishActivity(workspaceId: string, a: ActivityNotice): void {
  for (const fn of [...(activityChannels.get(workspaceId) ?? [])]) { try { fn(a); } catch (err) { console.error("[live] activity listener failed", err); } }
}

/** Listen to a workspace's activity items; returns the unsubscribe. */
export function subscribeActivity(workspaceId: string, fn: ActivityListener): () => void {
  let subs = activityChannels.get(workspaceId);
  if (!subs) { subs = new Set(); activityChannels.set(workspaceId, subs); }
  subs.add(fn);
  return () => {
    const s = activityChannels.get(workspaceId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) activityChannels.delete(workspaceId);
  };
}

// Membership ended (Task 9): an admin removed someone from Scout's settings, or a refresh found a
// workspace gone from Control Point's answer. Each open stream of that account in that workspace says
// `membership_revoked` and ends at once, instead of at its next periodic re-check.
type RevokedListener = (accountId: number) => void;
const revokedChannels = new Map<string, Set<RevokedListener>>();

/** Tell the workspace's open streams that this account lost access. Never throws. */
export function publishRevoked(workspaceId: string, accountId: number): void {
  for (const fn of [...(revokedChannels.get(workspaceId) ?? [])]) { try { fn(accountId); } catch (err) { console.error("[live] revoked listener failed", err); } }
}

/** Listen for accounts losing access to a workspace; returns the unsubscribe. */
export function subscribeRevoked(workspaceId: string, fn: RevokedListener): () => void {
  let subs = revokedChannels.get(workspaceId);
  if (!subs) { subs = new Set(); revokedChannels.set(workspaceId, subs); }
  subs.add(fn);
  return () => {
    const s = revokedChannels.get(workspaceId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) revokedChannels.delete(workspaceId);
  };
}

// Shared pick lists (picklist.ts, Task 11): after every change, the whole list as it now is (it's small:
// at most MAX_PICKS teams). Open streams pass it on as `event: picklist` (no id, like `activity`); a
// device keeps the highest version it has seen per season.
export type PicklistNotice = PickList;
type PicklistListener = (n: PicklistNotice) => void;
const picklistChannels = new Map<string, Set<PicklistListener>>();

/** Tell every open stream of the workspace that a pick list changed. Never throws. */
export function publishPicklist(workspaceId: string, n: PicklistNotice): void {
  for (const fn of [...(picklistChannels.get(workspaceId) ?? [])]) { try { fn(n); } catch (err) { console.error("[live] picklist listener failed", err); } }
}

/** Listen to a workspace's pick list changes; returns the unsubscribe. */
export function subscribePicklist(workspaceId: string, fn: PicklistListener): () => void {
  let subs = picklistChannels.get(workspaceId);
  if (!subs) { subs = new Set(); picklistChannels.set(workspaceId, subs); }
  subs.add(fn);
  return () => {
    const s = picklistChannels.get(workspaceId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) picklistChannels.delete(workspaceId);
  };
}

// Scouting assignments (assignments.ts, Task 10): each create, status change or delete is passed on by open
// streams as `event: assignment` (no id, like activity), carrying the assignments as the list now has them,
// so badges and cards update without a refetch.
type AssignmentListener = (n: AssignmentNotice) => void;
const assignmentChannels = new Map<string, Set<AssignmentListener>>();

/** Tell every open stream of the workspace that its assignments changed. Never throws. */
export function publishAssignments(workspaceId: string, n: AssignmentNotice): void {
  for (const fn of [...(assignmentChannels.get(workspaceId) ?? [])]) { try { fn(n); } catch (err) { console.error("[live] assignment listener failed", err); } }
}

/** Listen to a workspace's assignment changes; returns the unsubscribe. */
export function subscribeAssignments(workspaceId: string, fn: AssignmentListener): () => void {
  let subs = assignmentChannels.get(workspaceId);
  if (!subs) { subs = new Set(); assignmentChannels.set(workspaceId, subs); }
  subs.add(fn);
  return () => {
    const s = assignmentChannels.get(workspaceId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) assignmentChannels.delete(workspaceId);
  };
}

// Match scouting assignments (assignments.ts): each create, edit or delete is passed on as `event: match-assignment`
// (no id), carrying the assignments as the list now has them.
type MatchAssignmentListener = (n: MatchAssignmentNotice) => void;
const matchAssignmentChannels = new Map<string, Set<MatchAssignmentListener>>();

/** Tell every open stream of the workspace that its match assignments changed. Never throws. */
export function publishMatchAssignments(workspaceId: string, n: MatchAssignmentNotice): void {
  for (const fn of [...(matchAssignmentChannels.get(workspaceId) ?? [])]) { try { fn(n); } catch (err) { console.error("[live] match assignment listener failed", err); } }
}

/** Listen to a workspace's match assignment changes; returns the unsubscribe. */
export function subscribeMatchAssignments(workspaceId: string, fn: MatchAssignmentListener): () => void {
  let subs = matchAssignmentChannels.get(workspaceId);
  if (!subs) { subs = new Set(); matchAssignmentChannels.set(workspaceId, subs); }
  subs.add(fn);
  return () => {
    const s = matchAssignmentChannels.get(workspaceId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) matchAssignmentChannels.delete(workspaceId);
  };
}

// Entry comments (comments.ts, Task 15): each change to a thread is passed on by open streams as
// `event: comment` (no id, like activity: comments have their own order and never move the entry cursor).
type CommentListener = (c: CommentEvent) => void;
const commentChannels = new Map<string, Set<CommentListener>>();

/** Tell every open stream of the workspace about a comment just written, edited or deleted. Never throws. */
export function publishComment(workspaceId: string, c: CommentEvent): void {
  for (const fn of [...(commentChannels.get(workspaceId) ?? [])]) { try { fn(c); } catch (err) { console.error("[live] comment listener failed", err); } }
}

/** Listen to a workspace's comment changes; returns the unsubscribe. */
export function subscribeComments(workspaceId: string, fn: CommentListener): () => void {
  let subs = commentChannels.get(workspaceId);
  if (!subs) { subs = new Set(); commentChannels.set(workspaceId, subs); }
  subs.add(fn);
  return () => {
    const s = commentChannels.get(workspaceId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) commentChannels.delete(workspaceId);
  };
}

// Orphaned workspaces (Task 19, orphans.ts): the workspace went read-only (deleted in Control Point, or no
// admin left) or came back. Open streams of the workspace pass it on as `event: workspace` and stay open:
// its former members keep reading. data: {orphaned: OrphanState | null}.
type WorkspaceStateListener = (orphaned: OrphanState | null) => void;
const workspaceStateChannels = new Map<string, Set<WorkspaceStateListener>>();

/** Tell the workspace's open streams it went read-only (or back to normal: null). Never throws. */
export function publishWorkspaceState(workspaceId: string, orphaned: OrphanState | null): void {
  for (const fn of [...(workspaceStateChannels.get(workspaceId) ?? [])]) { try { fn(orphaned); } catch (err) { console.error("[live] workspace state listener failed", err); } }
}

/** Listen for the workspace going read-only or coming back; returns the unsubscribe. */
export function subscribeWorkspaceState(workspaceId: string, fn: WorkspaceStateListener): () => void {
  let subs = workspaceStateChannels.get(workspaceId);
  if (!subs) { subs = new Set(); workspaceStateChannels.set(workspaceId, subs); }
  subs.add(fn);
  return () => {
    const s = workspaceStateChannels.get(workspaceId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) workspaceStateChannels.delete(workspaceId);
  };
}

// An account's workspace list changed in a way only /api/auth/me shows (Task 19): a workspace joined or
// re-added in Control Point, a role changed, a workspace restored. Each of the account's open streams (in
// any workspace) says `event: account`, so the app re-reads /me at once instead of at its next refresh.
type AccountListener = () => void;
const accountChannels = new Map<number, Set<AccountListener>>();

/** Tell the account's open streams that its workspace list changed. Never throws. */
export function publishAccountChanged(accountId: number): void {
  for (const fn of [...(accountChannels.get(accountId) ?? [])]) { try { fn(); } catch (err) { console.error("[live] account listener failed", err); } }
}

/** Listen for the account's workspace list changing; returns the unsubscribe. */
export function subscribeAccountChanged(accountId: number, fn: AccountListener): () => void {
  let subs = accountChannels.get(accountId);
  if (!subs) { subs = new Set(); accountChannels.set(accountId, subs); }
  subs.add(fn);
  return () => {
    const s = accountChannels.get(accountId);
    if (!s) return;
    s.delete(fn);
    if (!s.size) accountChannels.delete(accountId);
  };
}
