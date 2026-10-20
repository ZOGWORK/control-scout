// Comment posts the workspace hasn't confirmed yet (audit E4), per account, workspace and entry.
//
// A comment goes up as an attempt with an operation id (scoutComments.ts): its retries reuse the id, so the
// server never posts it twice. The attempt is kept here, and on the device, from the moment it's sent until the
// workspace confirms it, so a closed entry or a reload doesn't lose it or forget whether it went:
// - saving: on its way (or being checked: the thread is read for its id);
// - attention: it didn't go, or its outcome is still unknown. The composer shows why, with Retry and Discard,
//   and so does the recoverable-changes view (src/lib/pendingWork.ts) once the entry is closed.
// After a reload a kept attempt is checked against the thread first (reconciled): posted after all, it's simply
// gone; not there, it waits for the member. Another account's attempts are never read: the key names the account.
import { useSyncExternalStore } from "react";
import { apiFetch } from "./api";
import { CommentWriteError, COMMENT_NOT_ARRIVED, COMMENT_UNCONFIRMED, postComment, SCOUT_COMMENT, SCOUT_COMMENTS_RESYNC } from "./scoutComments";
import { noteUnstoredSending, publishPending, type PendingItem } from "./pendingWork";
import { isCommentEvent, isEntryComment } from "../shared/comments";

/** Where a comment belongs, and what to call it ("Comment on 16236 · Match Q12"). */
export interface CommentPlace { account: number; space: string; uuid: string; season?: number; team?: number; what?: string }

export interface CommentAttempt extends CommentPlace {
  body: string;
  opId: string;
  at: number;
  state: "saving" | "attention";
  /** What the member is told (attention). */
  message: string;
  /** It may have been posted: Retry checks, and the same id never posts twice. */
  uncertain: boolean;
}

const PREFIX = "cs-comment-try:";
/** Kept attempts older than this are dropped unread: a comment two weeks late reads wrong. */
export const ATTEMPT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const CHECKING = "Checking whether your comment was posted…";

const keyOf = (account: number, space: string, uuid: string) => `${PREFIX}${account}:${encodeURIComponent(space)}:${uuid}`;
const attempts = new Map<string, CommentAttempt>();
const listeners = new Set<() => void>();
let version = 0;

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function changed() {
  version++;
  listeners.forEach((f) => f());
  publish();
}

/** Attempts this device couldn't store (full or blocked): kept in memory only, so a reload loses them. */
const unstored = new Set<string>();

function keep(a: CommentAttempt) {
  const k = keyOf(a.account, a.space, a.uuid);
  attempts.set(k, a);
  const s = storage();
  try { if (!s) throw new Error("no storage"); s.setItem(k, JSON.stringify({ body: a.body, opId: a.opId, at: a.at, season: a.season, team: a.team, what: a.what })); unstored.delete(k); }
  catch { unstored.add(k); /* full or blocked: kept in memory */ }
  changed();
}

function drop(account: number, space: string, uuid: string, opId?: string) {
  const k = keyOf(account, space, uuid);
  const a = attempts.get(k);
  if (opId && a && a.opId !== opId) return; // a newer attempt took its place
  attempts.delete(k);
  unstored.delete(k);
  try { storage()?.removeItem(k); } catch { /* blocked */ }
  changed();
}

/** This entry's attempt for this account (null: none). */
export function commentAttempt(account: number | null | undefined, space: string | null, uuid: string | null): CommentAttempt | null {
  return account == null || !space || !uuid ? null : attempts.get(keyOf(account, space, uuid)) ?? null;
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export function useCommentAttempt(account: number | null | undefined, space: string | null, uuid: string | null): CommentAttempt | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return commentAttempt(account, space, uuid);
}

/**
 * Send one attempt (the composer's Comment and Retry, the view's Retry). Kept on the device first; confirmed:
 * gone. `post` is the thread's own (it refreshes the thread when the entry or comment went meanwhile).
 */
export async function sendComment(place: CommentPlace, body: string, opId: string,
  post: (body: string, opId: string) => Promise<void> = (b, o) => postComment(place.space, place.uuid, b, o)): Promise<boolean> {
  keep({ ...place, body, opId, at: Date.now(), state: "saving", message: "", uncertain: false });
  try {
    await post(body, opId);
    heard.delete(opId);
    drop(place.account, place.space, place.uuid, opId);
    return true;
  } catch (e) {
    const uncertain = e instanceof CommentWriteError && e.uncertain;
    // Heard on the stream while it was on its way: it arrived, whatever happened to its answer.
    if (uncertain && heard.delete(opId)) { drop(place.account, place.space, place.uuid, opId); return true; }
    const cur = attempts.get(keyOf(place.account, place.space, place.uuid));
    if (cur?.opId === opId) keep({ ...cur, state: "attention", message: (e as Error).message, uncertain });
    return false;
  }
}

/** It showed up in the thread (the stream, a refetch): it was posted. */
export function commentArrived(account: number, space: string, uuid: string, opId: string) {
  const a = attempts.get(keyOf(account, space, uuid));
  if (a?.opId === opId) drop(account, space, uuid, opId);
}

/** The member lets it go: nothing more is sent (one that did arrive stays in the thread). */
export function discardComment(account: number, space: string, uuid: string) { drop(account, space, uuid); }

/** Attempts on their way whose comment was already heard on the stream (by operation id). */
const heard = new Set<string>();

/** Is it in the thread? true/false, or null when the thread can't be read. */
async function posted(space: string, uuid: string, opId: string): Promise<boolean | null> {
  try {
    const r = await apiFetch<{ comments?: unknown[] }>(`/api/scout/workspaces/${encodeURIComponent(space)}/entries/${encodeURIComponent(uuid)}/comments`);
    return (r?.comments ?? []).filter(isEntryComment).some((c) => c.opId === opId);
  } catch { return null; }
}

const loaded = new Set<number>();
/**
 * Read this account's kept attempts (once per page), then check each against its thread: posted, it goes;
 * not there, or the thread can't be read, it waits for the member (uncertain: Retry never posts twice).
 */
export function loadCommentAttempts(account: number | null | undefined, now = Date.now()): void {
  if (account == null || loaded.has(account)) return;
  loaded.add(account);
  const s = storage();
  if (!s) return;
  const prefix = `${PREFIX}${account}:`;
  const found: CommentAttempt[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(prefix)) keys.push(k); }
    for (const k of keys) {
      if (attempts.has(k)) continue;
      const m = /^([^:]+):([^:]+)$/.exec(k.slice(prefix.length));
      let raw: { body?: unknown; opId?: unknown; at?: unknown; season?: unknown; team?: unknown; what?: unknown } | null = null;
      try { raw = JSON.parse(s.getItem(k) ?? "null"); } catch { raw = null; }
      let space = "";
      try { space = m ? decodeURIComponent(m[1]) : ""; } catch { space = ""; }
      if (!m || !space || !raw || typeof raw.body !== "string" || typeof raw.opId !== "string" || typeof raw.at !== "number" || now - raw.at > ATTEMPT_MAX_AGE_MS) { s.removeItem(k); continue; }
      found.push({
        account, space, uuid: m[2], body: raw.body, opId: raw.opId, at: raw.at, state: "saving", message: CHECKING, uncertain: true,
        ...(typeof raw.season === "number" ? { season: raw.season } : {}), ...(typeof raw.team === "number" ? { team: raw.team } : {}), ...(typeof raw.what === "string" ? { what: raw.what } : {}),
      });
    }
  } catch { /* blocked */ }
  for (const a of found) attempts.set(keyOf(a.account, a.space, a.uuid), a);
  if (found.length) changed();
  for (const a of found) {
    void posted(a.space, a.uuid, a.opId).then((there) => {
      const cur = attempts.get(keyOf(a.account, a.space, a.uuid));
      if (cur?.opId !== a.opId || cur.state !== "saving" || cur.message !== CHECKING) return; // the member acted meanwhile
      if (there) drop(a.account, a.space, a.uuid, a.opId);
      else keep({ ...cur, state: "attention", message: there === false ? COMMENT_NOT_ARRIVED : COMMENT_UNCONFIRMED, uncertain: true });
    });
  }
}

/** What needs the member, for the recoverable view: attempts not on their way. */
function publish() {
  const items: PendingItem[] = [];
  for (const a of attempts.values()) {
    if (a.state !== "attention") continue;
    const place: CommentPlace = { account: a.account, space: a.space, uuid: a.uuid, season: a.season, team: a.team, what: a.what };
    items.push({
      key: `comment:${a.account}:${a.space}:${a.uuid}`, account: a.account, kind: "comment", workspaceId: a.space, season: a.season ?? null, team: a.team ?? null,
      label: a.what ?? (a.team ? `Comment on ${a.team}` : "Comment"), status: "attention", message: a.message,
      retry: () => { void sendComment(place, a.body, a.opId); },
      discard: () => discardComment(a.account, a.space, a.uuid),
      ...(unstored.has(keyOf(a.account, a.space, a.uuid)) ? { volatile: true } : {}),
    });
  }
  publishPending("comments", items);
  // Still on its way and not stored: nothing for the member to do yet, but a reload now would lose it.
  let sending = 0;
  for (const [k, a] of attempts) if (a.state === "saving" && unstored.has(k)) sending++;
  noteUnstoredSending("comments", sending);
}

// Another tab confirmed, discarded or replaced an attempt this tab holds: follow it, so a Retry here can't post a
// comment that was let go there (or send an older attempt over a newer one).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null) { if (attempts.size) { attempts.clear(); changed(); } return; }
    if (!e.key.startsWith(PREFIX) || !attempts.has(e.key)) return;
    const cur = attempts.get(e.key)!;
    let raw: { body?: unknown; opId?: unknown; at?: unknown } | null = null;
    try { raw = e.newValue ? JSON.parse(e.newValue) : null; } catch { raw = null; }
    if (!raw || typeof raw.body !== "string" || typeof raw.opId !== "string") attempts.delete(e.key);
    else if (raw.opId !== cur.opId) attempts.set(e.key, { ...cur, body: raw.body, opId: raw.opId, at: typeof raw.at === "number" ? raw.at : cur.at, state: "attention", message: COMMENT_UNCONFIRMED, uncertain: true });
    else return;
    changed();
  });
}

/**
 * Check the kept attempts whose outcome is unknown again (the connection came back, or a workspace's threads were
 * refetched): one the thread has after all goes, without the member having to press Retry. `space`: only its own.
 */
export function recheckCommentAttempts(space?: string): void {
  for (const a of [...attempts.values()]) {
    if (a.state !== "attention" || !a.uncertain || (space && a.space !== space)) continue;
    void posted(a.space, a.uuid, a.opId).then((there) => {
      const cur = attempts.get(keyOf(a.account, a.space, a.uuid));
      if (there && cur?.opId === a.opId && cur.state === "attention") drop(a.account, a.space, a.uuid, a.opId);
    });
  }
}

if (typeof window !== "undefined") {
  // A comment heard on a workspace's stream that is a kept attempt (by its operation id and author): it arrived.
  window.addEventListener(SCOUT_COMMENT, (ev) => {
    const e = (ev as CustomEvent<unknown>).detail;
    if (!isCommentEvent(e) || e.action !== "created" || !e.comment?.opId) return;
    const k = keyOf(e.comment.authorAccountId, e.workspaceId, e.entryUuid);
    // Only one waiting on the member: one still on its way settles with its own answer (so nothing else can be
    // sent from its composer meanwhile).
    const a = attempts.get(k);
    if (a?.opId !== e.comment.opId) return;
    // Still on its way: remembered, and used when it settles (the send lock stays until then).
    if (a.state === "saving") { heard.add(a.opId); if (heard.size > 200) heard.delete(heard.values().next().value!); return; }
    if (a.state === "attention") drop(e.comment.authorAccountId, e.workspaceId, e.entryUuid, e.comment.opId);
  });
  window.addEventListener(SCOUT_COMMENTS_RESYNC, (ev) => { const s = (ev as CustomEvent<{ space?: string }>).detail?.space; if (s) recheckCommentAttempts(s); });
  window.addEventListener("online", () => recheckCommentAttempts());
}

/** Tests: forget everything held in memory (a fresh page). */
export function resetCommentAttempts() { attempts.clear(); unstored.clear(); loaded.clear(); changed(); }
