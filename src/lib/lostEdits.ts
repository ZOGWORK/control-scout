// Edits this device lost to a newer one (Task 16): the last-write-wins loser's
// own version, kept on the device so it can be compared and restored even when
// the server never stored it (an offline edit that lost before it was sent).
//
// Device-only (Tier 3, docs/settings.md): `cs-scout-lost:<workspace>`, never
// sent anywhere (a restore sends the entry, as any edit). At most MAX_LOST per
// workspace, each kept LOST_TTL_MS; dismissing the notice only marks it seen,
// so it stays restorable from the entry's History until it ages out, is
// restored, or the person keeps the current version.
//
// Which merges count as a loss is decided in scouting.ts (lostTo).
import { useCallback, useEffect, useState } from "react";
import type { ScoutEntry, ScoutValue } from "./scouting";

export interface LostEdit {
  /** `${uuid}:${mine.updatedAt}`: one record per lost version, however many syncs see it. */
  id: string;
  space: string;
  uuid: string;
  /** The version this device had (and lost). */
  mine: {
    season: number; team: number; eventCode: string | null; matchLabel: string | null; kind: "match" | "pit";
    data: Record<string, ScoutValue>; notes: string; updatedAt: number; templateId?: string; templateVersion?: number;
  };
  /** Who wrote the version that replaced it, and its updatedAt. */
  by: { accountId: number; name: string };
  theirsUpdatedAt: number;
  /** When this device noticed. */
  lostAt: number;
  /** The notice was shown and dismissed (or its diff opened): it isn't shown again. */
  seen: boolean;
}

export const LOST_PREFIX = "cs-scout-lost:";
export const MAX_LOST = 30;
export const LOST_TTL_MS = 30 * 24 * 3600_000;
/** Window event: a local edit was overwritten (detail: LostEdit), or the store changed (no detail). */
export const SCOUT_OVERWRITTEN = "cs-scout-overwritten";

const key = (space: string) => `${LOST_PREFIX}${space}`;

const isLost = (x: unknown): x is LostEdit => {
  const l = x as LostEdit;
  return !!l && typeof l.id === "string" && typeof l.uuid === "string" && !!l.mine && typeof l.mine === "object" && !!l.by && Number.isFinite(l.lostAt);
};

/** This workspace's lost edits on the device, newest first (expired ones left out). */
export function lostEdits(space: string, now = Date.now()): LostEdit[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(space)) ?? "[]");
    return (Array.isArray(raw) ? raw.filter(isLost) : []).filter((l) => now - l.lostAt < LOST_TTL_MS).sort((a, b) => b.lostAt - a.lostAt);
  } catch { return []; }
}

/** Store the list; false when the device refused (storage full or blocked). */
function write(space: string, list: LostEdit[]): boolean {
  try {
    if (!list.length) localStorage.removeItem(key(space));
    else localStorage.setItem(key(space), JSON.stringify(list.slice(0, MAX_LOST)));
  } catch { return false; }
  window.dispatchEvent(new Event(SCOUT_OVERWRITTEN));
  return true;
}

/**
 * Keep a lost version (once: the same version lost again, seen by another sync, changes nothing).
 * Returns false only when the device couldn't store it: the caller must then keep its own copy (the
 * only one there is) rather than replace it, and try again later.
 */
export function recordLostEdit(space: string, mine: ScoutEntry, theirs: ScoutEntry, now = Date.now()): boolean {
  const id = `${mine.uuid}:${mine.updatedAt}`;
  const list = lostEdits(space, now);
  if (list.some((l) => l.id === id)) return true;
  const rec: LostEdit = {
    id, space, uuid: mine.uuid,
    mine: {
      season: mine.season, team: mine.team, eventCode: mine.eventCode, matchLabel: mine.matchLabel, kind: mine.kind,
      data: { ...mine.data }, notes: mine.notes, updatedAt: mine.updatedAt,
      ...(mine.templateId ? { templateId: mine.templateId, templateVersion: mine.templateVersion ?? 0 } : {}),
    },
    by: { accountId: theirs.editorAccountId ?? 0, name: theirs.editorDisplayName || "another member" },
    theirsUpdatedAt: theirs.updatedAt, lostAt: now, seen: false,
  };
  if (!write(space, [rec, ...list])) return false;
  window.dispatchEvent(new CustomEvent<LostEdit>(SCOUT_OVERWRITTEN, { detail: rec }));
  return true;
}

/** Window event: an overwritten edit couldn't be kept (storage full), so it was left in place, queued (detail: its space). */
export const SCOUT_LOST_UNSAVED = "cs-scout-lost-unsaved";
export const lostBackupFailed = (space: string) => { window.dispatchEvent(new CustomEvent<string>(SCOUT_LOST_UNSAVED, { detail: space })); };
export const LOST_UNSAVED_MESSAGE = "Someone else's newer edit is waiting, but this device is out of space to keep yours alongside it. Yours stays here, unsent, until there's room again.";

/** The notice was dismissed (or the version restored): don't show it again (the version stays restorable). */
export function markLostSeen(space: string, id: string) {
  const list = lostEdits(space);
  if (!list.some((l) => l.id === id && !l.seen)) return;
  write(space, list.map((l) => (l.id === id ? { ...l, seen: true } : l)));
}

/** Forget a lost version (kept the current one, or restored it). */
export function dropLostEdit(space: string, id: string) {
  const list = lostEdits(space);
  if (list.some((l) => l.id === id)) write(space, list.filter((l) => l.id !== id));
}

/** A restore of this entry reached the server: forget the version it brought back. */
export function dropRestored(space: string, uuid: string, restoredFrom: number) {
  dropLostEdit(space, `${uuid}:${restoredFrom}`);
}

/** Every workspace's lost edits on this device (an account's stash, personal.tsx). */
export function exportLostEdits(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LOST_PREFIX)) out[k] = localStorage.getItem(k)!;
    }
  } catch { /* storage blocked */ }
  return out;
}

/** The lost edits of a workspace, kept current (another tab, a sync, a dismissal). */
export function useLostEdits(space: string | null): LostEdit[] {
  const read = useCallback(() => (space == null ? [] : lostEdits(space)), [space]);
  const [list, setList] = useState<LostEdit[]>(read);
  useEffect(() => {
    const refresh = () => setList(read());
    refresh();
    window.addEventListener(SCOUT_OVERWRITTEN, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(SCOUT_OVERWRITTEN, refresh); window.removeEventListener("storage", refresh); };
  }, [read]);
  return list;
}
