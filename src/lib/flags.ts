// Feature flags in the browser: GET /api/flags, read once at start and again every few minutes,
// so a switch the owner flips (server/flags.ts) reaches open pages without a reload. Until the
// first answer, and whenever it can't be had (offline), every flag is on: the server still
// enforces its own switches, so a stale "on" here only means a feature that politely refuses.
import { useSyncExternalStore } from "react";
import { DEFAULT_FLAGS, type Flag, type FlagSet } from "../shared/flags";

let flags: FlagSet = { ...DEFAULT_FLAGS };
/** Has the server answered at least once on this page? */
let confirmed = false;
const subs = new Set<() => void>();
const listeners = new Set<(f: FlagSet) => void>();

const REFRESH_MS = 3 * 60_000;

function set(next: FlagSet) {
  if ((Object.keys(next) as Flag[]).every((k) => next[k] === flags[k])) return;
  flags = next;
  for (const f of subs) f();
  for (const f of listeners) { try { f(flags); } catch { /* a listener's failure stays its own */ } }
}

/** Ask the server for the current flags (quietly keeps the last known ones on any failure). */
export async function refreshFlags(): Promise<FlagSet> {
  // Asked whatever navigator.onLine says (iOS can report offline while online); a failure keeps the last flags.
  try {
    const r = await fetch("/api/flags", { credentials: "same-origin" });
    if (r.ok) {
      const body = (await r.json()) as { flags?: Partial<FlagSet> };
      const next = { ...DEFAULT_FLAGS };
      for (const k of Object.keys(next) as Flag[]) if (typeof body.flags?.[k] === "boolean") next[k] = body.flags[k]!;
      const first = !confirmed;
      confirmed = true;
      set(next);
      if (first) for (const f of subs) f();
    }
  } catch { /* offline: keep what we have */ }
  return flags;
}

/** The flag's last known value (on until the server says otherwise). */
export const flagOn = (name: Flag) => flags[name];

/** Call `fn` with the flags now and whenever they change; returns an unsubscribe. */
export function onFlags(fn: (f: FlagSet) => void): () => void {
  listeners.add(fn);
  fn(flags);
  return () => { listeners.delete(fn); };
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** A flag, re-rendering when it changes. */
export const useFlag = (name: Flag) => useSyncExternalStore(subscribe, () => flags[name], () => DEFAULT_FLAGS[name]);

/**
 * A flag that's off until the server says it's on: for features that also need something only the
 * server knows (photos need R2 configured), so their UI never flashes in and out on a server without it.
 */
export const useServerFlag = (name: Flag) => useSyncExternalStore(subscribe, () => confirmed && flags[name], () => false);

let started = false;
/** Load the flags now and keep them fresh (once per page load). */
export function startFlags(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void refreshFlags();
  window.setInterval(() => { if (document.visibilityState === "visible") void refreshFlags(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refreshFlags(); });
  window.addEventListener("online", () => { void refreshFlags(); });
}

/** Tests: back to every flag on. */
export function resetFlags(next: FlagSet = { ...DEFAULT_FLAGS }, serverAnswered = false): void {
  confirmed = serverAnswered;
  set(next);
  for (const f of subs) f();
}
