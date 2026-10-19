// Manual scouting: the user's own observations on top of public data.
// Offline-first (Control Point's pattern): every entry is saved on the device
// first, queued, and synced to the account when signed in and online. A newer
// edit always wins; deletes are tombstones so they sync too.
//
// Spaces: Personal (workspaceId null: the user's own entries, stored exactly
// as before) and one shared space per Control Point workspace the account
// belongs to. Each space has its own entries, dirty queue and sync; a
// workspace's entries are pulled by the server's cursor.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import type { EntryPhoto } from "../shared/photos";
import { dropRestored, exportLostEdits, LOST_PREFIX, lostBackupFailed, mergeLostLists, recordLostEdit, SCOUT_OVERWRITTEN } from "./lostEdits";
import { READ_ONLY_STATUS } from "../shared/orphaned";

import { builtinTemplate } from "../shared/scoutDefaults";
import { DEVICE_LATEST, isEntryTimestamp, NOTES_MAX as ENTRY_NOTES_MAX, repairScoutEntry, type Repaired } from "../shared/scoutEntry";
import { toast } from "../components/ui/sonner";

export type ScoutValue = number | boolean | string;
export type { FieldType, ScoutField, ScoutTemplate } from "../shared/scoutTemplate";

/** Where an entry lives: null = Personal, else a Control Point workspace id. */
export type ScoutSpace = string | null;

export interface ScoutEntry {
  uuid: string;
  /** null = Personal (the only space before workspaces); else the Control Point workspace it's shared in. */
  workspaceId: ScoutSpace;
  season: number;
  team: number;
  eventCode: string | null;
  matchLabel: string | null;
  kind: "match" | "pit";
  data: Record<string, ScoutValue>;
  notes: string;
  updatedAt: number;
  deleted?: boolean;
  /** Shared account id of whoever created it, stamped by the server. 0 when unknown: personal entries (yours) and workspace entries not yet synced. */
  authorAccountId: number;
  /** Their name as shown to the workspace. "" when unknown (as above). */
  authorDisplayName: string;
  /** Who wrote the latest version (workspace entries, from the server). */
  editorAccountId?: number;
  editorDisplayName?: string;
  /**
   * The template it was made with (workspace entries): "ws:<workspace>:<season>:<kind>" and that
   * template's version, or a built-in id with version 0. Absent on entries made before templates
   * (and on personal entries, which always use the built-in defaults): read with the built-in.
   */
  templateId?: string;
  templateVersion?: number;
  /** Workspace entries: photos (src/lib/photos.ts), the server's list. photosRev goes up on each photo change. */
  photos?: EntryPhoto[];
  photoExpired?: boolean;
  photosRev?: number;
  /**
   * Workspace entries: the server's version this edit was based on (its updatedAt: the device's last copy from
   * the server when the edit was made). A device whose own version is replaced by one based on an older copy
   * knows the writer never saw it (lostTo). Absent: a new entry, or unknown (an older build).
   */
  baseUpdatedAt?: number;
  /** Workspace entries, until synced: this edit restores an earlier version (the one with this updatedAt). */
  restoredFrom?: number;
}

// --- Templates -------------------------------------------------------------

/** The built-in default template (src/shared/scoutDefaults.ts). */
export const templateFor = builtinTemplate;

// --- Local store -------------------------------------------------------------
// Personal: cs-scout:<uuid> + cs-scout-dirty, unchanged since before workspaces
// (entries are stored without the newer fields, so older builds read them as
// ever). Workspace w: cs-scout-ws:<w>:<uuid>, cs-scout-ws-dirty:<w> and the
// pull cursor cs-scout-ws-cursor:<w>.

const KEY = (uuid: string) => `cs-scout:${uuid}`;
const DIRTY = "cs-scout-dirty";
const WS = "cs-scout-ws:";
const WS_DIRTY = "cs-scout-ws-dirty:";
const WS_CURSOR = "cs-scout-ws-cursor:";
/** Fired on window after any change to the scout entries on this device (a save, a pull, a live entry). */
export const SCOUT_CHANGED = "cs-scout-changed";
const EVT = SCOUT_CHANGED;
/** A local save (detail: SavedDetail): open lists push it right away, so other members see it live. */
const SAVED = "cs-scout-saved";
interface SavedDetail { space: ScoutSpace; deleted: boolean }
/** How long a list waits after a save before pushing, so a burst of saves goes up together. A delete goes at once. */
export const PUSH_DEBOUNCE_MS = 300;

/**
 * A workspace refused this device outright (403 on a push or a pull: the account isn't a member any
 * more, as far as the server can tell). detail: the workspace id. The page leaves that space
 * (scoutSpace.ts) and the app checks the account again; queued entries are never dropped here.
 */
export const SCOUT_DENIED = "cs-scout-denied";
/**
 * A workspace answered a write with 423 (Task 19, src/shared/orphaned.ts): it's read-only now (deleted in
 * Control Point, or no admin left), not a removal. detail: the workspace id. The app re-reads the account
 * (its list marks the space read-only, and the page shows the banner); queued entries are never dropped here.
 */
export const SCOUT_READ_ONLY = "cs-scout-read-only";
/**
 * The server says the account's workspace list changed (a live stream's `workspace` or `account` event: a
 * space went read-only or came back, a re-add, a role change). The app re-reads /api/auth/me at once.
 */
export const ACCOUNT_STALE = "cs-account-stale";
const deniedBy = (space: ScoutSpace, e: unknown) => {
  const status = (e as { status?: unknown } | null)?.status;
  if (space != null && status === 403) window.dispatchEvent(new CustomEvent<string>(SCOUT_DENIED, { detail: space }));
  if (space != null && status === READ_ONLY_STATUS) window.dispatchEvent(new CustomEvent<string>(SCOUT_READ_ONLY, { detail: space }));
};

/** The workspace refused a write (detail: ScoutRefusal); the server's copy is already back on the device. */
export const SCOUT_REFUSED = "cs-scout-refused";
export interface ScoutRefusal { space: string; uuid: string; /** What was refused: a delete, or an edit to an entry that had been deleted meanwhile. */ kind: "delete" | "edit-deleted" }

/** What the app says when a workspace refuses a write. */
export const refusalMessage = (r: Pick<ScoutRefusal, "kind">) => r.kind === "delete"
  ? "Only the author or a workspace admin can delete this entry. It's been put back."
  : "This entry was deleted by its author or a workspace admin, so your edit wasn't saved.";

/**
 * Who may delete a shared entry (the server's rule, docs/workspaces.md): its author or a
 * workspace admin. A personal entry is always yours; a workspace entry not synced yet
 * (author 0) is yours too. `me`: your shared account id and role in the entry's workspace.
 */
export function canDeleteScoutEntry(e: ScoutEntry, me: { accountId?: number; role?: "admin" | "member" } | null): boolean {
  if (e.workspaceId == null) return true;
  if (!me?.role) return false; // not a member (as far as this device knows): the server would refuse
  return me.role === "admin" || !e.authorAccountId || (me.accountId != null && e.authorAccountId === me.accountId);
}

const keyFor = (space: ScoutSpace, uuid: string) => (space == null ? KEY(uuid) : `${WS}${space}:${uuid}`);
const dirtyKey = (space: ScoutSpace) => (space == null ? DIRTY : `${WS_DIRTY}${space}`);

export function newScoutId(): string {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function dirty(space: ScoutSpace = null): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(dirtyKey(space)) ?? "[]")); } catch { return new Set(); } }
function setDirty(d: Set<string>, space: ScoutSpace = null) {
  if (space != null && !d.size) localStorage.removeItem(dirtyKey(space));
  else localStorage.setItem(dirtyKey(space), JSON.stringify([...d]));
}

/**
 * An entry as read from the device or the server: entries saved before workspaces lack the newer fields, and any
 * field stored with the wrong type (an import before PRIVATE-F02, a timestamp of 1e300) is repaired
 * (src/shared/scoutEntry.ts), so a list never renders an object as text or breaks on a date. `repaired`: which
 * fields were; null when the row has no usable identity (uuid, season, team, kind) and can't be shown at all.
 */
export function readScoutEntry(raw: unknown, space: ScoutSpace): { entry: ScoutEntry; repaired: Repaired } | null {
  const fixed = repairScoutEntry<Record<string, unknown>>(raw, DEVICE_LATEST);
  if (!fixed) return null;
  const r = fixed.entry;
  return {
    entry: {
      ...r,
      workspaceId: space,
      authorAccountId: Number.isFinite(r.authorAccountId) ? r.authorAccountId : 0,
      authorDisplayName: typeof r.authorDisplayName === "string" ? r.authorDisplayName : "",
    } as unknown as ScoutEntry,
    repaired: fixed.repaired,
  };
}

/** readScoutEntry's entry; a row it can't read keeps the old reading (callers that build an entry themselves). */
export function normalizeScoutEntry(raw: any, space: ScoutSpace): ScoutEntry {
  return readScoutEntry(raw, space)?.entry ?? {
    ...raw,
    workspaceId: space,
    authorAccountId: Number.isFinite(raw?.authorAccountId) ? raw.authorAccountId : 0,
    authorDisplayName: typeof raw?.authorDisplayName === "string" ? raw.authorDisplayName : "",
  };
}

// --- Rows stored with bad values (PRIVATE-F02) ---------------------------------------------------------------
// A row whose fields were repaired on reading is written back repaired (once: the next read finds it fine), and a
// row that can't be read at all is hidden but left where it is: nothing a scout wrote is ever deleted here. Either
// way the scout is told, once per page load, in one message.

const unreadable = new Set<string>();
const reported = new Set<string>();
let repairedCount = 0;
let skippedCount = 0;
let noticeDue: ReturnType<typeof setTimeout> | null = null;

/** What the notice says (null: nothing to say). */
export function repairNotice(repaired: number, skipped: number): string | null {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    repaired ? `${n(repaired, "scouting entry", "scouting entries")} on this device had damaged fields and ${repaired === 1 ? "was" : "were"} repaired. The observations were kept.` : "",
    skipped ? `${n(skipped, "scouting entry", "scouting entries")} on this device couldn't be read and ${skipped === 1 ? "is" : "are"} hidden. Nothing was deleted.` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function noteRepair(kind: "repaired" | "skipped") {
  if (kind === "repaired") repairedCount++; else skippedCount++;
  // After the read (often during a render): one toast for everything found in this pass.
  noticeDue ??= setTimeout(() => {
    noticeDue = null;
    const text = repairNotice(repairedCount, skippedCount);
    repairedCount = skippedCount = 0;
    if (text) toast.warning(text, { duration: 15_000 });
  }, 0);
}

/** A stored row read: repaired ones written back (best effort), unreadable ones reported once and skipped. */
function readStored(key: string, raw: string, space: ScoutSpace): ScoutEntry | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  const r = readScoutEntry(parsed, space);
  if (!r) {
    if (!unreadable.has(key)) { unreadable.add(key); noteRepair("skipped"); }
    return null;
  }
  if (r.repaired.length) {
    // An edit still waiting to sync keeps winning: a damaged timestamp becomes now (one the server accepts), not
    // 0, which an older server copy would beat. A synced row's 0 is beaten by the server's copy, as it should be.
    if (r.repaired.includes("updatedAt") && dirty(space).has(r.entry.uuid)) r.entry = { ...r.entry, updatedAt: Date.now() };
    try { localStorage.setItem(key, JSON.stringify(storedScoutEntry(r.entry))); } catch { /* storage full: repaired again next read */ }
    // Told once per row per page load, whether or not the repaired copy could be stored.
    if (!reported.has(key)) { reported.add(key); noteRepair("repaired"); }
  }
  return r.entry;
}

/** The shape kept on the device (and in exports): a personal entry exactly as before workspaces. */
export function storedScoutEntry(e: ScoutEntry): Record<string, unknown> {
  if (e.workspaceId != null) return { ...e };
  const { workspaceId: _w, authorAccountId: _a, authorDisplayName: _n, editorAccountId: _ea, editorDisplayName: _en, templateId: _t, templateVersion: _tv, baseUpdatedAt: _b, restoredFrom: _r, ...rest } = e;
  return rest;
}

function readEntry(space: ScoutSpace, uuid: string): ScoutEntry | null {
  try { const k = keyFor(space, uuid), raw = localStorage.getItem(k); return raw ? readStored(k, raw, space) : null; } catch { return null; }
}
const writeEntry = (e: ScoutEntry) => localStorage.setItem(keyFor(e.workspaceId, e.uuid), JSON.stringify(storedScoutEntry(e)));

/** The workspaces this device holds entries or a queue for. */
function localSpaces(): string[] {
  const out = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(WS)) out.add(k.slice(WS.length, k.indexOf(":", WS.length)));
      else if (k?.startsWith(WS_DIRTY)) out.add(k.slice(WS_DIRTY.length));
      else if (k?.startsWith(WS_CURSOR)) out.add(k.slice(WS_CURSOR.length));
    }
  } catch { /* storage blocked */ }
  return [...out];
}

/** Every entry saved on this device in a space (tombstones included). Personal by default. */
export function localScoutEntries(space: ScoutSpace = null): ScoutEntry[] {
  const out: ScoutEntry[] = [];
  const prefix = space == null ? "cs-scout:" : `${WS}${space}:`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      const e = readStored(k, localStorage.getItem(k) ?? "", space); // unreadable: skipped (and reported), never removed
      if (e) out.push(e);
    }
  } catch { /* storage blocked */ }
  return out;
}

export class ScoutStorageError extends Error {}

type NewEntry = Omit<ScoutEntry, "updatedAt" | "workspaceId" | "authorAccountId" | "authorDisplayName">
  & Partial<Pick<ScoutEntry, "updatedAt" | "workspaceId" | "authorAccountId" | "authorDisplayName">>;

/**
 * Save on the device first (throws if the device refuses), then queue for sync. `workspaceId` picks the space (Personal when absent).
 * A workspace entry keeps its author, and its editor becomes "you, not synced yet" (0) until the server stamps the real one.
 * `opts.base`: the draft's base (scoutDraftBase of the copy the form opened with), so a version that arrived while
 * the form was open counts as unseen; without it, the base is the copy on the device now.
 */
export function saveScoutEntry(e: NewEntry, opts: { base?: number | null } = {}): ScoutEntry {
  const space = e.workspaceId ?? null;
  const prior = space != null ? readEntry(space, e.uuid) : null;
  // The server version this edit builds on: the copy last taken from the server (a queued edit keeps its own base).
  const base = opts.base !== undefined ? opts.base ?? undefined : prior ? scoutDraftBase(prior) : undefined;
  const authorship = space == null ? {} : {
    authorAccountId: e.authorAccountId ?? prior?.authorAccountId ?? 0, authorDisplayName: e.authorDisplayName ?? prior?.authorDisplayName ?? "",
    editorAccountId: 0, editorDisplayName: "",
    baseUpdatedAt: base,
    // Only the save that restores says so (a delete, or a later edit, is not a restore).
    restoredFrom: e.deleted ? undefined : e.restoredFrom,
    // Photos are the server's: an edit to the text keeps the list the device has.
    ...(prior?.photos && e.photos === undefined ? { photos: prior.photos, photoExpired: prior.photoExpired, photosRev: prior.photosRev } : {}),
  };
  // A workspace edit (a restore, a delete, any change) must win over the version it's made on, even when
  // that version's writer had a clock running ahead of this one: newer wins, so it's stamped after it.
  // (Not after a version stamped further ahead than any clock could be, stored before the server checked: the
  // server reads that one as superseded by any edit, and would refuse a stamp after it. PRIVATE-F01.)
  const priorAt = prior && isEntryTimestamp(prior.updatedAt, Date.now()) ? prior.updatedAt : 0;
  const now = space != null ? Math.max(Date.now(), priorAt + 1) : Date.now();
  const entry = normalizeScoutEntry({ ...e, ...authorship, updatedAt: now }, space);
  try {
    writeEntry(entry);
    const d = dirty(entry.workspaceId); d.add(entry.uuid); setDirty(d, entry.workspaceId);
  } catch {
    throw new ScoutStorageError("This device couldn't save the entry (storage full or blocked). Nothing was lost from earlier entries.");
  }
  window.dispatchEvent(new Event(EVT));
  window.dispatchEvent(new CustomEvent<SavedDetail>(SAVED, { detail: { space: entry.workspaceId, deleted: !!entry.deleted } }));
  return entry;
}

/**
 * The server version an edit of this copy builds on: its own updatedAt when it's the server's copy, or, for an
 * edit still queued on this device, the base that edit had. A form keeps this from when it opened (Task 16).
 */
export function scoutDraftBase(e: ScoutEntry): number | undefined {
  if (e.workspaceId == null) return undefined;
  return dirty(e.workspaceId).has(e.uuid) ? e.baseUpdatedAt : e.updatedAt;
}

/** Is this entry waiting to sync on this device? */
export const isScoutQueued = (e: Pick<ScoutEntry, "uuid" | "workspaceId">) => dirty(e.workspaceId).has(e.uuid);

export function deleteScoutEntry(e: ScoutEntry) { saveScoutEntry({ ...e, deleted: true, data: {}, notes: "" }); }

/** Entries waiting to sync, per space. */
export function pendingScoutCounts(): { personal: number; workspaces: Record<string, number> } {
  return { personal: dirty(null).size, workspaces: Object.fromEntries(localSpaces().map((w) => [w, dirty(w).size]).filter(([, n]) => n)) };
}

export type PendingScoutCounts = ReturnType<typeof pendingScoutCounts>;
const samePending = (a: PendingScoutCounts, b: PendingScoutCounts) => a.personal === b.personal
  && Object.keys(a.workspaces).length === Object.keys(b.workspaces).length && Object.entries(a.workspaces).every(([w, n]) => b.workspaces[w] === n);

/** pendingScoutCounts(), kept current as entries are saved and synced (in this tab or another). */
export function usePendingScoutCounts(): PendingScoutCounts {
  const [counts, setCounts] = useState(pendingScoutCounts);
  useEffect(() => {
    const refresh = () => { const next = pendingScoutCounts(); setCounts((cur) => (samePending(cur, next) ? cur : next)); };
    refresh();
    window.addEventListener(EVT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(EVT, refresh); window.removeEventListener("storage", refresh); };
  }, []);
  return counts;
}

/**
 * Push every queue with something in it: Personal and the given workspaces (the account's, so a
 * space it has left isn't retried). A failure stays queued for the next try.
 */
export async function syncQueuedScouting(workspaces: string[]): Promise<void> {
  const p = pendingScoutCounts();
  const spaces: ScoutSpace[] = [...(p.personal ? [null] : []), ...workspaces.filter((w) => p.workspaces[w])];
  await Promise.all(spaces.map((s) => syncScouting(s).catch(() => undefined)));
}

interface SpaceExport { entries: ScoutEntry[]; dirty: string[]; cursor?: number }
/** Workspace templates kept on the device (scoutTemplates.ts): current ones and the versions entries were made with. */
const TEMPLATE_KEY = /^cs-scout-tplv?:[A-Za-z0-9_-]{1,64}:\d{4}(:\d+)?$/;
const LOST_KEY = /^cs-scout-lost:[A-Za-z0-9_-]{1,64}$/;

/**
 * Everything scouting-related on this device, including what hasn't synced yet. `spaces`: the workspaces' cached entries and queues.
 * `templates`: the workspace templates kept here, so cached entries still read with their fields offline after an account switch.
 */
export function exportLocalScouting(): SpaceExport & { spaces?: Record<string, SpaceExport>; templates?: Record<string, string>; lost?: Record<string, string> } {
  const templates: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && TEMPLATE_KEY.test(k)) templates[k] = localStorage.getItem(k)!;
    }
  } catch { /* storage blocked */ }
  return {
    entries: localScoutEntries(), dirty: [...dirty()],
    spaces: Object.fromEntries(localSpaces().map((w) => [w, { entries: localScoutEntries(w), dirty: [...dirty(w)], cursor: readCursor(w) }])),
    templates,
    // Edits this device lost to newer ones (lostEdits.ts): they belong to this account, so they go aside with it.
    lost: exportLostEdits(),
  };
}

/** Put back a previously exported set (an account's stashed copy). */
export function importLocalScouting(data: SpaceExport & { spaces?: Record<string, SpaceExport>; templates?: Record<string, string>; lost?: Record<string, string> }) {
  // What couldn't be put back (storage full): handed back, in the same shape, so the caller keeps it. Entries and
  // overwritten edits only: they may exist nowhere else (templates are fetched again online).
  const failed: SpaceExport & { spaces: Record<string, SpaceExport>; lost: Record<string, string> } = { entries: [], dirty: [], spaces: {}, lost: {} };
  const put = (space: ScoutSpace, s: SpaceExport) => {
    const missed: ScoutEntry[] = [];
    for (const e of s.entries ?? []) {
      // A copy on the device that's as new or newer (edited since an earlier, partial put-back) is kept: newer wins.
      const cur = readEntry(space, e.uuid);
      if (cur && cur.updatedAt >= (Number(e.updatedAt) || 0)) continue;
      try { writeEntry(normalizeScoutEntry(e, space)); } catch { missed.push(e); /* storage full */ }
    }
    let queueKept = true;
    try { const d = dirty(space); for (const u of s.dirty ?? []) d.add(u); setDirty(d, space); } catch { queueKept = false; /* storage full */ }
    // The cursor only holds if every entry it covers is back; otherwise the next pull starts over.
    if (space != null) { if (!missed.length && s.cursor) writeCursor(space, s.cursor); else try { localStorage.removeItem(`${WS_CURSOR}${space}`); } catch { /* blocked */ } }
    if (!missed.length && queueKept) return;
    // Hand back the entries that didn't make it, and (if the queue couldn't be written) every queued one.
    const queued = new Set(s.dirty ?? []);
    const back = queueKept ? missed : [...missed, ...(s.entries ?? []).filter((e) => queued.has(e.uuid) && !missed.includes(e))];
    const out = { entries: back, dirty: back.map((e) => e.uuid).filter((u) => queued.has(u)) };
    if (space == null) Object.assign(failed, out); else failed.spaces[space] = out;
  };
  put(null, data);
  for (const [w, s] of Object.entries(data.spaces ?? {})) if (/^[A-Za-z0-9_-]{1,64}$/.test(w)) put(w, s);
  for (const [k, v] of Object.entries(data.templates ?? {})) if (TEMPLATE_KEY.test(k) && typeof v === "string") { try { localStorage.setItem(k, v); } catch { /* storage full: fetched again online */ } }
  // Overwritten edits (lostEdits.ts): merged with any already here, each version once.
  let lostBack = false;
  for (const [k, v] of Object.entries(data.lost ?? {})) {
    if (!LOST_KEY.test(k) || typeof v !== "string") continue;
    try { localStorage.setItem(k, mergeLostLists(localStorage.getItem(k), v)); lostBack = true; } catch { failed.lost[k] = v; }
  }
  window.dispatchEvent(new Event(EVT));
  if (lostBack) window.dispatchEvent(new Event(SCOUT_OVERWRITTEN)); // open notices show what came back
  const any = failed.entries.length || Object.keys(failed.spaces).length || Object.keys(failed.lost).length;
  return { failed: any ? failed : null };
}

/** Remove every space's entries, queues and cursors (and cached workspace templates) from this device. */
export function clearLocalScouting() {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // (cs-scout-tpl…: workspace templates kept for offline forms, scoutTemplates.ts; cs-scout-wss: workspace settings, workspaceSettings.ts.)
      if (k && (k.startsWith("cs-scout:") || k.startsWith(WS) || k.startsWith(WS_DIRTY) || k.startsWith(WS_CURSOR) || k.startsWith("cs-scout-tpl") || k.startsWith("cs-scout-wss:") || k.startsWith(LOST_PREFIX))) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
    localStorage.removeItem(DIRTY);
  } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVT));
}

function readCursor(space: string): number { try { return Number(localStorage.getItem(`${WS_CURSOR}${space}`)) || 0; } catch { return 0; } }
function writeCursor(space: string, c: number) { try { localStorage.setItem(`${WS_CURSOR}${space}`, String(c)); } catch { /* storage full: pull again from the old cursor */ } }
/** Move a workspace's cursor forward only: the live stream and a pull may both have advanced it. */
function advanceCursor(space: string, c: number) { if (c > readCursor(space)) writeCursor(space, c); }

/** How far this device has a workspace's entries (the server's seq): where a pull or the live stream starts. */
export const scoutCursor = (space: string) => readCursor(space);

/** Tell open lists that entries changed (live updates batch their notices). */
export const notifyScoutChanged = () => window.dispatchEvent(new Event(EVT));

/**
 * Entries from the live stream (stream order): merged newer-wins like a pull, then the pull
 * cursor moves to the last one's seq, so a later pull starts after them. Throws if the device
 * can't save one; the cursor then stays before it, and the next pull or stream brings it again.
 * Doesn't notify (the caller batches): call notifyScoutChanged() after.
 */
export function applyLiveEntries(space: string, list: { entry: ScoutEntry; seq: number }[]) {
  for (const { entry, seq } of list) {
    mergeFromServer(space, [entry]);
    advanceCursor(space, seq);
  }
}

/**
 * Push a space's queued entries (≤200 per request); keep any entry edited
 * again meanwhile. A workspace answers with its stored copy of each entry
 * (with the authorship it stamped, or a newer edit from someone else), which
 * replaces the device's copy unless that changed meanwhile.
 */
export function syncScouting(space: ScoutSpace = null): Promise<{ sent: number }> {
  // One push per space at a time: a second call (a reconnect heard by the page and by the
  // background sync at once) waits for the first, then sends only what's still queued.
  const key = space ?? "";
  const run = (pushing.get(key) ?? Promise.resolve()).then(() => pushQueued(space)).catch((e: unknown) => { deniedBy(space, e); throw e; });
  const settled = run.catch(() => undefined);
  pushing.set(key, settled);
  void settled.then(() => { if (pushing.get(key) === settled) pushing.delete(key); });
  return run;
}
const pushing = new Map<string, Promise<unknown>>();

async function pushQueued(space: ScoutSpace): Promise<{ sent: number }> {
  const d = dirty(space);
  if (!d.size) return { sent: 0 };
  const queued = [...d].map((u) => readEntry(space, u)).filter((x): x is ScoutEntry => !!x);
  let sent = 0;
  const refused: ScoutRefusal[] = [];
  for (let i = 0; i < queued.length; i += 200) {
    const batch = queued.slice(i, i + 200);
    const r = await apiFetch<{ results: { uuid: string; ok: boolean; error?: string; entry?: ScoutEntry }[] }>("/api/me/scout/sync", {
      method: "POST",
      json: space == null ? { entries: batch.map(storedScoutEntry) } : { workspaceId: space, entries: batch },
    });
    const now = dirty(space);
    for (const res of r.results) {
      const sentVersion = batch.find((b) => b.uuid === res.uuid);
      const current = readEntry(space, res.uuid);
      const unchanged = !!current && !!sentVersion && current.updatedAt === sentVersion.updatedAt;
      if (res.ok && unchanged) {
        // Done only once the server's copy is on the device (it may be a newer edit that beat ours):
        // if it can't be saved, the entry stays queued and the next push brings the copy back again.
        let saved = true;
        const server = res.entry && normalizeScoutEntry(res.entry, space);
        // A newer edit from someone else beat ours on the server: keep ours (Task 16) before taking theirs.
        // If that copy can't be stored, ours stays on the device, queued, until it can.
        if (space != null && server && lostTo(current, server, true) && !recordLostEdit(space, current, server)) { lostBackupFailed(space); continue; }
        if (server) { try { writeEntry(withNewerPhotos(server, current)); } catch { saved = false; } }
        if (saved) now.delete(res.uuid);
        // A restore that landed: the lost version it brought back is no longer lost.
        if (space != null && sentVersion?.restoredFrom != null && server?.updatedAt === sentVersion.updatedAt) dropRestored(space, res.uuid, sentVersion.restoredFrom);
      }
      else if (!res.ok && res.error === "forbidden" && space != null && res.entry) {
        // Refused by the workspace's permissions: put the server's copy back (once this version is
        // the one still on the device; a newer local edit goes up on its own) and say why.
        if (!unchanged) continue;
        const server = normalizeScoutEntry(res.entry, space);
        // An edit refused because the entry was deleted meanwhile was never stored anywhere: keep it on the
        // device (Task 16) before the deleted copy goes back, so its author or an admin can still bring it back.
        // (A member's Restore stays blocked on an entry they didn't write: the same rule as this refusal.)
        if (current && !current.deleted && server.deleted && !sameScoutText(current, server) && !recordLostEdit(space, current, server)) { lostBackupFailed(space); continue; }
        try { writeEntry(withNewerPhotos(server, current)); } catch { continue; /* stays queued: the next push brings the copy again */ }
        now.delete(res.uuid);
        const kind = sentVersion?.deleted ? "delete" : "edit-deleted";
        // Deleting something already deleted (by its author or an admin) needs no message.
        if (!(kind === "delete" && res.entry.deleted)) refused.push({ space, uuid: res.uuid, kind });
      }
      else if (!res.ok) now.delete(res.uuid); // rejected for good (invalid): don't retry forever
    }
    setDirty(now, space);
    sent += batch.length;
    // Per batch: a later batch's request may fail, and what this one put back must still be shown and explained.
    window.dispatchEvent(new Event(EVT));
    for (const x of refused.splice(0)) window.dispatchEvent(new CustomEvent<ScoutRefusal>(SCOUT_REFUSED, { detail: x }));
  }
  return { sent };
}

/**
 * A server copy of a workspace entry, keeping whichever photo list is newer (photosRev): the
 * device's or the copy's. Photos are chosen apart from the text, so a late answer (an upload's,
 * a push's) never brings back a photo a newer change removed.
 */
function withNewerPhotos(server: ScoutEntry, cur: ScoutEntry | null): ScoutEntry {
  if (server.workspaceId == null || !cur || (server.photosRev ?? 0) >= (cur.photosRev ?? 0)) return server;
  return { ...server, photos: cur.photos, photoExpired: cur.photoExpired, photosRev: cur.photosRev };
}

/**
 * The text: newer wins; an equal stamp from the server wins unless this device has that entry queued.
 * The photos (the server's alone), separately: the newer photosRev wins, whichever text does.
 */
function mergeFromServer(space: ScoutSpace, list: ScoutEntry[]) {
  const d = dirty(space);
  let dropped = false;
  for (const raw of list) {
    const e = normalizeScoutEntry(raw, space);
    const cur = readEntry(space, e.uuid);
    if (!cur || e.updatedAt > cur.updatedAt || (space != null && e.updatedAt === cur.updatedAt && !d.has(e.uuid))) {
      // This device's own edit is being replaced by someone else's: keep it, and say so (once). If the device
      // can't store that copy, the edit stays as it is (and queued, if it was): its push brings the newer copy back.
      // (A synced version of yours is in the server's history already, so that one is replaced either way.)
      if (space != null && cur && lostTo(cur, e, d.has(e.uuid)) && !recordLostEdit(space, cur, e) && d.has(e.uuid)) { lostBackupFailed(space); continue; }
      writeEntry(withNewerPhotos(e, cur));
      // A queued edit older than the server's copy can't win: nothing is left to send (it's kept above if it was a loss).
      if (space != null && cur && e.updatedAt > cur.updatedAt && d.delete(e.uuid)) dropped = true;
    }
    else if (space != null && (e.photosRev ?? 0) > (cur.photosRev ?? 0)) writeEntry({ ...cur, photos: e.photos, photoExpired: e.photoExpired, photosRev: e.photosRev });
  }
  if (dropped) setDirty(d, space);
}

// --- Lost edits (Task 16) ------------------------------------------------------

/** This device's shared account id (personal.tsx sets it on sign-in): tells your own edits from other members'. */
let viewerAccountId: number | null = null;
export function setScoutViewer(accountId: number | null | undefined) { viewerAccountId = Number.isSafeInteger(accountId) && accountId! > 0 ? accountId! : null; }

type Text = Pick<ScoutEntry, "team" | "kind" | "eventCode" | "matchLabel" | "notes" | "deleted" | "data" | "templateId" | "templateVersion">;
/** Do two versions of an entry say the same thing (answers, notes, where, deleted, template)? */
export const sameScoutText = (a: Text, b: Text) => a.team === b.team && a.kind === b.kind && (a.eventCode ?? "") === (b.eventCode ?? "")
  && (a.matchLabel ?? "") === (b.matchLabel ?? "") && a.notes === b.notes && !!a.deleted === !!b.deleted && canonical(a.data) === canonical(b.data)
  // The template too: the same numbers read with other fields (another rating scale) say something else.
  && (a.templateId ?? "") === (b.templateId ?? "") && (a.templateVersion ?? 0) === (b.templateVersion ?? 0);
const canonical = (d: Record<string, unknown>) => JSON.stringify(Object.keys(d ?? {}).sort().map((k) => [k, d[k]]));

/**
 * Did this device lose an edit (last-write-wins) when `theirs` replaces `cur`? Yes when theirs is newer, says
 * something different, was written by someone else (not this account from another device), and either
 *  - cur is an edit of this device's still waiting to sync (`queued`: offline, or not sent yet), or
 *  - cur is this account's own synced version, and theirs was based on an older copy (its baseUpdatedAt is
 *    before cur's updatedAt): the writer never saw it. Edits made after seeing yours are not conflicts.
 * A delete that lost isn't an edit to keep (an entry deleted under you is a loss, and shows as one).
 */
export function lostTo(cur: ScoutEntry, theirs: ScoutEntry, queued: boolean): boolean {
  if (cur.workspaceId == null || theirs.updatedAt < cur.updatedAt || (theirs.updatedAt === cur.updatedAt && !queued) || cur.deleted || sameScoutText(cur, theirs)) return false;
  const by = theirs.editorAccountId ?? 0;
  if (viewerAccountId != null && by === viewerAccountId) return false;
  if (queued) return true;
  return viewerAccountId != null && cur.editorAccountId === viewerAccountId && theirs.baseUpdatedAt != null && theirs.baseUpdatedAt < cur.updatedAt;
}

/**
 * Restore an earlier version of a workspace entry (a version from its history, or an edit this device lost):
 * an ordinary save, so it gets a fresh updatedAt, goes up with the queue, is attributed to you, and the
 * server checks it like any write (bringing back a deleted entry is still its author's or an admin's).
 */
export function restoreScoutVersion(current: Pick<ScoutEntry, "uuid" | "workspaceId">, v: {
  season: number; team: number; eventCode: string | null; matchLabel: string | null; kind: "match" | "pit";
  data: Record<string, ScoutValue>; notes: string; updatedAt: number; templateId?: string; templateVersion?: number;
}): ScoutEntry {
  return saveScoutEntry({
    uuid: current.uuid, workspaceId: current.workspaceId, season: v.season, team: v.team, eventCode: v.eventCode, matchLabel: v.matchLabel, kind: v.kind,
    data: { ...v.data }, notes: v.notes, deleted: false,
    // A version made before templates names the built-in one explicitly: sending none would keep the template the entry has now.
    templateId: v.templateId ?? builtinTemplate(v.season, v.kind).id, templateVersion: v.templateId ? v.templateVersion ?? 0 : 0,
    restoredFrom: v.updatedAt,
  });
}

/** The server's copy of a workspace entry after a photo change (upload or removal): merged like a pull, lists refreshed. */
export function adoptServerEntry(space: string, entry: ScoutEntry) {
  mergeFromServer(space, [entry]);
  window.dispatchEvent(new Event(EVT));
}

/**
 * Access to a workspace ended while this device still had entries queued for it (saved offline, or
 * before the removal reached the device): the server refused them (403) and the account's workspace
 * list no longer has it. Nothing is dropped: every queued entry that isn't a delete moves to Personal
 * as a new personal entry (your own copy: its fields and notes; the workspace's photos and authorship
 * stay behind), queued to sync to your account. Queued deletes are let go (there is nothing to keep): their
 * local tombstone goes too, so a workspace still readable here (read-only, Task 19) shows the server's copy
 * again after the next pull instead of hiding it. The moved entries leave the workspace's copy on this
 * device, so a later re-add can't show them twice. Returns how many moved. docs/shared-accounts.md,
 * "Revoked while offline".
 */
export function moveQueuedToPersonal(space: string): number {
  const d = dirty(space);
  if (!d.size) return 0;
  let moved = 0, dropped = 0;
  const keep = new Set<string>();
  for (const uuid of d) {
    const e = readEntry(space, uuid);
    if (!e) continue;
    if (e.deleted) { try { localStorage.removeItem(keyFor(space, uuid)); dropped++; } catch { /* blocked */ } continue; }
    // The workspace's own questions have no label in Personal: their answers go into the notes (personalCopy).
    const copy = normalizeScoutEntry({
      uuid: newScoutId(), season: e.season, team: e.team, eventCode: e.eventCode, matchLabel: e.matchLabel, kind: e.kind,
      ...asPersonal(e.data ?? {}, e.notes ?? "", workspaceFieldsOnDevice(space, e.season, e.kind), templateFor(e.season, e.kind).fields), updatedAt: Date.now(),
    }, null);
    try {
      writeEntry(copy);
      const p = dirty(null); p.add(copy.uuid); setDirty(p, null);
    } catch {
      // The device is full: it stays where it was, queued, for the next try, and no half-made copy is left behind.
      try { localStorage.removeItem(keyFor(null, copy.uuid)); } catch { /* blocked */ }
      keep.add(uuid); continue;
    }
    try { localStorage.removeItem(keyFor(space, uuid)); } catch { /* blocked: hidden anyway */ }
    moved++;
  }
  try { setDirty(keep, space); } catch { /* storage blocked */ }
  // The workspace's copies on this device are no longer complete: a later return (re-added) pulls it all again.
  if (moved || dropped) try { localStorage.removeItem(`${WS_CURSOR}${space}`); } catch { /* blocked */ }
  window.dispatchEvent(new Event(EVT));
  if (moved) window.dispatchEvent(new CustomEvent<SavedDetail>(SAVED, { detail: { space: null, deleted: false } }));
  return moved;
}

/** The workspace's current questions for a season and kind as last seen on this device (scoutTemplates.ts keeps them), else the built-in ones. */
function workspaceFieldsOnDevice(space: string, season: number, kind: "match" | "pit"): { id: string; label: string }[] {
  try {
    const t = JSON.parse(localStorage.getItem(`cs-scout-tpl:${space}:${season}`) ?? "null") as Record<string, unknown> | null;
    const f = t?.[kind];
    if (Array.isArray(f)) return f.filter((x): x is { id: string; label: string } => !!x && typeof x.id === "string" && typeof x.label === "string");
  } catch { /* unreadable: the built-in questions */ }
  return templateFor(season, kind).fields;
}

/** personalCopy's data and notes only (an automatic move: what doesn't fit the notes stays in data). */
const asPersonal = (data: Record<string, ScoutValue>, notes: string, fields: { id: string; label: string }[], builtin: { id: string }[]) => {
  const { data: d, notes: n } = personalCopy(data, notes, fields, builtin, null);
  return { data: d, notes: n };
};

/** How long notes may be (the server keeps 4,000 characters: src/shared/scoutEntry.ts). */
export const NOTES_MAX = ENTRY_NOTES_MAX;

/**
 * What an entry from a read-only workspace keeps in Personal (Task 19): Personal entries use the built-in
 * questions, so answers to the workspace's own questions would have no label there. They're written into
 * the notes as well ("Label: answer"), readable anywhere. Nothing is dropped: every answer stays in `data`
 * too, and the notes the scout wrote are never cut. `overflow`: how many characters the readable answers
 * didn't fit by (0: they're all in the notes); they're still in `data`.
 */
export function personalCopy(data: Record<string, ScoutValue>, notes: string, fields: { id: string; label: string }[], builtin: { id: string }[], from: string | null): { data: Record<string, ScoutValue>; notes: string; overflow: number } {
  const known = new Set(builtin.map((f) => f.id));
  const lines: string[] = [];
  for (const [id, v] of Object.entries(data)) {
    if (known.has(id) || v === undefined || v === null || v === "" || v === false) continue;
    const label = fields.find((f) => f.id === id)?.label || id;
    lines.push(`${label}: ${v === true ? "yes" : Array.isArray(v) ? v.join(", ") : String(v)}`);
  }
  const mine = notes.trim();
  if (!lines.length) return { data: { ...data }, notes: mine, overflow: 0 };
  const full = [mine, `${from ? `Answers from ${from}` : "Workspace answers"}:\n${lines.join("\n")}`].filter(Boolean).join("\n\n");
  if (full.length <= NOTES_MAX) return { data: { ...data }, notes: full, overflow: 0 };
  // Too long for the notes: the scout's own notes stay whole, and the answers stay in data (nothing lost).
  return { data: { ...data }, notes: mine, overflow: full.length - NOTES_MAX };
}

/** Pull a space's entries from the account (Personal) or the workspace (changes since the last pull); local unsynced edits are kept if newer. */
export async function pullScouting(space: ScoutSpace = null): Promise<void> {
  if (space == null) {
    const r = await apiFetch<{ entries: ScoutEntry[] }>("/api/me/scout");
    mergeFromServer(null, r.entries);
  } else {
    for (let page = 0; page < 100; page++) {
      const since = readCursor(space);
      const r = await apiFetch<{ entries: ScoutEntry[]; cursor: number; more: boolean }>(`/api/scout/sync?workspaceId=${encodeURIComponent(space)}&since=${since}`)
        .catch((e: unknown) => { deniedBy(space, e); throw e; });
      mergeFromServer(space, r.entries);
      advanceCursor(space, r.cursor);
      if (!r.more) break;
    }
  }
  window.dispatchEvent(new Event(EVT));
}

export type ScoutSync = "local" | "idle" | "syncing" | "offline" | "error";

/** Live list of a space's entries (filtered; Personal by default), plus sync when signed in. */
export function useScouting(filter: { season?: number; team?: number }, signedIn: boolean, space: ScoutSpace = null) {
  const read = useCallback(() => localScoutEntries(space)
    .filter((e) => !e.deleted && (filter.season == null || e.season === filter.season) && (filter.team == null || e.team === filter.team))
    .sort((a, b) => b.updatedAt - a.updatedAt), [filter.season, filter.team, space]);
  const [entries, setEntries] = useState<ScoutEntry[]>(read);
  const [status, setStatus] = useState<ScoutSync>(signedIn ? "idle" : "local");
  /** Push the space's queue, then pull what's new. True when both went through. */
  const run = useCallback(async (): Promise<boolean> => {
    if (!signedIn) { setStatus("local"); return false; }
    setStatus("syncing");
    try { await syncScouting(space); await pullScouting(space); setStatus("idle"); return true; }
    catch (e: any) { setStatus(e?.offline ? "offline" : "error"); return false; }
  }, [signedIn, space]);
  useEffect(() => {
    const refresh = () => setEntries(read());
    refresh();
    window.addEventListener(EVT, refresh);
    window.addEventListener("storage", refresh);
    const online = () => run();
    window.addEventListener("online", online);
    const t = setInterval(() => { if (dirty(space).size) run(); }, 30_000);
    // A save in this space goes up at once (a burst of saves, together), not at the next 30 s tick.
    let soon: ReturnType<typeof setTimeout> | null = null;
    const push = async () => {
      soon = null;
      setStatus("syncing");
      try { await syncScouting(space); setStatus("idle"); }
      catch (e: any) { setStatus(e?.offline ? "offline" : "error"); }
    };
    // A delete goes up at once (it must reach other members as fast as an add), taking any save waiting with it.
    const saved = (ev: Event) => {
      const d = (ev as CustomEvent<SavedDetail>).detail;
      if (!signedIn || d?.space !== space) return;
      if (d.deleted) { if (soon) clearTimeout(soon); soon = null; void push(); }
      else soon ??= setTimeout(push, PUSH_DEBOUNCE_MS);
    };
    window.addEventListener(SAVED, saved);
    run();
    return () => {
      window.removeEventListener(EVT, refresh); window.removeEventListener("storage", refresh); window.removeEventListener("online", online); window.removeEventListener(SAVED, saved);
      clearInterval(t); if (soon) clearTimeout(soon);
    };
  }, [read, run, space, signedIn]);
  return { entries, status, pendingCount: dirty(space).size, syncNow: run };
}
