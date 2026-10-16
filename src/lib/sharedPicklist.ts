// A workspace's shared pick list on the device (Task 11; server/scout/picklist.ts, docs/picklist.md).
//
// - The list comes from GET /api/scout/workspaces/:id/picklist?season=, then live from the workspace's
//   stream (scoutLive.ts re-announces each `event: picklist` as SCOUT_PICKLIST: the whole list); the
//   highest version wins, so an older answer never replaces a newer one. It's fetched again whenever the
//   stream (re)connects, and every 30 s while the app polls instead.
// - A change shows at once: what's shown is the server's list with this device's changes still on their
//   way applied on top, by the same function the server uses (src/shared/picklist.ts). Changes go up one at
//   a time, in order. The server's answer (or a live list that already includes them) takes over; a 409
//   (a team it names was removed meanwhile) drops that change, says so, and fetches the list again.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import type { LiveMode } from "./scoutLive";
import { applyPickOp, isPickList, type PickList, type PickOp, type PickPerson } from "../shared/picklist";

/** Window event: a workspace's pick list arrived on its stream. detail: PickList. */
export const SCOUT_PICKLIST = "cs-scout-picklist";
export const announcePicklist = (l: PickList) => { window.dispatchEvent(new CustomEvent(SCOUT_PICKLIST, { detail: l })); };

export const PICKLIST_POLL_MS = 30_000;

const url = (space: string, season?: number) => `/api/scout/workspaces/${encodeURIComponent(space)}/picklist${season ? `?season=${season}` : ""}`;

interface Pending { id: number; op: PickOp; space: string; season: number }

/** The server's list with changes still on their way applied on top (each one that still applies). */
export function withPending(list: PickList, pending: readonly PickOp[], me: PickPerson, at = Date.now()): PickList {
  let picks = list.picks;
  for (const op of pending) {
    const r = applyPickOp(picks, op, me, at);
    if (r.ok) picks = r.picks;
  }
  return picks === list.picks ? list : { ...list, picks };
}

/** Keep the newer of two lists (by version) for the same workspace and season. */
export const newer = (cur: PickList | null, next: PickList) =>
  !cur || cur.workspaceId !== next.workspaceId || cur.season !== next.season || next.version > cur.version ? next : cur;

export interface PickListState {
  /** What to show (null until the first answer). */
  list: PickList | null;
  loading: boolean;
  error: ApiError | null;
  /** Changes not yet confirmed by the server. */
  saving: boolean;
  change: (op: PickOp) => void;
  reload: () => void;
}

/**
 * The shared pick list of a workspace for a season (null space: none). `me`: how this device's own
 * not-yet-saved changes are attributed until the server's answer. `onRefused`: a change the server
 * refused (shown as a notice).
 */
export function usePickList(space: string | null, season: number, live: LiveMode, me: PickPerson, onRefused: (message: string) => void): PickListState {
  const [server, setServer] = useState<PickList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const key = space ? `${space}:${season}` : null;
  const keyRef = useRef(key);
  keyRef.current = key;
  const queue = useRef<Pending[]>([]);
  const busy = useRef(false);
  const nextId = useRef(1);
  const refused = useRef(onRefused);
  refused.current = onRefused;

  const accept = useCallback((l: PickList) => {
    if (`${l.workspaceId}:${l.season}` !== keyRef.current) return;
    setServer((cur) => newer(cur, l));
  }, []);

  const fetchList = useCallback(async () => {
    if (!space) return;
    const k = `${space}:${season}`;
    setLoading(true);
    try {
      const r = await apiFetch<{ list: unknown }>(url(space, season));
      if (keyRef.current !== k) return;
      if (isPickList(r.list)) accept(r.list);
      setError(null);
    } catch (e) {
      if (keyRef.current === k) setError(e instanceof ApiError ? e : new ApiError(0, "Couldn't load the pick list."));
    } finally {
      if (keyRef.current === k) setLoading(false);
    }
  }, [space, season, accept]);

  const refetch = useRef(fetchList);
  refetch.current = fetchList;

  // A new space or season: start over (changes still on their way for the old one keep going up).
  useEffect(() => {
    setServer(null); setError(null);
    void fetchList();
  }, [fetchList]);

  // Back live (a reconnect may have missed a change): fetch again. Polling: every 30 s.
  useEffect(() => {
    if (!space) return;
    if (live === "live") void fetchList();
    if (live !== "polling") return;
    const t = setInterval(() => { void fetchList(); }, PICKLIST_POLL_MS);
    return () => clearInterval(t);
  }, [live, space, fetchList]);

  useEffect(() => {
    if (!space) return;
    const on = (ev: Event) => { const l = (ev as CustomEvent<unknown>).detail; if (isPickList(l)) accept(l); };
    window.addEventListener(SCOUT_PICKLIST, on);
    return () => window.removeEventListener(SCOUT_PICKLIST, on);
  }, [space, accept]);

  /** Send queued changes one at a time, in order. */
  const drain = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length) {
        const p = queue.current[0];
        const k = `${p.space}:${p.season}`;
        try {
          const r = await apiFetch<{ list: unknown }>(url(p.space), { method: "POST", json: { season: p.season, ...p.op } });
          if (isPickList(r.list)) accept(r.list);
        } catch (e) {
          // Refused (409: a team it names is gone, or the list is full) or not sent: say so, show the server's list.
          const err = e instanceof ApiError ? e : new ApiError(0, "Couldn't save the change.");
          if (keyRef.current === k) {
            refused.current(err.status === 409 ? err.message : `Not saved: ${err.message}`);
            void refetch.current();
          }
        }
        if (queue.current[0] === p) queue.current.shift();
        setPending((cur) => cur.filter((x) => x.id !== p.id));
      }
    } finally { busy.current = false; }
  }, [accept]);

  const change = useCallback((op: PickOp) => {
    if (!space) return;
    const p: Pending = { id: nextId.current++, op, space, season };
    queue.current.push(p);
    setPending((cur) => [...cur, p]);
    void drain();
  }, [space, season, drain]);

  const mine = useMemo(() => pending.filter((p) => p.space === space && p.season === season).map((p) => p.op), [pending, space, season]);
  const list = useMemo(() => (server ? withPending(server, mine, me) : null), [server, mine, me]);
  return { list, loading: !server && (loading || !error), error: server ? null : error, saving: mine.length > 0, change, reload: () => { void fetchList(); } };
}
