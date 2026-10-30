// Which event-day bundles are on this device (the list lives in localStorage, the bytes in IndexedDB: see
// bundles.ts). Tiny on purpose, like saved.ts: api.ts imports it to know whether a bundle could answer a read
// with no signal; everything heavier loads lazily.
import { useSyncExternalStore } from "react";
import type { SavedBundle } from "../../shared/eventBundle";

const KEY = "cs-event-bundles";
/** Fired on window when a bundle is saved, updated or removed. */
export const BUNDLES_EVENT = "cs-event-bundles-changed";

let raw: string | null | undefined;
let parsed: SavedBundle[] = [];
/** Saved bundles, soonest event first (the same array until the list changes). */
export function savedBundles(): SavedBundle[] {
  let r: string | null = null;
  try { r = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (r !== raw) {
    raw = r;
    try { parsed = (JSON.parse(r ?? "[]") as SavedBundle[]).sort((a, b) => (a.end ?? "").localeCompare(b.end ?? "") || a.code.localeCompare(b.code)); } catch { parsed = []; }
  }
  return parsed;
}

export function writeBundles(list: SavedBundle[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(BUNDLES_EVENT));
}

/** The bundle saved for this event, if any. */
export function bundleFor(season: number, code: string): SavedBundle | null {
  const c = code.toUpperCase();
  return savedBundles().find((b) => b.season === season && b.code.toUpperCase() === c) ?? null;
}

function subscribe(fn: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) fn(); }; // another tab saved or removed one
  window.addEventListener(BUNDLES_EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(BUNDLES_EVENT, fn); window.removeEventListener("storage", onStorage); };
}

export function useSavedBundles(): SavedBundle[] {
  return useSyncExternalStore(subscribe, savedBundles, () => parsed);
}
