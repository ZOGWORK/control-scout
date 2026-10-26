// Match scouting assignments on the device (server/scout/assignments.ts, docs/assignments.md): who watches which
// slot or alliance for which quals at an event ("Priya: Red 1, Q1–Q30"). A workspace's list for a season, from
// GET /api/scout/workspaces/:id/assignments/matches, kept live by the workspace's stream (scoutLive.ts
// re-announces each `event: match-assignment` as SCOUT_MATCH_ASSIGNMENT), fetched again whenever the stream
// (re)connects and every 30 s while the app polls. The last list is kept on the device (per space and season).
//
// The Scout page reads two things from it: the signed-in member's own assignment (myMatchAssignment, to prefill
// the session setup) and who has the other teams in each match (othersByMatch, for the Matches tab).
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import { ASSIGNMENTS_POLL_MS } from "./assignments";
import type { LiveMode } from "./scoutLive";
import type { OtherScout } from "../components/scout/redesign/MatchesList";
import {
  coversMatch, isMatchAssignment, qualNumber,
  type MatchAssignment, type MatchAssignmentBody, type MatchAssignmentNotice, type MatchAssignmentResult,
} from "../shared/assignments";
import { normalizeMatchLabel, teamsWatched, type ScheduleMatch, type Watching } from "../shared/scoutMatch";

export type { MatchAssignment } from "../shared/assignments";

/** Window event: match assignments changed on a workspace's stream. detail: { space, notice }. */
export const SCOUT_MATCH_ASSIGNMENT = "cs-scout-match-assignment";
export const announceMatchAssignments = (space: string, notice: MatchAssignmentNotice) => {
  window.dispatchEvent(new CustomEvent(SCOUT_MATCH_ASSIGNMENT, { detail: { space, notice } }));
};

const base = (space: string) => `/api/scout/workspaces/${encodeURIComponent(space)}/assignments/matches`;
const storeKey = (space: string, season: number) => `cs-match-assignments:${space}:${season}`;

function readStored(space: string, season: number): MatchAssignment[] | null {
  try {
    const raw = localStorage.getItem(storeKey(space, season));
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter(isMatchAssignment) : null;
  } catch { return null; }
}
function store(space: string, season: number, list: MatchAssignment[]) {
  try { localStorage.setItem(storeKey(space, season), JSON.stringify(list)); } catch { /* full or blocked: the list still shows */ }
}

/**
 * Apply a change to a list (one season's), as applyNotice does for team assignments: created/updated replace by
 * id unless the list holds a newer version, deleted removes, and an id in `deleted` never comes back.
 */
export function applyMatchNotice(list: MatchAssignment[], n: MatchAssignmentNotice, season: number, deleted: ReadonlySet<number> = new Set()): MatchAssignment[] {
  const touched = n.matchAssignments.filter(isMatchAssignment);
  if (n.action === "deleted") {
    const ids = new Set(touched.map((a) => a.id));
    return list.filter((a) => !ids.has(a.id));
  }
  const byId = new Map(list.map((a) => [a.id, a]));
  for (const a of touched) {
    const cur = byId.get(a.id);
    if (deleted.has(a.id) || (cur && cur.version > a.version)) continue;
    // An edit can move one to another season: it leaves this list.
    if (a.season !== season) { byId.delete(a.id); continue; }
    byId.set(a.id, a);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export interface MatchAssignmentsState {
  list: MatchAssignment[]; loading: boolean; error: ApiError | null;
  reload: () => void;
  /** Put the server's answer to a change in at once (the stream brings it too; same result). */
  apply: (n: MatchAssignmentNotice) => void;
}

/** A workspace's match assignments for a season (null space: Personal, none). Same guards as useAssignments. */
export function useMatchAssignments(space: string | null, season: number, live: LiveMode): MatchAssignmentsState {
  const [list, setList] = useState<MatchAssignment[]>(() => (space ? readStored(space, season) ?? [] : []));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const gen = useRef(0);
  const latestReq = useRef(0);
  const log = useRef<{ seq: number; notice: MatchAssignmentNotice }[]>([]);
  const seq = useRef(0);
  const inflight = useRef(0);
  const deletedIds = useRef(new Set<number>());

  const fetchList = useCallback(async () => {
    if (!space) return;
    const g = gen.current, req = ++latestReq.current, since = seq.current;
    inflight.current++;
    setLoading(true);
    try {
      const r = await apiFetch<{ matchAssignments: unknown[] }>(`${base(space)}?season=${season}`);
      if (gen.current !== g || req !== latestReq.current) return;
      let next = (r.matchAssignments ?? []).filter(isMatchAssignment).filter((a) => !deletedIds.current.has(a.id));
      // Changes that arrived while this was on its way: a reply read before them must not undo them.
      for (const l of log.current) if (l.seq > since) next = applyMatchNotice(next, l.notice, season, deletedIds.current);
      setList(next); store(space, season, next); setError(null);
    } catch (e) {
      if (gen.current === g && req === latestReq.current) setError(e instanceof ApiError ? e : new ApiError(0, "Couldn't load the match assignments."));
    } finally {
      if (gen.current === g && --inflight.current <= 0) { inflight.current = 0; log.current = []; setLoading(false); }
    }
  }, [space, season]);

  useEffect(() => {
    gen.current++;
    log.current = []; inflight.current = 0; deletedIds.current = new Set();
    setList(space ? readStored(space, season) ?? [] : []);
    setError(null);
    void fetchList();
  }, [space, season, fetchList]);

  const wasLive = useRef(false);
  useEffect(() => {
    if (!space) return;
    if (live === "live" && wasLive.current === false) { wasLive.current = true; void fetchList(); }
    if (live !== "live") wasLive.current = false;
    if (live !== "polling") return;
    const t = setInterval(() => { void fetchList(); }, ASSIGNMENTS_POLL_MS);
    return () => clearInterval(t);
  }, [live, space, fetchList]);

  const shown = useRef({ space, season });
  shown.current = { space, season };
  const apply = useCallback((n: MatchAssignmentNotice) => {
    if (!space || shown.current.space !== space || shown.current.season !== season) return;
    if (n.action === "deleted") for (const a of n.matchAssignments) if (Number.isSafeInteger(a?.id)) deletedIds.current.add(a.id);
    if (inflight.current > 0) log.current.push({ seq: ++seq.current, notice: n });
    setList((cur) => { const next = applyMatchNotice(cur, n, season, deletedIds.current); store(space, season, next); return next; });
  }, [space, season]);

  useEffect(() => {
    if (!space) return;
    const on = (ev: Event) => {
      const d = (ev as CustomEvent<{ space: string; notice: MatchAssignmentNotice }>).detail;
      if (d?.space === space && d.notice && Array.isArray(d.notice.matchAssignments)) apply(d.notice);
    };
    window.addEventListener(SCOUT_MATCH_ASSIGNMENT, on);
    return () => window.removeEventListener(SCOUT_MATCH_ASSIGNMENT, on);
  }, [space, apply]);

  return { list, loading, error, reload: () => { void fetchList(); }, apply };
}

// --- What the Scout page reads -----------------------------------------------------------------

const sameEvent = (a: MatchAssignment, eventCode: string, season: number) => a.season === season && a.eventCode === eventCode.trim().toUpperCase();

export interface MyMatchAssignment { watching: Watching; fromMatch: string | null; toMatch: string | null; assignment: MatchAssignment }

/**
 * The signed-in member's match assignment at an event, to prefill the session setup: the one covering `atMatch`
 * when that's given and one does, else the one starting earliest. null: none (or signed out).
 */
export function myMatchAssignment(list: readonly MatchAssignment[], me: number | null | undefined, eventCode: string, season: number, atMatch?: string | null): MyMatchAssignment | null {
  if (me == null) return null;
  const mine = list.filter((a) => a.assigneeAccountId === me && sameEvent(a, eventCode, season))
    .sort((a, b) => (qualNumber(a.fromMatch) ?? 0) - (qualNumber(b.fromMatch) ?? 0) || a.id - b.id);
  const pick = (atMatch ? mine.find((a) => coversMatch(a, atMatch)) : undefined) ?? mine[0];
  return pick ? { watching: pick.watching, fromMatch: pick.fromMatch, toMatch: pick.toMatch, assignment: pick } : null;
}

const SIDE_ORDER: OtherScout["side"][] = ["red", "red1", "red2", "blue", "blue1", "blue2"];

/**
 * Who else has teams in each match, in the shape MatchesList takes: normalized label → the other members whose
 * assignment covers that match, one line per slot or alliance (all four teams: one for each alliance). done:
 * every team of theirs in that match has an entry (scoutedByMatch). The signed-in member is left out. Pass
 * `at` when the list holds other events.
 */
export function othersByMatch(list: readonly MatchAssignment[], schedule: readonly ScheduleMatch[], scouted: Map<string, Set<number>>, me: number | null | undefined, at?: { eventCode: string; season: number }): Map<string, OtherScout[]> {
  const out = new Map<string, OtherScout[]>();
  const theirs = list.filter((a) => a.assigneeAccountId !== me && (!at || sameEvent(a, at.eventCode, at.season)));
  if (!theirs.length) return out;
  for (const m of schedule) {
    const label = normalizeMatchLabel(m.label);
    if (!label || m.level !== "qual") continue;
    const have = scouted.get(label);
    const rows: OtherScout[] = [];
    for (const a of theirs) {
      if (!coversMatch(a, label)) continue;
      const w = a.watching;
      const sides: OtherScout["side"][] = w.kind === "slot" ? [w.slot] : w.kind === "alliance" ? [w.side] : ["red", "blue"];
      for (const side of sides) {
        const part: Watching = side === "red" || side === "blue" ? { kind: "alliance", side } : { kind: "slot", slot: side };
        const teams = teamsWatched(m, part);
        const done = teams.length > 0 && !!have && teams.every((t) => have.has(t.team));
        const name = a.assigneeName || "A member";
        if (!rows.some((r) => r.side === side && r.name === name)) rows.push({ side, name, done });
      }
    }
    if (rows.length) out.set(label, rows.sort((x, y) => SIDE_ORDER.indexOf(x.side) - SIDE_ORDER.indexOf(y.side)));
  }
  return out;
}

// --- Changes (admins) ----------------------------------------------------------------------------

export const createMatchAssignment = (space: string, body: MatchAssignmentBody) =>
  apiFetch<MatchAssignmentResult>(base(space), { method: "POST", json: body });

export const updateMatchAssignment = (space: string, id: number, body: MatchAssignmentBody) =>
  apiFetch<MatchAssignmentResult>(`${base(space)}/${id}`, { method: "PATCH", json: body });

export const deleteMatchAssignment = (space: string, id: number) =>
  apiFetch<{ deleted: number }>(`${base(space)}/${id}`, { method: "DELETE" });
