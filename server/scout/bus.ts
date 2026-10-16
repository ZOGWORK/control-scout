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

/** A written entry with its place in the workspace's write order. */
export type LiveEntry = WorkspaceEntryOut & { seq: number };

type Listener = (e: LiveEntry) => void;
const channels = new Map<string, Set<Listener>>();

/** Tell every open stream of the workspace about entries just written (in seq order). Never throws. */
export function publishEntries(workspaceId: string, entries: LiveEntry[]): void {
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
