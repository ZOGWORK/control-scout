// The first-visit onboarding (src/components/onboarding/Onboarding.tsx): who gets it, and its record on this device.
//
// It starts once, on Home, for someone new: nothing saved here or on their account (no team, tracked teams or events,
// shortlist or workspace). While it runs, the record is "open" with the step it's on, so a reload brings it back on
// that step. Only Skip ("skipped") or the last step's button ("finished") end it, and then it never starts by itself
// again here. Settings → About → "Show the welcome again" opens it once more; "Clear all local data" forgets it.
//
// `cs-onboarding` is Tier 3 (device-only, DEVICE_ONLY_KEYS): it isn't synced, because a team picked in step 2 is, and
// someone with a team never gets it started.
import { useSyncExternalStore } from "react";
import type { PersonalState } from "../shared/personal";
import type { AccountUser } from "./personal";
import { sendOnboarding } from "./onboardingStats";

export const ONBOARDING_KEY = "cs-onboarding";
/**
 * Automation opt-in: browsers driven by tools (screenshots, audits) never get the onboarding, so their pages stay as
 * they are. "1" lets one see it (`npm run shots -- --onboarding`, the journeys script).
 */
export const ONBOARDING_DEMO_KEY = "cs-onboarding-demo";
/** Fired on window when this tab changes the record, so the dialog and Settings follow without a reload. */
export const ONBOARDING_CHANGE = "cs-onboarding-change";

/** How many steps it has. */
export const ONBOARDING_STEPS = 4;

export type OnboardingStatus = "open" | "finished" | "skipped";
export interface OnboardingRecord {
  v: 1;
  status: OnboardingStatus;
  /** The step it's on (0-based), or ended on. */
  step: number;
  /** The team step 2 saved as My team (null: none, or one the person already had), so "I'm not on a team" can take
   *  back only that one, even after a reload. */
  team: number | null;
  /** The furthest step reached (0-based): a step counts as reached once, however often Back and Next go over it. */
  max: number;
  /** Opened from Settings (Show the welcome again): its moments aren't counted (the counts are about first visits). */
  replay: boolean;
  at: string;
}

// The record when storage is blocked (a private window, storage off): it holds for this page's lifetime.
let memory: OnboardingRecord | null = null;

function parse(raw: string | null): OnboardingRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<OnboardingRecord> | null;
    if (!r || r.v !== 1 || (r.status !== "open" && r.status !== "finished" && r.status !== "skipped")) return null;
    const step = Math.min(Math.max(0, Math.floor(Number(r.step) || 0)), ONBOARDING_STEPS - 1);
    const team = Number.isInteger(r.team) && (r.team as number) > 0 ? (r.team as number) : null;
    const max = Math.min(Math.max(step, Math.floor(Number(r.max) || 0)), ONBOARDING_STEPS - 1);
    return { v: 1, status: r.status, step, team, max, replay: r.replay === true, at: String(r.at ?? "") };
  } catch { return null; }
}

/** This device's record: null when it has never started. */
export function readOnboarding(): OnboardingRecord | null {
  if (memory) return memory;
  try { return parse(localStorage.getItem(ONBOARDING_KEY)); } catch { return null; }
}

const announce = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(ONBOARDING_CHANGE)); };

function write(status: OnboardingStatus, step: number, team: number | null, max: number, replay: boolean): OnboardingRecord {
  const s = Math.min(Math.max(0, step), ONBOARDING_STEPS - 1);
  const rec: OnboardingRecord = { v: 1, status, step: s, team, max: Math.max(s, max), replay, at: new Date().toISOString() };
  memory = rec;
  try { localStorage.setItem(ONBOARDING_KEY, JSON.stringify(rec)); } catch { /* storage blocked: memory holds it */ }
  announce();
  return rec;
}

/** Open it at step 1: a new visitor's first time, or (`replay`) "Show the welcome again". */
export function openOnboarding(replay = false): OnboardingRecord {
  if (!replay) sendOnboarding("shown", 1);
  return write("open", 0, null, 0, replay);
}
/** Move to step `n` (0-based) while it's open; `team` records (or, with null, forgets) the team step 2 saved. */
export function moveOnboarding(n: number, team?: number | null): OnboardingRecord | null {
  const r = readOnboarding();
  if (r?.status !== "open") return r;
  if (!r.replay && n > r.max) sendOnboarding("reached", n + 1);
  return write("open", n, team === undefined ? r.team : team, r.max, r.replay);
}
/** End it for good here: Skip, or the last step's button. */
export function endOnboarding(status: "finished" | "skipped"): OnboardingRecord {
  const r = readOnboarding();
  const step = r?.step ?? 0;
  if (r?.status === "open" && !r.replay) sendOnboarding(status, status === "finished" ? ONBOARDING_STEPS : step + 1, status === "finished" && r.team != null);
  return write(status, step, r?.team ?? null, r?.max ?? step, r?.replay ?? false);
}

/** Forget it ("Clear all local data", tests): a new visitor again. */
export function resetOnboarding(): void {
  memory = null;
  try { localStorage.removeItem(ONBOARDING_KEY); } catch { /* storage blocked */ }
  announce();
}

let snapshot: { raw: OnboardingRecord | null; key: string } = { raw: null, key: "" };
/** A stable value for useSyncExternalStore: the same object until the record changes. */
function current(): OnboardingRecord | null {
  const r = readOnboarding();
  const key = r ? `${r.status}:${r.step}:${r.team}:${r.max}:${r.at}` : "";
  if (key !== snapshot.key) snapshot = { raw: r, key };
  return snapshot.raw;
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== ONBOARDING_KEY) return;
    // Another tab wrote it (a step, Skip, Done, a reset): read storage, not this tab's copy.
    memory = null;
    cb();
  };
  window.addEventListener(ONBOARDING_CHANGE, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(ONBOARDING_CHANGE, cb); window.removeEventListener("storage", onStorage); };
}

/** The record, as React state that follows this tab and others. */
export const useOnboardingRecord = () => useSyncExternalStore(subscribe, current, () => null);

/** The automation opt-in. */
export function onboardingDemo(): boolean {
  try { return localStorage.getItem(ONBOARDING_DEMO_KEY) === "1"; } catch { return false; }
}

/**
 * Already uses Control Scout: a team of their own, tracked teams or events, a shortlist, or (signed in) a workspace.
 * Keeps the onboarding from starting; never ends one that's open (picking a team is one of its steps).
 */
export function usesTheApp(state: Pick<PersonalState, "myTeam" | "tracked" | "bookmarks">, user: AccountUser | null): boolean {
  if (state.myTeam != null || state.tracked.teams.length > 0 || state.tracked.events.length > 0 || state.bookmarks.length > 0) return true;
  return (user?.controlPoint?.workspaces?.length ?? 0) > 0;
}

/** Where it starts: Home only. A visitor who lands on a team or event page came for that page. */
export const startsOn = (pathname: string) => (pathname.replace(/\/+$/, "") || "/") === "/";
