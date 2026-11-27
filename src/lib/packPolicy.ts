// When the lite pack (about 4.4 MB) may download by itself. A first visit
// never pays for it: it goes to returning visitors (a second session on this
// device, someone with a My team / tracked teams / shortlist, or a device that
// already has a pack to keep current), and never on Save-Data or a 2g/3g
// connection, nor on mobile data when the Download page's network setting says Wi-Fi only
// (offline/updatePolicy.ts liteAllowed). Opening the Download page still fetches it straight away.
// Downloading is all that happens online: the pack is stored, never opened,
// until the device has no signal (lib/api.ts).
// Pure and tiny: it sits in the entry bundle, packs.ts (the engine) doesn't.
import type { PersonalState } from "../shared/personal";

/** localStorage: the saved lite pack's meta (packs.ts writes it). */
export const PACK_META_KEY = "cs-pack-meta";

export interface PackMeta {
  version: string; bytes: number; savedAt: number; builtAt: string; engineVersion: string;
  /** Seasons it holds (packs saved before this was noted don't say). */
  seasons?: number[];
  /** When the server last synced before the pack was built (packs saved from 6.0.5 on). */
  dataAsOf?: string | null;
}
/** The lite pack saved on this device: its meta only (reading it opens nothing). */
export function packStatus(): PackMeta | null { try { return JSON.parse(localStorage.getItem(PACK_META_KEY) ?? "null"); } catch { return null; } }
/** localStorage: a session has happened on this device before. */
export const SEEN_KEY = "cs-seen";
/** sessionStorage: this session's verdict, "new" or "returning", fixed at its first page. */
export const SESSION_KEY = "cs-session";

/** The parts of navigator.connection (Network Information API) that matter here. */
export interface ConnectionInfo { saveData?: boolean; effectiveType?: string; /** wifi, cellular, ethernet…: only some browsers say (offline/updatePolicy.ts). */ type?: string }

/** Is this session a return to the site? Decided once per session (a tab):
 *  "returning" when an earlier session left its marker. Storage blocked: new. */
export function noteVisit(local: Pick<Storage, "getItem" | "setItem"> | null, session: Pick<Storage, "getItem" | "setItem"> | null, now = Date.now()): boolean {
  try {
    const known = session?.getItem(SESSION_KEY);
    if (known) return known === "returning";
    const returning = !!local?.getItem(SEEN_KEY);
    session?.setItem(SESSION_KEY, returning ? "returning" : "new");
    local?.setItem(SEEN_KEY, String(now));
    return returning;
  } catch { return false; }
}

/** Has this person said which teams they follow? */
export function followsTeams(s: Pick<PersonalState, "myTeam" | "tracked" | "bookmarks">): boolean {
  return s.myTeam != null || s.tracked.teams.length > 0 || s.tracked.events.length > 0 || s.bookmarks.length > 0;
}

/** Save-Data on, or a slow connection (slow-2g, 2g, 3g): keep the megabytes for the page. */
export function constrained(c: ConnectionInfo | null | undefined): boolean {
  if (!c) return false;
  return c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g";
}

export interface SyncSignals {
  online: boolean;
  /** A second (or later) session on this device. */
  returning: boolean;
  /** My team, tracked teams/events or a shortlist set. */
  follows: boolean;
  /** A lite pack is already on this device (keep it current). */
  hasPack: boolean;
  connection?: ConnectionInfo | null;
}

/** May the background sync run now? */
export function shouldSyncLite(s: SyncSignals): boolean {
  if (!s.online || constrained(s.connection)) return false;
  return s.hasPack || s.returning || s.follows;
}

/** How often a page left open asks whether a newer pack is out. The server rebuilds the packs at the sync's pace on an
 *  event day (about every 15 minutes), so a tab open all weekend gets that day's ratings without a reload. Ten minutes
 *  is the most it asks, and only while it's on screen: the answer is one small manifest, but it isn't a poll. */
export const LITE_RECHECK_MS = 10 * 60_000;

/** Is the mid-session check due? Hidden tabs never ask (they ask again as they come back). */
export function liteRecheckDue(lastAt: number, now: number, visible: boolean): boolean {
  return visible && now - lastAt >= LITE_RECHECK_MS;
}

/** The least time between two background downloads of the lite pack. An event day publishes a new one at the sync's
 *  pace (every 15 minutes while results arrive), and each is the whole pack (about 4.4 MB): a phone left open at a
 *  venue, asking every LITE_RECHECK_MS, fetched it nearly every time, some 26 MB an hour of the venue's Wi-Fi. A pack
 *  saved within the hour now stays until it's older. The results that came in since are folded in on the device
 *  (offline/predict.ts, liteLearned), and the person's own Update still fetches the newest at once. */
export const LITE_BACKGROUND_EVERY_MS = 60 * 60_000;

/** May a background check replace the saved lite pack with the published one? Always when none is saved, or when the
 *  published one comes from another engine (its ratings carry state the saved one lacks); otherwise once the saved one
 *  is LITE_BACKGROUND_EVERY_MS old. A saved time in the future (the clock moved back) counts as old. */
export function liteRefreshDue(have: Pick<PackMeta, "savedAt" | "engineVersion"> | null, published: { engineVersion: string }, now: number): boolean {
  if (!have || have.engineVersion !== published.engineVersion) return true;
  const age = now - have.savedAt;
  return !(age >= 0 && age < LITE_BACKGROUND_EVERY_MS);
}
