// Importing a scouting export (Settings → Scouting data → Import JSON). Audit PRIVATE-F02: every row is checked
// with the one validator (src/shared/scoutEntry.ts) before anything is stored; a row that fails is left out with
// its reason, and the message counts only the rows actually saved.
import { problemSummary, validateScoutEntry, type EntryProblem } from "../shared/scoutEntry";
import { saveScoutEntry, ScoutStorageError } from "./scouting";

export interface ScoutImportResult {
  /** Rows saved to Personal on this device. */
  imported: number;
  /** Why each row left out was refused (one per row). */
  problems: EntryProblem[];
  /** Valid rows the device couldn't store (storage full). */
  notStored: number;
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

/**
 * Check every row, then save the valid ones to Personal. The file's timestamps aren't kept: an imported row is a fresh save on this device, stamped now, as imports
 * always were; so a row is judged on what it says, not on the clock of the device that exported it.
 */
export function importScoutRows(rows: unknown[], now = Date.now()): ScoutImportResult {
  const problems: EntryProblem[] = [];
  let imported = 0, notStored = 0;
  for (const row of rows) {
    const c = validateScoutEntry(row && typeof row === "object" && !Array.isArray(row) ? { ...row, updatedAt: now } : row, now);
    if (!c.ok) { problems.push(c.problem); continue; }
    const { updatedAt: _u, baseUpdatedAt: _b, restoredFrom: _r, ...e } = c.entry;
    try { saveScoutEntry({ ...e, workspaceId: null }); imported++; } // imports go to Personal
    catch (err) { if (err instanceof ScoutStorageError) notStored++; else throw err; }
  }
  return { imported, problems, notStored };
}

const entries = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

/** What to tell the scout: the count saved, and how many rows were left out and why. Never "Imported N" for rows that weren't. */
export function importMessage(r: ScoutImportResult): { tone: "success" | "warning" | "error"; text: string } {
  const skipped = r.problems.length;
  const why = skipped ? ` Skipped ${entries(skipped)} that ${skipped === 1 ? "wasn't" : "weren't"} valid: ${problemSummary(r.problems)}.` : "";
  const full = r.notStored ? ` ${entries(r.notStored)} didn't fit on this device (storage full).` : "";
  if (!r.imported) {
    if (!skipped && !r.notStored) return { tone: "error", text: "That file has no scouting entries to import." };
    return { tone: "error", text: `Nothing imported.${why}${full}` };
  }
  return { tone: skipped || r.notStored ? "warning" : "success", text: `Imported ${entries(r.imported)}.${why}${full}` };
}
