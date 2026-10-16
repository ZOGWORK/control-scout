// Scouting assignments on the device (Task 10; server/scout/assignments.ts): a workspace's list for a
// season, from GET /api/scout/workspaces/:id/assignments, kept live by the workspace's stream
// (scoutLive.ts re-announces each `event: assignment` as SCOUT_ASSIGNMENT). Fetched again whenever the
// stream (re)connects and every 30 s while the app polls instead. The last list is kept on the device
// (per space and season), so My assignments and the badges are there with no signal at the venue.
//
// Progress: the server counts the assignee's synced entries; this device adds what it knows that the
// server can't yet (entries saved here and not synced), so a scout sees their count move the moment they save.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import type { LiveMode } from "./scoutLive";
import type { ScoutEntry } from "./scouting";
import {
  assignmentKey, isAssignment, type AssignableMember, type Assignment, type AssignmentNotice, type AssignmentStatus,
  type CreateAssignmentsBody, type CreateAssignmentsResult, type EventTeamOption,
} from "../shared/assignments";

export type { Assignment } from "../shared/assignments";

/** Window event: assignments changed on a workspace's stream. detail: { space, notice }. */
export const SCOUT_ASSIGNMENT = "cs-scout-assignment";
export const announceAssignments = (space: string, notice: AssignmentNotice) => {
  window.dispatchEvent(new CustomEvent(SCOUT_ASSIGNMENT, { detail: { space, notice } }));
};

export const ASSIGNMENTS_POLL_MS = 30_000;

const base = (space: string) => `/api/scout/workspaces/${encodeURIComponent(space)}/assignments`;
const storeKey = (space: string, season: number) => `cs-assignments:${space}:${season}`;

function readStored(space: string, season: number): Assignment[] | null {
  try {
    const raw = localStorage.getItem(storeKey(space, season));
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter(isAssignment) : null;
  } catch { return null; }
}
function store(space: string, season: number, list: Assignment[]) {
  try { localStorage.setItem(storeKey(space, season), JSON.stringify(list)); } catch { /* full or blocked: the list still shows */ }
}

/**
 * Apply a change to a list (one season's): created/updated replace by id, deleted removes. Changes can
 * arrive out of order (a PATCH reply after the stream's newer notice), so a copy never replaces a newer
 * version of itself, and an id in `deleted` (ids are never reused) never comes back.
 */
export function applyNotice(list: Assignment[], n: AssignmentNotice, season: number, deleted: ReadonlySet<number> = new Set()): Assignment[] {
  const touched = n.assignments.filter(isAssignment);
  if (n.action === "deleted") {
    const ids = new Set(touched.map((a) => a.id));
    return list.filter((a) => !ids.has(a.id));
  }
  const byId = new Map(list.map((a) => [a.id, a]));
  for (const a of touched) {
    if (deleted.has(a.id) || a.season !== season) continue;
    const cur = byId.get(a.id);
    if (cur && (cur.version ?? 1) > (a.version ?? 1)) continue;
    byId.set(a.id, a);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export interface AssignmentsState {
  list: Assignment[]; loading: boolean; error: ApiError | null;
  reload: () => void;
  /** Put the server's answer to a change in at once (the stream brings it too; same result). */
  apply: (n: AssignmentNotice) => void;
}

/** A workspace's assignments for a season (null space: Personal, none). */
export function useAssignments(space: string | null, season: number, live: LiveMode): AssignmentsState {
  const [list, setList] = useState<Assignment[]>(() => (space ? readStored(space, season) ?? [] : []));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // One generation per space and season: a reply from an earlier one changes nothing.
  const gen = useRef(0);
  // The latest request started: an older reply that lands after a newer one is dropped.
  const latestReq = useRef(0);
  // Changes applied since each request started (live notices, or this device's own): a reply read before
  // them must not undo them, so they're applied again on top of it.
  const log = useRef<{ seq: number; notice: AssignmentNotice }[]>([]);
  const seq = useRef(0);
  const inflight = useRef(0);
  // Ids this device has seen deleted (in this space and season): a late reply or notice never brings one back.
  const deletedIds = useRef(new Set<number>());

  const fetchList = useCallback(async () => {
    if (!space) return;
    const g = gen.current, req = ++latestReq.current, since = seq.current;
    inflight.current++;
    setLoading(true);
    try {
      const r = await apiFetch<{ assignments: unknown[] }>(`${base(space)}?season=${season}`);
      if (gen.current !== g || req !== latestReq.current) return;
      let next = (r.assignments ?? []).filter(isAssignment);
      next = next.filter((a) => !deletedIds.current.has(a.id));
      for (const l of log.current) if (l.seq > since) next = applyNotice(next, l.notice, season, deletedIds.current);
      setList(next); store(space, season, next); setError(null);
    } catch (e) {
      if (gen.current === g && req === latestReq.current) setError(e instanceof ApiError ? e : new ApiError(0, "Couldn't load the assignments."));
    } finally {
      if (gen.current === g) {
        if (--inflight.current <= 0) { inflight.current = 0; log.current = []; setLoading(false); }
      }
    }
  }, [space, season]);

  useEffect(() => {
    gen.current++;
    log.current = []; inflight.current = 0; deletedIds.current = new Set();
    setList(space ? readStored(space, season) ?? [] : []);
    setError(null);
    void fetchList();
  }, [space, season, fetchList]);

  // Live again (a reconnect may have missed changes, and the first load may have failed): fetch again.
  // Polling: every 30 s.
  const wasLive = useRef(false);
  useEffect(() => {
    if (!space) return;
    if (live === "live" && wasLive.current === false) { wasLive.current = true; void fetchList(); }
    if (live !== "live") wasLive.current = false;
    if (live !== "polling") return;
    const t = setInterval(() => { void fetchList(); }, ASSIGNMENTS_POLL_MS);
    return () => clearInterval(t);
  }, [live, space, fetchList]);

  const apply = useCallback((n: AssignmentNotice) => {
    if (!space) return;
    if (n.action === "deleted") for (const a of n.assignments) if (Number.isSafeInteger(a?.id)) deletedIds.current.add(a.id);
    if (inflight.current > 0) log.current.push({ seq: ++seq.current, notice: n });
    setList((cur) => { const next = applyNotice(cur, n, season, deletedIds.current); store(space, season, next); return next; });
  }, [space, season]);

  useEffect(() => {
    if (!space) return;
    const on = (ev: Event) => {
      const d = (ev as CustomEvent<{ space: string; notice: AssignmentNotice }>).detail;
      if (d?.space === space && d.notice && Array.isArray(d.notice.assignments)) apply(d.notice);
    };
    window.addEventListener(SCOUT_ASSIGNMENT, on);
    return () => window.removeEventListener(SCOUT_ASSIGNMENT, on);
  }, [space, apply]);

  return { list, loading, error, reload: () => { void fetchList(); }, apply };
}

/** Who holds each team at each event: assignmentKey → the assignments (badges on team rows and entry cards). */
export function useAssignmentIndex(list: Assignment[]): Map<string, Assignment[]> {
  return useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of list) {
      const k = assignmentKey(a.season, a.eventCode, a.team);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [list]);
}

/** "Assigned to Priya" / "Assigned to you" / "Assigned to Priya and Sam" / "Assigned to Priya +2". */
export function assignedLabel(holders: Assignment[], myAccountId: number | null | undefined): string | null {
  if (!holders.length) return null;
  const names = holders.map((a) => (a.assigneeAccountId === myAccountId ? "you" : a.assigneeName || "a member"));
  // "you" first: it's what matters to the reader.
  names.sort((a, b) => (a === "you" ? -1 : b === "you" ? 1 : 0));
  if (names.length === 1) return `Assigned to ${names[0]}`;
  if (names.length === 2) return `Assigned to ${names[0]} and ${names[1]}`;
  return `Assigned to ${names[0]} +${names.length - 1}`;
}

/**
 * The assignee's entries for this assignment: the server's count, or this device's when it knows more
 * (entries saved here that haven't synced yet are the signed-in scout's own).
 */
export function assignmentProgress(a: Assignment, local: ScoutEntry[], myAccountId: number | null | undefined): number {
  const mine = a.assigneeAccountId === myAccountId;
  const here = local.filter((e) => !e.deleted && e.season === a.season && e.team === a.team && (e.eventCode ?? "").toUpperCase() === a.eventCode
    && (e.authorAccountId === a.assigneeAccountId || (mine && !e.authorAccountId))).length;
  return Math.max(a.progress, here);
}

// --- Changes ---------------------------------------------------------------------------------

export const createAssignments = (space: string, body: CreateAssignmentsBody) =>
  apiFetch<CreateAssignmentsResult>(base(space), { method: "POST", json: body });

export const setAssignmentStatus = (space: string, id: number, status: AssignmentStatus) =>
  apiFetch<{ assignment: Assignment; changed: boolean }>(`${base(space)}/${id}`, { method: "PATCH", json: { status } });

export const deleteAssignment = (space: string, id: number) =>
  apiFetch<{ deleted: number }>(`${base(space)}/${id}`, { method: "DELETE" });

export const fetchAssignOptions = (space: string, season: number, eventCode: string) =>
  apiFetch<{ members: AssignableMember[]; teams: EventTeamOption[] }>(`${base(space)}/options?season=${season}&event=${encodeURIComponent(eventCode)}`);
