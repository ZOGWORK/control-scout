// Shared pick list notes this device wrote that the workspace hasn't confirmed yet (audit PRIVATE-F03).
//
// A note goes up to the server, which can take a moment; a reload or a closed tab in that moment used to
// lose it. So each note write is also kept here, in this device's storage, until the server confirms it:
// one draft per account, workspace, season and team (the key names all four, so a draft is only ever read
// back for the account that wrote it). With it, the note it was written over (its noteUpdatedAt, the
// "base"), so after a reload the device can tell whether resending it would replace a newer note a
// teammate wrote meanwhile (sharedPicklist.ts decides; the server checks again).
//
// Storage full, blocked or unreadable: nothing is kept (the write still goes up as before).

export interface NoteDraft {
  team: number;
  note: string;
  /** The note's noteUpdatedAt this draft was written over (null: there was no note). */
  base: number | null;
  /** When it was written (ms). */
  at: number;
  /** This write's id: the answer to it clears this draft only, never a newer one (another tab's, say). */
  wid?: string;
}

const PREFIX = "cs-picknote:";
/** A draft older than this is dropped unread: a note that sat unsent for two weeks reads wrong. */
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const scope = (account: number, space: string, season: number) => `${PREFIX}${account}:${encodeURIComponent(space)}:${season}:`;
const keyOf = (account: number, space: string, season: number, team: number) => `${scope(account, space, season)}${team}`;

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

const isDraft = (x: unknown): x is Omit<NoteDraft, "team"> => {
  // (wid is optional and checked where it's read.)
  const d = x as NoteDraft;
  return !!d && typeof d.note === "string" && (d.base === null || Number.isSafeInteger(d.base)) && Number.isFinite(d.at);
};

export function saveNoteDraft(account: number, space: string, season: number, d: NoteDraft): void {
  try { storage()?.setItem(keyOf(account, space, season, d.team), JSON.stringify({ note: d.note, base: d.base, at: d.at, ...(d.wid ? { wid: d.wid } : {}) })); } catch { /* full or blocked */ }
}

export function readNoteDraft(account: number, space: string, season: number, team: number): NoteDraft | null {
  try {
    const raw = storage()?.getItem(keyOf(account, space, season, team));
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    return isDraft(d) ? { team, note: d.note, base: d.base, at: d.at, ...(typeof d.wid === "string" ? { wid: d.wid } : {}) } : null;
  } catch { return null; }
}

export function clearNoteDraft(account: number, space: string, season: number, team: number): void {
  try { storage()?.removeItem(keyOf(account, space, season, team)); } catch { /* blocked */ }
}

/** This account's drafts for a workspace's list in a season (expired or unreadable ones are removed). */
export function noteDrafts(account: number, space: string, season: number, now = Date.now()): NoteDraft[] {
  const s = storage();
  if (!s) return [];
  const prefix = scope(account, space, season);
  const out: NoteDraft[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(prefix)) keys.push(k); }
    for (const k of keys) {
      const team = Number(k.slice(prefix.length));
      const d = Number.isSafeInteger(team) && team > 0 ? readNoteDraft(account, space, season, team) : null;
      if (!d || now - d.at > DRAFT_MAX_AGE_MS) { s.removeItem(k); continue; }
      out.push(d);
    }
  } catch { /* blocked */ }
  return out;
}
