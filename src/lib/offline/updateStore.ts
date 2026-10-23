// The saved seasons' update, for the app: what the background check (updateWatcher.tsx) last found, which
// release the person already saw the pop-up for or answered "Later" to, and the Update now action. The inbox
// bell and the Download page read it. Small on purpose (the bell is in the entry bundle): saving loads lazily.
import { useSyncExternalStore } from "react";
import type { PackManifest } from "../packs";
import { SEASONS_EVENT, savedSeasons, type SavedSeason } from "./saved";
import { planSeasons, type SeasonRow } from "./seasonPlan";
import { releaseKey, seasonList, updateId, type SeasonUpdate, type UpdateAction } from "./updatePolicy";
import { toast } from "../../components/ui/sonner";

/** localStorage: the releases (updateIds, newest last) the pop-up showed for, and those answered "Later". */
export const SHOWN_KEY = "cs-offline-update-shown";
export const LATER_KEY = "cs-offline-update-later";
/** Fired on window when either changes. */
const EVENT = "cs-offline-update-changed";
/** Enough for every season several releases back; older ids drop off. */
const KEEP = 40;

export interface UpdateSnapshot {
  manifest: PackManifest | null;
  /** Saved seasons with a newer release in that manifest. */
  rows: SeasonRow[];
  /** The same, as the policy and the question see them. */
  updates: SeasonUpdate[];
  key: string | null;
  /** What the policy decided last (none until a check ran). */
  action: UpdateAction;
  /** Releases answered "Later". */
  later: string[];
}

const readIds = (k: string): string[] => {
  try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
};
const addIds = (k: string, ids: string[]) => {
  const next = [...readIds(k).filter((x) => !ids.includes(x)), ...ids].slice(-KEEP);
  try { localStorage.setItem(k, JSON.stringify(next)); } catch { /* storage blocked: asks again next time */ }
  window.dispatchEvent(new Event(EVENT));
};

export const shownReleases = () => readIds(SHOWN_KEY);
export const laterReleases = () => readIds(LATER_KEY);
export const markShown = (ids: string[]) => addIds(SHOWN_KEY, ids);
export const markLater = (ids: string[]) => addIds(LATER_KEY, ids);

/**
 * Only releases newer than what's saved count as updates: a manifest read before another tab (or an earlier
 * check) saved a newer release must never offer, or automatically install, the older one over it.
 */
export function pendingUpdates(m: PackManifest | null, saved: SavedSeason[]): SeasonRow[] {
  if (!m) return [];
  const built = Date.parse(m.builtAt);
  return planSeasons(m.full, saved).toUpdate.filter((r) => !(Date.parse(r.saved?.builtAt ?? "") > built));
}

let manifest: PackManifest | null = null;
let action: UpdateAction = "none";
let snap: UpdateSnapshot = { manifest: null, rows: [], updates: [], key: null, action: "none", later: [] };
let laterRaw = "";
const subs = new Set<() => void>();

/** Bring the snapshot up to date with the manifest, the saved list and Later (the same object when nothing changed). */
function compute(): boolean {
  const rows = pendingUpdates(manifest, savedSeasons());
  const updates = rows.map((r): SeasonUpdate => ({ season: r.season, sha256: r.file.sha256, bytes: r.file.bytes }));
  const key = releaseKey(updates);
  const later = laterReleases();
  const raw = later.join(",");
  if (snap.manifest === manifest && snap.key === key && snap.action === action && laterRaw === raw) return false;
  snap = { manifest, rows, updates, key, action, later };
  laterRaw = raw;
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

/** Is there an update to ask about (the inbox item)? One not answered "Later". */
export const askingAbout = (s: UpdateSnapshot) => s.action === "prompt" && s.updates.some((u) => !s.later.includes(updateId(u)));

/**
 * Download these updates (all of them by default) and swap each in: saveSeason verifies each against its
 * SHA-256, a failed or partial download never replaces the saved copy, and a season removed meanwhile stays
 * removed (replaceOnly). go (automatic runs): asked before each season; false leaves the rest for later
 * (Wi-Fi dropped mid-run). Null when a save run is already going.
 */
export async function applyUpdate(s: UpdateSnapshot = updateSnapshot(), rows: SeasonRow[] = s.rows, go?: () => boolean) {
  if (!s.manifest || !rows.length) return null;
  const { runSeasonBatch } = await import("./seasonBatch");
  return runSeasonBatch(rows.map((r) => r.file), s.manifest, { replaceOnly: true, go });
}

/**
 * Update now (the pop-up's, the inbox item's), with a toast that says how it went. If seasons are already
 * saving, it waits for that run, then updates whatever is still out of date: the answer is never dropped.
 */
export async function updateNow(s: UpdateSnapshot = updateSnapshot()): Promise<void> {
  if (!s.rows.length) return;
  const { whenIdle } = await import("./seasonBatch");
  const id = toast.loading(`Updating offline data for ${seasonList(s.rows)}…`);
  let r: Awaited<ReturnType<typeof applyUpdate>> = null;
  let ran: SeasonRow[] = [];
  try {
    for (;;) {
      await whenIdle();
      // The seasons the person said yes to, at the newest release known now: that run may have updated some
      // (or all) of them, and a check may have found a newer release meanwhile. pendingUpdates never picks a
      // release older than what's saved.
      const now = updateSnapshot();
      const base = now.manifest ? now : s;
      ran = pendingUpdates(base.manifest, savedSeasons()).filter((x) => s.rows.some((y) => y.season === x.season));
      if (!ran.length) break;
      r = await applyUpdate(base, ran);
      if (r) break; // null: another run started first; wait for that one too
      toast.loading(`Waiting for the seasons already saving, then updating ${seasonList(ran)}…`, { id });
    }
  } catch (e) {
    r = { saved: [], skipped: [], held: [], failed: ran.map((x) => ({ season: x.season, error: e instanceof Error ? e : new Error(String(e)) })) };
  }
  if (!r) toast.success(`Offline data for ${seasonList(s.rows)} is up to date`, { id });
  else if (r.failed.length) toast.error(`Couldn't update ${seasonList(r.failed)}. The saved copy is unchanged and still works offline.`, { id, description: r.failed[0].error.message });
  else if (!r.saved.length) toast(`Nothing to update: ${seasonList(r.skipped.map((season) => ({ season })))} ${r.skipped.length === 1 ? "was" : "were"} removed from this device.`, { id });
  else toast.success(`Offline data for ${seasonList(r.saved.map((season) => ({ season })))} updated`, { id, description: "Its team and event pages show the new release with no connection." });
}
