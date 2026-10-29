// Feature flags in the browser: GET /api/flags, read once at start and again every few minutes,
// so a switch the owner flips (server/flags.ts) reaches open pages without a reload. Until the
// first answer, and whenever it can't be had (offline), every flag is on: the server still
// enforces its own switches, so a stale "on" here only means a feature that politely refuses.
import { useSyncExternalStore } from "react";
import { DEFAULT_FLAGS, type Flag, type FlagSet, type FlagsAnswer } from "../shared/flags";

let flags: FlagSet = { ...DEFAULT_FLAGS };
/** The signed-in account's workspaces' own values of workspace-scoped flags (only when some workspace has an override). */
let byWorkspace: Record<string, Partial<FlagSet>> = {};
let byWorkspaceKey = "{}";
/** Has the server answered at least once on this page? */
let confirmed = false;
const subs = new Set<() => void>();
const listeners = new Set<(f: FlagSet) => void>();

const REFRESH_MS = 3 * 60_000;

function set(next: FlagSet, ws: Record<string, Partial<FlagSet>> = byWorkspace) {
  const key = JSON.stringify(ws);
  if ((Object.keys(next) as Flag[]).every((k) => next[k] === flags[k]) && key === byWorkspaceKey) return;
  flags = next;
  byWorkspace = ws;
  byWorkspaceKey = key;
  for (const f of subs) f();
  for (const f of listeners) { try { f(flags); } catch { /* a listener's failure stays its own */ } }
}

/** Ask the server for the current flags (quietly keeps the last known ones on any failure). */
export async function refreshFlags(): Promise<FlagSet> {
  // Asked whatever navigator.onLine says (iOS can report offline while online); a failure keeps the last flags.
  try {
    const r = await fetch("/api/flags", { credentials: "same-origin" });
    if (r.ok) {
      const body = (await r.json()) as Partial<FlagsAnswer> & { flags?: Partial<FlagSet> };
      const next = { ...DEFAULT_FLAGS };
      for (const k of Object.keys(next) as Flag[]) if (typeof body.flags?.[k] === "boolean") next[k] = body.flags[k]!;
      const ws: Record<string, Partial<FlagSet>> = {};
      if (body.workspaces && typeof body.workspaces === "object") {
        for (const [id, v] of Object.entries(body.workspaces)) {
          if (!v || typeof v !== "object") continue;
          const o: Partial<FlagSet> = {};
          for (const k of Object.keys(DEFAULT_FLAGS) as Flag[]) if (typeof v[k] === "boolean") o[k] = v[k];
          ws[id] = o;
        }
      }
      const first = !confirmed;
      confirmed = true;
      set(next, ws);
      if (first) for (const f of subs) f();
    }
  } catch { /* offline: keep what we have */ }
  return flags;
}

/** The flag's last known value (on until the server says otherwise). */
export const flagOn = (name: Flag) => flags[name];

/** A workspace-scoped flag for one workspace: its own setting when the server sent one, else the flag's value. */
export const workspaceFlagOn = (name: Flag, workspaceId: string | null | undefined) =>
  (workspaceId != null ? byWorkspace[workspaceId]?.[name] : undefined) ?? flags[name];

/** Call `fn` with the flags now and whenever they change; returns an unsubscribe. */
export function onFlags(fn: (f: FlagSet) => void): () => void {
  listeners.add(fn);
  fn(flags);
  return () => { listeners.delete(fn); };
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** A flag, re-rendering when it changes. */
export const useFlag = (name: Flag) => useSyncExternalStore(subscribe, () => flags[name], () => DEFAULT_FLAGS[name]);
/** A workspace-scoped flag for one workspace (workspaceFlagOn), re-rendering when it changes. */
export const useWorkspaceFlag = (name: Flag, workspaceId: string | null | undefined) =>
  useSyncExternalStore(subscribe, () => workspaceFlagOn(name, workspaceId), () => DEFAULT_FLAGS[name]);

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
export function resetFlags(next: FlagSet = { ...DEFAULT_FLAGS }, serverAnswered = false, workspaces: Record<string, Partial<FlagSet>> = {}): void {
  confirmed = serverAnswered;
  set(next, workspaces);
  for (const f of subs) f();
}
