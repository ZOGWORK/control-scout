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
// - Every note goes up with its base (the note it was written over: the server's note when the edit began), so
//   a teammate's newer note this member hadn't seen is never replaced by an older draft (audit E4). The server
//   refuses it (409) and the field asks. A later edit made while this page's own earlier note was on its way
//   moves its base onto the note that one made (so a member's own notes never conflict with each other).
// - A change whose answer was lost (no answer, or a proxy's 5xx) isn't called failed: the list is fetched and
//   checked first. Taken: saved. Not there: kept, marked as unconfirmed, with Retry (safe: notes carry their
//   base) or Discard. Order changes that didn't go through stay listed in the recoverable view
//   (RecoverableChanges.tsx, src/lib/pendingWork.ts) instead of disappearing behind a notice.
// - Every order change (add, remove, move, copy) has an op id, and is kept in this device's IndexedDB
//   (picklistOps.ts) from the moment it's made until the workspace confirms it or the member discards it, with
//   the account, workspace and season it belongs to and the order the member saw then. The server applies one id
//   once, so a change sent again (Retry, or after a lost answer) never lands twice. After a reload, kept changes
//   are checked against the server first (GET ?ops=): applied meanwhile, they simply go; the rest wait, with
//   Retry and Discard, on the pick list and in the recoverable view. Nothing is sent again by itself.
// - Retry checks first (picklistConflict.ts): the team it moves is gone (only Discard), the team it was placed
//   beside is gone (applied next to the nearest one still there), or someone changed the list since (what
//   changed is shown; the member applies theirs anyway or discards). A change is only ever sent as the account
//   that made it (the server refuses another, WRONG_ACCOUNT), and only to its own workspace and season; a
//   workspace this account can no longer reach (403/404) or that is read-only (423) is never sent to: the change
//   is kept until the member discards it.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { apiFetch, ApiError } from "./api";
import type { LiveMode } from "./scoutLive";
import { applyPickOp, cleanNote, isPickList, MAX_OP_QUERY, NOTE_CHANGED, WRONG_ACCOUNT, type Pick, type PickList, type PickOp, type PickPerson } from "../shared/picklist";
import { deleteKeptOp, KEPT_OPS_CHANGED, keptOps, newPageForTests, putKeptOp, TAB_ID, type KeptPickOp } from "./picklistOps";
import { conflictOf, describeConflict, teamsOf, type PickConflict } from "./picklistConflict";
import { clearNoteDraft, noteDrafts, readNoteDraft, saveNoteDraft, type NoteDraft } from "./picklistDrafts";
import { claimScope, knownOffline, noteUnstoredSending, outcomeUnknown, publishPending, SAVED_SHOW_MS, type PendingItem, type SaveState } from "./pendingWork";

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
interface Pending { id: number; op: PickOp; space: string; season: number; account: number | null; wid?: string; /** Its draft was stored on the device. */ kept?: boolean;
  /** An order change's op id, and the order (and version) the member saw just before it. */ opId?: string; base?: number[]; baseVersion?: number; at?: number }
const newWid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
/** A new order change's op id (isPickOpId). */
export const newOpId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${newWid()}-${Math.random().toString(36).slice(2, 10)}`);

/**
 * A note this member wrote that the server hasn't taken. conflict: a teammate's newer note is there instead.
 * base: the base it was sent with (a kept note) and failed to send: its retry carries the same one, so a
 * teammate's note written meanwhile still isn't replaced.
 */
interface Unsaved { note: string; conflict: boolean; base?: number | null; /** False: this device couldn't store it, so a reload loses it. */ kept?: boolean;
  /** Sent, but the answer was lost and the list didn't show it: it may still arrive. */ uncertain?: boolean }
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
  /** That note is stored on this device (false: only on this page, a reload loses it). */
  noteKept: (team: number) => boolean;
  /** Its outcome is unknown: the answer was lost and checking the list didn't settle it. */
  noteUncertain: (team: number) => boolean;
  /** A team's note as the server has it (what a note that failed to save is compared with). */
  savedNote: (team: number) => string | undefined;
  /** The server's time of a team's note (null: never noted): the version a new edit of it is written over. */
  savedNoteAt: (team: number) => number | null;
  /** Where a team's note stands (null: nothing to say). Draft is the field's own (its save pause). */
  noteState: (team: number) => SaveState | null;
  /** Where the list's order changes (add, remove, move, copy) stand. */
  orderState: SaveState | null;
  /** Order changes that didn't go through (not refused: not sent, or unconfirmed). */
  failed: FailedChange[];
  /** Send every kept order change of this list again, oldest first (force: apply them over what changed since). */
  retryAll: (opts?: { force?: boolean }) => void;
  /** Let go of every kept order change of this list. */
  discardAll: () => void;
  /** `editBase`: the server's time of the note when this edit began (savedNoteAt then). */
  change: (op: PickOp, opts?: { editBase?: number | null }) => void;
  /** Drop a note the server didn't take (the saved one shows again; nothing is sent). */
  discardNote: (team: number) => void;
  retryFailed: (id: number, opts?: { force?: boolean }) => void;
  discardFailed: (id: number) => void;
  reload: () => void;
}

/** An order change that didn't go through. uncertain: sent, no answer, and the list didn't show it. */
export interface FailedChange { id: number; op: Exclude<PickOp, { op: "note" }>; space: string; season: number; account: number | null; message: string; uncertain: boolean;
  /** A Retry of it is on its way. */ busy?: boolean;
  /** Its op id (every retry sends the same one, so it's applied once). */ opId?: string;
  /** The order (and the server's version) the member saw just before making it: what a retry compares with. */ base?: number[]; baseVersion?: number;
  /** When it was made (ms). */ at?: number;
  /** Kept in this device's storage (a reload doesn't lose it). */ stored?: boolean;
  /** Kept from before this page (a reload, or another tab). */ restored?: boolean;
  /** What a Retry found that the member decides (see picklistConflict.ts). */ conflict?: PickConflict;
  /** Never sent as things are: another account is signed in, the workspace can't be reached as this one, or it's read-only. */
  blocked?: "account" | "revoked" | "readonly" }

// One write at a time per workspace's list, in the order they were made: a list's own changes and Retries of
// kept ones join the same line, so an older change sent again can never land after a newer one and undo it.
// A list that closes (or a page that reloads) gives up its place: a write of its that never answers doesn't hold up
// the line for the list opened next (as a reload starts with an empty line anyway).
const writeLines = new Map<string, Promise<unknown>>();
const leaving = new Map<number, { gone: Promise<void>; leave: () => void }>();
let ownerSeq = 0;
const newLineOwner = () => ++ownerSeq;
function goneOf(owner: number): Promise<void> {
  let o = leaving.get(owner);
  if (!o) { let leave = () => {}; const gone = new Promise<void>((r) => { leave = r; }); o = { gone, leave }; leaving.set(owner, o); }
  return o.gone;
}
function leaveLine(owner: number) { goneOf(owner); leaving.get(owner)!.leave(); leaving.delete(owner); }
function inLine<T>(space: string, send: () => Promise<T>, owner?: number): Promise<T> {
  const run = (writeLines.get(space) ?? Promise.resolve()).then(send);
  const settled = owner == null ? run.catch(() => undefined) : Promise.race([run.catch(() => undefined), goneOf(owner)]);
  writeLines.set(space, settled);
  void settled.then(() => { if (writeLines.get(space) === settled) writeLines.delete(space); });
  return run;
}

// Changes queued or on their way that exist only in memory (order changes, and notes this device couldn't store).
// A list's queue keeps sending after the list closes, so these count for every list on the page: a reload before
// their answers would lose them (src/lib/chunkError.ts asks first).
const memoryOnly = new Set<Pending>();
function trackMemoryOnly(p: Pending, on: boolean) {
  if (on ? memoryOnly.has(p) : !memoryOnly.has(p)) return;
  if (on) memoryOnly.add(p); else memoryOnly.delete(p);
  noteUnstoredSending("picklist-queue", memoryOnly.size);
}

/** Window event: a kept order change went through on Retry. detail: { space, season }. */
const PICKLIST_CHANGE_SAVED = "cs-picklist-change-saved";

// Order changes that didn't go through, for this page (not per mounted list): closing the list, or switching
// workspace, season or view, never drops one. Each keeps its own workspace and season, and Retry sends it there.
const failedChanges = new Map<number, FailedChange>();
const failedListeners = new Set<() => void>();
let failedVersion = 0;
let failedSeq = 0;
function failedChanged() {
  failedVersion++;
  failedListeners.forEach((f) => f());
  publishPending("picklist-changes", [...failedChanges.values()].flatMap((f): PendingItem[] => f.account == null ? [] : [{
    key: `order:${f.account}:${f.space}:${f.season}:${f.id}`, account: f.account, kind: "order", workspaceId: f.space, season: f.season,
    team: "team" in f.op ? f.op.team : null, label: describeChange(f.op), status: "attention", message: failedMessage(f), busy: f.busy,
    retry: () => { void retryFailedChange(f.id); }, discard: () => discardFailedChange(f.id),
    ...(f.stored ? {} : { volatile: true }), // not in this device's storage: a reload loses it
  }]));
}
/** What a kept change's row says: what a Retry found, else why it's kept. */
export function failedMessage(f: FailedChange): string {
  if (f.conflict?.kind === "gone") return describeConflict(f.conflict);
  if (f.conflict) return `${describeConflict(f.conflict)} Open the pick list to apply yours anyway or discard it.`;
  return f.message;
}

// Writes to the device's kept changes, one at a time per op id (keeping one, then forgetting it once it's confirmed,
// always in that order).
const storeLines = new Map<string, Promise<unknown>>();
function persist<T>(opId: string, fn: () => Promise<T>): Promise<T> {
  const run = (storeLines.get(opId) ?? Promise.resolve()).then(fn, fn);
  const settled = run.catch(() => undefined);
  storeLines.set(opId, settled);
  void settled.then(() => { if (storeLines.get(opId) === settled) storeLines.delete(opId); });
  return run;
}
interface Recordable { op: FailedChange["op"]; space: string; season: number; message: string; uncertain: boolean; base?: number[]; baseVersion?: number; at?: number; account: number; opId: string }
const recordOf = (f: Recordable, state: KeptPickOp["state"]): KeptPickOp => ({
  account: f.account, space: f.space, season: f.season, opId: f.opId, op: f.op, at: f.at ?? Date.now(), base: f.base ?? [], baseVersion: f.baseVersion ?? 0,
  state, tab: TAB_ID, ...(state === "kept" ? { message: f.message, uncertain: f.uncertain } : {}),
});
const forget = (account: number | null, space: string, season: number, opId: string | undefined) => {
  if (account != null && opId) void persist(opId, () => deleteKeptOp(account, space, season, opId));
};
function keepFailed(f: Omit<FailedChange, "id">) {
  const id = ++failedSeq;
  failedChanges.set(id, { ...f, id });
  failedChanged();
  const { account, opId } = f;
  if (account != null && opId) {
    void persist(opId, () => putKeptOp(recordOf({ ...f, account, opId }, "kept"))).then((ok) => {
      const cur = failedChanges.get(id);
      if (cur && !!cur.stored !== ok) { failedChanges.set(id, { ...cur, stored: ok }); failedChanged(); }
    });
  }
}
export function discardFailedChange(id: number) {
  const f = failedChanges.get(id);
  if (!f) return;
  failedChanges.delete(id);
  failedChanged();
  forget(f.account, f.space, f.season, f.opId);
}

// The account signed in on this page (set by the open pick list and the recoverable view): a kept change of another
// account's is never sent (the server checks too: WRONG_ACCOUNT). Undefined: not known yet.
let signedInAccount: number | null | undefined;
export function setPicklistAccount(account: number | null | undefined) { signedInAccount = account; }

const STATUS_BLOCK: Record<number, FailedChange["blocked"]> = { 401: "account", 403: "revoked", 404: "revoked", 423: "readonly" };
export const BLOCKED_MESSAGE: Record<NonNullable<FailedChange["blocked"]>, string> = {
  account: "Made by an account that isn't signed in here, so it isn't sent. Sign in as that account to send it, or discard it.",
  revoked: "This account can't reach that workspace any more (removed from it, or it was deleted), so nothing is sent. It's kept on this device until you discard it.",
  readonly: "That workspace is read-only now, so nothing is sent. It's kept on this device until the workspace can be written again, or you discard it.",
};
/** Kept from before this page, and not sent yet. */
export const NOT_SENT_BEFORE_RELOAD = "Not saved before the page closed or reloaded. Kept on this device: Retry checks the list first and sends it once.";

/** Change a kept change in place (gone meanwhile, discarded: nothing). */
function updateFailed(id: number, patch: Partial<FailedChange>) {
  const cur = failedChanges.get(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  failedChanges.set(id, next);
  failedChanged();
  // What the device keeps says the same (a reload shows the same message).
  const { account, opId } = next;
  if (account != null && opId && next.stored && (patch.message !== undefined || patch.uncertain !== undefined)) void persist(opId, () => putKeptOp(recordOf({ ...next, account, opId }, "kept")));
}

/** The list (and which of these op ids it already took) as the server has it now, or why it couldn't say. */
async function checkList(space: string, season: number, opIds: string[]): Promise<{ list: PickList | null; applied: Set<string> } | { error: ApiError }> {
  try {
    const r = await apiFetch<{ list: unknown; appliedOps?: unknown }>(`${url(space, season)}${opIds.length ? `&ops=${opIds.map(encodeURIComponent).join(",")}` : ""}`);
    const list = isPickList(r.list) ? r.list : null;
    if (list) announcePicklist(list);
    return { list, applied: new Set(Array.isArray(r.appliedOps) ? r.appliedOps.filter((x): x is string => typeof x === "string") : []) };
  } catch (e) { return { error: e instanceof ApiError ? e : new ApiError(0, "Couldn't reach the workspace.") }; }
}

/** Teams this account's other kept changes for the same list name (their effects aren't someone else's change). */
const ownTeams = (f: FailedChange) => [...failedChanges.values()]
  .filter((x) => x.id !== f.id && x.account === f.account && x.space === f.space && x.season === f.season).flatMap((x) => teamsOf(x.op));
/** Every kept order change (a list filters its own scope). */
export function useFailedChanges(): FailedChange[] {
  useSyncExternalStore((f) => { failedListeners.add(f); return () => { failedListeners.delete(f); }; }, () => failedVersion, () => 0);
  return [...failedChanges.values()];
}
/**
 * Send a kept order change again, to its own workspace and season, as its own account, with its own op id. The
 * list is checked first: taken already (its op id), it goes with nothing sent; a conflict (picklistConflict.ts) is
 * kept for the member to decide (force: they did, so it goes over what changed since; a move whose team is gone
 * never goes). Taken: gone (the list updates). Refused: kept, with what the list says now. Answer lost: checked.
 */
export async function retryFailedChange(id: number, opts: { force?: boolean } = {}): Promise<void> {
  const f = failedChanges.get(id);
  if (!f || f.busy) return;
  if (signedInAccount !== undefined && f.account !== signedInAccount) { updateFailed(id, { blocked: "account", message: BLOCKED_MESSAGE.account }); return; }
  updateFailed(id, { busy: true });
  const offlineBefore = knownOffline();
  const settle = (message: string | null, more: Partial<FailedChange> = {}, saved = false) => {
    if (message == null) {
      if (failedChanges.delete(id)) failedChanged();
      forget(f.account, f.space, f.season, f.opId);
    }
    // An open list of that workspace and season shows its moment of Saved.
    if (saved) window.dispatchEvent(new CustomEvent(PICKLIST_CHANGE_SAVED, { detail: { space: f.space, season: f.season } }));
    // Discarded while its Retry was on its way: it stays discarded (updateFailed does nothing).
    if (message != null) updateFailed(id, { busy: false, message, uncertain: false, conflict: undefined, blocked: undefined, ...more });
  };
  const blockedBy = (err: ApiError) => {
    const b = STATUS_BLOCK[err.status] ?? (err.status === 409 && err.message === WRONG_ACCOUNT ? "account" : undefined);
    if (b) settle(BLOCKED_MESSAGE[b], { blocked: b });
    return !!b;
  };
  let op = f.op;
  // What the list is now, and whether this change already went (an earlier send whose answer was lost, or another tab).
  const check = await checkList(f.space, f.season, f.opId ? [f.opId] : []);
  if ("error" in check) {
    if (!blockedBy(check.error)) settle(`Not saved: ${check.error.message}`);
    return;
  }
  if (f.opId && check.applied.has(f.opId)) { settle(null, {}, true); return; }
  if (check.list && f.base) {
    const c = conflictOf(f.op, f.base, check.list.picks.map((p) => p.team), ownTeams(f));
    if (c && (c.kind === "gone" || !opts.force)) { settle(f.message, { conflict: c }); return; }
    if (c?.kind === "anchor") op = c.rebased;
  }
  try {
    const r = await inLine(f.space, () => apiFetch<{ list: unknown }>(url(f.space), {
      method: "POST", json: { season: f.season, ...op, ...(f.opId ? { opId: f.opId } : {}), ...(f.account != null ? { account: f.account } : {}) },
    }));
    if (isPickList(r.list)) announcePicklist(r.list);
    settle(null, {}, true);
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, "Couldn't save the change.");
    if (blockedBy(err)) return;
    if (err.status === 409) {
      // Refused (a team it names went meanwhile, or the list is full): kept, with what the list says now.
      const again = await checkList(f.space, f.season, []);
      const c = !("error" in again) && again.list && f.base ? conflictOf(f.op, f.base, again.list.picks.map((p) => p.team), ownTeams(f)) : null;
      settle(err.message, c ? { conflict: c } : {});
      return;
    }
    if (outcomeUnknown(e, offlineBefore)) {
      const again = await checkList(f.space, f.season, f.opId ? [f.opId] : []);
      if (!("error" in again) && (f.opId ? again.applied.has(f.opId) : !!again.list && changeLanded(again.list.picks, f.op))) { settle(null, {}, true); return; }
      settle(CHANGE_UNCONFIRMED, { uncertain: true });
      return;
    }
    settle(`Not saved: ${err.message}`);
  }
}

/**
 * Send every kept change of one list again, oldest first, one at a time. A conflict stops the rest (the member
 * decides first) unless `force`; a move whose team is gone is skipped (it stays, to discard).
 */
export async function retryKeptChanges(account: number | null, space: string, season: number, opts: { force?: boolean } = {}): Promise<void> {
  const scope = () => [...failedChanges.values()].filter((f) => f.account === account && f.space === space && f.season === season)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.id - b.id);
  const tried = new Set<number>();
  for (;;) {
    const next = scope().find((f) => !tried.has(f.id) && !f.busy && f.conflict?.kind !== "gone");
    if (!next) return;
    tried.add(next.id);
    await retryFailedChange(next.id, opts);
    const after = failedChanges.get(next.id);
    if (after && (after.blocked || (after.conflict && after.conflict.kind !== "gone" && !opts.force))) return;
  }
}
/** Let go of every kept change of one list. */
export function discardKeptChanges(account: number | null, space: string, season: number) {
  for (const f of [...failedChanges.values()]) if (f.account === account && f.space === space && f.season === season && !f.busy) discardFailedChange(f.id);
}

// Order changes this page is sending (made here, not answered yet): what this device keeps of them isn't a kept change to offer.
const pageOps = new Set<string>();
const restoredFor = new Set<number>();

/**
 * Bring back this account's kept changes from before this page (a reload, a closed tab), once per page. Each is
 * checked with the server first: one it already took (its op id) simply goes; the rest wait for the member.
 * Another account's are never read.
 */
export async function loadKeptOrderChanges(account: number | null | undefined): Promise<void> {
  if (account == null || restoredFor.has(account)) return;
  restoredFor.add(account);
  await syncKept(account, true);
}

/** Add kept changes this page doesn't hold yet (reconcile: check them with the server first); drop ones another tab let go of. */
async function syncKept(account: number, reconcile: boolean): Promise<void> {
  const recs = await keptOps(account);
  const have = new Set(recs.map((r) => r.opId));
  let dirty = false;
  // Confirmed or discarded in another tab: gone here too.
  for (const f of [...failedChanges.values()]) {
    if (f.account === account && f.stored && f.opId && !f.busy && !have.has(f.opId)) { failedChanges.delete(f.id); dirty = true; }
  }
  const known = () => new Set([...failedChanges.values()].map((f) => f.opId).filter(Boolean));
  // This page's own changes on their way are its own; another open tab's on their way are left to it until they settle.
  const fresh = recs.filter((r) => !known().has(r.opId) && !pageOps.has(r.opId) && !(r.state === "sending" && r.tab === TAB_ID) && (reconcile || r.state === "kept"));
  const add = (r: KeptPickOp, more: Partial<FailedChange> = {}) => {
    if (known().has(r.opId) || pageOps.has(r.opId)) return;
    const id = ++failedSeq;
    failedChanges.set(id, {
      id, op: r.op, space: r.space, season: r.season, account: r.account, opId: r.opId, base: r.base, baseVersion: r.baseVersion, at: r.at,
      message: r.state === "kept" && r.message ? r.message : NOT_SENT_BEFORE_RELOAD, uncertain: !!r.uncertain, stored: true, restored: true, ...more,
    });
    dirty = true;
  };
  if (reconcile) {
    const groups = new Map<string, KeptPickOp[]>();
    for (const r of fresh) { const k = `${r.space}\n${r.season}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
    for (const rs of groups.values()) {
      for (let i = 0; i < rs.length; i += MAX_OP_QUERY) {
        const chunk = rs.slice(i, i + MAX_OP_QUERY);
        const check = await checkList(chunk[0].space, chunk[0].season, chunk.map((r) => r.opId));
        if ("error" in check) {
          const b = STATUS_BLOCK[check.error.status];
          const still = new Set((await keptOps(account)).map((x) => x.opId));
          chunk.filter((r) => still.has(r.opId)).forEach((r) => add(r, b ? { blocked: b, message: BLOCKED_MESSAGE[b] } : {}));
          continue;
        }
        // Still kept after the check? (Another tab may have confirmed or discarded one meanwhile: it stays gone.)
        const still = new Set((await keptOps(account)).map((x) => x.opId));
        for (const r of chunk) {
          if (check.applied.has(r.opId)) void persist(r.opId, () => deleteKeptOp(account, r.space, r.season, r.opId));
          else if (still.has(r.opId)) add(r);
        }
      }
    }
  } else fresh.forEach((r) => add(r));
  if (dirty) failedChanged();
}
// Another tab kept, confirmed or discarded a change: catch up (no server check: that tab did it).
if (typeof window !== "undefined") {
  window.addEventListener(KEPT_OPS_CHANGED, (ev) => {
    const a = (ev as CustomEvent<{ account?: number }>).detail?.account;
    if (typeof a === "number" && restoredFor.has(a)) void syncKept(a, false);
  });
}
/** Tests: forget every kept order change this page holds (what the device keeps stays: as after a reload). */
export function resetFailedChanges() { failedChanges.clear(); pageOps.clear(); restoredFor.clear(); signedInAccount = undefined; newPageForTests(); failedChanged(); }

/** Note writes on their way, by draft id (any page of this tab): the recoverable view doesn't offer them as waiting. */
const inflight = new Set<string>();
export const noteInFlight = (wid: string | undefined) => !!wid && inflight.has(wid);

/** Has this change already taken effect in `picks` (so an unconfirmed send of it went through)? */
export function changeLanded(picks: readonly Pick[], op: PickOp): boolean {
  if (op.op === "note") return picks.find((p) => p.team === op.team)?.note === op.note;
  const r = applyPickOp(picks, op, { accountId: null, name: "" }, 0);
  return r.ok && !r.changed;
}

/** What a change is, for a person (the recoverable view). */
export function describeChange(op: PickOp): string {
  switch (op.op) {
    case "add": return op.restore ? `Put ${op.team} back on the pick list` : `Add ${op.team} to the pick list`;
    case "remove": return `Remove ${op.team} from the pick list`;
    case "move": return `Move ${op.team} in the pick list`;
    case "import": return `Copy ${op.teams.length} team${op.teams.length === 1 ? "" : "s"} into the pick list`;
    case "note": return `Note on ${op.team}`;
  }
}

export const NOTE_UNCONFIRMED = "Couldn't confirm your note was saved: the connection dropped before the workspace answered. Retry checks the note again and never replaces a newer one.";
const CHANGE_UNCONFIRMED = "Couldn't confirm this change: the connection dropped before the workspace answered, and the list doesn't show it.";

/**
 * Send a note this account kept on the device for a list that isn't open (the recoverable view's Retry). Sent
 * with its base, so a teammate's newer note is never replaced: the server refuses it (409) and it stays kept.
 */
export async function sendKeptNote(account: number, space: string, season: number, d: NoteDraft): Promise<"saved" | "conflict" | "gone" | "failed"> {
  const offlineBefore = knownOffline();
  const done = (l: unknown) => { if (readNoteDraft(account, space, season, d.team)?.at === d.at) clearNoteDraft(account, space, season, d.team); if (isPickList(l)) announcePicklist(l); };
  try {
    const r = await apiFetch<{ list: unknown }>(url(space), { method: "POST", json: { season, op: "note", team: d.team, note: cleanNote(d.note), base: d.base } });
    done(r.list);
    return "saved";
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      if (e.message === NOTE_CHANGED) return "conflict";
      done(null); // its team was removed: nothing to keep it for
      return "gone";
    }
    if (outcomeUnknown(e, offlineBefore)) {
      const r = await apiFetch<{ list: unknown }>(url(space, season)).catch(() => null);
      if (r && isPickList(r.list) && changeLanded(r.list.picks, { op: "note", team: d.team, note: cleanNote(d.note) })) { done(r.list); return "saved"; }
    }
    return "failed";
  }
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
  // Order changes that didn't go through (not refused): kept (for this page, not this list) to retry or let go.
  const failed = useFailedChanges();
  // When a note (by noteKey) or the order ("order:" + space:season) was last confirmed: "Saved" shows for a moment.
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
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
  // Every draft id this page wrote: an older one of its own can be removed when a newer note supersedes it.
  const pageWids = useRef(new Set<string>());
  // This page's own confirmed notes, per team (same keys): the base each was written over → the note time it
  // made. A later edit begun before that answer came is written over this page's own note, not a teammate's,
  // so its base moves along this chain (a teammate's note in between still stops it).
  const rebased = useRef(new Map<string, Map<number | null, number>>());
  const key = space ? `${space}:${season}` : null;
  const keyRef = useRef(key);
  keyRef.current = key;
  const queue = useRef<Pending[]>([]);
  // This list's place in its workspace's write line (shared with Retries of kept changes).
  const lineOwner = useRef(0);
  if (!lineOwner.current) lineOwner.current = newLineOwner();
  const busy = useRef(false);
  const nextId = useRef(1);
  const refused = useRef(onRefused);
  refused.current = onRefused;

  const accept = useCallback((l: PickList) => {
    if (`${l.workspaceId}:${l.season}` !== keyRef.current) return;
    setServer((cur) => newer(cur, l));
  }, []);

  const markSaved = useCallback((k: string) => {
    setSavedAt((s) => ({ ...s, [k]: Date.now() }));
    setTimeout(() => setSavedAt((s) => { if (!(k in s) || Date.now() - s[k] < SAVED_SHOW_MS) return s; const { [k]: _gone, ...rest } = s; return rest; }), SAVED_SHOW_MS + 50);
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

  /** A note confirmed (`list`: the server's list with it): its draft goes, and later edits rebase onto it. */
  const noteConfirmed = useCallback((p: Pending, sent: Extract<PickOp, { op: "note" }>, list: unknown) => {
    const team = sent.team, key = noteKey(p.account, p.space, p.season, team);
    const now = isPickList(list) ? list.picks.find((x) => x.team === team) : undefined;
    if (now && sent.base !== undefined && now.noteUpdatedAt != null && now.noteUpdatedAt !== sent.base) {
      const chain = rebased.current.get(key) ?? new Map<number | null, number>();
      chain.set(sent.base, now.noteUpdatedAt);
      rebased.current.set(key, chain);
    }
    if (p.account != null) {
      // Only the draft this write made: a newer one (this page's, or another tab's) is still to be confirmed.
      const d = readNoteDraft(p.account, p.space, p.season, team);
      if (d && d.wid === p.wid) clearNoteDraft(p.account, p.space, p.season, team);
      else if (d && d.wid === latestWid.current.get(key)) {
        // A newer note of this page's is still on its way: it's now written over this one, as the server has it.
        if (now) saveNoteDraft(p.account, p.space, p.season, { ...d, base: now.noteUpdatedAt ?? null });
      }
    }
    if (latestNote.current.get(key) === p.id) markSaved(key);
  }, [markSaved]);

  /** Send queued changes one at a time, in order. */
  const drain = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length) {
        const p = queue.current[0];
        const k = `${p.space}:${p.season}`;
        let op = p.op;
        // A note written over this page's own earlier note, confirmed since: over the note that one made.
        if (op.op === "note" && op.base !== undefined) {
          const chain = rebased.current.get(noteKey(p.account, p.space, p.season, op.team));
          let b = op.base;
          for (let i = 0; chain?.has(b) && i < 100; i++) b = chain.get(b)!;
          if (b !== op.base) op = { ...op, base: b };
        }
        const offlineBefore = knownOffline();
        if (p.wid) inflight.add(p.wid);
        try {
          const ids = p.opId ? { opId: p.opId, ...(p.account != null ? { account: p.account } : {}) } : {};
          const r = await inLine(p.space, () => apiFetch<{ list: unknown }>(url(p.space), { method: "POST", json: { season: p.season, ...op, ...ids } }), lineOwner.current);
          if (isPickList(r.list)) accept(r.list);
          if (op.op === "note") noteConfirmed(p, op, r.list);
          else { forget(p.account, p.space, p.season, p.opId); if (keyRef.current === k) markSaved(`order:${k}`); }
        } catch (e) {
          // Refused (409: a team it names is gone, or the list is full) or not sent: say so, show the server's list.
          const err = e instanceof ApiError ? e : new ApiError(0, "Couldn't save the change.");
          // Sent but unanswered: what does the list say? Taken after all: saved, nothing to ask.
          let uncertain = false;
          if (err.status !== 409 && outcomeUnknown(e, offlineBefore)) {
            // An order change asks by its op id (exact); a note, by its text.
            const check = await checkList(p.space, p.season, p.opId ? [p.opId] : []);
            const l = "error" in check ? null : check.list;
            if (l) accept(l);
            if (!("error" in check) && (p.opId ? check.applied.has(p.opId) : !!l && changeLanded(l.picks, op))) {
              if (op.op === "note") noteConfirmed(p, op, l);
              else { forget(p.account, p.space, p.season, p.opId); if (keyRef.current === k) markSaved(`order:${k}`); }
              finish(p);
              continue;
            }
            uncertain = true;
          }
          if (op.op === "note") {
            const note = op.note, team = op.team, key = noteKey(p.account, p.space, p.season, team);
            // A note sent with its base and refused because the note changed: a teammate's newer note is there. Kept,
            // not sent. (Any other 409, e.g. its team was removed, drops it like a note sent without a base.)
            const conflict = err.status === 409 && op.base !== undefined && err.message === NOTE_CHANGED;
            if (latestNote.current.get(key) === p.id) {
              // Its text stays (the field shows it unsaved, and its draft is kept), unless its team is gone (409).
              const base = op.base;
              const kept = p.kept !== false;
              if (err.status !== 409 || conflict) setUnsaved((u) => ({ ...u, [key]: { note, conflict, kept, uncertain, ...(!conflict && base !== undefined ? { base } : {}) } }));
              else if (p.account != null && readNoteDraft(p.account, p.space, p.season, team)?.wid === p.wid) clearNoteDraft(p.account, p.space, p.season, team);
            }
            // A conflict says so in the field itself: no notice on top of it.
            if (keyRef.current === k && !conflict && !uncertain) refused.current(err.status === 409 ? err.message : `Not saved: ${err.message}`);
          } else if (err.status === 409 && err.message !== WRONG_ACCOUNT) {
            // Refused (a team it names was removed meanwhile, or the list is full): said at once, and let go.
            forget(p.account, p.space, p.season, p.opId);
            if (keyRef.current === k) refused.current(err.message);
          } else {
            // Not refused: kept for the member (the pick list's notice, the recoverable view), never dropped without a word.
            const blocked = STATUS_BLOCK[err.status] ?? (err.status === 409 ? "account" : undefined);
            const message = blocked ? BLOCKED_MESSAGE[blocked] : uncertain ? CHANGE_UNCONFIRMED : `Not saved: ${err.message}`;
            keepFailed({ op, space: p.space, season: p.season, account: p.account, message, uncertain, opId: p.opId, base: p.base, baseVersion: p.baseVersion, at: p.at,
              ...(blocked ? { blocked } : {}) });
            if (keyRef.current === k && !uncertain) refused.current(`Not saved: ${err.message}`);
          }
          if (keyRef.current === k) void refetch.current();
        }
        finish(p);
      }
    } finally { busy.current = false; }

    function finish(p: Pending) {
      if (p.wid) inflight.delete(p.wid);
      if (p.opId) pageOps.delete(p.opId);
      if (p.op.op === "note") { const key = noteKey(p.account, p.space, p.season, p.op.team); if (latestNote.current.get(key) === p.id) latestNote.current.delete(key); }
      trackMemoryOnly(p, false);
      if (queue.current[0] === p) queue.current.shift();
      setPending((cur) => cur.filter((x) => x.id !== p.id));
    }
  }, [accept, markSaved, noteConfirmed]);

  const change = useCallback((op: PickOp, opts: { editBase?: number | null } = {}) => {
    if (!space) return;
    const acct = accountRef.current;
    let wid: string | undefined;
    let stored = false;
    if (op.op === "note") {
      // As the server will store it, so the draft (and what's shown meanwhile) compares equal to its answer.
      op = { ...op, note: cleanNote(op.note) };
      const key = noteKey(acct, space, season, op.team);
      const team = op.team;
      const shown = serverRef.current?.picks.find((x) => x.team === team);
      // Every note goes up with the note it was written over (its base), so the server never lets it replace a
      // teammate's newer note this member hadn't seen (E4). A retry (or Escape) of a kept note over a teammate's
      // newer one: written over the note shown now (the member chose). One that failed to send: with the base it
      // was sent with. A fresh edit: the note as it was when the edit began, else the one shown now.
      const kept = unsavedRef.current[key];
      if (op.base === undefined && kept?.conflict) op = { ...op, base: shown?.noteUpdatedAt ?? null };
      else if (op.base === undefined && kept?.base !== undefined) op = { ...op, base: kept.base };
      else if (op.base === undefined) op = { ...op, base: opts.editBase !== undefined ? opts.editBase : shown?.noteUpdatedAt ?? null };
      // Kept on the device until the server confirms it, with the note it's written over.
      wid = newWid();
      latestWid.current.set(key, wid);
      pageWids.current.add(wid);
      stored = acct != null && saveNoteDraft(acct, space, season, { team, note: op.note, base: op.base ?? null, at: Date.now(), wid });
      // Couldn't store this one: an older draft of this page's for the team is superseded (it would come back
      // after a reload over this newer note), so it goes. Another tab's is left alone.
      if (acct != null && !stored) {
        const old = readNoteDraft(acct, space, season, team);
        if (old?.wid && pageWids.current.has(old.wid)) clearNoteDraft(acct, space, season, team);
      }
    }
    const p: Pending = { id: nextId.current++, op, space, season, account: acct, wid, kept: stored };
    // A new write of a note replaces one that failed (a retry, or putting the saved one back).
    if (op.op === "note") { const key = noteKey(acct, space, season, op.team); latestNote.current.set(key, p.id); setUnsaved((u) => { if (!(key in u)) return u; const { [key]: _gone, ...rest } = u; return rest; }); }
    else {
      // An order change: its op id, and the order the member is looking at (the server's, with their changes on their way).
      const srv = serverRef.current;
      const ahead = queue.current.filter((q) => q.space === space && q.season === season).map((q) => q.op);
      Object.assign(p, { opId: newOpId(), at: Date.now(), baseVersion: srv?.version ?? 0, base: srv ? withPending(srv, ahead, { accountId: acct, name: "" }).picks.map((x) => x.team) : [] });
      pageOps.add(p.opId!);
      const opId = p.opId!;
      // Kept on the device until the workspace confirms it: a reload before then doesn't lose it.
      if (acct != null) {
        const orderOp = op;
        void persist(opId, () => putKeptOp(recordOf({ op: orderOp, space, season, account: acct, opId, message: "", uncertain: false, base: p.base, baseVersion: p.baseVersion, at: p.at }, "sending")))
          .then((ok) => { if (ok && pageOps.has(opId)) trackMemoryOnly(p, false); });
      }
    }
    queue.current.push(p);
    trackMemoryOnly(p, op.op !== "note" || !stored);
    setPending((cur) => [...cur, p]);
    void drain();
  }, [space, season, drain]);

  const discardNote = useCallback((team: number) => {
    if (!space) return;
    const acct = accountRef.current;
    const key = noteKey(acct, space, season, team);
    setUnsaved((u) => { if (!(key in u)) return u; const { [key]: _gone, ...rest } = u; return rest; });
    if (acct != null) clearNoteDraft(acct, space, season, team);
  }, [space, season]);
  const retryFailed = useCallback((id: number, opts?: { force?: boolean }) => { void retryFailedChange(id, opts); }, []);
  const discardFailed = useCallback((id: number) => discardFailedChange(id), []);
  const retryAll = useCallback((opts?: { force?: boolean }) => { if (space) void retryKeptChanges(accountRef.current, space, season, opts); }, [space, season]);
  const discardAll = useCallback(() => { if (space) discardKeptChanges(accountRef.current, space, season); }, [space, season]);

  // Order changes this account kept on the device from before this page (a reload): back, checked with the server first.
  // Only the signed-in account's are read, and only it can send them.
  useEffect(() => {
    setPicklistAccount(account);
    void loadKeptOrderChanges(account);
  }, [account]);

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
      if (latestNote.current.has(key) || noteInFlight(d.wid)) continue; // on its way already
      const now = server.picks.find((x) => x.team === d.team);
      const note = cleanNote(d.note);
      if (!now || now.note === note) { clearNoteDraft(account, space, season, d.team); continue; }
      if ((now.noteUpdatedAt ?? null) === d.base) change({ op: "note", team: d.team, note, base: d.base });
      else setUnsaved((u) => ({ ...u, [key]: { note, conflict: true } }));
    }
  }, [server, space, season, account, change, readOnly]);

  // Gone (a reload, or the list closed): its writes no longer count as on their way. One still answering is
  // safe to send again (it carries its base), and a reload starts with none anyway.
  useEffect(() => () => { for (const w of pageWids.current) inflight.delete(w); leaveLine(lineOwner.current); }, []);

  // A kept order change of this list's went through on Retry: Saved, for a moment.
  useEffect(() => {
    if (!space) return;
    const on = (ev: Event) => { const d = (ev as CustomEvent<{ space: string; season: number }>).detail; if (d?.space === space && d.season === season) markSaved(`order:${space}:${season}`); };
    window.addEventListener(PICKLIST_CHANGE_SAVED, on);
    return () => window.removeEventListener(PICKLIST_CHANGE_SAVED, on);
  }, [space, season, markSaved]);

  // The list open on this page handles its own kept notes: the recoverable view leaves them to it. Not a
  // read-only one: it neither sends nor shows them, so the view keeps listing them (to discard).
  useEffect(() => {
    if (!space || account == null || readOnly) return;
    return claimScope(`${account}:${space}:${season}`);
  }, [space, season, account, readOnly]);

  const mine = useMemo(() => pending.filter((p) => p.space === space && p.season === season).map((p) => p.op), [pending, space, season]);
  const list = useMemo(() => (server ? withPending(server, mine, me) : null), [server, mine, me]);
  const scopeFailed = useMemo(() => failed.filter((f) => f.space === space && f.season === season && f.account === account), [failed, space, season, account]);
  const recent = (k: string) => savedAt[k] !== undefined && Date.now() - savedAt[k] < SAVED_SHOW_MS;
  const noteState = (team: number): SaveState | null => {
    if (!space) return null;
    const k = noteKey(account, space, season, team);
    if (unsaved[k]) return "attention";
    if (mine.some((o) => o.op === "note" && o.team === team)) return "saving";
    return recent(k) ? "saved" : null;
  };
  const orderState: SaveState | null = !space ? null : scopeFailed.some((f) => !f.busy) ? "attention" : mine.some((o) => o.op !== "note") || scopeFailed.length ? "saving" : recent(`order:${space}:${season}`) ? "saved" : null;

  // What needs the member, for the recoverable view (this account's only; nothing while read-only).
  useEffect(() => {
    const source = `picklist:${space ?? ""}:${season}`;
    if (!space || account == null || readOnly) { publishPending(source, []); return; }
    const items: PendingItem[] = [];
    const prefix = `${account}:${space}:${season}:`;
    for (const [k, u] of Object.entries(unsaved)) {
      if (!k.startsWith(prefix)) continue;
      const team = Number(k.slice(prefix.length));
      items.push({
        key: `note:${k}`, account, kind: "note", workspaceId: space, season, team, label: `Note on ${team}`, status: "attention",
        message: u.conflict ? "A teammate changed this note after you wrote yours. Retry replaces theirs with yours."
          : u.uncertain ? NOTE_UNCONFIRMED : u.kept === false ? "Not saved yet, and this device couldn't keep a copy." : "Not saved yet. Your text is kept on this device.",
        retry: () => change({ op: "note", team, note: u.note }),
        discard: () => discardNote(team), discardLabel: u.conflict ? "Keep theirs" : "Discard",
        text: u.note, ...(u.base !== undefined ? { base: u.base } : {}),
        ...(u.kept === false ? { volatile: true } : {}),
      });
    }
    publishPending(source, items);
  }, [unsaved, space, season, account, readOnly, change, discardNote]);
  useEffect(() => () => publishPending(`picklist:${space ?? ""}:${season}`, []), [space, season]);

  return { list, loading: !server && (loading || !error), error: server ? null : error, saving: mine.length > 0, change, discardNote, retryFailed, discardFailed, retryAll, discardAll,
    failed: scopeFailed, noteState, orderState,
    unsavedNote: (team: number) => (space ? unsaved[noteKey(account, space, season, team)]?.note : undefined),
    noteConflict: (team: number) => (space ? !!unsaved[noteKey(account, space, season, team)]?.conflict : false),
    noteKept: (team: number) => (space ? unsaved[noteKey(account, space, season, team)]?.kept !== false : true),
    noteUncertain: (team: number) => (space ? !!unsaved[noteKey(account, space, season, team)]?.uncertain : false),
    savedNote: (team: number) => server?.picks.find((p) => p.team === team)?.note,
    savedNoteAt: (team: number) => server?.picks.find((p) => p.team === team)?.noteUpdatedAt ?? null,
    reload: () => { void fetchList(); } };
}
