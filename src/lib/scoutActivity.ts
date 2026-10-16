// A workspace's activity feed on the device (server/scout/activityLog.ts):
// the newest page from GET /api/scout/workspaces/:id/activity, older pages on
// "Load older", and items arriving live from the workspace's stream
// (scoutLive.ts re-announces each `event: activity` as SCOUT_ACTIVITY).
// The newest page is fetched again whenever the stream (re)connects, and every
// 30 s while the app is polling instead, so nothing logged meanwhile is missed.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import type { LiveMode } from "./scoutLive";
import { entrySubject } from "../shared/inbox";

export interface ActivityItem {
  id: number; workspaceId: string; at: number;
  actor: { accountId: number | null; name: string };
  type: string; subject: string; details: Record<string, unknown>;
}

/** Window event: an activity item arrived on a workspace's stream. detail: ActivityItem. */
export const SCOUT_ACTIVITY = "cs-scout-activity";
export const announceActivity = (item: ActivityItem) => { window.dispatchEvent(new CustomEvent(SCOUT_ACTIVITY, { detail: item })); };

export const ACTIVITY_PAGE = 50;
export const ACTIVITY_POLL_MS = 30_000;

/** A valid-looking item (the stream and the API are ours, but a bad one must never break the feed). */
export function isActivityItem(x: unknown): x is ActivityItem {
  const a = x as ActivityItem;
  return !!a && Number.isSafeInteger(a.id) && typeof a.workspaceId === "string" && Number.isFinite(a.at) && typeof a.type === "string"
    && !!a.actor && typeof a.actor.name === "string" && !!a.details && typeof a.details === "object";
}

/**
 * Merge items into a feed (newest first, by id). A coalesced edit (details.firstId) replaces the earlier
 * items it stands for: same type, subject and actor, with an id from firstId up to its own.
 */
export function mergeActivity(current: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
  const byId = new Map(current.map((i) => [i.id, i]));
  for (const i of incoming) byId.set(i.id, i);
  const all = [...byId.values()];
  const replaced = new Set<number>();
  for (const i of all) {
    const first = Number(i.details.firstId);
    if (!Number.isSafeInteger(first)) continue;
    for (const o of all) {
      if (o.id >= first && o.id < i.id && o.type === i.type && o.subject === i.subject && o.actor.accountId === i.actor.accountId) replaced.add(o.id);
    }
  }
  return all.filter((i) => !replaced.has(i.id)).sort((a, b) => b.id - a.id);
}

const url = (space: string, before?: number) => `/api/scout/workspaces/${encodeURIComponent(space)}/activity?limit=${ACTIVITY_PAGE}${before ? `&before=${before}` : ""}`;

export interface ActivityState {
  items: ActivityItem[]; loading: boolean; error: ApiError | null;
  /** Older items exist on the server. */ more: boolean; loadingOlder: boolean;
  loadOlder: () => void; reload: () => void;
}

/** The feed of a workspace (null: Personal, no feed). `live`: the space's stream mode, to refetch on (re)connect. */
export function useWorkspaceActivity(space: string | null, live: LiveMode): ActivityState {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [more, setMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // One generation per feed shown (a space, or the same space opened again): a reply from an earlier
  // one changes nothing, so a request still out when the view closes can't touch the next feed.
  const gen = useRef(0);
  const loaded = useRef(false);
  // The newest id a fetched page has covered. Live items don't move it: one arriving during a reconnect
  // must not hide the items missed before it (the gap check below compares pages with pages).
  const fetchedNewest = useRef(0);

  const fetchNewest = useCallback(async () => {
    if (!space) return;
    const g = gen.current;
    if (!loaded.current) setLoading(true);
    try {
      const r = await apiFetch<{ items: unknown[]; more: boolean }>(url(space));
      if (gen.current !== g) return;
      const page = (r.items ?? []).filter(isActivityItem);
      // A page that doesn't reach the last one fetched (more than a page logged meanwhile) starts the feed
      // again from it, so there's never a hole; otherwise it only adds the newer items.
      const gap = loaded.current && !!r.more && page.length > 0 && page.at(-1)!.id > fetchedNewest.current;
      // The reset drops only what's older than the page (below the hole): items that streamed in while it
      // was on its way, newer than it, stay.
      if (gap) { const floor = page.at(-1)!.id; setMore(true); setItems((cur) => mergeActivity(cur.filter((i) => i.id >= floor), page)); }
      else {
        if (!loaded.current) setMore(!!r.more);
        setItems((cur) => mergeActivity(cur, page)); // the first load keeps anything that streamed in meanwhile
      }
      if (page.length) fetchedNewest.current = Math.max(gap ? 0 : fetchedNewest.current, page[0].id);
      loaded.current = true;
      setError(null);
    } catch (e) {
      if (gen.current === g) setError(e instanceof ApiError ? e : new ApiError(0, "Couldn't load the activity."));
    } finally {
      if (gen.current === g) setLoading(false);
    }
  }, [space]);

  useEffect(() => {
    gen.current++;
    setItems([]); setMore(false); setError(null); setLoading(false); setLoadingOlder(false);
    loaded.current = false; fetchedNewest.current = 0;
    void fetchNewest();
  }, [fetchNewest]);

  // Back live (a reconnect may have missed items): the newest page again. Polling: every 30 s.
  useEffect(() => {
    if (!space) return;
    if (live === "live" && loaded.current) void fetchNewest();
    if (live !== "polling") return;
    const t = setInterval(() => { void fetchNewest(); }, ACTIVITY_POLL_MS);
    return () => clearInterval(t);
  }, [live, space, fetchNewest]);

  useEffect(() => {
    if (!space) return;
    const on = (ev: Event) => {
      const item = (ev as CustomEvent<unknown>).detail;
      if (isActivityItem(item) && item.workspaceId === space) setItems((cur) => mergeActivity(cur, [item]));
    };
    window.addEventListener(SCOUT_ACTIVITY, on);
    return () => window.removeEventListener(SCOUT_ACTIVITY, on);
  }, [space]);

  const oldest = items.at(-1)?.id;
  const loadOlder = useCallback(() => {
    if (!space || !oldest) return;
    const g = gen.current;
    setLoadingOlder(true);
    apiFetch<{ items: unknown[]; more: boolean }>(url(space, oldest))
      .then((r) => {
        if (gen.current !== g) return;
        setItems((cur) => mergeActivity(cur, (r.items ?? []).filter(isActivityItem)));
        setMore(!!r.more);
      })
      .catch((e) => { if (gen.current === g) setError(e instanceof ApiError ? e : new ApiError(0, "Couldn't load older activity.")); })
      .finally(() => { if (gen.current === g) setLoadingOlder(false); });
  }, [space, oldest]);

  return { items, loading, error, more, loadingOlder, loadOlder, reload: () => { void fetchNewest(); } };
}

// --- Words ----------------------------------------------------------------------------------

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "team 18360 · match Q12 · USNJQ1" / "team 18360 · pit" for an entry item (shared with the inbox). */
export { entrySubject };

const FIELD_NAMES: Record<string, string> = { team: "team", season: "season", kind: "kind", event: "event", match: "match", notes: "notes" };

/** What an item says: the verb ("edited") and what it's about ("team 18360 · match Q12"), plus an optional note. */
export function describeActivity(i: ActivityItem): { verb: string; subject: string; note?: string } {
  const d = i.details;
  switch (i.type) {
    case "entry.added": return { verb: "added", subject: entrySubject(d) };
    case "entry.edited": {
      const edits = num(d.edits);
      const changed = Array.isArray(d.changed) ? d.changed.map(String) : [];
      const fields = changed.filter((c) => !FIELD_NAMES[c]).length;
      const named = changed.filter((c) => FIELD_NAMES[c]).map((c) => FIELD_NAMES[c]);
      const parts = [...named, ...(fields ? [`${fields} answer${fields === 1 ? "" : "s"}`] : [])];
      const note = [parts.length ? `changed ${parts.join(", ")}` : null, edits && edits > 1 ? `${edits} edits` : null].filter(Boolean).join(" · ");
      return { verb: "edited", subject: entrySubject(d), note: note || undefined };
    }
    case "entry.deleted": return { verb: "deleted", subject: entrySubject(d) };
    case "entry.restored": return { verb: "restored", subject: entrySubject(d) };
    case "entry.version_restored": {
      // Task 16: an earlier version brought back (a kept version, or an overwritten edit kept on the restorer's device).
      const from = num(d.fromVersion);
      const name = str(d.fromName);
      const note = [from ? `version ${from}${name ? ` by ${name}` : ""}` : "an edit that was overwritten", d.undeleted ? "undeleted" : null].filter(Boolean).join(" · ");
      return { verb: "restored an earlier version of", subject: entrySubject(d), note };
    }
    case "photo.added": return { verb: "added a photo to", subject: entrySubject(d) };
    case "photo.removed": return { verb: "removed a photo from", subject: entrySubject(d) };
    case "template.changed": {
      const kinds = Array.isArray(d.kinds) ? d.kinds.map(String) : [];
      const which = kinds.length === 1 ? `${kinds[0]} fields` : "fields";
      return { verb: "changed the", subject: `${num(d.season) ?? ""} ${which}`.trim(), note: num(d.version) ? `version ${num(d.version)}` : undefined };
    }
    case "settings.changed": {
      // Task 6: an admin changed the defaults for new entries (details.defaults: the new values).
      const def = d.defaults && typeof d.defaults === "object" ? d.defaults as Record<string, unknown> : {};
      const parts = [num(def.season) ? `season ${num(def.season)}` : "current season", str(def.eventCode) ? `event ${str(def.eventCode)}` : "no event"];
      return { verb: "changed the", subject: "defaults for new entries", note: parts.join(", ") };
    }
    case "member.joined": return { verb: "added", subject: `${str(d.name) ?? "a member"} to the workspace`, note: d.role === "admin" ? "admin" : undefined };
    // From Control Point's answer (actor "Control Point"), or removed by an admin in Scout's settings
    // (details.origin "control-scout"); details.self: they removed themselves, i.e. left.
    case "member.left":
      if (d.self === true) return { verb: "left", subject: "the workspace" };
      return { verb: "removed", subject: `${str(d.name) ?? "a member"} from the workspace`, note: d.origin === "control-scout" ? "in Control Scout" : undefined };
    default: return { verb: i.type.replace(/[._]/g, " "), subject: "" };
  }
}

/** The uuid of the entry an item is about, when tapping it should open that entry (not for a deleted one). */
export function activityEntry(i: ActivityItem): string | null {
  if (!i.subject.startsWith("entry:") || i.type === "entry.deleted") return null;
  return str(i.details.uuid) ?? (i.subject.slice(6) || null);
}

const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** "Today", "Yesterday", else "Mon, Oct 13" (with the year when it isn't this one). */
export function dayLabel(ms: number, now: number): string {
  if (dayKey(ms) === dayKey(now)) return "Today";
  if (dayKey(ms) === dayKey(now - 864e5)) return "Yesterday";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}

/** Items grouped by local day, in feed order. */
export function groupByDay(items: ActivityItem[], now: number): { key: string; label: string; items: ActivityItem[] }[] {
  const out: { key: string; label: string; items: ActivityItem[] }[] = [];
  for (const i of items) {
    const key = dayKey(i.at);
    const last = out.at(-1);
    if (last?.key === key) last.items.push(i);
    else out.push({ key, label: dayLabel(i.at, now), items: [i] });
  }
  return out;
}
