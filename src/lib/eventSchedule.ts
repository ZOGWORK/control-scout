// An event's match schedule for the scout screen. Read from the event's own route (a saved season answers
// it with no signal), and the last schedule seen is kept on this device (localStorage
// cs-scout-schedule:<season>:<code>, a few events at most), so a venue with no wifi still scouts match by
// match. A schedule FIRST hasn't published is "none", never made up (AGENTS.md rule 8).
import { useEffect, useMemo } from "react";
import { useApi } from "./api";
import { offlineSource } from "./offline/saved";
import type { EventDetail } from "../shared/api";
import { scheduleFromMatches, type ScheduleMatch } from "../shared/scoutMatch";

const KEY_PREFIX = "cs-scout-schedule:";
/** How many events' schedules this device keeps. */
const KEEP = 3;
const scheduleKey = (season: number, code: string) => `${KEY_PREFIX}${season}:${code.toUpperCase()}`;

interface Stored { name: string; matches: ScheduleMatch[]; at: number }

const isMatch = (m: unknown): m is ScheduleMatch => {
  const x = m as ScheduleMatch;
  return !!x && typeof x.key === "string" && typeof x.label === "string" && (x.level === "qual" || x.level === "playoff")
    && Array.isArray(x.red) && Array.isArray(x.blue) && [...x.red, ...x.blue].every(Number.isSafeInteger);
};

export function readStoredSchedule(season: number, code: string): Stored | null {
  try {
    const raw = localStorage.getItem(scheduleKey(season, code));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (!Array.isArray(v.matches) || !v.matches.every(isMatch)) return null;
    return { name: typeof v.name === "string" ? v.name : "", matches: v.matches, at: Number(v.at) || 0 };
  } catch { return null; }
}

export function storeSchedule(season: number, code: string, s: Stored) {
  try {
    localStorage.setItem(scheduleKey(season, code), JSON.stringify(s));
    // Keep the newest few: older events' schedules go.
    const kept: { k: string; at: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(KEY_PREFIX)) continue;
      try { kept.push({ k, at: Number((JSON.parse(localStorage.getItem(k) ?? "{}") as Stored).at) || 0 }); } catch { kept.push({ k, at: 0 }); }
    }
    kept.sort((a, b) => b.at - a.at).slice(KEEP).forEach(({ k }) => localStorage.removeItem(k));
  } catch { /* storage full or blocked: the server's answer still shows this visit */ }
}

export interface EventSchedule {
  /** ready: matches to scout; none: the event has no schedule yet; loading: nothing yet; error: no answer and none kept here. */
  status: "loading" | "ready" | "none" | "error";
  matches: ScheduleMatch[];
  eventName: string;
  /** Shown from the copy kept on this device (the server didn't answer). */
  fromDevice: boolean;
  error?: string;
  reload: () => Promise<void>;
}

/** The schedule of an event (null code: none asked for). */
export function useEventSchedule(season: number, code: string | null): EventSchedule {
  const c = code?.trim().toUpperCase() || null;
  const api = useApi<EventDetail>(c ? `/api/events/${season}/${encodeURIComponent(c)}` : null);
  // An answer from a season saved on this device (no signal) can be older than the copy kept here from the
  // server: the kept copy wins then, and a saved season's answer is never kept over it.
  const answer = useMemo(() => (api.data ? { name: api.data.event.name, matches: scheduleFromMatches(api.data.matches), saved: !!offlineSource(api.data) } : null), [api.data]);
  const kept = useMemo(() => (c && (!answer || answer.saved) ? readStoredSchedule(season, c) : null), [season, c, answer]);
  const fresh = answer && !(answer.saved && kept?.matches.length) ? answer : null;
  useEffect(() => { if (c && fresh && !fresh.saved && fresh.matches.length) storeSchedule(season, c, { name: fresh.name, matches: fresh.matches, at: Date.now() }); }, [season, c, fresh]);
  const stored = fresh ? null : kept;
  const base = { reload: api.reload };
  if (!c) return { ...base, status: "none", matches: [], eventName: "", fromDevice: false };
  if (fresh) return { ...base, status: fresh.matches.length ? "ready" : "none", matches: fresh.matches, eventName: fresh.name, fromDevice: fresh.saved };
  if (stored) return { ...base, status: "ready", matches: stored.matches, eventName: stored.name, fromDevice: !!api.error || !!answer };
  if (api.error) return { ...base, status: "error", matches: [], eventName: "", fromDevice: false, error: api.error.message };
  return { ...base, status: "loading", matches: [], eventName: "", fromDevice: false };
}
