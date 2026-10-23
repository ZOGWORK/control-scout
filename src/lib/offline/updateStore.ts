// The saved seasons' update, for the app: what the background check (updateWatcher.tsx) last found, which
// release the person already saw the pop-up for or answered "Later" to, and the Update now action. The inbox
// bell and the Download page read it. Small on purpose (the bell is in the entry bundle): saving loads lazily.
import { useSyncExternalStore } from "react";
import type { PackManifest } from "../packs";
import { SEASONS_EVENT, savedSeasons } from "./saved";
import { planSeasons, type SeasonRow } from "./seasonPlan";
import { releaseKey, seasonList, type SeasonUpdate, type UpdateAction } from "./updatePolicy";
import { toast } from "../../components/ui/sonner";

/** localStorage: the release the pop-up last showed for, and the one answered "Later". */
export const SHOWN_KEY = "cs-offline-update-shown";
export const LATER_KEY = "cs-offline-update-later";
/** Fired on window when either changes. */
const EVENT = "cs-offline-update-changed";

export interface UpdateSnapshot {
  manifest: PackManifest | null;
  /** Saved seasons with a newer release in that manifest. */
  rows: SeasonRow[];
  /** The same, as the policy and the question see them. */
  updates: SeasonUpdate[];
  key: string | null;
  /** What the policy decided last (none until a check ran). */
  action: UpdateAction;
  later: string | null;
}

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: asks again next time */ } window.dispatchEvent(new Event(EVENT)); };

export const shownRelease = () => read(SHOWN_KEY);
export const laterRelease = () => read(LATER_KEY);
export const markShown = (key: string) => write(SHOWN_KEY, key);
export const markLater = (key: string) => write(LATER_KEY, key);

let manifest: PackManifest | null = null;
let action: UpdateAction = "none";
let snap: UpdateSnapshot = { manifest: null, rows: [], updates: [], key: null, action: "none", later: null };
const subs = new Set<() => void>();

/** Bring the snapshot up to date with the manifest, the saved list and Later (the same object when nothing changed). */
function compute(): boolean {
  const rows = manifest ? planSeasons(manifest.full, savedSeasons()).toUpdate : [];
  const updates = rows.map((r): SeasonUpdate => ({ season: r.season, sha256: r.file.sha256, bytes: r.file.bytes }));
  const key = releaseKey(updates);
  const later = laterRelease();
  if (snap.manifest === manifest && snap.key === key && snap.action === action && snap.later === later) return false;
  snap = { manifest, rows, updates, key, action, later };
  return true;
}
function rebuild() { if (compute()) for (const f of subs) f(); }

/** The check found this manifest (and the policy this action). */
export function setUpdate(m: PackManifest | null, a: UpdateAction) { manifest = m; action = a; rebuild(); }
export const updateSnapshot = () => { compute(); return snap; };

function subscribe(f: () => void) {
  subs.add(f);
  const on = () => rebuild();
  // A season saved or removed (here or in another tab), or Later pressed elsewhere: the update may be gone.
  window.addEventListener(SEASONS_EVENT, on);
  window.addEventListener(EVENT, on);
  window.addEventListener("storage", on);
  return () => { subs.delete(f); window.removeEventListener(SEASONS_EVENT, on); window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
}

export function useSeasonUpdate(): UpdateSnapshot { return useSyncExternalStore(subscribe, updateSnapshot, () => snap); }

/** Is there an update to ask about (the inbox item)? */
export const askingAbout = (s: UpdateSnapshot) => s.action === "prompt" && !!s.key && s.later !== s.key;

/**
 * Download the updates and swap each in (saveSeason: verified against its SHA-256, and a failed or partial
 * download never replaces the copy that's saved). Null when a save run is already going.
 */
export async function applyUpdate(s: UpdateSnapshot = updateSnapshot()) {
  if (!s.manifest || !s.rows.length) return null;
  const { runSeasonBatch } = await import("./seasonBatch");
  return runSeasonBatch(s.rows.map((r) => r.file), s.manifest);
}

/** Update now (the pop-up's, the inbox item's): download with a toast that says how it went. */
export async function updateNow(s: UpdateSnapshot = updateSnapshot()): Promise<void> {
  if (!s.rows.length) return;
  const what = seasonList(s.rows);
  const id = toast.loading(`Updating offline data for ${what}…`);
  const r = await applyUpdate(s).catch((e: unknown) => ({ saved: [], failed: s.rows.map((x) => ({ season: x.season, error: e instanceof Error ? e : new Error(String(e)) })) }));
  if (!r) toast("Already saving seasons on this device. Updates run when that's done.", { id });
  else if (r.failed.length) toast.error(`Couldn't update ${seasonList(r.failed)}. The saved copy is unchanged and still works offline.`, { id, description: r.failed[0].error.message });
  else toast.success(`Offline data for ${what} updated`, { id, description: "Its team and event pages show the new release with no connection." });
}
