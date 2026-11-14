// Which event-day bundles are on this device (the list lives in localStorage, the bytes in IndexedDB: see
// bundles.ts). Tiny on purpose, like saved.ts: api.ts imports it to know whether a bundle could answer a read
// with no signal; everything heavier loads lazily.
import { useSyncExternalStore } from "react";
import { bundleTime, packPath, type SavedBundle } from "../../shared/eventBundle";

const KEY = "cs-event-bundles";
/** Fired on window when a bundle is saved, updated or removed. */
export const BUNDLES_EVENT = "cs-event-bundles-changed";

/** Whose data this device holds (lib/personal.tsx's owner: the account signed in here, kept offline). */
const OWNER_KEY = "cs-personal-owner";
const owner = () => { try { return localStorage.getItem(OWNER_KEY) ?? ""; } catch { return ""; } };

/** A bundle this device's account may read: a public one, or a workspace one it downloaded itself. A workspace
 *  bundle holds that member's pick list and scouting, so another account on the same device never sees it. */
export const bundleVisible = (b: SavedBundle, who = owner()): boolean => !b.workspace || (b.accountId != null && String(b.accountId) === who);

let raw: string | null | undefined;
let rawOwner: string | undefined;
let all: SavedBundle[] = [];
let parsed: SavedBundle[] = [];
/** Every bundle on the device, whoever's (only for writing the list and removing other accounts' bundles). */
export function allBundles(): SavedBundle[] {
  savedBundles();
  return all;
}
/** Saved bundles this device's account may read, soonest event first (the same array until the list changes). */
export function savedBundles(): SavedBundle[] {
  let r: string | null = null;
  try { r = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  const who = owner();
  if (r !== raw || who !== rawOwner) {
    raw = r;
    rawOwner = who;
    try { all = (JSON.parse(r ?? "[]") as SavedBundle[]).sort((a, b) => (a.end ?? "").localeCompare(b.end ?? "") || a.code.localeCompare(b.code)); } catch { all = []; }
    parsed = all.filter((b) => bundleVisible(b, who));
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

/** The packPath()s each saved bundle's event pack answers, by bundle (rebuilt when the list changes). */
let pathSets: { list: SavedBundle[]; sets: Map<SavedBundle, Set<string>> } | null = null;
function pathSet(b: SavedBundle): Set<string> {
  const list = savedBundles();
  if (pathSets?.list !== list) pathSets = { list, sets: new Map() };
  let s = pathSets.sets.get(b);
  if (!s) { s = new Set(b.apiPaths ?? []); pathSets.sets.set(b, s); }
  return s;
}

/** The saved bundles whose event pack holds this API path, newest data first (none: []). */
export function bundlesWith(path: string): SavedBundle[] {
  const key = packPath(path);
  if (key == null) return [];
  return savedBundles().filter((b) => b.apiPaths?.length && pathSet(b).has(key)).sort((a, b) => bundleTime(b).localeCompare(bundleTime(a)));
}

const COMPARE_PATH = /^\/api\/compare(\?|$)/;
/** A comparison the saved packs hold: every team asked for is in a saved bundle's event (with the season asked for). */
export function bundlesCompare(path: string): boolean {
  if (!COMPARE_PATH.test(path)) return false;
  const url = new URL(path, "http://offline.invalid");
  const teams = (url.searchParams.get("teams") ?? "").split(",").filter(Boolean).map(Number);
  const season = Number(url.searchParams.get("season")) || null;
  const packs = savedBundles().filter((b) => b.apiPaths?.length && (season == null || b.season === season));
  // A pack also holds its teams for another season they last played (its Compare `others`): their season matches
  // for it are in its paths.
  return teams.length > 0 && teams.every((t) => packs.some((b) => b.teams?.includes(t)) || (season != null && bundlesWith(`/api/teams/${t}/matches?season=${season}`).length > 0));
}

/** A comparison while some event pack is saved: even one with a team no pack holds goes to the saved data with no
 *  signal, which says which team is missing (it doesn't get the offline timeout: only bundleCanAnswer reads do). */
export const comparePacksSaved = (path: string): boolean => COMPARE_PATH.test(path) && savedBundles().some((b) => b.apiPaths?.length);

/** A saved event pack can answer this read with no signal (lib/api.ts gives it the offline timeout). */
export const bundleCanAnswer = (path: string): boolean => bundlesWith(path).length > 0 || bundlesCompare(path);

function subscribe(fn: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === OWNER_KEY) fn(); }; // another tab saved or removed one, or another account signed in
  window.addEventListener(BUNDLES_EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(BUNDLES_EVENT, fn); window.removeEventListener("storage", onStorage); };
}

export function useSavedBundles(): SavedBundle[] {
  return useSyncExternalStore(subscribe, savedBundles, () => parsed);
}
