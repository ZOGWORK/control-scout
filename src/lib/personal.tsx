// Personal data store. Anonymous-first: everything works from localStorage
// with no account. Signed in, every change is written locally first and then
// pushed (last write wins); the first sign-in on a device merges the device's
// data into the account so nothing is lost.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "./api";
import type { OrphanState } from "../shared/orphaned";
import { cleanValue, EMPTY_STATE, PERSONAL_KEYS, type PersonalKey, type PersonalState, type Stamped } from "../shared/personal";
import { clearLocalScouting, exportLocalScouting, importLocalScouting, localScoutEntries, setScoutViewer, storedScoutEntry } from "./scouting";
import { LOST_PREFIX, lostBackupFailed, mergeLostLists } from "./lostEdits";

export interface AccountUser { id: number; email: string | null; displayName: string | null; createdAt: string; /** Tied to the shared account Control Point keeps (docs/shared-accounts.md). */ controlPointLinked?: boolean;
  /** Only present (true) for the owner (OWNER_EMAILS): shows the owner portal's nav item. The server enforces access. */
  isOwner?: true;
  /** The signed-in owner's Control Point side: whether they're a member there, and their teams. */
  controlPoint?: { /** The shared account id (author/editor ids on workspace entries). Missing from older servers. */ accountId?: number; member: boolean; teams: { teamNumber: number | null; name: string }[]; shortlist?: number[];
    /** Control Point workspaces (one shared scout space each). Missing from older servers: treat as none. */
    workspaces?: { id: string; name: string; role: "admin" | "member"; /** Read-only (Task 19): deleted in Control Point, or no admin left. */ orphaned?: OrphanState }[]; url: string } | null }
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
  /**
   * True while `user` is the account this device last saw signed in (ACCOUNT_CACHE_KEY), because the
   * app opened offline and /api/auth/me couldn't answer. Its workspaces still pick the scout space,
   * so entries saved now go to the right one and sync once /me answers again; nothing syncs until then
   * (syncReady stays false).
   */
  offlineAccount: boolean;
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
  /**
   * Ask /api/auth/me again and take the account's new answer (its Control Point workspaces and roles),
   * without re-syncing. Also runs by itself every few minutes while the app is visible and when it comes
   * back to the front, so a workspace removed in Control Point leaves the app (scoutSpace.ts) without a reload.
   */
  refreshUser(): Promise<void>;
  /** Wipe this device's personal data (account data is untouched). */
  clearLocal(): void;
}

const Ctx = createContext<PersonalApi | null>(null);
/** How often a visible app re-reads the account (/api/auth/me), and the least gap when it comes back to the front. */
export const USER_REFRESH_MS = 5 * 60_000;
export const USER_REFRESH_MIN_GAP_MS = 60_000;
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
  // What an earlier sign-in couldn't put back yet (the device was full) stays in the stash too.
  s.scouting = withLeftovers(s.scouting, peekStash(owner)?.scouting);
  try { localStorage.setItem(STASH(owner), JSON.stringify(s)); }
  catch { throw new Error("This device is out of storage, so it can't keep the other account's unsynced data aside. Free some space and sign in again."); }
}
function peekStash(owner: string): Stash | null {
  try { const raw = localStorage.getItem(STASH(owner)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
/**
 * Put an account's stashed copy back. The stash is removed only once everything that exists nowhere else is
 * back: overwritten edits (lostEdits.ts) the device couldn't store stay stashed (and are said to be waiting),
 * to be tried again on the next sign-in.
 */
function restoreStash(owner: string, mine: Stash, apply: (k: PersonalKey, s: Stamped<any>) => void) {
  for (const [k, s] of Object.entries(mine.personal ?? {}) as [PersonalKey, Stamped<any>][]) apply(k, s);
  if (mine.pending) setPendingMap({ ...pending(), ...mine.pending });
  let { failed } = importLocalScouting(mine.scouting ?? { entries: [], dirty: [] });
  // Something didn't fit with the stash still here: drop the stash (freeing its room) and put back just what's missing.
  if (failed) {
    try { localStorage.removeItem(STASH(owner)); } catch { /* blocked */ }
    failed = importLocalScouting(failed).failed;
  }
  try {
    // What still didn't fit stays stashed (smaller than the stash it came from), tried again on the next sign-in.
    if (!failed) localStorage.removeItem(STASH(owner));
    else localStorage.setItem(STASH(owner), JSON.stringify({ personal: {}, pending: {}, scouting: failed } satisfies Stash));
  } catch { /* storage blocked */ }
  for (const k of Object.keys(failed?.lost ?? {})) lostBackupFailed(k.slice(LOST_PREFIX.length));
}

/** A stash's scouting with what an earlier sign-in couldn't put back (`left`) carried into it (nothing dropped). */
function withLeftovers(now: Stash["scouting"], left: Stash["scouting"] | undefined): Stash["scouting"] {
  if (!left) return now;
  const add = (cur: { entries: ScoutEntryLike[]; dirty: string[] }, more: { entries?: ScoutEntryLike[]; dirty?: string[] } | undefined) => {
    for (const e of more?.entries ?? []) if (!cur.entries.some((x) => x.uuid === e.uuid)) cur.entries.push(e);
    for (const u of more?.dirty ?? []) if (!cur.dirty.includes(u)) cur.dirty.push(u);
  };
  const out = { ...now, entries: [...now.entries], dirty: [...now.dirty], spaces: { ...(now.spaces ?? {}) }, lost: { ...(now.lost ?? {}) } };
  add(out, left);
  for (const [w, s] of Object.entries(left.spaces ?? {})) {
    const cur = out.spaces[w] = { ...(out.spaces[w] ?? { entries: [], dirty: [] }) };
    cur.entries = [...cur.entries]; cur.dirty = [...cur.dirty];
    add(cur, s);
  }
  for (const [k, v] of Object.entries(left.lost ?? {})) out.lost[k] = mergeLostLists(out.lost[k], v);
  return out;
}
type ScoutEntryLike = { uuid: string };

/**
 * Device-only (Tier 3, docs/settings.md): the signed-in account as /api/auth/me last answered, kept so
 * an app opened offline still knows its workspaces (scout spaces). Written on every answer with an
 * account, removed on sign-out or when /me says signed out. Used only for the device's own account
 * (OWNER) and never sent anywhere.
 */
export const ACCOUNT_CACHE_KEY = "cs-account-cache";
function cacheAccount(u: AccountUser | null) {
  try { if (u) localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(u)); else localStorage.removeItem(ACCOUNT_CACHE_KEY); } catch { /* storage blocked: no offline account */ }
}
/** The cached account, if it's the one this device's data belongs to. */
function cachedAccount(): AccountUser | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_CACHE_KEY);
    const u = raw ? (JSON.parse(raw) as AccountUser) : null;
    return u && Number.isSafeInteger(u.id) && String(u.id) === getOwner() ? u : null;
  } catch { return null; }
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
  const [offlineAccount, setOfflineAccount] = useState(false);
  const offlineRef = useRef(false);
  const [sync, setSync] = useState<SyncStatus>("local");
  /** True once this device's data is confirmed to belong to the signed-in account. */
  const [syncReady, setSyncReady] = useState(false);
  const userRef = useRef<AccountUser | null>(null);
  const readyRef = useRef(false);
  userRef.current = user;
  // Scouting tells this account's own edits from other members' (an overwritten edit is a conflict only if it was yours).
  setScoutViewer(user?.controlPoint?.accountId);

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
    offlineRef.current = false; setOfflineAccount(false);
    cacheAccount(u);
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
        const mine = peekStash(String(u.id));
        if (mine) restoreStash(String(u.id), mine, apply);
        await pull(alive);
      } else {
        // Overwritten edits an earlier switch couldn't put back (the device was full): try again.
        const left = peekStash(String(u.id));
        if (left) restoreStash(String(u.id), left, apply);
        await pull(alive);
      }
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
    // Opened offline: /me can't answer, so the account this device last saw stands in (offlineAccount) until it can.
    // A reply is for the generation it was asked in: a sign-out or another sign-in meanwhile makes it stale.
    const load = () => { const asked = generation.current; return apiFetch<{ user: AccountUser | null; providers: AuthProviders }>("/api/auth/me")
      .then((r) => {
        if (generation.current !== asked) return;
        setProviders(r.providers);
        if (r.user) { connect(r.user); return; }
        cacheAccount(null);
        if (offlineRef.current) { offlineRef.current = false; setOfflineAccount(false); generation.current++; userRef.current = null; setUser(null); setSync("local"); }
      })
      .catch((e: { offline?: boolean }) => {
        if (generation.current !== asked) return;
        if (offlineRef.current) return; // still offline: keep the cached account
        setProviders((p) => p ?? { email: false, google: false });
        const cached = e?.offline ? cachedAccount() : null;
        if (!cached || userRef.current) return;
        offlineRef.current = true; setOfflineAccount(true);
        userRef.current = cached; setUser(cached); setSync("offline");
      }); };
    void load();
    const retry = () => {
      if (offlineRef.current) { void load(); return; } // back online: ask /me again, then sync as usual
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
    cacheAccount(null); offlineRef.current = false; setOfflineAccount(false);
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

  const lastRefresh = useRef(Date.now()); // the page load just asked
  // Each refresh's order, and the newest one applied: a reply older than that is dropped.
  const refreshSeq = useRef(0);
  const appliedSeq = useRef(0);
  const refreshUser = useCallback(async () => {
    const u = userRef.current;
    if (!u || offlineRef.current) return; // the offline stand-in: the reconnect asks /me itself
    const mine = generation.current;
    const seq = ++refreshSeq.current;
    lastRefresh.current = Date.now();
    try {
      const r = await apiFetch<{ user: AccountUser | null }>("/api/auth/me");
      // A newer refresh already answered (e.g. the one after leaving a workspace): this older reply is stale.
      if (seq < appliedSeq.current) return;
      // The session ended (signed out elsewhere, or expired): opening offline later mustn't bring this account back.
      if (generation.current === mine && !r.user) cacheAccount(null);
      // Signed out meanwhile, or another account: that's the next page load's to handle, not this refresh's.
      if (generation.current !== mine || !r.user || r.user.id !== userRef.current?.id) return;
      appliedSeq.current = seq;
      if (JSON.stringify(r.user) === JSON.stringify(userRef.current)) return;
      cacheAccount(r.user);
      userRef.current = r.user;
      setUser(r.user);
    } catch { /* offline: the next one tries again */ }
  }, []);
  useEffect(() => {
    const due = () => document.visibilityState === "visible" && Date.now() - lastRefresh.current >= USER_REFRESH_MIN_GAP_MS;
    const onFront = () => { if (due()) void refreshUser(); };
    const t = setInterval(() => { if (document.visibilityState === "visible") void refreshUser(); }, USER_REFRESH_MS);
    document.addEventListener("visibilitychange", onFront);
    window.addEventListener("focus", onFront);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onFront); window.removeEventListener("focus", onFront); };
  }, [refreshUser]);

  const api = useMemo<PersonalApi>(() => ({ state, user, providers, offlineAccount, sync, syncReady, set, update, stored, signedIn, signOut, refreshUser, clearLocal }), [state, user, providers, offlineAccount, sync, syncReady, set, update, stored, signedIn, signOut, refreshUser, clearLocal]);
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
