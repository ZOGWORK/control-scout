// Which scout space the Scout page shows: Personal (your own entries, as ever) or one shared space
// per Control Point workspace the account belongs to.
//
// Rules (docs/shared-accounts.md, "Scout spaces"):
// - Signed out, workspace scouting switched off, or Control Point's answer unknown: Personal only.
// - Otherwise the URL (?space=<id> or ?space=personal) wins, then the space remembered on this
//   device (localStorage cs-scout-space, never synced), then the account's first workspace, then
//   Personal when it has none.
// - A URL or remembered workspace the account no longer belongs to is skipped, with a notice.
// - Losing the space on screen (the live stream says access ended, a push or pull is refused with
//   403, or the account's workspaces change) goes to Personal, with a notice.
// - Entries still queued for a workspace the account has left are moved to Personal, never dropped
//   (useQueuedScoutSync, moveQueuedToPersonal).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useFlag } from "./flags";
import { usePersonal, type AccountUser } from "./personal";
import { ACCOUNT_STALE, moveQueuedToPersonal, pendingScoutCounts, pullScouting, SCOUT_DENIED, SCOUT_READ_ONLY, syncQueuedScouting, syncScouting, type ScoutSpace } from "./scouting";
import { toast } from "../components/ui/sonner";
import { isAccessDenied } from "./api";
import { isOrphanReason, READ_ONLY_STATUS, type OrphanState } from "../shared/orphaned";

/** `orphaned`: the space is read-only (Task 19): deleted in Control Point, or no admin left. Reads and export still work. */
export interface WorkspaceSpace { id: string; name: string; role: "admin" | "member"; orphaned?: OrphanState }

/** Device-only (Tier 3): the space last shown here, as { id, name, account } (id "personal" for Personal). */
export const SPACE_STORAGE_KEY = "cs-scout-space";
/** The URL's word for the Personal space. */
export const PERSONAL_PARAM = "personal";
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The value of ?space= for a space. */
export const spaceParam = (space: ScoutSpace) => space ?? PERSONAL_PARAM;
/** A link to a space's scout page. */
export const scoutSpaceHref = (space: ScoutSpace) => `/scout?space=${encodeURIComponent(spaceParam(space))}`;
/** How a workspace is named in the app (Control Point may send an empty name). */
export const workspaceLabel = (w: { name: string } | undefined) => w?.name.trim() || "your workspace";

/**
 * The account's workspaces, as far as this device knows. `known` is false when it can't tell: signed out,
 * Control Point unreachable (controlPoint null) or an older server (no list). Then nothing counts as lost.
 */
export function workspacesOf(user: AccountUser | null): { list: WorkspaceSpace[]; known: boolean } {
  const ws = user?.controlPoint?.workspaces;
  if (!Array.isArray(ws)) return { list: [], known: false };
  const seen = new Set<string>();
  const list = ws.filter((w) => w && typeof w.id === "string" && WORKSPACE_ID.test(w.id) && !seen.has(w.id) && !!seen.add(w.id))
    .map((w) => {
      const o = w.orphaned as Partial<OrphanState> | undefined;
      const orphaned = o && typeof o === "object" && typeof o.at === "string" && isOrphanReason(o.reason) ? { orphaned: { at: o.at, reason: o.reason } } : {};
      return { id: w.id, name: typeof w.name === "string" ? w.name : "", role: w.role === "admin" ? "admin" as const : "member" as const, ...orphaned };
    });
  return { list, known: true };
}

/** `account`: the account (AccountUser.id) it was remembered for; another account signing in on this device ignores it. */
export interface RememberedSpace { id: string; name?: string; account?: number }

export function readRememberedSpace(): RememberedSpace | null {
  try {
    const raw = localStorage.getItem(SPACE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (typeof v === "string") return v === PERSONAL_PARAM || WORKSPACE_ID.test(v) ? { id: v } : null;
    if (!v || typeof v !== "object") return null;
    const { id, name, account } = v as { id?: unknown; name?: unknown; account?: unknown };
    if (typeof id !== "string" || !(id === PERSONAL_PARAM || WORKSPACE_ID.test(id))) return null;
    return { id, ...(typeof name === "string" && name ? { name: name.slice(0, 120) } : {}), ...(Number.isSafeInteger(account) ? { account: account as number } : {}) };
  } catch { return null; }
}

export function rememberSpace(space: ScoutSpace, name?: string, account?: number | null): RememberedSpace {
  const v: RememberedSpace = { id: space ?? PERSONAL_PARAM, ...(space != null && name ? { name } : {}), ...(account != null ? { account } : {}) };
  try { localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(v)); } catch { /* storage blocked: this visit only */ }
  return v;
}

export interface SpaceInput {
  signedIn: boolean;
  /** The workspaceScouting flag. */
  enabled: boolean;
  workspaces: WorkspaceSpace[];
  /** Whether `workspaces` is Control Point's answer (else nothing is "lost"). */
  known: boolean;
  /** The signed-in account (AccountUser.id): a space remembered for another account is ignored. */
  account?: number | null;
  /** ?space= */
  url: string | null;
  remembered: RememberedSpace | null;
}

export interface SpaceResolution {
  space: ScoutSpace;
  /** Whether the page offers a choice (signed in, flag on, Control Point's answer known). */
  switchable: boolean;
  /** A workspace asked for (URL first, then the remembered one) that isn't the account's: say so. */
  lost: { id: string; name?: string } | null;
}

/** Which space to show (pure: the rules at the top of this file). */
export function resolveScoutSpace(i: SpaceInput): SpaceResolution {
  if (!i.signedIn || !i.enabled || !i.known) return { space: null, switchable: false, lost: null };
  let lost: SpaceResolution["lost"] = null;
  const remembered = i.remembered && (i.remembered.account == null || i.remembered.account === i.account) ? i.remembered : null;
  for (const id of [i.url, remembered?.id]) {
    if (!id) continue;
    if (id === PERSONAL_PARAM) return { space: null, switchable: true, lost };
    if (i.workspaces.some((w) => w.id === id)) return { space: id, switchable: true, lost };
    if (!lost && WORKSPACE_ID.test(id)) lost = { id, name: remembered?.id === id ? remembered.name : undefined };
  }
  return { space: i.workspaces[0]?.id ?? null, switchable: true, lost };
}

/** The notice for a space the account can't open any more. */
export const lostNotice = (name?: string) => name?.trim()
  ? `You no longer have access to ${name.trim()}. Its shared entries are hidden; your personal entries are unchanged.`
  : "You don't have access to that workspace's scout space, so it isn't shown. Your personal entries are unchanged.";

/** The notice when the workspace on screen is taken away (removed in Control Point, or by an admin in Scout). */
export const removedNotice = (name?: string) =>
  `You were removed from ${name?.trim() || "this workspace"}. Its shared entries are hidden here; your personal entries are unchanged.`;

export interface ScoutSpaces {
  /** The space on screen (null = Personal). */
  space: ScoutSpace;
  /** The account's workspaces the switcher offers (Personal comes first, always). */
  workspaces: WorkspaceSpace[];
  /** Show the switcher. False: Personal only, exactly as before workspaces. */
  switchable: boolean;
  /** Sign-in hasn't answered yet and a workspace may be the one to show: hold the list back. */
  resolving: boolean;
  /** The workspace on screen, if any. */
  current: WorkspaceSpace | null;
  select(space: ScoutSpace): void;
  /** Access to a workspace ended (e.g. the live stream said so): leave it for Personal, with a notice. */
  revoke(id: string): void;
  notice: string | null;
  dismissNotice(): void;
}

export const QUEUE_RETRY_MS = 30_000;

/** The notice when entries queued for a workspace the account has left were moved to Personal. */
export const movedNotice = (n: number, name?: string) =>
  `${n === 1 ? "1 entry" : `${n} entries`} saved in ${name?.trim() || "a workspace you've left"} couldn't sync: you're no longer a member there. ${n === 1 ? "It's" : "They're"} kept in Personal, so nothing was lost.`;

/** The notice when entries queued for a read-only (orphaned, Task 19) workspace were moved to Personal. */
export const readOnlyMovedNotice = (n: number, name?: string) =>
  `${n === 1 ? "1 entry" : `${n} entries`} saved in ${name?.trim() || "a read-only workspace"} couldn't sync: the workspace is read-only now. ${n === 1 ? "It's" : "They're"} kept in Personal, so nothing was lost.`;

const deviceOwner = () => { try { return localStorage.getItem("cs-personal-owner"); } catch { return null; } };
/** One rescue per workspace at a time. */
const rescuing = new Set<string>();
/**
 * A workspace with entries queued on this device that the account can't write to any more: one the
 * account's list (Control Point's answer) no longer has (`readOnly` false), or one that is read-only now
 * (Task 19, `readOnly` true). Push once more, and only when the server refuses it too (403 for a removal,
 * 423 for a read-only space) move them to Personal, with a notice. Anything else (offline, paused, a server
 * error, or the push going through because the workspace came back) leaves them where they are.
 */
async function rescueQueued(space: string, name: string | undefined, alive: () => boolean, readOnly = false): Promise<void> {
  if (rescuing.has(space)) return;
  rescuing.add(space);
  // The device's data belongs to one account (personal.tsx, cs-personal-owner). Another account signing in
  // while the push is on its way swaps the local queues: then the answer is about the other account's
  // queue and nothing moves.
  const owner = deviceOwner();
  try { await syncScouting(space); }
  catch (e) {
    // Only a refusal that means "no access" (403, never feature_disabled: that's the owner pausing workspace scouting,
    // and the queue waits on the device) or "read-only" (423) moves anything.
    if (!(readOnly ? (e as { status?: unknown } | null)?.status === READ_ONLY_STATUS : isAccessDenied(e)) || !alive() || deviceOwner() !== owner) return;
    const n = moveQueuedToPersonal(space);
    // Still readable here (read-only): the server's copies of what was queued (refused edits and deletes) come back.
    if (readOnly) void pullScouting(space).catch(() => undefined);
    if (!n) return;
    toast.warning((readOnly ? readOnlyMovedNotice : movedNotice)(n, name), { duration: 20_000 });
    void syncScouting(null).catch(() => undefined); // up to the account now (else the next tick)
  } finally { rescuing.delete(space); }
}

/**
 * Entries saved while offline go up when the connection comes back, in every space, not only the
 * one on screen (whose list syncs itself): at sign-in, on reconnect, and every 30 s while any wait.
 * Workspaces only while workspace scouting is on and the account still belongs to them; a queue for
 * one it has left is rescued (rescueQueued). A refused push or pull (SCOUT_DENIED) re-reads the
 * account at once, so its workspace list (and with it the page and this queue) catches up.
 */
export function useQueuedScoutSync(): void {
  const { user, syncReady, refreshUser } = usePersonal();
  const enabled = useFlag("workspaceScouting");
  const { list: all, known } = useMemo(() => workspacesOf(user), [user]);
  // Writable workspaces sync as ever; read-only ones (Task 19) are rescued instead (their queue can't go up).
  const ids = useMemo(() => (enabled ? all.filter((w) => !w.orphaned).map((w) => w.id) : []).join(","), [all, enabled]);
  const readOnly = useMemo(() => (enabled ? all.filter((w) => w.orphaned).map((w) => `${w.id}\u0000${w.name}`) : []).join("\u0001"), [all, enabled]);
  // Which workspaces the account belongs to, when Control Point's answer is known (else nothing counts as left).
  const memberOf = enabled && known ? all.map((w) => w.id).join(",") : null;
  useEffect(() => {
    if (!syncReady) return;
    let alive = true; // until the account (or its workspaces) change: a rescue started before then moves nothing
    const list = ids ? ids.split(",") : [];
    const frozen = readOnly ? readOnly.split("\u0001").map((x) => x.split("\u0000") as [string, string]) : [];
    const members = memberOf == null ? null : new Set(memberOf ? memberOf.split(",") : []);
    const left = () => (members ? Object.keys(pendingScoutCounts().workspaces).filter((w) => !members.has(w)) : []);
    const stuck = () => { const p = pendingScoutCounts(); return frozen.filter(([w]) => p.workspaces[w]); };
    const run = () => {
      void syncQueuedScouting(list);
      const remembered = readRememberedSpace();
      for (const w of left()) void rescueQueued(w, remembered?.id === w ? remembered.name : undefined, () => alive);
      // Entries queued for a space that went read-only: tried once more (it may be back), then kept in Personal.
      for (const [w, name] of stuck()) void rescueQueued(w, name, () => alive, true);
    };
    const tick = () => { const p = pendingScoutCounts(); if (p.personal || list.some((w) => p.workspaces[w]) || left().length || stuck().length) run(); };
    tick();
    window.addEventListener("online", run);
    const t = setInterval(tick, QUEUE_RETRY_MS);
    return () => { alive = false; window.removeEventListener("online", run); clearInterval(t); };
  }, [syncReady, ids, readOnly, memberOf]);
  useEffect(() => {
    // A refusal (403: removed; 423: read-only) or a live notice that the account's spaces changed: re-read it now.
    const reread = () => { void refreshUser?.(); };
    for (const ev of [SCOUT_DENIED, SCOUT_READ_ONLY, ACCOUNT_STALE]) window.addEventListener(ev, reread);
    return () => { for (const ev of [SCOUT_DENIED, SCOUT_READ_ONLY, ACCOUNT_STALE]) window.removeEventListener(ev, reread); };
  }, [refreshUser]);
}

/** Mount once inside PersonalProvider: useQueuedScoutSync() for the whole app. */
export function ScoutQueueSync(): null { useQueuedScoutSync(); return null; }

/** The Scout page's space: resolved from the account, the URL and this device, and kept in the URL. */
export function useScoutSpaces(): ScoutSpaces {
  const { user, providers, refreshUser } = usePersonal();
  const enabled = useFlag("workspaceScouting");
  const [sp, setSp] = useSearchParams();
  const [remembered, setRemembered] = useState(readRememberedSpace);
  // Workspaces whose access ended while this page was open, for the account they ended for (another
  // account signing in on the same page starts with none).
  const userId = user?.id ?? null;
  const [revokedFor, setRevokedFor] = useState<{ user: number | null; ids: string[] }>({ user: null, ids: [] });
  const revoked = revokedFor.user === userId ? revokedFor.ids : [];
  const setRevoked = useCallback((id: string) => setRevokedFor((x) => {
    const ids = x.user === userId ? x.ids : [];
    return ids.includes(id) && x.user === userId ? x : { user: userId, ids: [...ids, id] };
  }), [userId]);
  const [notice, setNotice] = useState<string | null>(null);
  const { list, known } = useMemo(() => workspacesOf(user), [user]);
  const workspaces = useMemo(() => list.filter((w) => !revoked.includes(w.id)), [list, revoked]);
  const url = sp.get("space");
  const authKnown = providers !== null;
  const r = resolveScoutSpace({ signedIn: !!user, enabled, workspaces, known, account: userId, url, remembered });
  // Until sign-in answers, a workspace in the URL or remembered here may be the one to show: wait, rather than flash Personal.
  const candidate = url ?? remembered?.id;
  const resolving = !authKnown && !!candidate && candidate !== PERSONAL_PARAM;
  const space = resolving ? null : r.space;
  const current = workspaces.find((w) => w.id === space) ?? null;

  // Leaving a workspace for Personal: until the URL says Personal, the effects below mustn't
  // put back the space this render resolved (or replace the notice).
  const leaving = useRef(false);
  const leave = useCallback((w: WorkspaceSpace) => {
    leaving.current = true;
    setRevoked(w.id);
    setNotice(removedNotice(w.name));
    setRemembered(rememberSpace(null, undefined, userId));
    setSp((x) => { x.set("space", PERSONAL_PARAM); x.delete("entry"); return x; }, { replace: true });
  }, [setSp, setRevoked, userId]);

  // The workspace on screen disappeared from the account's list (a new answer from Control Point): to Personal.
  const shown = useRef<WorkspaceSpace | null>(null);
  const shownFor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (shownFor.current !== userId) { shown.current = null; shownFor.current = userId; } // another account: nothing was taken away
    const was = shown.current;
    if (was && known && !list.some((w) => w.id === was.id)) { shown.current = null; leave(was); return; }
    if (!user) shown.current = null; // signed out: nothing was taken away
    else if (current) shown.current = current;
    else if (!resolving) shown.current = null;
  }, [list, known, user, userId, current, resolving, leave]);

  const revoke = useCallback((id: string) => {
    if (shown.current?.id === id) { const was = shown.current; shown.current = null; leave(was); }
    else setRevoked(id);
    void refreshUser?.(); // the account's workspaces as the server now has them (so Settings and the switcher agree)
  }, [leave, setRevoked, refreshUser]);

  // A push or pull for the space on screen was refused (403): access is gone, as when the stream says so.
  useEffect(() => {
    const denied = (ev: Event) => { const id = (ev as CustomEvent<string>).detail; if (id === shown.current?.id) revoke(id); };
    window.addEventListener(SCOUT_DENIED, denied);
    return () => window.removeEventListener(SCOUT_DENIED, denied);
  }, [revoke]);

  // A workspace asked for that isn't the account's: say so once, and stop asking for it.
  const lostKey = r.lost && !resolving && r.switchable ? r.lost.id : null;
  useEffect(() => { if (lostKey && !leaving.current) setNotice(lostNotice(r.lost?.name)); }, [lostKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the URL and this device's memory in step with what's shown (only when there's a choice to make).
  const param = spaceParam(space);
  const name = current?.name;
  useEffect(() => {
    if (leaving.current) { if (url === PERSONAL_PARAM) leaving.current = false; return; }
    if (!r.switchable || resolving) return;
    if (url !== param) setSp((x) => { x.set("space", param); return x; }, { replace: true });
    if (remembered?.id !== param || remembered.account !== (userId ?? undefined) || (name && remembered.name !== name)) setRemembered(rememberSpace(space, name, userId));
  }, [r.switchable, resolving, url, param, space, name, remembered, userId, setSp]);

  const select = useCallback((next: ScoutSpace) => {
    setNotice(null);
    const w = next == null ? undefined : workspaces.find((x) => x.id === next);
    if (next != null && !w) return;
    setRemembered(rememberSpace(next, w?.name, userId));
    // Another space's entry can't be edited here: the form closes with the switch.
    setSp((x) => { x.set("space", spaceParam(next)); x.delete("entry"); return x; });
  }, [workspaces, setSp, userId]);

  return {
    space, workspaces: r.switchable ? workspaces : [], switchable: r.switchable && !resolving, resolving, current,
    select, revoke, notice, dismissNotice: useCallback(() => setNotice(null), []),
  };
}
