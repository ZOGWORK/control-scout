// The scouting commons in the app (docs/scouting-commons.md; the server: server/scout/commons.ts).
// - useCommons: what other workspaces shared on a team (signed-in accounts only; nothing is fetched signed out).
// - useWorkspaceCommons: a workspace's opt-in and its shares, for the share switch and Settings: asked again whenever
//   a component showing it mounts (one request at a time per workspace), and updated in place by setShare / setOptIn.
// - reportEntry / setMute: a reader's report of a shared entry, and their own mute of a source workspace.
// - pitAge: how old a pit claim is, said prominently (a robot rebuilt on Saturday makes Friday's notes wrong).
import { useEffect, useState } from "react";
import { apiFetch, qs, type ApiError } from "./api";
import { usePersonal } from "./personal";
import { useFlag, useWorkspaceFlag } from "./flags";
import type { CommonsAnswer, CommonsEvent, CommonsReportReason, CommonsSource, WorkspaceCommons } from "../shared/commons";

export const commonsPath = (season: number, team: number) => `/api/scout/commons${qs({ season, team })}`;
export const commonsPhotoUrl = (id: string) => `/api/scout/commons/photos/${encodeURIComponent(id)}`;
const workspacePath = (ws: string) => `/api/scout/workspaces/${encodeURIComponent(ws)}/commons`;

/** The commons on a team this season (`reload` asks again: after a mute). Null while signed out or switched off by the owner (nothing asked). */
export function useCommons(team: number, season: number): { data?: CommonsAnswer; error?: ApiError; reload: () => void } | null {
  const { user } = usePersonal();
  const on = useFlag("scoutingCommons");
  const signedIn = !!user && on;
  const [st, setSt] = useState<{ key: string; data?: CommonsAnswer; error?: ApiError } | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = `${season}:${team}:${user?.id ?? ""}`;
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    apiFetch<CommonsAnswer>(commonsPath(season, team)).then(
      (data) => { if (live) setSt({ key, data }); },
      (error: ApiError) => { if (live) setSt({ key, error }); },
    );
    return () => { live = false; };
  }, [signedIn, season, team, key, nonce]);
  if (!signedIn) return null;
  const reload = () => setNonce((n) => n + 1);
  return st?.key === key ? { ...st, reload } : { reload };
}

/** Report a shared entry to Control Scout (one open report per reader per entry; `already`: it was reported before). */
export async function reportEntry(entryId: string, reason: CommonsReportReason, note: string): Promise<{ already: boolean }> {
  return apiFetch<{ reported: true; already: boolean }>("/api/scout/commons/reports", { method: "POST", json: { entryId, reason, note } });
}

/** Mute or unmute a source workspace for this account only. The muted list after. */
export async function setMute(sourceId: number, muted: boolean): Promise<CommonsSource[]> {
  return (await apiFetch<{ muted: CommonsSource[] }>(`/api/scout/commons/mutes/${sourceId}`, { method: "PUT", json: { muted } })).muted;
}

// One copy per workspace, shared by every component showing it.
const cache = new Map<string, WorkspaceCommons>();
const inflight = new Map<string, Promise<WorkspaceCommons>>();
const listeners = new Set<() => void>();
const changed = () => { for (const fn of [...listeners]) fn(); };
/** Tests: forget everything. */
export function clearCommonsCache() { cache.clear(); inflight.clear(); }

function load(ws: string): Promise<WorkspaceCommons> {
  let p = inflight.get(ws);
  if (!p) {
    p = apiFetch<WorkspaceCommons>(workspacePath(ws)).then(
      (c) => { cache.set(ws, c); inflight.delete(ws); changed(); return c; },
      (e) => { inflight.delete(ws); throw e; },
    );
    inflight.set(ws, p);
  }
  return p;
}

/**
 * A workspace's opt-in and shares (members). Undefined while loading, when it can't be read, or while the owner has
 * the commons switched off for the workspace (hidden then: nothing is asked).
 */
export function useWorkspaceCommons(ws: string | null | undefined): WorkspaceCommons | undefined {
  const on = useWorkspaceFlag("scoutingCommons", ws);
  const workspaceId = on ? ws : null;
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((x) => x + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  // Asked again each time a component showing it mounts (opening an entry, Settings), so an admin's change on another
  // device shows without a reload; the copy already here shows meanwhile, and requests at once are shared.
  useEffect(() => { if (workspaceId) load(workspaceId).catch(() => {}); }, [workspaceId]);
  return workspaceId ? cache.get(workspaceId) : undefined;
}

/** Share or unshare one entry. Throws the server's refusal (its `code` says why: COMMONS_REFUSAL). */
export async function setShare(workspaceId: string, uuid: string, publish: boolean): Promise<WorkspaceCommons> {
  const r = await apiFetch<{ commons: WorkspaceCommons }>(`${workspacePath(workspaceId)}/entries/${encodeURIComponent(uuid)}`, { method: "PUT", json: { publish } });
  cache.set(workspaceId, r.commons);
  changed();
  return r.commons;
}

/** An admin's opt-in or opt-out (opting out withdraws every share). */
export async function setOptIn(workspaceId: string, optedIn: boolean): Promise<WorkspaceCommons> {
  const c = await apiFetch<WorkspaceCommons>(workspacePath(workspaceId), { method: "PUT", json: { optedIn } });
  cache.set(workspaceId, c);
  changed();
  return c;
}

/** Is this entry shared right now? */
export const isShared = (c: WorkspaceCommons | undefined, uuid: string) => !!c?.shares.some((s) => s.uuid === uuid && s.status === "published");

/** 00:00 on `date` (YYYY-MM-DD) in the IANA zone `tz`, as ms; the reader's local midnight when the zone is unknown or unusable. */
export function zonedMidnight(date: string, tz: string | null): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (!tz) return new Date(y, mo, d).getTime();
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    // The zone's offset at an instant: what its wall clock reads, taken as UTC, minus the instant.
    const offset = (at: number) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
      return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - at;
    };
    const guess = Date.UTC(y, mo, d);
    const first = guess - offset(guess);
    return guess - offset(first); // once more, in case midnight sits across a DST change from the guess
  } catch {
    return new Date(y, mo, d).getTime(); // not a zone this browser knows
  }
}

export type PitAgeTone = "fresh" | "aging" | "stale";
export interface PitAge { tone: PitAgeTone; when: string; note: string }

const HOUR = 36e5;

/**
 * How old a pit claim is, for the badge on every commons entry. `when` names the day and time ("Sat 9:14 AM"),
 * the note says what that means: scouted before the event started is stale (the robot may have changed since);
 * over a day old is aging (a rebuild overnight is common); otherwise fresh.
 */
export function pitAge(scoutedAt: number, event: Pick<CommonsEvent, "start" | "timezone"> | undefined, now = Date.now()): PitAge {
  const d = new Date(scoutedAt);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const when = d.toLocaleString(undefined, { weekday: "short", ...(now - scoutedAt > 6 * 24 * HOUR ? { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) } : {}), hour: "numeric", minute: "2-digit" });
  // The event's first day, from 00:00 where the event is held (the same for every reader): before it means another
  // event or the off-season. An event with no known zone falls back to the reader's own midnight.
  const start = event?.start ? zonedMidnight(event.start, event.timezone ?? null) : NaN;
  if (Number.isFinite(start) && scoutedAt < start) return { tone: "stale", when, note: "Before this event: the robot may have changed" };
  const age = now - scoutedAt;
  if (age > 24 * HOUR) {
    const days = Math.floor(age / (24 * HOUR));
    return { tone: days >= 2 ? "stale" : "aging", when, note: `${days === 1 ? "A day" : `${days} days`} old: check it still holds` };
  }
  return { tone: "fresh", when, note: age < HOUR ? "Within the hour" : `${Math.floor(age / HOUR)}h ago` };
}
