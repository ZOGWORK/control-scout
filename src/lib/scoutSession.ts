// The scouting session: the event a scout is at and what they watch each match, set once and kept on
// this device (localStorage cs-scout-session:<space>, never synced), so Scout opens straight on the next
// match instead of asking for the event and match every entry. One per space; a session for another
// season is ignored (it belongs to that season's page).
import { useCallback, useEffect, useState } from "react";
import { parseWatching, type Watching } from "../shared/scoutMatch";
import type { ScoutSpace } from "./scouting";

export interface ScoutSession { season: number; eventCode: string; watching: Watching; /** ms since epoch */ setAt: number }

const EVENT_CODE = /^[A-Z0-9_-]{1,32}$/;
export const sessionStorageKey = (space: ScoutSpace) => `cs-scout-session:${space ?? "personal"}`;
/** Fired on window when a space's session changes here, so every hook showing it follows (detail: the space). */
export const SCOUT_SESSION_CHANGED = "cs-scout-session-changed";

/** Sessions this device couldn't store (storage full or blocked): kept for this visit, so a Start still takes. */
const unsaved = new Map<string, ScoutSession | null>();

export function readScoutSession(space: ScoutSpace): ScoutSession | null {
  const key = sessionStorageKey(space);
  if (unsaved.has(key)) return unsaved.get(key)!;
  try {
    const raw = localStorage.getItem(sessionStorageKey(space));
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    const eventCode = typeof v.eventCode === "string" ? v.eventCode.trim().toUpperCase() : "";
    const watching = parseWatching(v.watching);
    if (!Number.isSafeInteger(v.season) || !EVENT_CODE.test(eventCode) || !watching) return null;
    return { season: v.season as number, eventCode, watching, setAt: Number.isFinite(v.setAt) ? (v.setAt as number) : 0 };
  } catch { return null; }
}

/** Saves (or with null, ends) a space's session. A bad event code saves nothing and returns null. */
export function writeScoutSession(space: ScoutSpace, s: Omit<ScoutSession, "setAt"> | null): ScoutSession | null {
  const eventCode = s ? s.eventCode.trim().toUpperCase() : "";
  const saved = s && EVENT_CODE.test(eventCode) ? { ...s, eventCode, setAt: Date.now() } : null;
  if (s && !saved) return null;
  const key = sessionStorageKey(space);
  try {
    if (saved) localStorage.setItem(key, JSON.stringify(saved));
    else localStorage.removeItem(key);
    unsaved.delete(key);
  } catch { unsaved.set(key, saved); /* storage full or blocked: this visit only */ }
  window.dispatchEvent(new CustomEvent(SCOUT_SESSION_CHANGED, { detail: space }));
  return saved;
}

/**
 * The session for a space and season. With none saved, a workspace's default event (its shared settings)
 * stands in as a suggestion (`suggested`), never saved until the scout starts it. `set` saves; `end` clears.
 */
export function useScoutSession(space: ScoutSpace, season: number, defaultEvent = "") {
  const read = useCallback(() => { const s = readScoutSession(space); return s && s.season === season ? s : null; }, [space, season]);
  const [session, setSession] = useState<ScoutSession | null>(read);
  useEffect(() => {
    setSession(read());
    const changed = (ev: Event) => { if ((ev as CustomEvent<ScoutSpace>).detail === space) setSession(read()); };
    const storage = (ev: StorageEvent) => { if (ev.key === sessionStorageKey(space) || ev.key === null) setSession(read()); };
    window.addEventListener(SCOUT_SESSION_CHANGED, changed);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(SCOUT_SESSION_CHANGED, changed); window.removeEventListener("storage", storage); };
  }, [space, read]);
  const set = useCallback((eventCode: string, watching: Watching) => writeScoutSession(space, { season, eventCode, watching }), [space, season]);
  const end = useCallback(() => { writeScoutSession(space, null); }, [space]);
  const suggested = !session && EVENT_CODE.test(defaultEvent.trim().toUpperCase()) ? defaultEvent.trim().toUpperCase() : null;
  return { session, suggested, set, end };
}
