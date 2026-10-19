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
// - A note is kept on the device until the server confirms it (picklistDrafts.ts; audit PRIVATE-F03), per
//   account, workspace, season and team. After a reload, a kept note goes up again by itself when the note
//   it was written over is still the one the list has (sent with that base, so the server checks it too).
//   When a teammate has changed the note since, it isn't sent: the field shows it as not saved yet, and
//   the member retries (replacing theirs) or presses Escape (keeping theirs). Confirmed: the draft goes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import type { LiveMode } from "./scoutLive";
import { applyPickOp, isPickList, type PickList, type PickOp, type PickPerson } from "../shared/picklist";
import { clearNoteDraft, noteDrafts, readNoteDraft, saveNoteDraft } from "./picklistDrafts";

/** Window event: a workspace's pick list arrived on its stream. detail: PickList. */
export const SCOUT_PICKLIST = "cs-scout-picklist";
export const announcePicklist = (l: PickList) => { window.dispatchEvent(new CustomEvent(SCOUT_PICKLIST, { detail: l })); };
/** Window event: fetch a workspace's open pick list again (the space switcher's manual refresh). detail: { space }. */
export const SCOUT_PICKLIST_RESYNC = "cs-scout-picklist-resync";
export const announcePicklistResync = (space: string) => { window.dispatchEvent(new CustomEvent(SCOUT_PICKLIST_RESYNC, { detail: { space } })); };

export const PICKLIST_POLL_MS = 30_000;

const url = (space: string, season?: number) => `/api/scout/workspaces/${encodeURIComponent(space)}/picklist${season ? `?season=${season}` : ""}`;

/** `account`: who wrote it (its note draft is that account's). */
/** `wid`: the id of the note draft it wrote (drafts are shared by this account's tabs: each answer only clears its own). */
interface Pending { id: number; op: PickOp; space: string; season: number; account: number | null; wid?: string }
const newWid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** A note this member wrote that the server hasn't taken. conflict: a teammate's newer note is there instead. */
/**
 * A note this member wrote that the server hasn't taken. conflict: a teammate's newer note is there instead.
 * base: the base it was sent with (a kept note) and failed to send: its retry carries the same one, so a
 * teammate's note written meanwhile still isn't replaced.
 */
interface Unsaved { note: string; conflict: boolean; base?: number | null }
/** The key of one team's note for one account (drafts are never shown to another account). */
const noteKey = (account: number | null, space: string, season: number, team: number) => `${account ?? "-"}:${space}:${season}:${team}`;

/** The server's list with changes still on their way applied on top (each one that still applies). */
export function withPending(list: PickList, pending: readonly PickOp[], me: PickPerson, at = Date.now()): PickList {
  let picks = list.picks;
  for (const op of pending) {
    const r = applyPickOp(picks, op, me, at);
    if (r.ok) picks = r.picks;
  }
  return picks === list.picks ? list : { ...list, picks };
}

/**
 * The order the pick numbers show: the whole list, with the rows on screen (`shown`) in the order a drag in
 * progress would leave them (`rankOf`: the drag hook's 1-based place, 0 for a team it doesn't know). A pick not
 * on screen yet (its stats loading), or one that appeared mid-drag, keeps its own place.
 */
export function displayOrder(teams: readonly number[], shown: (team: number) => boolean, rankOf: (team: number) => number): number[] {
  const inDrag = teams.filter((t) => shown(t) && rankOf(t) > 0);
  const dragOrder = [...inDrag].sort((a, b) => rankOf(a) - rankOf(b));
  let j = 0;
  return teams.map((t) => (shown(t) && rankOf(t) > 0 ? dragOrder[j++] : t));
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
  /** A note this member wrote that the server didn't take (kept so it isn't lost: they retry or put it back). */
  unsavedNote: (team: number) => string | undefined;
  /** That note wasn't sent because a teammate changed the note since it was written (see the file's notes). */
  noteConflict: (team: number) => boolean;
  /** A team's note as the server has it (what a note that failed to save is compared with). */
  savedNote: (team: number) => string | undefined;
  change: (op: PickOp) => void;
  reload: () => void;
}

/**
 * The shared pick list of a workspace for a season (null space: none). `me`: how this device's own
 * not-yet-saved changes are attributed until the server's answer. `onRefused`: a change the server
 * refused (shown as a notice).
 */
export function usePickList(space: string | null, season: number, live: LiveMode, me: PickPerson, onRefused: (message: string) => void,
  /** A read-only space (Task 19): kept notes are neither sent nor shown (they wait, untouched, until it can be written again). */
  readOnly = false): PickListState {
  const [server, setServer] = useState<PickList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  // Notes the server didn't take, by noteKey: the text stays in the field, marked unsaved.
  const [unsaved, setUnsaved] = useState<Record<string, Unsaved>>({});
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const serverRef = useRef(server);
  serverRef.current = server;
  const account = me.accountId;
  const accountRef = useRef(account);
  accountRef.current = account;
  // The newest note write per team (same keys): only its failure marks the field unsaved, so an older write
  // failing after a newer one was made never brings its text back.
  const latestNote = useRef(new Map<string, number>());
  // The draft id of this page's newest note write per team (same keys).
  const latestWid = useRef(new Map<string, string>());
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
    const resync = (ev: Event) => { if ((ev as CustomEvent<{ space?: string }>).detail?.space === space) void refetch.current(); };
    window.addEventListener(SCOUT_PICKLIST, on);
    window.addEventListener(SCOUT_PICKLIST_RESYNC, resync);
    return () => { window.removeEventListener(SCOUT_PICKLIST, on); window.removeEventListener(SCOUT_PICKLIST_RESYNC, resync); };
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
          if (p.op.op === "note" && p.account != null) {
            const team = p.op.team;
            // Only the draft this write made: a newer one (this page's, or another tab's) is still to be confirmed.
            const d = readNoteDraft(p.account, p.space, p.season, team);
            if (d && d.wid === p.wid) clearNoteDraft(p.account, p.space, p.season, team);
            else if (d && d.wid === latestWid.current.get(noteKey(p.account, p.space, p.season, team))) {
              // A newer note of this page's is still on its way: it's now written over this one, as the server has it.
              const now = isPickList(r.list) ? r.list.picks.find((x) => x.team === team) : undefined;
              if (now) saveNoteDraft(p.account, p.space, p.season, { ...d, base: now.noteUpdatedAt ?? null });
            }
          }
        } catch (e) {
          // Refused (409: a team it names is gone, or the list is full) or not sent: say so, show the server's list.
          const err = e instanceof ApiError ? e : new ApiError(0, "Couldn't save the change.");
          if (p.op.op === "note") {
            const note = p.op.note, team = p.op.team, key = noteKey(p.account, p.space, p.season, team);
            // A note sent with its base and refused (409): a teammate's newer note is there. Kept, not sent.
            const conflict = err.status === 409 && p.op.base !== undefined;
            if (latestNote.current.get(key) === p.id) {
              // Its text stays (the field shows it unsaved, and its draft is kept), unless its team is gone (409).
              const base = p.op.base;
              if (err.status !== 409 || conflict) setUnsaved((u) => ({ ...u, [key]: { note, conflict, ...(!conflict && base !== undefined ? { base } : {}) } }));
              else if (p.account != null && readNoteDraft(p.account, p.space, p.season, team)?.wid === p.wid) clearNoteDraft(p.account, p.space, p.season, team);
            }
          }
          if (keyRef.current === k) {
            refused.current(err.status === 409 ? err.message : `Not saved: ${err.message}`);
            void refetch.current();
          }
        }
        if (p.op.op === "note") { const key = noteKey(p.account, p.space, p.season, p.op.team); if (latestNote.current.get(key) === p.id) latestNote.current.delete(key); }
        if (queue.current[0] === p) queue.current.shift();
        setPending((cur) => cur.filter((x) => x.id !== p.id));
      }
    } finally { busy.current = false; }
  }, [accept]);

  const change = useCallback((op: PickOp) => {
    if (!space) return;
    const acct = accountRef.current;
    let wid: string | undefined;
    if (op.op === "note") {
      const key = noteKey(acct, space, season, op.team);
      const team = op.team;
      const shown = serverRef.current?.picks.find((x) => x.team === team);
      // A retry (or Escape) of a kept note. Over a teammate's newer one: written over the note shown now, so one
      // written after it still isn't replaced. One that failed to send: with the base it was sent with.
      const kept = unsavedRef.current[key];
      if (op.base === undefined && kept?.conflict) op = { ...op, base: shown?.noteUpdatedAt ?? null };
      else if (op.base === undefined && kept?.base !== undefined) op = { ...op, base: kept.base };
      // Kept on the device until the server confirms it, with the note it's written over.
      wid = newWid();
      latestWid.current.set(key, wid);
      if (acct != null) saveNoteDraft(acct, space, season, { team, note: op.note, base: op.base !== undefined ? op.base : shown?.noteUpdatedAt ?? null, at: Date.now(), wid });
    }
    const p: Pending = { id: nextId.current++, op, space, season, account: acct, wid };
    // A new write of a note replaces one that failed (a retry, or putting the saved one back).
    if (op.op === "note") { const key = noteKey(acct, space, season, op.team); latestNote.current.set(key, p.id); setUnsaved((u) => { if (!(key in u)) return u; const { [key]: _gone, ...rest } = u; return rest; }); }
    queue.current.push(p);
    setPending((cur) => [...cur, p]);
    void drain();
  }, [space, season, drain]);

  // Notes kept from before a reload (or from another tab of this account that closed): once the list is here,
  // once per account, workspace and season. Confirmed meanwhile (the list says the same) or its team gone:
  // dropped. Written over the note the list still has: sent again (with that base). A teammate's newer note
  // there instead: shown as not saved yet, for the member to decide.
  const recovered = useRef(new Set<string>());
  useEffect(() => {
    if (readOnly || !space || account == null || !server || server.workspaceId !== space || server.season !== season) return;
    const rk = `${account}:${space}:${season}`;
    if (recovered.current.has(rk)) return;
    recovered.current.add(rk);
    for (const d of noteDrafts(account, space, season)) {
      const key = noteKey(account, space, season, d.team);
      if (latestNote.current.has(key)) continue; // written on this page: on its way already
      const now = server.picks.find((x) => x.team === d.team);
      if (!now || now.note === d.note) { clearNoteDraft(account, space, season, d.team); continue; }
      if ((now.noteUpdatedAt ?? null) === d.base) change({ op: "note", team: d.team, note: d.note, base: d.base });
      else setUnsaved((u) => ({ ...u, [key]: { note: d.note, conflict: true } }));
    }
  }, [server, space, season, account, change, readOnly]);

  const mine = useMemo(() => pending.filter((p) => p.space === space && p.season === season).map((p) => p.op), [pending, space, season]);
  const list = useMemo(() => (server ? withPending(server, mine, me) : null), [server, mine, me]);
  return { list, loading: !server && (loading || !error), error: server ? null : error, saving: mine.length > 0, change,
    unsavedNote: (team: number) => (space ? unsaved[noteKey(account, space, season, team)]?.note : undefined),
    noteConflict: (team: number) => (space ? !!unsaved[noteKey(account, space, season, team)]?.conflict : false),
    savedNote: (team: number) => server?.picks.find((p) => p.team === team)?.note, reload: () => { void fetchList(); } };
}
