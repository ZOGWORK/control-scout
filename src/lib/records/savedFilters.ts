// Saved filters: named filters kept on this device (localStorage, no account
// needed). One list for team tables (team-event and team-season records share
// it) and one for match tables. Pure functions over a Storage, unit tested.
import { parseFilter } from "../../shared/filterDsl";
import type { RecordScope } from "../../shared/statCatalog";

export type SavedKind = "team" | "match";
export interface SavedFilter { id: string; name: string; kind: SavedKind; /** The filter in URL form. */ filter: string; savedAt: number }

export const SAVED_KEY = "cs-saved-filters:v1";
export const SAVED_MAX = 50;
export const kindOf = (scope: RecordScope): SavedKind => (scope === "match" ? "match" : "team");

type Store = Pick<Storage, "getItem" | "setItem">;
const ls = (): Store | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

const valid = (x: any): x is SavedFilter => x && typeof x.id === "string" && typeof x.name === "string" && (x.kind === "team" || x.kind === "match") && typeof x.filter === "string";

export function loadSaved(store: Store | null = ls()): SavedFilter[] {
  try {
    const raw = store?.getItem(SAVED_KEY);
    const xs = raw ? JSON.parse(raw) : [];
    return Array.isArray(xs) ? xs.filter(valid) : [];
  } catch { return []; }
}

function write(list: SavedFilter[], store: Store | null): void {
  try { store?.setItem(SAVED_KEY, JSON.stringify(list.slice(0, SAVED_MAX))); } catch { /* storage full or blocked */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SAVED_KEY));
}

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 60);

/** Save (or overwrite one with the same name and kind). Throws on an empty name or a filter that doesn't parse. */
export function saveFilter(name: string, kind: SavedKind, filter: string, store: Store | null = ls(), now = Date.now()): SavedFilter {
  const n = cleanName(name);
  if (!n) throw new Error("Give the filter a name");
  parseFilter(filter);
  const list = loadSaved(store);
  const same = list.find((s) => s.kind === kind && s.name.toLowerCase() === n.toLowerCase());
  const entry: SavedFilter = { id: same?.id ?? `f${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: n, kind, filter, savedAt: now };
  write([entry, ...list.filter((s) => s.id !== entry.id)], store);
  return entry;
}

export function renameSaved(id: string, name: string, store: Store | null = ls()): void {
  const n = cleanName(name);
  if (!n) throw new Error("Give the filter a name");
  write(loadSaved(store).map((s) => (s.id === id ? { ...s, name: n } : s)), store);
}

export function deleteSaved(id: string, store: Store | null = ls()): void {
  write(loadSaved(store).filter((s) => s.id !== id), store);
}
