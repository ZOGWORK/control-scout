// Shared work that hasn't reached the workspace yet (audit E4): one state model for pick list notes and
// order changes, comments and shared scout entries.
//
// Each piece of shared work is in one of four states:
// - draft: typed here, not sent yet (a note in its save pause, a comment in the composer);
// - saving: sent, waiting for the workspace's answer;
// - saved: the workspace confirmed it;
// - attention: the member has something to decide (it wasn't sent, a teammate changed the same note, or the
//   device couldn't tell whether it arrived and checking didn't settle it).
// A request whose answer was lost is never called failed outright: the device checks what the workspace has
// first (reconciles), and only asks when it still can't tell.
//
// Work that needs the member (attention), or that is waiting on this device for a connection, is published
// here by whoever holds it (the pick list, the comment attempts, the entry queue). The recoverable-changes view
// (RecoverableChanges.tsx) lists it, per account: an item names the account it belongs to, and the view only
// ever shows the signed-in one's.
import { useSyncExternalStore } from "react";
import { ApiError } from "./api";

export type SaveState = "draft" | "saving" | "saved" | "attention";

/** How long "Saved" stays up after the workspace confirms a change (then the calm, empty state). */
export const SAVED_SHOW_MS = 3000;

export interface PendingItem {
  /** Unique across sources (the kind, the account, the workspace, the season and what it's about). */
  key: string;
  /** The account it belongs to: never shown to another one. */
  account: number;
  kind: "note" | "order" | "comment" | "entry";
  workspaceId: string;
  season: number | null;
  team: number | null;
  /** What it is, for a person: "Note on 16236", "Comment on 16236 · Match Q12". */
  label: string;
  /** waiting: kept on this device, goes up by itself; attention: the member decides. */
  status: "waiting" | "attention";
  /** What happened, in a sentence. */
  message: string;
  retry?: () => void;
  discard?: () => void;
  /** What Discard does, for its label ("Keep theirs" reads better than "Discard" over a teammate's note). */
  discardLabel?: string;
}

const sources = new Map<string, PendingItem[]>();
const listeners = new Set<() => void>();
let snapshot: PendingItem[] = [];
let version = 0;
const notify = () => { version++; listeners.forEach((f) => f()); };

const sameItems = (a: PendingItem[] | undefined, b: PendingItem[]) => !!a && a.length === b.length
  && a.every((x, i) => x.key === b[i].key && x.status === b[i].status && x.message === b[i].message && x.label === b[i].label
    && x.retry === b[i].retry && x.discard === b[i].discard && x.discardLabel === b[i].discardLabel);

/** Replace what one source holds (an empty list removes it). */
export function publishPending(source: string, items: PendingItem[]): void {
  if (!items.length ? !sources.has(source) : sameItems(sources.get(source), items)) return;
  if (items.length) sources.set(source, items); else sources.delete(source);
  snapshot = [...sources.values()].flat();
  notify();
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** Everything published, for every account (tests; the view filters by account with usePendingWork). */
export const allPending = () => snapshot;

/** The signed-in account's pending shared work (null: signed out, nothing). */
export function usePendingWork(account: number | null | undefined): PendingItem[] {
  const all = useSyncExternalStore(subscribe, allPending, allPending);
  return account == null ? NONE : all.filter((x) => x.account === account);
}
const NONE: PendingItem[] = [];

// Pick list scopes (account:workspace:season) whose list is open on this page: its own hook handles their kept
// notes (sends them, or marks them for the member), so the view doesn't offer them twice.
const claimed = new Map<string, number>();
export function claimScope(scope: string): () => void {
  claimed.set(scope, (claimed.get(scope) ?? 0) + 1);
  notify();
  return () => {
    const n = (claimed.get(scope) ?? 1) - 1;
    if (n > 0) claimed.set(scope, n); else claimed.delete(scope);
    notify();
  };
}
export const isClaimed = (scope: string) => claimed.has(scope);
/** Re-renders when the claimed scopes (or anything else here) change. */
export function usePendingVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

/**
 * Did a write fail in a way that leaves its outcome unknown? No answer (sent while the device was online), a
 * proxy's or server's 5xx other than 503 (paused), a 2xx whose body was cut off, or a body that couldn't be
 * read: the workspace may have taken it. Known offline before sending is definite (nothing went).
 */
export function outcomeUnknown(e: unknown, offlineBefore: boolean): boolean {
  if (offlineBefore) return false;
  if (!(e instanceof ApiError)) return true;
  return e.status === 0 || (e.status >= 200 && e.status < 300) || (e.status >= 500 && e.status !== 503);
}

/** Is the device known to be offline right now? */
export const knownOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
