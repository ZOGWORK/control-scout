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

export type ScoutValue = number | boolean | string;
export type FieldType = "counter" | "toggle" | "choice" | "rating" | "text";
export interface ScoutField { id: string; label: string; type: FieldType; phase: "auto" | "teleop" | "endgame" | "overall" | "pit"; options?: string[]; max?: number }
export interface ScoutTemplate { id: string; kind: "match" | "pit"; name: string; fields: ScoutField[] }

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
}

// --- Templates -------------------------------------------------------------

const common: ScoutField[] = [
  { id: "defense", label: "Played defense", type: "toggle", phase: "teleop" },
  { id: "broke", label: "Broke down / disabled", type: "toggle", phase: "overall" },
  { id: "fouls", label: "Fouls drawn", type: "counter", phase: "overall", max: 20 },
  { id: "driver", label: "Driver skill", type: "rating", phase: "overall", max: 5 },
  { id: "consistency", label: "Consistency", type: "rating", phase: "overall", max: 5 },
];

const MATCH: Record<number, ScoutField[]> = {
  2026: [
    { id: "autoLeave", label: "Left start zone", type: "toggle", phase: "auto" },
    { id: "autoPark", label: "Parked in auto", type: "toggle", phase: "auto" },
    { id: "autoHive", label: "Hive tips (auto)", type: "counter", phase: "auto", max: 10 },
    { id: "pollen", label: "Pollen / nectar scored", type: "counter", phase: "teleop", max: 60 },
    { id: "garden", label: "Garden scoring", type: "counter", phase: "teleop", max: 40 },
    { id: "teleHive", label: "Hive tips (TeleOp)", type: "counter", phase: "teleop", max: 10 },
    { id: "park", label: "End park", type: "choice", phase: "endgame", options: ["None", "Partial", "Full"] },
  ],
  2025: [
    { id: "autoLeave", label: "Left launch line", type: "toggle", phase: "auto" },
    { id: "autoArtifacts", label: "Artifacts classified (auto)", type: "counter", phase: "auto", max: 20 },
    { id: "autoPattern", label: "Matched the pattern (auto)", type: "toggle", phase: "auto" },
    { id: "artifacts", label: "Artifacts classified (TeleOp)", type: "counter", phase: "teleop", max: 60 },
    { id: "overflow", label: "Overflow artifacts", type: "counter", phase: "teleop", max: 40 },
    { id: "base", label: "Returned to base", type: "choice", phase: "endgame", options: ["None", "Partial", "Full"] },
  ],
  2024: [
    { id: "autoSamples", label: "Samples (auto)", type: "counter", phase: "auto", max: 10 },
    { id: "autoSpecimens", label: "Specimens (auto)", type: "counter", phase: "auto", max: 10 },
    { id: "samples", label: "Samples (TeleOp)", type: "counter", phase: "teleop", max: 40 },
    { id: "specimens", label: "Specimens (TeleOp)", type: "counter", phase: "teleop", max: 40 },
    { id: "ascent", label: "Ascent", type: "choice", phase: "endgame", options: ["None", "Park", "Level 1", "Level 2", "Level 3"] },
  ],
  2023: [
    { id: "purple", label: "Purple pixel on spike mark", type: "toggle", phase: "auto" },
    { id: "yellow", label: "Yellow pixel on backdrop", type: "toggle", phase: "auto" },
    { id: "pixels", label: "Pixels placed (TeleOp)", type: "counter", phase: "teleop", max: 80 },
    { id: "mosaics", label: "Mosaics", type: "counter", phase: "teleop", max: 10 },
    { id: "drone", label: "Drone launched", type: "toggle", phase: "endgame" },
    { id: "hang", label: "Suspended", type: "toggle", phase: "endgame" },
  ],
};

const PIT: ScoutField[] = [
  { id: "drivetrain", label: "Drivetrain", type: "choice", phase: "pit", options: ["Mecanum", "Tank", "Swerve", "Other"] },
  { id: "autoRoutines", label: "Auto routines", type: "counter", phase: "pit", max: 10 },
  { id: "preferredStart", label: "Preferred start", type: "choice", phase: "pit", options: ["Near", "Far", "Either"] },
  { id: "endgameCapable", label: "Can do the endgame", type: "toggle", phase: "pit" },
  { id: "canDefend", label: "Willing to play defense", type: "toggle", phase: "pit" },
  { id: "weight", label: "Robot weight (lb)", type: "counter", phase: "pit", max: 60 },
];

export function templateFor(season: number, kind: "match" | "pit"): ScoutTemplate {
  if (kind === "pit") return { id: `pit`, kind, name: "Pit scouting", fields: PIT };
  const fields = MATCH[season] ?? [
    { id: "autoScore", label: "Auto scoring", type: "rating", phase: "auto", max: 5 },
    { id: "teleScore", label: "TeleOp scoring", type: "rating", phase: "teleop", max: 5 },
    { id: "endgame", label: "Endgame", type: "rating", phase: "endgame", max: 5 },
  ];
  return { id: `match-${season}`, kind, name: "Match scouting", fields: [...fields, ...common] };
}

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
const EVT = "cs-scout-changed";

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

/** An entry as read from the device or the server: entries saved before workspaces lack the newer fields. */
export function normalizeScoutEntry(raw: any, space: ScoutSpace): ScoutEntry {
  return {
    ...raw,
    workspaceId: space,
    authorAccountId: Number.isFinite(raw?.authorAccountId) ? raw.authorAccountId : 0,
    authorDisplayName: typeof raw?.authorDisplayName === "string" ? raw.authorDisplayName : "",
  };
}

/** The shape kept on the device (and in exports): a personal entry exactly as before workspaces. */
export function storedScoutEntry(e: ScoutEntry): Record<string, unknown> {
  if (e.workspaceId != null) return { ...e };
  const { workspaceId: _w, authorAccountId: _a, authorDisplayName: _n, editorAccountId: _ea, editorDisplayName: _en, ...rest } = e;
  return rest;
}

function readEntry(space: ScoutSpace, uuid: string): ScoutEntry | null {
  try { const raw = localStorage.getItem(keyFor(space, uuid)); return raw ? normalizeScoutEntry(JSON.parse(raw), space) : null; } catch { return null; }
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
      try { out.push(normalizeScoutEntry(JSON.parse(localStorage.getItem(k)!), space)); } catch { /* skip corrupt */ }
    }
  } catch { /* storage blocked */ }
  return out;
}

export class ScoutStorageError extends Error {}

type NewEntry = Omit<ScoutEntry, "updatedAt" | "workspaceId" | "authorAccountId" | "authorDisplayName">
  & Partial<Pick<ScoutEntry, "updatedAt" | "workspaceId" | "authorAccountId" | "authorDisplayName">>;

/** Save on the device first (throws if the device refuses), then queue for sync. `workspaceId` picks the space (Personal when absent). */
export function saveScoutEntry(e: NewEntry): ScoutEntry {
  const entry = normalizeScoutEntry({ ...e, updatedAt: Date.now() }, e.workspaceId ?? null);
  try {
    writeEntry(entry);
    const d = dirty(entry.workspaceId); d.add(entry.uuid); setDirty(d, entry.workspaceId);
  } catch {
    throw new ScoutStorageError("This device couldn't save the entry (storage full or blocked). Nothing was lost from earlier entries.");
  }
  window.dispatchEvent(new Event(EVT));
  return entry;
}

export function deleteScoutEntry(e: ScoutEntry) { saveScoutEntry({ ...e, deleted: true, data: {}, notes: "" }); }

/** Entries waiting to sync, per space. */
export function pendingScoutCounts(): { personal: number; workspaces: Record<string, number> } {
  return { personal: dirty(null).size, workspaces: Object.fromEntries(localSpaces().map((w) => [w, dirty(w).size]).filter(([, n]) => n)) };
}

interface SpaceExport { entries: ScoutEntry[]; dirty: string[]; cursor?: number }
/** Everything scouting-related on this device, including what hasn't synced yet. `spaces`: the workspaces' cached entries and queues. */
export function exportLocalScouting(): SpaceExport & { spaces?: Record<string, SpaceExport> } {
  return {
    entries: localScoutEntries(), dirty: [...dirty()],
    spaces: Object.fromEntries(localSpaces().map((w) => [w, { entries: localScoutEntries(w), dirty: [...dirty(w)], cursor: readCursor(w) }])),
  };
}

/** Put back a previously exported set (an account's stashed copy). */
export function importLocalScouting(data: SpaceExport & { spaces?: Record<string, SpaceExport> }) {
  const put = (space: ScoutSpace, s: SpaceExport) => {
    let complete = true;
    for (const e of s.entries ?? []) { try { writeEntry(normalizeScoutEntry(e, space)); } catch { complete = false; /* storage full */ } }
    try { const d = dirty(space); for (const u of s.dirty ?? []) d.add(u); setDirty(d, space); } catch { /* storage full */ }
    // The cursor only holds if every entry it covers is back; otherwise the next pull starts over.
    if (space != null) { if (complete && s.cursor) writeCursor(space, s.cursor); else try { localStorage.removeItem(`${WS_CURSOR}${space}`); } catch { /* blocked */ } }
  };
  put(null, data);
  for (const [w, s] of Object.entries(data.spaces ?? {})) if (/^[A-Za-z0-9_-]{1,64}$/.test(w)) put(w, s);
  window.dispatchEvent(new Event(EVT));
}

/** Remove every space's entries, queues and cursors from this device. */
export function clearLocalScouting() {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("cs-scout:") || k.startsWith(WS) || k.startsWith(WS_DIRTY) || k.startsWith(WS_CURSOR))) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
    localStorage.removeItem(DIRTY);
  } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVT));
}

function readCursor(space: string): number { try { return Number(localStorage.getItem(`${WS_CURSOR}${space}`)) || 0; } catch { return 0; } }
function writeCursor(space: string, c: number) { try { localStorage.setItem(`${WS_CURSOR}${space}`, String(c)); } catch { /* storage full: pull again from the old cursor */ } }

/**
 * Push a space's queued entries (≤200 per request); keep any entry edited
 * again meanwhile. A workspace answers with its stored copy of each entry
 * (with the authorship it stamped, or a newer edit from someone else), which
 * replaces the device's copy unless that changed meanwhile.
 */
export async function syncScouting(space: ScoutSpace = null): Promise<{ sent: number }> {
  const d = dirty(space);
  if (!d.size) return { sent: 0 };
  const queued = [...d].map((u) => readEntry(space, u)).filter((x): x is ScoutEntry => !!x);
  let sent = 0;
  for (let i = 0; i < queued.length; i += 200) {
    const batch = queued.slice(i, i + 200);
    const r = await apiFetch<{ results: { uuid: string; ok: boolean; entry?: ScoutEntry }[] }>("/api/me/scout/sync", {
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
        if (res.entry) { try { writeEntry(normalizeScoutEntry(res.entry, space)); } catch { saved = false; } }
        if (saved) now.delete(res.uuid);
      }
      if (!res.ok) now.delete(res.uuid); // rejected for good (invalid): don't retry forever
    }
    setDirty(now, space);
    sent += batch.length;
  }
  window.dispatchEvent(new Event(EVT));
  return { sent };
}

/** Newer wins; an equal stamp from the server wins unless this device has that entry queued. */
function mergeFromServer(space: ScoutSpace, list: ScoutEntry[]) {
  const d = dirty(space);
  for (const raw of list) {
    const e = normalizeScoutEntry(raw, space);
    const cur = readEntry(space, e.uuid);
    if (!cur || e.updatedAt > cur.updatedAt || (space != null && e.updatedAt === cur.updatedAt && !d.has(e.uuid))) writeEntry(e);
  }
}

/** Pull a space's entries from the account (Personal) or the workspace (changes since the last pull); local unsynced edits are kept if newer. */
export async function pullScouting(space: ScoutSpace = null): Promise<void> {
  if (space == null) {
    const r = await apiFetch<{ entries: ScoutEntry[] }>("/api/me/scout");
    mergeFromServer(null, r.entries);
  } else {
    for (let page = 0; page < 100; page++) {
      const since = readCursor(space);
      const r = await apiFetch<{ entries: ScoutEntry[]; cursor: number; more: boolean }>(`/api/scout/sync?workspaceId=${encodeURIComponent(space)}&since=${since}`);
      mergeFromServer(space, r.entries);
      writeCursor(space, r.cursor);
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
  const run = useCallback(async () => {
    if (!signedIn) { setStatus("local"); return; }
    setStatus("syncing");
    try { await syncScouting(space); await pullScouting(space); setStatus("idle"); }
    catch (e: any) { setStatus(e?.offline ? "offline" : "error"); }
  }, [signedIn, space]);
  useEffect(() => {
    const refresh = () => setEntries(read());
    refresh();
    window.addEventListener(EVT, refresh);
    window.addEventListener("storage", refresh);
    const online = () => run();
    window.addEventListener("online", online);
    const t = setInterval(() => { if (dirty(space).size) run(); }, 30_000);
    run();
    return () => { window.removeEventListener(EVT, refresh); window.removeEventListener("storage", refresh); window.removeEventListener("online", online); clearInterval(t); };
  }, [read, run, space]);
  return { entries, status, pendingCount: dirty(space).size, syncNow: run };
}
