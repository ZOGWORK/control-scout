// Importing a scouting export (Settings → Scouting data → Import JSON). Audit PRIVATE-F02: every row is checked
// with the one validator (src/shared/scoutEntry.ts) before anything is stored; a row that fails is left out with
// its reason, and the message counts only the rows actually saved.
//
// Audit E3: nothing is written until the scout has seen a preview (previewScoutImport, shown by
// ImportPreviewDialog): which rows are new, which are already on this device (and whether the file's copy is
// newer or older than the one here), which are invalid and why. An import only ever merges into Personal:
// entries that aren't in the file stay as they are, and workspace entries are never touched.
import { isEntryTimestamp, problemSummary, validateScoutEntry, type CheckedScoutEntry, type EntryProblem } from "../shared/scoutEntry";
import { localScoutEntries, saveScoutEntry, ScoutStorageError, storedScoutEntry, type ScoutEntry } from "./scouting";

export interface ScoutImportResult {
  /** Rows saved to Personal on this device (new and updated). */
  imported: number;
  /** Why each row left out was refused (one per row). */
  problems: EntryProblem[];
  /** Valid rows the device couldn't store (storage full). */
  notStored: number;
  /** Of `imported`: entries that replaced a copy already here. */
  updated?: number;
  /** Rows already on this device whose copy here was kept (newer, the same, or the file's had no date). */
  kept?: number;
  /** Rows the file marks deleted: never imported. */
  deletedInFile?: number;
  /** Rows whose id an earlier row of the file already had: left out. */
  repeated?: number;
}

export const IMPORT_FORMAT = "control-scout-scouting";

/** The rows of an export file (our format, or a bare list of entries); null when the file isn't one. */
export function importRows(text: string): unknown[] | null {
  let d: unknown;
  try { d = JSON.parse(text); } catch { return null; }
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object" && Array.isArray((d as { entries?: unknown }).entries)) {
    const f = (d as { format?: unknown }).format;
    return f === undefined || f === IMPORT_FORMAT ? (d as { entries: unknown[] }).entries : null;
  }
  return null;
}

// --- Preview ---------------------------------------------------------------------------------------

/** How the file's copy of an entry compares with the one on this device. */
export type DuplicateAge = "newer" | "older" | "same" | "undated";

/** What to do with entries already on this device: keep whichever copy is newer, or take the file's. */
export type DuplicatePolicy = "newer" | "file";

interface RowRef {
  /** 1-based position in the file's list of entries. */
  row: number;
  /** "team 101 · Q1": enough for a person to find the row. */
  label: string;
}
export interface InvalidRow extends RowRef { reason: string; problem?: EntryProblem }
export interface NewRow extends RowRef { entry: CheckedScoutEntry }
export interface DuplicateRow extends RowRef {
  entry: CheckedScoutEntry;
  age: DuplicateAge;
  /** The copy here is a deleted entry (importing brings it back). */
  deletedHere: boolean;
}
export interface ImportPreview {
  /** Rows in the file. */
  total: number;
  fresh: NewRow[];
  duplicates: DuplicateRow[];
  invalid: InvalidRow[];
  /** Rows the file marks deleted: skipped (an import never deletes). */
  deletedInFile: RowRef[];
  /** Entries on this device (Personal, not deleted) the file doesn't mention: they stay as they are. */
  untouched: number;
}

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");

/** "team 101 · Q1", "team 101 · pit", or the id when the row has nothing better. */
function rowLabel(x: unknown): string {
  if (!x || typeof x !== "object" || Array.isArray(x)) return "not an entry";
  const r = x as Record<string, unknown>;
  const team = str(r.team), match = str(r.matchLabel);
  const parts = [team ? `team ${team.slice(0, 12)}` : "", r.kind === "pit" ? "pit" : match.slice(0, 24)].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  const id = str(r.uuid);
  return id ? `id ${id.slice(0, 16)}` : "no team";
}

const sameText = (a: CheckedScoutEntry, b: ScoutEntry) =>
  a.team === b.team && a.season === b.season && a.kind === b.kind && (a.eventCode ?? null) === (b.eventCode ?? null)
  && (a.matchLabel ?? null) === (b.matchLabel ?? null) && a.notes === (b.notes ?? "") && !b.deleted
  && JSON.stringify(Object.entries(a.data).sort(([x], [y]) => x.localeCompare(y))) === JSON.stringify(Object.entries(b.data ?? {}).sort(([x], [y]) => x.localeCompare(y)));

/**
 * Sort every row of a file into new, already here, invalid and deleted, against Personal on this device. Reads only:
 * nothing is stored. A row's own timestamp isn't needed to import it (an imported row is stamped now, as imports always
 * were), but it says whether the file's copy is newer or older than the one here.
 */
export function previewScoutImport(rows: unknown[], now = Date.now()): ImportPreview {
  const here = new Map(localScoutEntries(null).map((e) => [e.uuid, e]));
  const seen = new Map<string, number>();
  const out: ImportPreview = { total: rows.length, fresh: [], duplicates: [], invalid: [], deletedInFile: [], untouched: 0 };
  rows.forEach((raw, i) => {
    const ref = { row: i + 1, label: rowLabel(raw) };
    const c = validateScoutEntry(raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw, updatedAt: now } : raw, now);
    if (!c.ok) { out.invalid.push({ ...ref, reason: c.problem, problem: c.problem }); return; }
    const e = c.entry;
    const first = seen.get(e.uuid);
    if (first != null) { out.invalid.push({ ...ref, reason: `same id as row ${first}` }); return; }
    seen.set(e.uuid, ref.row);
    if (e.deleted) { out.deletedInFile.push(ref); return; }
    const filed = (raw as Record<string, unknown>).updatedAt;
    const entry = { ...e, updatedAt: isEntryTimestamp(filed, now) ? filed : 0 };
    const cur = here.get(e.uuid);
    if (!cur) { out.fresh.push({ ...ref, entry }); return; }
    const age: DuplicateAge = sameText(e, cur) ? "same" : !entry.updatedAt ? "undated" : entry.updatedAt > cur.updatedAt ? "newer" : "older";
    out.duplicates.push({ ...ref, entry, age, deletedHere: !!cur.deleted });
  });
  for (const e of here.values()) if (!e.deleted && !seen.has(e.uuid)) out.untouched++;
  return out;
}

/** Does this row replace the copy on this device, under this policy? An identical copy is never rewritten. */
export const replaces = (d: DuplicateRow, policy: DuplicatePolicy) => d.age !== "same" && (policy === "file" || d.age === "newer");

/** What Import will do: add, update, skip (each row once). */
export function importPlan(p: ImportPreview, policy: DuplicatePolicy) {
  const update = p.duplicates.filter((d) => replaces(d, policy)).length;
  const keep = p.duplicates.length - update;
  return { add: p.fresh.length, update, keep, skip: keep + p.invalid.length + p.deletedInFile.length };
}

/**
 * Save what the preview accepts to Personal: new rows, and the rows already here that the policy replaces. Each
 * saved row is a fresh save on this device (stamped now, queued for sync), as imports always were.
 */
export function applyScoutImport(p: ImportPreview, policy: DuplicatePolicy): ScoutImportResult {
  let imported = 0, updated = 0, notStored = 0;
  const save = (e: CheckedScoutEntry) => {
    const { updatedAt: _u, baseUpdatedAt: _b, restoredFrom: _r, ...rest } = e;
    try { saveScoutEntry({ ...rest, workspaceId: null }); imported++; return true; } // imports go to Personal
    catch (err) { if (err instanceof ScoutStorageError) { notStored++; return false; } throw err; }
  };
  for (const r of p.fresh) save(r.entry);
  for (const d of p.duplicates) if (replaces(d, policy) && save(d.entry)) updated++;
  return {
    imported, updated, notStored, problems: p.invalid.flatMap((r) => (r.problem ? [r.problem] : [])),
    repeated: p.invalid.filter((r) => !r.problem).length, kept: importPlan(p, policy).keep, deletedInFile: p.deletedInFile.length,
  };
}

/** Check every row, then save the valid ones to Personal (no preview: keeps the newer copy of entries already here). */
export function importScoutRows(rows: unknown[], now = Date.now(), policy: DuplicatePolicy = "newer"): ScoutImportResult {
  return applyScoutImport(previewScoutImport(rows, now), policy);
}

const entries = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

/**
 * What to tell the scout: the count saved, and how many rows were left out and why. Never "Imported N" for rows
 * that weren't, and never a plain success when any row was refused.
 */
export function importMessage(r: ScoutImportResult): { tone: "success" | "warning" | "error"; text: string } {
  const skipped = r.problems.length;
  const why = skipped ? ` Skipped ${entries(skipped)} that ${skipped === 1 ? "wasn't" : "weren't"} valid: ${problemSummary(r.problems)}.` : "";
  const full = r.notStored ? ` ${entries(r.notStored)} didn't fit on this device (storage full).` : "";
  const kept = r.kept ? ` Kept ${r.kept === 1 ? "the copy" : "the copies"} of ${entries(r.kept)} already here.` : "";
  const gone = r.deletedInFile ? ` Left out ${entries(r.deletedInFile)} marked deleted in the file.` : "";
  const twice = r.repeated ? ` Left out ${entries(r.repeated)} repeated in the file.` : "";
  const rest = `${why}${full}${twice}${kept}${gone}`;
  // Anything refused or not stored: never a plain success.
  const partial = skipped || r.notStored || r.repeated;
  if (!r.imported) {
    if (!partial && !r.kept && !r.deletedInFile) return { tone: "error", text: "That file has no scouting entries to import." };
    if (!partial) return { tone: "success", text: `Nothing new to import.${rest}` };
    return { tone: "error", text: `Nothing imported.${rest}` };
  }
  const split = r.updated ? ` (${r.imported - r.updated} new, ${r.updated} updated)` : "";
  return { tone: partial ? "warning" : "success", text: `Imported ${entries(r.imported)}${split}.${rest}` };
}

// --- Export and backup -----------------------------------------------------------------------------

/** The Personal entries on this device as an export file (the format Import reads). */
export function scoutExportJson(now = new Date()): string {
  const data = localScoutEntries().filter((e) => !e.deleted).map(storedScoutEntry); // the personal set, in its original shape
  return JSON.stringify({ format: IMPORT_FORMAT, version: 1, exportedAt: now.toISOString(), entries: data }, null, 2);
}

/** Save text as a .json download. */
export function downloadJson(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A backup of Personal on this device, named with the date, before an import changes it. */
export function downloadScoutBackup(now = new Date()) {
  downloadJson(`control-scout-scouting-backup-${now.toISOString().slice(0, 10)}.json`, scoutExportJson(now));
}
