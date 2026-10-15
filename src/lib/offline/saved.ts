// Which full seasons are saved on this device (the list lives in localStorage,
// the bytes in IndexedDB — see seasons.ts), and the mark an API answer carries
// when it came from them instead of the server. Tiny on purpose: api.ts
// imports it, so it ships in the main bundle; everything heavier loads lazily.
import { useSyncExternalStore } from "react";

export interface SavedSeason {
  season: number;
  /** Pack release it came from (manifest version) and the file's SHA-256. */
  version: string;
  sha256: string;
  bytes: number;
  savedAt: number;
  /** When the server last synced before the pack was built: the data is "as of" this. */
  dataAsOf: string | null;
  builtAt: string;
}

const KEY = "cs-offline-seasons";
/** Fired on window when a season is saved or removed. */
export const SEASONS_EVENT = "cs-offline-seasons-changed";

let raw: string | null | undefined;
let parsed: SavedSeason[] = [];
/** Saved seasons, newest first (the same array until the list changes). */
export function savedSeasons(): SavedSeason[] {
  let r: string | null = null;
  try { r = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (r !== raw) {
    raw = r;
    try { parsed = (JSON.parse(r ?? "[]") as SavedSeason[]).sort((a, b) => b.season - a.season); } catch { parsed = []; }
  }
  return parsed;
}

export function writeSaved(list: SavedSeason[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(SEASONS_EVENT));
}

function subscribe(fn: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) fn(); }; // another tab saved or removed one
  window.addEventListener(SEASONS_EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(SEASONS_EVENT, fn); window.removeEventListener("storage", onStorage); };
}

export function useSavedSeasons(): SavedSeason[] {
  return useSyncExternalStore(subscribe, savedSeasons, () => parsed);
}

/** Where an offline answer came from, for the "Offline: from your saved …" note. */
export interface OfflineSource { season: number; savedAt: number; dataAsOf: string | null }

// A symbol, non-enumerable: invisible to JSON, spreads and equality checks, so
// the answer keeps exactly the API's shape.
const MARK = Symbol.for("control-scout.offline");

export function markOffline<T extends object>(data: T, src: OfflineSource): T {
  Object.defineProperty(data, MARK, { value: src, enumerable: false });
  return data;
}

export function offlineSource(data: unknown): OfflineSource | null {
  return data && typeof data === "object" ? ((data as Record<symbol, OfflineSource>)[MARK] ?? null) : null;
}
