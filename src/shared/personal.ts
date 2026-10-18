// Personal data: what a signed-in account syncs, and what an anonymous device
// keeps locally. Shared by server and web app so both merge the same way.
//
// Anonymous-first: everything works in localStorage without an account; on
// sign-in, local data is merged into the account (nothing lost), then the
// account is the source of truth.
import { INBOX_TOGGLE_KEYS, type InboxToggleKey } from "./inbox.js";
import { MAX_TEAM_COLORS, teamColorById } from "./teamColors.js";

export interface TrackedState { teams: number[]; events: string[] } // events: "season:CODE"
export interface VideoLink { url: string; title: string | null; addedAt: number }
export interface SavedPrediction { id: string; season: number; red: number[]; blue: number[]; winProbRed: number; predictedRed: number; predictedBlue: number; tier: string; savedAt: number; note?: string }
export interface Settings {
  theme: "dark" | "light" | "system";
  density: "comfortable" | "compact";
  /** Animated background (on by default; reduced motion always stills it). */
  ambient: boolean;
  /** Match alerts, plus the notification inbox's per-kind switches (src/shared/inbox.ts): those are
   *  optional and missing means on, so a value saved before they existed is unchanged byte for byte. */
  notify: { myTeamMatches: boolean; trackedTeams: boolean; upsets: boolean; eventStart: boolean } & Partial<Record<InboxToggleKey, boolean>>;
}

export interface PersonalState {
  myTeam: number | null;
  tracked: TrackedState;
  bookmarks: number[];
  settings: Settings;
  /** Match ref "season:CODE:level:series:number" → YouTube links. Device recordings never sync. */
  videoLinks: Record<string, VideoLink[]>;
  predictionHistory: SavedPrediction[];
  /** Private alliance-selection notes on shortlisted teams: team number (as a string) to note. The pick
   *  order itself is `bookmarks`' order. Added later than the rest: older clients simply don't sync it. */
  shortlistNotes: Record<string, string>;
  /** Colours given to teams (team number as a string → a TEAM_COLORS id), used on the shortlist and in Compare.
   *  Added later than the rest: older clients simply don't sync it. */
  teamColors: Record<string, string>;
}

export type PersonalKey = keyof PersonalState;
export const PERSONAL_KEYS: PersonalKey[] = ["myTeam", "tracked", "bookmarks", "settings", "videoLinks", "predictionHistory", "shortlistNotes", "teamColors"];

const NOTIFY_KEYS = new Set<string>(["myTeamMatches", "trackedTeams", "upsets", "eventStart", ...INBOX_TOGGLE_KEYS]);

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  density: "comfortable",
  ambient: true,
  notify: { myTeamMatches: true, trackedTeams: false, upsets: false, eventStart: true },
};

export const EMPTY_STATE: PersonalState = {
  myTeam: null,
  tracked: { teams: [], events: [] },
  bookmarks: [],
  settings: DEFAULT_SETTINGS,
  videoLinks: {},
  predictionHistory: [],
  shortlistNotes: {},
  teamColors: {},
};

/** A stored value with the client clock time it last changed (last write wins). */
export interface Stamped<T> { value: T; updatedAt: number }

const uniq = <T>(xs: T[]) => [...new Set(xs)];
const MAX_HISTORY = 200;
export const MAX_NOTE = 500;
const MAX_NOTES = 500;

/** Validate + clamp one key's value (null when unusable). Server and client both run this. */
export function cleanValue<K extends PersonalKey>(key: K, v: unknown): PersonalState[K] | null {
  const isTeam = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0 && (x as number) < 1e6;
  switch (key) {
    case "myTeam": return (v === null || isTeam(v) ? v : null) as PersonalState[K];
    case "tracked": {
      const o = v as TrackedState;
      if (!o || typeof o !== "object") return null;
      return { teams: uniq((o.teams ?? []).filter(isTeam)).slice(0, 200), events: uniq((o.events ?? []).filter((e) => typeof e === "string" && /^\d{4}:[A-Z0-9_-]{2,24}$/.test(e))).slice(0, 200) } as PersonalState[K];
    }
    case "bookmarks": return (Array.isArray(v) ? uniq(v.filter(isTeam)).slice(0, 500) : null) as PersonalState[K];
    case "settings": {
      const o = (v ?? {}) as Partial<Settings>;
      return {
        theme: ["dark", "light", "system"].includes(o.theme as string) ? o.theme : DEFAULT_SETTINGS.theme,
        density: o.density === "compact" ? "compact" : "comfortable",
        ambient: o.ambient !== false,
        // Known switches only, booleans only. The inbox's are kept only when present (missing: on).
        notify: { ...DEFAULT_SETTINGS.notify, ...Object.fromEntries(Object.entries(o.notify && typeof o.notify === "object" ? o.notify : {}).filter(([k, b]) => NOTIFY_KEYS.has(k) && typeof b === "boolean")) },
      } as PersonalState[K];
    }
    case "videoLinks": {
      if (!v || typeof v !== "object") return null;
      const out: Record<string, VideoLink[]> = {};
      for (const [ref, links] of Object.entries(v as Record<string, VideoLink[]>).slice(0, 2000)) {
        if (!/^\d{4}:[A-Z0-9_-]{2,24}:(qual|playoff):\d+:\d+$/.test(ref) || !Array.isArray(links)) continue;
        const ok = links.filter((l) => l && typeof l.url === "string" && youtubeId(l.url)).slice(0, 10)
          .map((l) => ({ url: l.url.slice(0, 300), title: typeof l.title === "string" ? l.title.slice(0, 120) : null, addedAt: Number(l.addedAt) || 0 }));
        if (ok.length) out[ref] = ok;
      }
      return out as PersonalState[K];
    }
    case "predictionHistory": {
      if (!Array.isArray(v)) return null;
      return v.filter((p) => p && typeof p.id === "string" && Array.isArray(p.red) && Array.isArray(p.blue)).slice(0, MAX_HISTORY) as PersonalState[K];
    }
    case "shortlistNotes": {
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      const out: Record<string, string> = {};
      for (const [team, note] of Object.entries(v as Record<string, unknown>)) {
        if (Object.keys(out).length >= MAX_NOTES) break;
        if (!/^[1-9]\d{0,5}$/.test(team) || typeof note !== "string") continue;
        const text = note.trim().slice(0, MAX_NOTE);
        if (text) out[team] = text;
      }
      return out as PersonalState[K];
    }
    case "teamColors": {
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      const out: Record<string, string> = {};
      for (const [team, id] of Object.entries(v as Record<string, unknown>)) {
        if (Object.keys(out).length >= MAX_TEAM_COLORS) break;
        if (/^[1-9]\d{0,5}$/.test(team) && typeof id === "string" && teamColorById(id)) out[team] = id;
      }
      return out as PersonalState[K];
    }
  }
  return null;
}

/**
 * Merge a device's local value into the account's, for the first sign-in on
 * that device. Lists union (account order first); single values keep the
 * newer write; an account value is never replaced by an empty local one.
 */
export function mergeValue<K extends PersonalKey>(key: K, account: Stamped<PersonalState[K]> | null, local: Stamped<PersonalState[K]> | null): Stamped<PersonalState[K]> | null {
  if (!local) return account;
  if (!account) return local;
  const updatedAt = Math.max(account.updatedAt, local.updatedAt);
  const a = account.value as any, l = local.value as any;
  switch (key) {
    case "tracked": return { value: { teams: uniq([...a.teams, ...l.teams]), events: uniq([...a.events, ...l.events]) } as any, updatedAt };
    case "bookmarks": return { value: uniq([...a, ...l]) as any, updatedAt };
    case "videoLinks": {
      const out: Record<string, VideoLink[]> = { ...a };
      for (const [ref, links] of Object.entries(l as Record<string, VideoLink[]>)) {
        const have = new Set((out[ref] ?? []).map((x) => x.url));
        out[ref] = [...(out[ref] ?? []), ...links.filter((x) => !have.has(x.url))];
      }
      return { value: out as any, updatedAt };
    }
    case "predictionHistory": {
      const ids = new Set(a.map((p: SavedPrediction) => p.id));
      return { value: [...a, ...l.filter((p: SavedPrediction) => !ids.has(p.id))].sort((x: SavedPrediction, y: SavedPrediction) => y.savedAt - x.savedAt).slice(0, MAX_HISTORY) as any, updatedAt };
    }
    case "teamColors":
    case "shortlistNotes": {
      // Every team's note (or colour) survives; a team set on both sides keeps the newer side's.
      const newer = local.updatedAt > account.updatedAt;
      return { value: (newer ? { ...a, ...l } : { ...l, ...a }) as any, updatedAt };
    }
    case "myTeam": if (a == null) return local; if (l == null) return account; break;
  }
  return local.updatedAt > account.updatedAt ? local : account;
}

/** YouTube video id from a URL (watch, youtu.be, shorts, live, embed), else null. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return clean(u.pathname.slice(1));
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") return clean(u.searchParams.get("v"));
      const m = /^\/(shorts|live|embed)\/([^/?#]+)/.exec(u.pathname);
      if (m) return clean(m[2]);
    }
  } catch { /* not a URL */ }
  return null;
  function clean(id: string | null) { return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null; }
}
