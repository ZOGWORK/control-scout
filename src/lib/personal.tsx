// Personal data store. Anonymous-first: everything works from localStorage
// with no account. Signed in, every change is written locally first and then
// pushed (last write wins); the first sign-in on a device merges the device's
// data into the account so nothing is lost.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "./api";
import { cleanValue, EMPTY_STATE, PERSONAL_KEYS, type PersonalKey, type PersonalState, type Stamped } from "../shared/personal";
import { clearLocalScouting, exportLocalScouting, importLocalScouting, localScoutEntries, storedScoutEntry } from "./scouting";

export interface AccountUser { id: number; email: string | null; displayName: string | null; createdAt: string; /** Tied to the shared account Control Point keeps (docs/shared-accounts.md). */ controlPointLinked?: boolean;
  /** The signed-in owner's Control Point side: whether they're a member there, and their teams. */
  controlPoint?: { /** The shared account id (author/editor ids on workspace entries). Missing from older servers. */ accountId?: number; member: boolean; teams: { teamNumber: number | null; name: string }[]; shortlist?: number[];
    /** Control Point workspaces (one shared scout space each). Missing from older servers: treat as none. */
    workspaces?: { id: string; name: string; role: "admin" | "member" }[]; url: string } | null }
/** Fired on window for every explicit sign-in (detail: the AccountUser). */
export const SIGNED_IN = "cs-signed-in";
export function announceSignIn(u: AccountUser) { window.dispatchEvent(new CustomEvent<AccountUser>(SIGNED_IN, { detail: u })); }

export interface AuthProviders { email: boolean; google: boolean; controlPoint?: boolean; /** Google / Discord / GitHub, run by Control Point for us. */ via?: ("google" | "discord" | "github")[] }
export type SyncStatus = "local" | "synced" | "syncing" | "offline" | "error";

interface PersonalApi {
  state: PersonalState;
  user: AccountUser | null;
  /** Null until /api/auth/me has answered. */
  providers: AuthProviders | null;
  sync: SyncStatus;
  /** Signed in AND this device's data confirmed as the account's: safe to sync scouting. */
  syncReady: boolean;
  /** Returns false when this device couldn't store the change (storage full or blocked): it lives only until the page closes. */
  set<K extends PersonalKey>(key: K, value: PersonalState[K]): boolean;
  update<K extends PersonalKey>(key: K, fn: (prev: PersonalState[K]) => PersonalState[K]): boolean;
  /** What this device has actually stored for the key: null when nothing is, undefined when storage
   *  can't be read (unknown, not empty). Equal to `state[key]` unless a write was refused. */
  stored<K extends PersonalKey>(key: K): PersonalState[K] | null | undefined;
  signedIn(user: AccountUser): Promise<void>;
  signOut(): Promise<void>;
  /** Wipe this device's personal data (account data is untouched). */
  clearLocal(): void;
}

const Ctx = createContext<PersonalApi | null>(null);
const LS = (k: PersonalKey) => `cs-personal:${k}`;
/** Key → the edit version (updatedAt) still waiting to reach the server. */
const PENDING = "cs-personal-pending-v2";
/**
 * Who this device's personal data belongs to: "" = anonymous (never synced),
 * otherwise the account id it was last synced with. Only anonymous data is
 * ever merged into an account; another account's data is never absorbed.
 */
const OWNER = "cs-personal-owner";

function readLocal(): Record<PersonalKey, Stamped<any> | null> {
  const out = {} as Record<PersonalKey, Stamped<any> | null>;
  for (const k of PERSONAL_KEYS) {
    try {
      const raw = localStorage.getItem(LS(k));
      const s = raw ? (JSON.parse(raw) as Stamped<unknown>) : null;
      const v = s ? cleanValue(k, s.value) : null;
      out[k] = s && (v !== null || k === "myTeam") ? { value: v, updatedAt: Number(s.updatedAt) || 0 } : null;
    } catch { out[k] = null; }
  }
  return out;
}
/** False when storage is full or blocked. */
function writeLocal(k: PersonalKey, s: Stamped<unknown>): boolean { try { localStorage.setItem(LS(k), JSON.stringify(s)); return true; } catch { return false; } }
function pending(): Partial<Record<PersonalKey, number>> { try { return JSON.parse(localStorage.getItem(PENDING) ?? "{}"); } catch { return {}; } }
function setPendingMap(p: Partial<Record<PersonalKey, number>>) { try { localStorage.setItem(PENDING, JSON.stringify(p)); } catch { /* ignore */ } }
function markPending(k: PersonalKey, version: number) { const p = pending(); p[k] = Math.max(p[k] ?? 0, version); setPendingMap(p); }
/** Clear a key's marker only if nothing newer than `version` is waiting. */
function ackPending(k: PersonalKey, version: number) { const p = pending(); if ((p[k] ?? 0) <= version) { delete p[k]; setPendingMap(p); } }
/**
 * Each account's copy on this device is kept under its own key when another
 * account signs in — including edits that haven't reached the server yet —
 * and restored (then synced) the next time that account signs in here.
 */
const STASH = (owner: string) => `cs-stash:${owner}`;
interface Stash { personal: Partial<Record<PersonalKey, Stamped<unknown>>>; pending: Partial<Record<PersonalKey, number>>; scouting: ReturnType<typeof exportLocalScouting> }
function stashOwner(owner: string, live: Record<PersonalKey, Stamped<any> | null>) {
  const s: Stash = { personal: Object.fromEntries(PERSONAL_KEYS.filter((k) => live[k]).map((k) => [k, live[k]!])), pending: pending(), scouting: exportLocalScouting() };
  try { localStorage.setItem(STASH(owner), JSON.stringify(s)); }
  catch { throw new Error("This device is out of storage, so it can't keep the other account's unsynced data aside. Free some space and sign in again."); }
}
function takeStash(owner: string): Stash | null {
  try { const raw = localStorage.getItem(STASH(owner)); if (!raw) return null; localStorage.removeItem(STASH(owner)); return JSON.parse(raw); } catch { return null; }
}

const getOwner = () => { try { return localStorage.getItem(OWNER) ?? ""; } catch { return ""; } };
const setOwner = (v: string) => { try { localStorage.setItem(OWNER, v); } catch { /* ignore */ } };

const toState = (s: Record<PersonalKey, Stamped<any> | null>): PersonalState =>
  Object.fromEntries(PERSONAL_KEYS.map((k) => [k, s[k]?.value ?? EMPTY_STATE[k]])) as unknown as PersonalState;

export function PersonalProvider({ children }: { children: ReactNode }) {
  const stamped = useRef(readLocal());
  const [state, setState] = useState<PersonalState>(() => toState(stamped.current));
  const [user, setUser] = useState<AccountUser | null>(null);
  const [providers, setProviders] = useState<PersonalApi["providers"]>(null);
  const [sync, setSync] = useState<SyncStatus>("local");
  /** True once this device's data is confirmed to belong to the signed-in account. */
  const [syncReady, setSyncReady] = useState(false);
  const userRef = useRef<AccountUser | null>(null);
  const readyRef = useRef(false);
  userRef.current = user;

  const apply = useCallback((k: PersonalKey, s: Stamped<any>): boolean => {
    stamped.current[k] = s;
    const stored = writeLocal(k, s);
    setState((prev) => ({ ...prev, [k]: s.value ?? EMPTY_STATE[k] }));
    return stored;
  }, []);

  // One upload loop at a time; edits made meanwhile stay pending and go next.
  const pushing = useRef<Promise<void> | null>(null);
  const push = useCallback(async (): Promise<void> => {
    if (!userRef.current || !readyRef.current) return;
    if (pushing.current) { await pushing.current; if (!Object.keys(pending()).length) return; }
    const run = (async () => {
      setSync("syncing");
      try {
        for (;;) {
          const keys = Object.keys(pending()) as PersonalKey[];
          if (!keys.length) break;
          for (const k of keys) {
            const s = stamped.current[k];
            if (!s) { ackPending(k, Infinity); continue; }
            const r = await apiFetch<{ stored: Stamped<any> }>(`/api/me/state/${k}`, { method: "PUT", json: s });
            // Another device wrote something newer: adopt it (unless we edited again since).
            if (r.stored.updatedAt > s.updatedAt && (stamped.current[k]?.updatedAt ?? 0) <= s.updatedAt) apply(k, r.stored);
            ackPending(k, s.updatedAt);
          }
        }
        setSync("synced");
      } catch (e: any) {
        setSync(e?.offline ? "offline" : "error");
      }
    })();
    pushing.current = run;
    try { await run; } finally { if (pushing.current === run) pushing.current = null; }
  }, [apply]);

  /** Pull the account's state; the newer side wins per key; newer local edits are pushed. */
  const pull = useCallback(async (alive: () => boolean = () => true) => {
    const r = await apiFetch<{ state: Partial<Record<PersonalKey, Stamped<any>>> }>("/api/me/state");
    if (!alive()) return;
    for (const k of PERSONAL_KEYS) {
      const remote = r.state[k], local = stamped.current[k];
      if (remote && (!local || remote.updatedAt > local.updatedAt)) apply(k, remote);
      else if (local && (!remote || local.updatedAt > remote.updatedAt)) markPending(k, local.updatedAt);
    }
  }, [apply]);

  /** First sign-in with anonymous data on this device: merge it into the account. */
  const migrate = useCallback(async (alive: () => boolean = () => true) => {
    const snapshot = Object.fromEntries(PERSONAL_KEYS.filter((k) => stamped.current[k]).map((k) => [k, stamped.current[k]])) as Record<PersonalKey, Stamped<any>>;
    const r = await apiFetch<{ state: Record<PersonalKey, Stamped<any>> }>("/api/me/migrate", { method: "POST", json: { state: snapshot, scout: localScoutEntries().map(storedScoutEntry) } });
    if (!alive()) return;
    for (const [k, s] of Object.entries(r.state) as [PersonalKey, Stamped<any>][]) {
      const now = stamped.current[k];
      // Edited while the merge was in flight: keep the newer local edit and send it next.
      if (now && now.updatedAt > (snapshot[k]?.updatedAt ?? 0)) { markPending(k, now.updatedAt); continue; }
      apply(k, s);
      ackPending(k, s.updatedAt);
    }
  }, [apply]);

  // Each connection belongs to one account and one generation. A different
  // account signing in, or a sign-out, bumps the generation so stale work
  // stops at its next await instead of blocking or overwriting the new state.
  const generation = useRef(0);
  const connectingFor = useRef<string | null>(null);
  const connect = useCallback(async (u: AccountUser) => {
    if (connectingFor.current === String(u.id)) return; // already connecting this account
    const mine = ++generation.current;
    const alive = () => generation.current === mine;
    connectingFor.current = String(u.id);
    setUser(u);
    userRef.current = u;
    readyRef.current = false;
    setSyncReady(false);
    setSync("syncing");
    try {
      const owner = getOwner();
      if (owner === "") { await migrate(alive); if (!alive()) return; }
      else if (owner !== String(u.id)) {
        // This device holds another account's copy: keep it aside (unsent edits
        // included) rather than absorbing it into this account or deleting it.
        stashOwner(owner, stamped.current);
        for (const k of PERSONAL_KEYS) { try { localStorage.removeItem(LS(k)); } catch { /* ignore */ } stamped.current[k] = null; }
        setPendingMap({});
        clearLocalScouting();
        setState(EMPTY_STATE);
        setOwner(String(u.id));
        // This account's own copy from an earlier visit, if any: back in place,
        // its unsent edits still pending.
        const mine = takeStash(String(u.id));
        if (mine) {
          for (const [k, s] of Object.entries(mine.personal) as [PersonalKey, Stamped<any>][]) apply(k, s);
          setPendingMap(mine.pending ?? {});
          importLocalScouting(mine.scouting ?? { entries: [], dirty: [] });
        }
        await pull(alive);
      } else await pull(alive);
      if (!alive()) return;
      setOwner(String(u.id));
      readyRef.current = true;
      setSyncReady(true);
      await push();
      if (alive() && !Object.keys(pending()).length) setSync("synced");
    } catch (e: any) { if (alive()) setSync(e?.offline ? "offline" : "error"); }
    finally { if (alive()) connectingFor.current = null; }
  }, [apply, migrate, pull, push]);

  useEffect(() => {
    apiFetch<{ user: AccountUser | null; providers: AuthProviders }>("/api/auth/me")
      .then((r) => { setProviders(r.providers); if (r.user) connect(r.user); })
      .catch(() => setProviders({ email: false, google: false }));
    const retry = () => {
      const u = userRef.current;
      if (!u) return;
      if (!readyRef.current) connect(u); // the sign-in sync didn't finish (e.g. offline): redo it
      else if (Object.keys(pending()).length) push();
    };
    window.addEventListener("online", retry);
    const t = setInterval(retry, 30_000);
    // Another tab changed something: reload it.
    const onStorage = (e: StorageEvent) => {
      const k = PERSONAL_KEYS.find((x) => LS(x) === e.key);
      if (k && e.newValue) { try { const s = JSON.parse(e.newValue); stamped.current[k] = s; setState((p) => ({ ...p, [k]: s.value })); } catch { /* ignore */ } }
    };
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("online", retry); window.removeEventListener("storage", onStorage); clearInterval(t); };
  }, [connect, push]);

  const set = useCallback(<K extends PersonalKey>(key: K, value: PersonalState[K]) => {
    const s = { value, updatedAt: Date.now() };
    const stored = apply(key, s);
    // Signed out, edits stay local; they're compared with the account on the next sign-in.
    if (userRef.current) { markPending(key, s.updatedAt); push(); }
    return stored;
  }, [apply, push]);

  const update = useCallback(<K extends PersonalKey>(key: K, fn: (prev: PersonalState[K]) => PersonalState[K]) => {
    return set(key, fn((stamped.current[key]?.value ?? EMPTY_STATE[key]) as PersonalState[K]));
  }, [set]);

  const signOut = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST", json: {} }).catch(() => {});
    // The device keeps its copy, still marked as this account's (never treated as anonymous).
    generation.current++; // any connection still in flight is now stale
    connectingFor.current = null;
    setUser(null);
    userRef.current = null;
    readyRef.current = false;
    setSyncReady(false);
    setSync("local");
  }, []);

  const clearLocal = useCallback(() => {
    for (const k of PERSONAL_KEYS) { try { localStorage.removeItem(LS(k)); } catch { /* ignore */ } stamped.current[k] = null; }
    setPendingMap({});
    // A wiped device starts anonymous again — unless an account is signed in right now.
    setOwner(userRef.current ? String(userRef.current.id) : "");
    setState(EMPTY_STATE);
  }, []);

  // An explicit sign-in (email code, from any form): announced, so the account menu can play the
  // merge for an existing Control Point account. Page loads that restore a session don't announce.
  const signedIn = useCallback((u: AccountUser) => { announceSignIn(u); return connect(u); }, [connect]);
  const stored = useCallback(<K extends PersonalKey>(key: K): PersonalState[K] | null | undefined => {
    try {
      const raw = localStorage.getItem(LS(key));
      return raw ? (cleanValue(key, (JSON.parse(raw) as Stamped<unknown>).value) as PersonalState[K] | null) : null;
    } catch { return undefined; } // blocked or corrupt: unknown
  }, []);

  const api = useMemo<PersonalApi>(() => ({ state, user, providers, sync, syncReady, set, update, stored, signedIn, signOut, clearLocal }), [state, user, providers, sync, syncReady, set, update, stored, signedIn, signOut, clearLocal]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePersonal(): PersonalApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePersonal outside PersonalProvider");
  return c;
}

/** Convenience: is this team tracked / bookmarked / my team? */
export function useTeamFlags(team: number) {
  const { state, update, set } = usePersonal();
  return {
    isMine: state.myTeam === team,
    tracked: state.tracked.teams.includes(team),
    bookmarked: state.bookmarks.includes(team),
    setMine: (on: boolean) => set("myTeam", on ? team : null),
    toggleTracked: () => update("tracked", (t) => ({ ...t, teams: t.teams.includes(team) ? t.teams.filter((x) => x !== team) : [...t.teams, team] })),
    toggleBookmark: () => update("bookmarks", (b) => (b.includes(team) ? b.filter((x) => x !== team) : [...b, team])),
  };
}
