// Manual scouting: the user's own observations on top of public data.
// Offline-first (Control Point's pattern): every entry is saved on the device
// first, queued, and synced to the account when signed in and online. A newer
// edit always wins; deletes are tombstones so they sync too.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";

export type ScoutValue = number | boolean | string;
export type FieldType = "counter" | "toggle" | "choice" | "rating" | "text";
export interface ScoutField { id: string; label: string; type: FieldType; phase: "auto" | "teleop" | "endgame" | "overall" | "pit"; options?: string[]; max?: number }
export interface ScoutTemplate { id: string; kind: "match" | "pit"; name: string; fields: ScoutField[] }

export interface ScoutEntry {
  uuid: string;
  season: number;
  team: number;
  eventCode: string | null;
  matchLabel: string | null;
  kind: "match" | "pit";
  data: Record<string, ScoutValue>;
  notes: string;
  updatedAt: number;
  deleted?: boolean;
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

const KEY = (uuid: string) => `cs-scout:${uuid}`;
const DIRTY = "cs-scout-dirty";
const EVT = "cs-scout-changed";

export function newScoutId(): string {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function dirty(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(DIRTY) ?? "[]")); } catch { return new Set(); } }
function setDirty(d: Set<string>) { localStorage.setItem(DIRTY, JSON.stringify([...d])); }

/** Every entry saved on this device (tombstones included). */
export function localScoutEntries(): ScoutEntry[] {
  const out: ScoutEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("cs-scout:")) continue;
      try { out.push(JSON.parse(localStorage.getItem(k)!)); } catch { /* skip corrupt */ }
    }
  } catch { /* storage blocked */ }
  return out;
}

export class ScoutStorageError extends Error {}

/** Save on the device first (throws if the device refuses), then queue for sync. */
export function saveScoutEntry(e: Omit<ScoutEntry, "updatedAt"> & { updatedAt?: number }): ScoutEntry {
  const entry: ScoutEntry = { ...e, updatedAt: Date.now() };
  try {
    localStorage.setItem(KEY(entry.uuid), JSON.stringify(entry));
    const d = dirty(); d.add(entry.uuid); setDirty(d);
  } catch {
    throw new ScoutStorageError("This device couldn't save the entry (storage full or blocked). Nothing was lost from earlier entries.");
  }
  window.dispatchEvent(new Event(EVT));
  return entry;
}

export function deleteScoutEntry(e: ScoutEntry) { saveScoutEntry({ ...e, deleted: true, data: {}, notes: "" }); }

/** Everything scouting-related on this device, including what hasn't synced yet. */
export function exportLocalScouting(): { entries: ScoutEntry[]; dirty: string[] } {
  return { entries: localScoutEntries(), dirty: [...dirty()] };
}

/** Put back a previously exported set (an account's stashed copy). */
export function importLocalScouting(data: { entries: ScoutEntry[]; dirty: string[] }) {
  for (const e of data.entries ?? []) { try { localStorage.setItem(KEY(e.uuid), JSON.stringify(e)); } catch { /* storage full */ } }
  const d = dirty(); for (const u of data.dirty ?? []) d.add(u); setDirty(d);
  window.dispatchEvent(new Event(EVT));
}

export function clearLocalScouting() {
  for (const e of localScoutEntries()) localStorage.removeItem(KEY(e.uuid));
  localStorage.removeItem(DIRTY);
  window.dispatchEvent(new Event(EVT));
}

/** Push queued entries (≤200 per request); keep any entry edited again meanwhile. */
export async function syncScouting(): Promise<{ sent: number }> {
  const d = dirty();
  if (!d.size) return { sent: 0 };
  const queued = [...d].map((u) => { try { return JSON.parse(localStorage.getItem(KEY(u))!) as ScoutEntry; } catch { return null; } }).filter((x): x is ScoutEntry => !!x);
  let sent = 0;
  for (let i = 0; i < queued.length; i += 200) {
    const batch = queued.slice(i, i + 200);
    const r = await apiFetch<{ results: { uuid: string; ok: boolean }[] }>("/api/me/scout/sync", { method: "POST", json: { entries: batch } });
    const now = dirty();
    for (const res of r.results) {
      const sentVersion = batch.find((b) => b.uuid === res.uuid);
      const current = (() => { try { return JSON.parse(localStorage.getItem(KEY(res.uuid))!) as ScoutEntry; } catch { return null; } })();
      if (res.ok && current && sentVersion && current.updatedAt === sentVersion.updatedAt) now.delete(res.uuid);
      if (!res.ok) now.delete(res.uuid); // rejected for good (invalid): don't retry forever
    }
    setDirty(now);
    sent += batch.length;
  }
  return { sent };
}

/** Pull the account's entries; newer wins (local unsynced edits are kept if newer). */
export async function pullScouting(): Promise<void> {
  const r = await apiFetch<{ entries: ScoutEntry[] }>("/api/me/scout");
  for (const e of r.entries) {
    const cur = (() => { try { return JSON.parse(localStorage.getItem(KEY(e.uuid)) ?? "null") as ScoutEntry | null; } catch { return null; } })();
    if (!cur || e.updatedAt > cur.updatedAt) localStorage.setItem(KEY(e.uuid), JSON.stringify(e));
  }
  window.dispatchEvent(new Event(EVT));
}

export type ScoutSync = "local" | "idle" | "syncing" | "offline" | "error";

/** Live list of entries (filtered), plus sync when signed in. */
export function useScouting(filter: { season?: number; team?: number }, signedIn: boolean) {
  const read = useCallback(() => localScoutEntries()
    .filter((e) => !e.deleted && (filter.season == null || e.season === filter.season) && (filter.team == null || e.team === filter.team))
    .sort((a, b) => b.updatedAt - a.updatedAt), [filter.season, filter.team]);
  const [entries, setEntries] = useState<ScoutEntry[]>(read);
  const [status, setStatus] = useState<ScoutSync>(signedIn ? "idle" : "local");
  const run = useCallback(async () => {
    if (!signedIn) { setStatus("local"); return; }
    setStatus("syncing");
    try { await syncScouting(); await pullScouting(); setStatus("idle"); }
    catch (e: any) { setStatus(e?.offline ? "offline" : "error"); }
  }, [signedIn]);
  useEffect(() => {
    const refresh = () => setEntries(read());
    refresh();
    window.addEventListener(EVT, refresh);
    window.addEventListener("storage", refresh);
    const online = () => run();
    window.addEventListener("online", online);
    const t = setInterval(() => { if (dirty().size) run(); }, 30_000);
    run();
    return () => { window.removeEventListener(EVT, refresh); window.removeEventListener("storage", refresh); window.removeEventListener("online", online); clearInterval(t); };
  }, [read, run]);
  return { entries, status, pendingCount: dirty().size, syncNow: run };
}
