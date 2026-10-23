// When the lite pack (about 1.6 MB) may download by itself. A first visit
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
