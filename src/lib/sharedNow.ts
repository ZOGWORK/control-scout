// What a retained change's destination holds right now (the recoverable view's "Show change"). Read only: it
// only ever GETs (the pick list, or the entry's thread), so showing a change never sends anything.
//
// The destination may be gone (the team was taken off the pick list, the entry was deleted) or out of reach
// (the member was removed from the workspace, signed out): each says so plainly instead of comparing with nothing.
import { apiFetch, ApiError, isFeatureDisabled } from "./api";
import { isPickList, type PickList } from "../shared/picklist";
import { isEntryComment } from "../shared/comments";

export interface ReviewTarget {
  kind: "note" | "comment";
  workspaceId: string;
  season: number | null;
  team: number | null;
  /** A note: the note it was written over (noteUpdatedAt; null: none), when known. */
  base?: number | null;
  /** A comment: its entry and operation id. */
  entry?: string;
  opId?: string;
}

/** version: the pick list version it was read from (a note), so an older answer never replaces a newer one. */
export type SharedNow = { version?: number } & (
  /** text: what's shared now ("" for none). hint: one sentence of context (a teammate's newer note, a new comment). */
  | { state: "ok"; text: string; hint?: string; posted?: boolean }
  | { state: "gone"; message: string }
  | { state: "denied"; message: string }
  | { state: "unavailable"; message: string });

export const NO_ACCESS = "You're no longer a member of this workspace, so what's shared there can't be shown. Your text is still kept on this device.";
const SIGNED_OUT = "Sign in again to see what's shared now. Your text is still kept on this device.";
const UNREACHABLE = "Couldn't read what's shared now: the workspace couldn't be reached. Your text is still kept on this device.";

const base = (space: string) => `/api/scout/workspaces/${encodeURIComponent(space)}`;

/** What a pick list (fetched, or heard on the workspace's stream) holds for a note's team. */
export function noteIn(list: PickList, t: ReviewTarget): SharedNow {
  const pick = list.picks.find((p) => p.team === t.team);
  if (!pick) return { state: "gone", version: list.version, message: `Team ${t.team} is no longer on the pick list, so this note has nowhere to go.` };
  const newer = t.base !== undefined && pick.noteUpdatedAt !== t.base;
  return { state: "ok", version: list.version, text: pick.note, ...(newer ? { hint: "A teammate changed this note after you wrote yours." } : {}) };
}

/** Read what `t`'s destination holds now. Never throws (an abort aside). */
export async function readSharedNow(t: ReviewTarget, signal?: AbortSignal): Promise<SharedNow> {
  try {
    if (t.kind === "note") {
      if (t.season == null || t.team == null) return { state: "unavailable", message: UNREACHABLE };
      const r = await apiFetch<{ list?: unknown }>(`${base(t.workspaceId)}/picklist?season=${t.season}`, { signal });
      return isPickList(r?.list) ? noteIn(r.list, t) : { state: "unavailable", message: UNREACHABLE };
    }
    if (!t.entry) return { state: "unavailable", message: UNREACHABLE };
    const r = await apiFetch<{ comments?: unknown[]; entryDeleted?: boolean }>(`${base(t.workspaceId)}/entries/${encodeURIComponent(t.entry)}/comments`, { signal });
    if (r?.entryDeleted) return { state: "gone", message: "The entry this comment is on was deleted, so it has nowhere to go." };
    const thread = (r?.comments ?? []).filter(isEntryComment);
    const mine = t.opId ? thread.find((c) => c.opId === t.opId) : undefined;
    if (mine) return { state: "ok", text: mine.body, posted: true, hint: "It's in the thread already: Retry won't post it twice." };
    // Not found isn't proof it was never posted (a deleted comment, or one past the newest the thread lists, isn't
    // there either): Retry checks with the workspace first and never posts it twice.
    return { state: "ok", text: "", hint: "It isn't in the thread as this device sees it. Retry checks with the workspace first and never posts it twice." };
  } catch (e) {
    if (signal?.aborted) throw e;
    if (!(e instanceof ApiError)) return { state: "unavailable", message: UNREACHABLE };
    if (e.status === 401) return { state: "denied", message: SIGNED_OUT };
    if (isFeatureDisabled(e)) return { state: "unavailable", message: e.message };
    if (e.status === 403) return { state: "denied", message: NO_ACCESS };
    if (e.status === 404 || e.status === 410) {
      return { state: "gone", message: t.kind === "comment" ? "The entry this comment is on isn't in the workspace: it hasn't synced yet, or it was removed." : "This workspace's pick list isn't there any more." };
    }
    return { state: "unavailable", message: UNREACHABLE };
  }
}
