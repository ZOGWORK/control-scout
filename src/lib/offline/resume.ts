// Picking up the downloads a dropped connection paused (resumeMarks.ts), and getting the predictions pack for
// the person (Update, Resume, the whole-season download). Loaded only when there's something to pick up
// (resumeWatcher.tsx) or from the Download page.
import { ManifestError, fetchManifest, lastSyncError, packStatus, syncLite, type PackFile, type PackManifest } from "../packs";
import { noteDownloadWaiting } from "../connection";
import { activeDownloads, byConnection, partialDownloads, type PartialDownload } from "./download";
import { batchRunning, runSeasonBatch, type BatchResult } from "./seasonBatch";
import { savedSeasons } from "./saved";
import { clearResume, markKey, resumeMarks, wantResume } from "./resumeMarks";

/** Pack releases ("2026-11-13.1": the day, then the build that day) in order: negative when `a` is older than `b`. */
export function releaseOrder(a: string, b: string): number {
  const [da, na] = a.split("."), [db, nb] = b.split(".");
  return da !== db ? (da < db ? -1 : 1) : Number(na ?? 0) - Number(nb ?? 0);
}

const LITE = markKey("lite", "lite");
const litePaused = (l: PartialDownload[]) => l.some((p) => p.owner.kind === "lite" && !p.verified && p.have > 0);

/** Get the predictions pack for the person (Update, Resume, the whole season). syncLite stays quiet on failure (it
 *  also runs in the background), so this checks what it left: no pack, or not the release asked for, is an error
 *  the person sees. A dropped connection leaves it marked, so it picks up by itself when the connection is back. */
export async function getLite(version: string | undefined): Promise<void> {
  wantResume("lite", "lite");
  const meta = await syncLite();
  const have = packStatus();
  // syncLite reads the manifest again, so a release published meanwhile is a success too: at least the one asked for.
  if (!meta || !have || (version && releaseOrder(have.version, version) < 0)) {
    // Stopped by the connection (what came is kept, nothing came at all, or the pack list didn't load): it waits for
    // the connection. Anything else isn't picked up by itself.
    const e = lastSyncError();
    const connection = byConnection(e) || (e instanceof ManifestError && e.reason === "unreachable") || litePaused(await partialDownloads().catch(() => []));
    if (connection) noteDownloadWaiting(); else clearResume(LITE);
    throw new Error("Couldn't finish downloading the predictions pack. Try again in a moment.");
  }
  clearResume(LITE);
}

/** The single-season file for a season in this release, or null. */
export const seasonFile = (m: PackManifest, season: number): PackFile | null =>
  m.full.find((f) => f.kind === "full" && f.seasons.length === 1 && f.seasons[0] === season) ?? null;

export { resumeAllowed } from "./updatePolicy";

/** Auto attempts on one download that got no further, before it waits for the person's own Resume. */
export const MAX_STALLED = 4;
/** One auto attempt per download at most this often. */
export const MIN_GAP_MS = 10_000;
/** The pack list is a small file: no answer in this long is a request hung by a line that just came back
 *  (lib/connection.ts), abandoned and asked again, up to MANIFEST_TRIES times. Without a limit one hung request
 *  held the pick-up (and every later one, which shares it) until the browser gave up. */
export const MANIFEST_TIMEOUT_MS = 5000;
export const MANIFEST_TRIES = 3;

/** The pack list, given up on after MANIFEST_TIMEOUT_MS. */
function manifestSoon(): Promise<PackManifest> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MANIFEST_TIMEOUT_MS);
  return fetchManifest({ signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

export interface ResumeDeps {
  fetchManifest: () => Promise<PackManifest>;
  runSeasonBatch: (files: PackFile[], m: PackManifest, opts: { replaceOnly?: boolean; person?: boolean }) => Promise<BatchResult | null>;
  getLite: (version: string | undefined) => Promise<void>;
  partialDownloads: () => Promise<PartialDownload[]>;
  busy: () => boolean;
  now: () => number;
}
const realDeps: ResumeDeps = {
  fetchManifest: manifestSoon,
  runSeasonBatch,
  getLite,
  partialDownloads,
  busy: () => batchRunning() || Object.keys(activeDownloads()).length > 0,
  now: Date.now,
};

/** Per download: the last auto attempt and how far it had got, so a line that keeps dropping isn't hammered. */
const tries = new Map<string, { at: number; have: number; stalled: number }>();
/** Tests only. */
export function resetResume() { tries.clear(); running = null; }

const haveOf = (key: string, l: PartialDownload[]) => l.filter((p) => `${p.owner.kind}:${p.owner.id}` === key).reduce((n, p) => Math.max(n, p.have), 0);

/** How long until a marked download that was tried moments ago may be tried again (null: none waits on the gap; one
 *  that stopped being retried doesn't count). The watcher tries again then, so a check that found internet during
 *  the gap isn't lost until the next one (minutes away once there's internet). */
export function nextTryIn(now = Date.now()): number | null {
  let soonest: number | null = null;
  for (const m of resumeMarks(now)) {
    const t = tries.get(m.key);
    if (!t || t.stalled + 1 >= MAX_STALLED) continue;
    const wait = Math.max(0, t.at + MIN_GAP_MS - now);
    if (soonest == null || wait < soonest) soonest = wait;
  }
  return soonest;
}

/** Should this download get an auto attempt now? Records the attempt. */
function due(key: string, have: number, now: number): boolean {
  const t = tries.get(key);
  if (t && now - t.at < MIN_GAP_MS) return false;
  const stalled = t && have <= t.have ? t.stalled + 1 : 0;
  if (stalled >= MAX_STALLED) return false;
  tries.set(key, { at: now, have, stalled });
  return true;
}

/** One tab at a time picks them up (another tab finds them saved, or no longer marked, once it gets the lock). */
function acrossTabs<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? (locks.request("cs-download-resume", fn) as Promise<T>) : fn();
}

export interface Tried { key: string; saved: boolean }
let running: Promise<Tried[]> | null = null;
/**
 * Pick up every marked download, in the order the person asked for them: seasons through the season save run,
 * then the predictions pack. Nothing when the network setting doesn't allow this connection or another download
 * is running. Returns each download it tried and whether it's now saved. `allowed` is asked again before each one.
 */
export function resumePaused(allowed: () => boolean, deps: ResumeDeps = realDeps): Promise<Tried[]> {
  running ??= acrossTabs(() => pickUp(allowed, deps)).finally(() => { running = null; });
  return running;
}

async function pickUp(allowed: () => boolean, deps: ResumeDeps): Promise<Tried[]> {
  const tried: Tried[] = [];
  if (!resumeMarks(deps.now()).length || !allowed() || deps.busy()) return tried;
  let m: PackManifest | null = null;
  for (let i = 0; i < MANIFEST_TRIES && !m && allowed(); i++) m = await deps.fetchManifest().catch(() => null);
  if (!m) return tried;
  const partials = await deps.partialDownloads().catch(() => [] as PartialDownload[]);
  // Read again: marks change while the manifest loads (another tab picked them up, the person deleted one).
  for (const mark of resumeMarks(deps.now())) {
    if (!allowed() || deps.busy()) break;
    if (mark.kind === "season") {
      const season = Number(mark.id);
      const f = seasonFile(m, season);
      // Not offered any more, or already saved as this release: nothing to pick up.
      if (!f || savedSeasons().some((s) => s.season === season && s.sha256 === f.sha256)) { clearResume(mark.key); continue; }
      // Tried moments ago, or stuck: it and everything asked for after it wait (the order the person asked in).
      if (!due(mark.key, haveOf(mark.key, partials), deps.now())) break;
      const r = await deps.runSeasonBatch([f], m, { person: true, replaceOnly: mark.replaceOnly });
      tried.push({ key: mark.key, saved: !!r?.saved.length });
      // Stopped by the connection again (or failed): the rest wait for the next time it's back.
      if (!r || r.failed.length) break;
    } else {
      if (!m.lite || packStatus()?.version === m.version) { clearResume(mark.key); continue; }
      if (!due(mark.key, haveOf(mark.key, partials), deps.now())) continue;
      try { await deps.getLite(m.version); tried.push({ key: mark.key, saved: true }); }
      catch { tried.push({ key: mark.key, saved: false }); break; }
    }
  }
  return tried;
}
