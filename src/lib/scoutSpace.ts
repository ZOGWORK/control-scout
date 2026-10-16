// Which scout space the Scout page shows: Personal (your own entries, as ever) or one shared space
// per Control Point workspace the account belongs to.
//
// Rules (docs/shared-accounts.md, "Scout spaces"):
// - Signed out, workspace scouting switched off, or Control Point's answer unknown: Personal only.
// - Otherwise the URL (?space=<id> or ?space=personal) wins, then the space remembered on this
//   device (localStorage cs-scout-space, never synced), then the account's first workspace, then
//   Personal when it has none.
// - A URL or remembered workspace the account no longer belongs to is skipped, with a notice.
// - Losing the space on screen (the live stream says access ended, or the account's workspaces
//   change) goes to Personal, with a notice.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useFlag } from "./flags";
import { usePersonal, type AccountUser } from "./personal";
import { pendingScoutCounts, syncQueuedScouting, type ScoutSpace } from "./scouting";

export interface WorkspaceSpace { id: string; name: string; role: "admin" | "member" }

/** Device-only (Tier 3): the space last shown here, as { id, name } (id "personal" for Personal). */
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
    .map((w) => ({ id: w.id, name: typeof w.name === "string" ? w.name : "", role: w.role === "admin" ? "admin" as const : "member" as const }));
  return { list, known: true };
}

export interface RememberedSpace { id: string; name?: string }

export function readRememberedSpace(): RememberedSpace | null {
  try {
    const raw = localStorage.getItem(SPACE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (typeof v === "string") return v === PERSONAL_PARAM || WORKSPACE_ID.test(v) ? { id: v } : null;
    if (!v || typeof v !== "object") return null;
    const { id, name } = v as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || !(id === PERSONAL_PARAM || WORKSPACE_ID.test(id))) return null;
    return typeof name === "string" && name ? { id, name: name.slice(0, 120) } : { id };
  } catch { return null; }
}

export function rememberSpace(space: ScoutSpace, name?: string): RememberedSpace {
  const v: RememberedSpace = space == null ? { id: PERSONAL_PARAM } : name ? { id: space, name } : { id: space };
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
  for (const id of [i.url, i.remembered?.id]) {
    if (!id) continue;
    if (id === PERSONAL_PARAM) return { space: null, switchable: true, lost };
    if (i.workspaces.some((w) => w.id === id)) return { space: id, switchable: true, lost };
    if (!lost && WORKSPACE_ID.test(id)) lost = { id, name: i.remembered?.id === id ? i.remembered.name : undefined };
  }
  return { space: i.workspaces[0]?.id ?? null, switchable: true, lost };
}

/** The notice for a space the account can't open any more. */
export const lostNotice = (name?: string) => name?.trim()
  ? `You no longer have access to ${name.trim()}. Its shared entries are hidden; your personal entries are unchanged.`
  : "You don't have access to that workspace's scout space, so it isn't shown. Your personal entries are unchanged.";

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

/**
 * Entries saved while offline go up when the connection comes back, in every space, not only the
 * one on screen (whose list syncs itself): at sign-in, on reconnect, and every 30 s while any wait.
 * Workspaces only while workspace scouting is on and the account still belongs to them.
 */
export function useQueuedScoutSync(): void {
  const { user, syncReady } = usePersonal();
  const enabled = useFlag("workspaceScouting");
  const ids = useMemo(() => (enabled ? workspacesOf(user).list.map((w) => w.id) : []).join(","), [user, enabled]);
  useEffect(() => {
    if (!syncReady) return;
    const list = ids ? ids.split(",") : [];
    const run = () => { void syncQueuedScouting(list); };
    const tick = () => { const p = pendingScoutCounts(); if (p.personal || list.some((w) => p.workspaces[w])) run(); };
    tick();
    window.addEventListener("online", run);
    const t = setInterval(tick, QUEUE_RETRY_MS);
    return () => { window.removeEventListener("online", run); clearInterval(t); };
  }, [syncReady, ids]);
}

/** Mount once inside PersonalProvider: useQueuedScoutSync() for the whole app. */
export function ScoutQueueSync(): null { useQueuedScoutSync(); return null; }

/** The Scout page's space: resolved from the account, the URL and this device, and kept in the URL. */
export function useScoutSpaces(): ScoutSpaces {
  const { user, providers } = usePersonal();
  const enabled = useFlag("workspaceScouting");
  const [sp, setSp] = useSearchParams();
  const [remembered, setRemembered] = useState(readRememberedSpace);
  const [revoked, setRevoked] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const { list, known } = useMemo(() => workspacesOf(user), [user]);
  const workspaces = useMemo(() => list.filter((w) => !revoked.includes(w.id)), [list, revoked]);
  const url = sp.get("space");
  const authKnown = providers !== null;
  const r = resolveScoutSpace({ signedIn: !!user, enabled, workspaces, known, url, remembered });
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
    setRevoked((x) => (x.includes(w.id) ? x : [...x, w.id]));
    setNotice(lostNotice(workspaceLabel(w)));
    setRemembered(rememberSpace(null));
    setSp((x) => { x.set("space", PERSONAL_PARAM); x.delete("entry"); return x; }, { replace: true });
  }, [setSp]);

  // The workspace on screen disappeared from the account's list (a new answer from Control Point): to Personal.
  const shown = useRef<WorkspaceSpace | null>(null);
  useLayoutEffect(() => {
    const was = shown.current;
    if (was && known && !list.some((w) => w.id === was.id)) { shown.current = null; leave(was); return; }
    if (!user) shown.current = null; // signed out: nothing was taken away
    else if (current) shown.current = current;
    else if (!resolving) shown.current = null;
  }, [list, known, user, current, resolving, leave]);

  const revoke = useCallback((id: string) => {
    if (shown.current?.id === id) { const was = shown.current; shown.current = null; leave(was); }
    else setRevoked((x) => (x.includes(id) ? x : [...x, id]));
  }, [leave]);

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
    if (remembered?.id !== param || (name && remembered.name !== name)) setRemembered(rememberSpace(space, name));
  }, [r.switchable, resolving, url, param, space, name, remembered, setSp]);

  const select = useCallback((next: ScoutSpace) => {
    setNotice(null);
    const w = next == null ? undefined : workspaces.find((x) => x.id === next);
    if (next != null && !w) return;
    setRemembered(rememberSpace(next, w?.name));
    // Another space's entry can't be edited here: the form closes with the switch.
    setSp((x) => { x.set("space", spaceParam(next)); x.delete("entry"); return x; });
  }, [workspaces, setSp]);

  return {
    space, workspaces: r.switchable ? workspaces : [], switchable: r.switchable && !resolving, resolving, current,
    select, revoke, notice, dismissNotice: useCallback(() => setNotice(null), []),
  };
}
