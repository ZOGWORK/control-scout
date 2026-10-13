// Personal data store. Anonymous-first: everything works from localStorage
// with no account. Signed in, every change is written locally first and then
// pushed (last write wins); the first sign-in on a device merges the device's
// data into the account so nothing is lost.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "./api";
import { cleanValue, EMPTY_STATE, PERSONAL_KEYS, type PersonalKey, type PersonalState, type Stamped } from "../shared/personal";
import { localScoutEntries } from "./scouting";

export interface AccountUser { id: number; email: string | null; displayName: string | null; createdAt: string }
export type SyncStatus = "local" | "synced" | "syncing" | "offline" | "error";

interface PersonalApi {
  state: PersonalState;
  user: AccountUser | null;
  /** Null until /api/auth/me has answered. */
  providers: { email: boolean; google: boolean } | null;
  sync: SyncStatus;
  set<K extends PersonalKey>(key: K, value: PersonalState[K]): void;
  update<K extends PersonalKey>(key: K, fn: (prev: PersonalState[K]) => PersonalState[K]): void;
  signedIn(user: AccountUser): Promise<void>;
  signOut(): Promise<void>;
  /** Wipe this device's personal data (account data is untouched). */
  clearLocal(): void;
}

const Ctx = createContext<PersonalApi | null>(null);
const LS = (k: PersonalKey) => `cs-personal:${k}`;
const PENDING = "cs-personal-pending";
const MIGRATED = (id: number) => `cs-migrated:${id}`;

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
function writeLocal(k: PersonalKey, s: Stamped<unknown>) { try { localStorage.setItem(LS(k), JSON.stringify(s)); } catch { /* storage full or blocked */ } }
function pending(): Set<PersonalKey> { try { return new Set(JSON.parse(localStorage.getItem(PENDING) ?? "[]")); } catch { return new Set(); } }
function setPending(p: Set<PersonalKey>) { try { localStorage.setItem(PENDING, JSON.stringify([...p])); } catch { /* ignore */ } }

const toState = (s: Record<PersonalKey, Stamped<any> | null>): PersonalState =>
  Object.fromEntries(PERSONAL_KEYS.map((k) => [k, s[k]?.value ?? EMPTY_STATE[k]])) as unknown as PersonalState;

export function PersonalProvider({ children }: { children: ReactNode }) {
  const stamped = useRef(readLocal());
  const [state, setState] = useState<PersonalState>(() => toState(stamped.current));
  const [user, setUser] = useState<AccountUser | null>(null);
  const [providers, setProviders] = useState<PersonalApi["providers"]>(null);
  const [sync, setSync] = useState<SyncStatus>("local");
  const userRef = useRef<AccountUser | null>(null);
  userRef.current = user;

  const apply = useCallback((k: PersonalKey, s: Stamped<any>) => {
    stamped.current[k] = s;
    writeLocal(k, s);
    setState((prev) => ({ ...prev, [k]: s.value ?? EMPTY_STATE[k] }));
  }, []);

  const push = useCallback(async (keys: Iterable<PersonalKey>) => {
    if (!userRef.current) return;
    const p = pending();
    for (const k of keys) p.add(k);
    setPending(p);
    setSync("syncing");
    try {
      for (const k of [...p]) {
        const s = stamped.current[k];
        if (!s) { p.delete(k); continue; }
        const r = await apiFetch<{ stored: Stamped<any> }>(`/api/me/state/${k}`, { method: "PUT", json: s });
        // The server keeps the newer write: adopt it if another device won.
        if (r.stored.updatedAt > s.updatedAt) apply(k, r.stored);
        p.delete(k);
        setPending(p);
      }
      setSync("synced");
    } catch (e: any) {
      setSync(e?.offline ? "offline" : "error");
    }
  }, [apply]);

  /** Pull the account's state; newer side wins per key; push what's newer locally. */
  const pull = useCallback(async () => {
    const r = await apiFetch<{ state: Partial<Record<PersonalKey, Stamped<any>>> }>("/api/me/state");
    const newerLocal: PersonalKey[] = [];
    for (const k of PERSONAL_KEYS) {
      const remote = r.state[k], local = stamped.current[k];
      if (remote && (!local || remote.updatedAt > local.updatedAt)) apply(k, remote);
      else if (local && (!remote || local.updatedAt > remote.updatedAt)) newerLocal.push(k);
    }
    if (newerLocal.length) await push(newerLocal);
    else setSync("synced");
  }, [apply, push]);

  /** First sign-in on this device: merge local data into the account. */
  const migrate = useCallback(async (u: AccountUser) => {
    const local = Object.fromEntries(PERSONAL_KEYS.filter((k) => stamped.current[k]).map((k) => [k, stamped.current[k]]));
    const r = await apiFetch<{ state: Record<PersonalKey, Stamped<any>> }>("/api/me/migrate", { method: "POST", json: { state: local, scout: localScoutEntries() } });
    for (const [k, s] of Object.entries(r.state)) apply(k as PersonalKey, s);
    try { localStorage.setItem(MIGRATED(u.id), new Date().toISOString()); } catch { /* ignore */ }
    setPending(new Set());
    setSync("synced");
  }, [apply]);

  const connect = useCallback(async (u: AccountUser) => {
    setUser(u);
    userRef.current = u;
    setSync("syncing");
    try {
      if (!localStorage.getItem(MIGRATED(u.id))) await migrate(u);
      else await pull();
    } catch (e: any) { setSync(e?.offline ? "offline" : "error"); }
  }, [migrate, pull]);

  useEffect(() => {
    apiFetch<{ user: AccountUser | null; providers: { email: boolean; google: boolean } }>("/api/auth/me")
      .then((r) => { setProviders(r.providers); if (r.user) connect(r.user); })
      .catch(() => setProviders({ email: false, google: false }));
    const retry = () => { if (userRef.current && pending().size) push([]); };
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
    apply(key, { value, updatedAt: Date.now() });
    if (userRef.current) push([key]);
  }, [apply, push]);

  const update = useCallback(<K extends PersonalKey>(key: K, fn: (prev: PersonalState[K]) => PersonalState[K]) => {
    set(key, fn((stamped.current[key]?.value ?? EMPTY_STATE[key]) as PersonalState[K]));
  }, [set]);

  const signOut = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST", json: {} }).catch(() => {});
    setUser(null);
    userRef.current = null;
    setSync("local");
  }, []);

  const clearLocal = useCallback(() => {
    for (const k of PERSONAL_KEYS) { try { localStorage.removeItem(LS(k)); } catch { /* ignore */ } stamped.current[k] = null; }
    setPending(new Set());
    setState(EMPTY_STATE);
  }, []);

  const api = useMemo<PersonalApi>(() => ({ state, user, providers, sync, set, update, signedIn: connect, signOut, clearLocal }), [state, user, providers, sync, set, update, connect, signOut, clearLocal]);
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
