// Shared accounts: Control Point owns the account store (docs/shared-accounts.md).
// This is Scout's client for Control Point's internal API, plus the linking
// rule: every Scout user with a verified email is tied to one shared account,
// recorded as identities(provider 'control-point', subject = account id).
// Off unless all three env settings are present (Render, the rollback host,
// runs without it: it can't reach Control Point's loopback port).
import { all, db, get, run } from "../db.js";
import { activityStatement, CONTROL_POINT_ACTOR, publishLogged, type ActivityActor } from "../scout/activityLog.js";
import { publishAccountChanged, publishRevoked } from "../scout/bus.js";
import { formerWorkspaces, markOrphaned, mirroredStates, restoreWorkspace } from "../scout/orphans.js";
import { recordAudit } from "../portal/audit.js";
import { env } from "../env.js";
import type { OrphanReason, OrphanState } from "../../src/shared/orphaned.js";
import type { User } from "./session.js";
import type { BrunoOutput, FactPacket } from "../powerRankings/factCheck.js";

export const CP_PROVIDER = "control-point";

export interface SharedAccount {
  id: number;
  email: string;
  displayName: string | null;
  createdAt: string;
  controlPoint: { member: boolean; teams: { teamNumber: number | null; name: string }[]; shortlist?: number[] };
  /** The account's Control Point workspaces. Sent by newer Control Point deploys only: missing means none. */
  workspaces?: unknown;
}

/** A Control Point workspace the account belongs to. `id` is opaque and stable across renames; `name` can change. */
export interface Workspace { id: string; name: string; role: "admin" | "member" }

/** Sign-in providers Scout can offer through Control Point (it runs the OAuth). */
export const CP_VIA = ["google", "discord", "github"] as const;
export type CpVia = (typeof CP_VIA)[number];
export const isCpVia = (v: unknown): v is CpVia => typeof v === "string" && (CP_VIA as readonly string[]).includes(v);

let via: { at: number; list: CpVia[] } = { at: 0, list: [] };
let viaLoading: Promise<void> | null = null;
/** Tests: forget the cached provider list. */
export const resetViaCache = () => { via = { at: 0, list: [] }; };
/** Which of Google/Discord/GitHub Control Point has switched on (its public /api/auth/config), refreshed every 10 minutes. */
export async function controlPointVia(): Promise<CpVia[]> {
  if (!controlPointEnabled()) return [];
  if (Date.now() - via.at > 10 * 60_000) {
    viaLoading ??= (async () => {
      try {
        const res = await fetch(`${env.controlPointInternalUrl!.replace(/\/$/, "")}/api/auth/config`, { signal: AbortSignal.timeout(3000) });
        const c = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
        via = { at: Date.now(), list: CP_VIA.filter((p) => c[`${p}Enabled`] === true) };
      } catch (e) { logFailure("config", e); via = { at: Date.now() - 9 * 60_000, list: via.list }; } // retry in a minute
      finally { viaLoading = null; }
    })();
    await viaLoading;
  }
  return via.list;
}

export const controlPointEnabled = () => !!(env.controlPointInternalUrl && env.controlPointPublicUrl && env.controlPointInternalKey);

/** A safe, secret-free reason for logs: which call, and what kind of failure. */
function failure(op: string, e: unknown): string {
  const err = e as { name?: string; status?: number; message?: string };
  const kind = err?.name === "TimeoutError" || err?.name === "AbortError" ? "timeout"
    : typeof err?.status === "number" ? `http ${err.status}`
      : err?.message === "Control Point sent an unexpected account" ? "unexpected response" : "network";
  return `[shared-accounts] ${op} failed: ${kind}`;
}
export const logFailure = (op: string, e: unknown) => console.warn(failure(op, e));

/** Call Control Point's internal API. Throws on network errors, timeouts and non-2xx answers. */
async function internal<T>(path: string, init: { method?: string; body?: unknown } = {}, timeoutMs = 3000): Promise<T> {
  const res = await fetch(`${env.controlPointInternalUrl!.replace(/\/$/, "")}${path}`, {
    method: init.method ?? "GET",
    headers: { "X-Internal-Key": env.controlPointInternalKey!, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((data as { error?: string } | null)?.error ?? `Control Point answered ${res.status}`), { status: res.status });
  return data as T;
}

const isAccount = (a: unknown): a is SharedAccount => !!a && typeof (a as SharedAccount).id === "number" && typeof (a as SharedAccount).email === "string";


// --- Bruno's power-rankings blurbs (server/powerRankings/auto.ts) -------------------------------

/** Bruno can be asked: needs only the internal URL and key (no sign-in hand-off involved). */
export const brunoAvailable = () => !!(env.controlPointInternalUrl && env.controlPointInternalKey);

/**
 * Control Point's POST /internal/bruno/power-rankings: Bruno writes a week's blurbs from a fact packet.
 * Throws on network errors, timeouts and non-2xx answers (the caller falls back to the template).
 * A model call takes a while, so this one waits up to two minutes.
 */
export async function brunoPowerRankings(packet: FactPacket): Promise<BrunoOutput> {
  return internal<BrunoOutput>("/internal/bruno/power-rankings", { method: "POST", body: packet }, 120_000);
}

/** When each account answer was asked for: an answer asked before Scout dropped a membership can't restore it (withoutDropped). */
const askedAtOf = new WeakMap<object, number>();
const stamped = <T extends object>(a: T, asked: number): T => { askedAtOf.set(a, asked); return a; };

export async function resolveAccount(email: string, verifiedBy: "scout-email-code" | "google", displayName?: string | null): Promise<SharedAccount> {
  const asked = Date.now();
  const r = await internal<{ account: unknown }>("/internal/accounts/resolve", { method: "POST", body: { email, verifiedBy, ...(displayName ? { displayName } : {}) } });
  if (!isAccount(r.account)) throw new Error("Control Point sent an unexpected account");
  return stamped(r.account, asked);
}

export async function redeemHandoff(code: string, state: string): Promise<SharedAccount> {
  const asked = Date.now();
  const r = await internal<{ account: unknown }>("/internal/handoff/redeem", { method: "POST", body: { code, state } });
  if (!isAccount(r.account)) throw new Error("Control Point sent an unexpected account");
  return stamped(r.account, asked);
}

export async function getAccount(id: number): Promise<SharedAccount | null> {
  const asked = Date.now();
  try { const a = (await internal<{ account: SharedAccount }>(`/internal/accounts/${id}`)).account; return a && typeof a === "object" ? stamped(a, asked) : a; }
  catch (e) { if ((e as { status?: number }).status === 404) return null; throw e; }
}

/** The shared account id this Scout user is linked to, if any. */
export async function linkedAccountId(userId: number): Promise<number | null> {
  const r = await get<{ subject: string }>("SELECT subject FROM identities WHERE provider = ? AND user_id = ?", [CP_PROVIDER, userId]);
  return r ? Number(r.subject) : null;
}

/**
 * Tie a signed-in Scout user to their shared account (best effort: never
 * throws, never blocks sign-in; unlinked users are retried on the next /me).
 * `provenEmail` is the address this sign-in just proved and `how` how it was
 * proved. If it isn't the user's stored email (e.g. a Google account whose
 * address changed), nothing is linked: Scout never vouches for an address it
 * didn't just prove.
 */
export async function linkToSharedAccount(user: User, how: "scout-email-code" | "google", provenEmail: string): Promise<SharedAccount | null> {
  if (!controlPointEnabled() || !user.email) return null;
  if (provenEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    console.warn("[shared-accounts] link skipped: the proven email differs from the account's email");
    return null;
  }
  try {
    const account = await resolveAccount(provenEmail.trim().toLowerCase(), how, user.displayName);
    // The same shared account may already be linked to another Scout user (an
    // older duplicate): keep the existing link; userForIdentity merges by email.
    await run("INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES (?, ?, ?)", [CP_PROVIDER, String(account.id), user.id]);
    await rememberInfo(account);
    return account;
  } catch (e) {
    logFailure("resolve", e);
    return null;
  }
}

/**
 * For linking an existing session later (/me): the user's email counts as
 * proven only if an email-code identity proved that exact address. A Google
 * identity can't be re-checked without a fresh Google sign-in, so those users
 * link on their next sign-in instead.
 */
export async function provenEmailFor(user: User): Promise<string | null> {
  if (!user.email) return null;
  const r = await get<{ subject: string }>("SELECT subject FROM identities WHERE user_id = ? AND provider = 'email' AND subject = ? COLLATE NOCASE", [user.id, user.email]);
  return r ? user.email : null;
}

/**
 * A workspace as /api/auth/me lists it: Control Point's, plus `orphaned` while its scout space is read-only
 * (Task 19). A workspace deleted in Control Point stays in its former members' list this way.
 */
export type WorkspaceOut = Workspace & { orphaned?: OrphanState };

/** What a signed-in user sees about their Control Point side: membership, teams and workspaces. */
export interface ControlPointInfo { /** The shared account's id: what workspace entries record as author/editor, so the app can tell which are yours. */ accountId: number; member: boolean; teams: { teamNumber: number | null; name: string }[]; shortlist: number[]; workspaces: WorkspaceOut[]; url: string }

type Info = SharedAccount["controlPoint"] & { workspaces: Workspace[] };
const infoCache = new Map<number, { at: number; info: Info }>();
const INFO_TTL = 10 * 60_000;
const INFO_MAX = 2000;

/** Membership as Control Point sent it, if it has the expected shape (it's optional data: never trusted blindly). */
function validInfo(cp: unknown): SharedAccount["controlPoint"] | null {
  if (!cp || typeof cp !== "object" || !Array.isArray((cp as { teams?: unknown }).teams)) return null;
  const teams = ((cp as { teams: unknown[] }).teams)
    .filter((t): t is { teamNumber?: unknown; name?: unknown } => !!t && typeof t === "object")
    .slice(0, 10)
    .map((t) => ({ teamNumber: typeof t.teamNumber === "number" ? t.teamNumber : null, name: typeof t.name === "string" ? t.name : "" }));
  const raw = (cp as { shortlist?: unknown }).shortlist;
  const shortlist = Array.isArray(raw) ? [...new Set(raw.filter((n): n is number => Number.isInteger(n) && n > 0 && n <= 999999))].slice(0, 200) : [];
  return { member: (cp as { member?: unknown }).member === true, teams, shortlist };
}

/** A workspace id as Scout accepts it: opaque, short, URL- and key-safe (Control Point sends numeric strings). */
export const isWorkspaceId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/**
 * The account's workspaces as Control Point sent them. Missing (an older
 * Control Point) or malformed means none: Scout stays personal-only. Bad
 * items are dropped one by one, never the whole list.
 */
export function validWorkspaces(raw: unknown): Workspace[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, Workspace>();
  for (const w of raw.slice(0, 100)) {
    if (!w || typeof w !== "object") continue;
    const { id, name, role } = w as { id?: unknown; name?: unknown; role?: unknown };
    if (!isWorkspaceId(id) || out.has(id)) continue;
    out.set(id, { id, name: typeof name === "string" ? name.trim().slice(0, 120) : "", role: role === "admin" ? "admin" : "member" });
  }
  return [...out.values()];
}

const toInfo = (accountId: number, cp: Info): ControlPointInfo => ({ accountId, member: cp.member, teams: cp.teams, shortlist: cp.shortlist ?? [], workspaces: cp.workspaces, url: env.controlPointPublicUrl!.replace(/\/$/, "") });

/**
 * Remember an account's Control Point side (from resolve, redeem or a read), so
 * /me needn't ask again, and rewrite its cached workspace memberships. Never
 * throws. Bounded: expired entries go first, then the oldest.
 */
export async function rememberInfo(account: SharedAccount): Promise<void> {
  const workspaces = withoutDropped(account, validWorkspaces(account.workspaces));
  const info = validInfo(account.controlPoint);
  if (info) {
    const t = Date.now();
    infoCache.delete(account.id);
    infoCache.set(account.id, { at: t, info: { ...info, workspaces } });
    if (infoCache.size > INFO_MAX) {
      for (const [k, v] of infoCache) if (t - v.at >= INFO_TTL) infoCache.delete(k);
      while (infoCache.size > INFO_MAX) infoCache.delete(infoCache.keys().next().value!);
    }
  }
  await storeMemberships(account.id, workspaces, account);
}
/** Tests: forget everything (a cold cache). */
export const clearInfoCache = () => { infoCache.clear(); lastForced.clear(); dropped.clear(); deferred.clear(); answeredAt.clear(); workspaceChecks.clear(); };

/**
 * Membership for a linked account (/api/auth/me). Control Point's answer is reused for ME_TTL (a minute, like
 * a cached membership: Task 19, so someone re-added in Control Point sees the space within a minute, not ten),
 * then asked again through refreshAccount (one call per account at a time). When Control Point can't answer,
 * the last answer still counts for INFO_TTL (10 minutes), as before. Null when there's none to go by, or the
 * account is gone from Control Point. Read-only (orphaned) workspaces are marked, and the deleted ones the
 * account still reads as a former member are added (withOrphans).
 */
export async function controlPointInfo(accountId: number): Promise<ControlPointInfo | null> {
  try {
    const hit = infoCache.get(accountId);
    if (hit && Date.now() - hit.at < ME_TTL) return withOrphans(toInfo(accountId, hit.info));
    const asked = Date.now();
    const list = await refreshAccount(accountId);
    const fresh = infoCache.get(accountId);
    // An answer from this refresh (or one coalesced with it, at most FORCED_GAP old).
    if (list) return fresh && fresh.at >= asked - FORCED_GAP ? withOrphans(toInfo(accountId, fresh.info)) : null;
    if (hit && Date.now() - hit.at < INFO_TTL) return withOrphans(toInfo(accountId, hit.info)); // Control Point away: the last answer
    return null;
  } catch (e) { logFailure("account", e); return null; }
}

/** How long /api/auth/me reuses Control Point's last answer for an account before asking again. */
export const ME_TTL = 60_000;

/**
 * The account's workspaces with their orphan state (Task 19): a listed one whose scout space is read-only
 * gets `orphaned`; a deleted one the account was in when it went (a former member) is added, read-only.
 * The database being away leaves the list as Control Point sent it.
 */
async function withOrphans(info: ControlPointInfo): Promise<ControlPointInfo> {
  try {
    const [states, former] = await Promise.all([mirroredStates(info.workspaces.map((w) => w.id)), formerWorkspaces(info.accountId)]);
    const listed = info.workspaces.map((w) => { const o = states.get(w.id); return o ? { ...w, orphaned: o } : w; });
    return { ...info, workspaces: [...listed, ...former.filter((f) => !listed.some((w) => w.id === f.id))] };
  } catch (e) {
    console.warn(`[shared-accounts] orphan state read failed: ${(e as Error)?.name ?? "error"}`);
    return info;
  }
}

// ---------------------------------------------------------------------------
// Workspace membership cache (workspace_members). Control Point decides who
// belongs where; Scout keeps the last answer so a write needn't ask every time.
// ---------------------------------------------------------------------------

/**
 * A cached membership younger than this is trusted as is; older, it's re-checked with Control Point first
 * (Task 12: every workspace read and write, so a removal in Control Point counts within a minute, not ten).
 * Control Point's load stays flat: one account read refreshes all of that account's rows, re-checks are
 * coalesced per account and at most one every 5 s (refreshAccount), and an account with an open stream is
 * re-checked by the stream sweep (stream.ts) just before its rows go stale. docs/shared-accounts.md has
 * the call-rate estimate.
 */
export const MEMBERSHIP_TTL = 60_000;

/** When Control Point last answered for each account (any fetch that rewrote its memberships): the stream sweep's clock. */
const answeredAt = new Map<number, number>();
/** When Control Point last answered for this account (ms since epoch), 0 when this server hasn't asked since it started. */
export const membershipAnsweredAt = (accountId: number): number => answeredAt.get(accountId) ?? 0;

/**
 * Replace the account's cached memberships with what Control Point just said. Writes only the cache (and a
 * mirror row's name, if one exists), plus the activity feed: a workspace that appears in the list, or drops
 * out of it, is logged as member.joined / member.left (actor Control Point: Scout doesn't know who added or
 * removed them) in the same transaction, guarded on the cache row so each change is logged once. Only for
 * workspaces with a scout space (a mirror row). Never throws.
 */
async function storeMemberships(accountId: number, list: Workspace[], account?: Pick<SharedAccount, "displayName" | "email">): Promise<void> {
  const now = Date.now(), iso = new Date(now).toISOString();
  answeredAt.delete(accountId); answeredAt.set(accountId, now); // newest last, so the bound below drops the oldest
  if (answeredAt.size > 5000) answeredAt.delete(answeredAt.keys().next().value!);
  // Every fresh answer passes through here: a re-check's saved answer must never be older than it.
  const last = lastForced.get(accountId);
  if (last) lastForced.set(accountId, { at: last.at, list });
  try {
    const cached = await all<{ cp_workspace_id: string; role: string; workspace_name: string }>("SELECT cp_workspace_id, role, workspace_name FROM workspace_members WHERE account_id = ?", [accountId]);
    const was = new Map(cached.map((r) => [String(r.cp_workspace_id), String(r.role)]));
    const joined = list.filter((w) => !was.has(w.id));
    const left = [...was].filter(([id]) => !list.some((w) => w.id === id));
    const roleChanged = list.some((w) => was.has(w.id) && was.get(w.id) !== w.role);
    // Orphaned workspaces (Task 19): the scout spaces involved (a mirror row), each with its read-only state.
    // Departures Control Point couldn't explain on an earlier answer (deleted, or a removal?), still unlisted: asked again.
    const pendingRows = await all<{ cp_workspace_id: string; role: string; workspace_name: string }>(
      "SELECT cp_workspace_id, role, workspace_name FROM workspace_pending_departures WHERE account_id = ?", [accountId]);
    const pending = new Map(pendingRows.map((r) => [String(r.cp_workspace_id), r]));
    const listed = new Set(list.map((w) => w.id));
    const pendingLeft = [...pending.keys()].filter((id) => !listed.has(id) && !was.has(id));
    // Orphaned workspaces (Task 19): the scout spaces involved (a mirror row), each with its read-only state.
    const mirror = await mirroredStates([...new Set([...left.map(([id]) => id), ...pendingLeft, ...list.map((w) => w.id)])]);
    // A scout space gone from this answer because Control Point deleted the workspace (its members route
    // says not_found) is not a removal: no member.left, no revoke, no removal audit. It goes read-only, and
    // everyone in the cache for it now (this account's row included: it's dropped below) keeps reading it.
    const gone = new Set<string>();
    // Control Point couldn't say (timeout, error): undecided. The membership goes (it grants nothing: Control Point
    // no longer lists it), but nothing is logged or audited yet: the departure is kept in workspace_pending_departures,
    // apart from the membership cache, and asked about again on this account's next answer. Only Control Point's
    // answer decides between deleted (read-only, a former member) and removed (logged then).
    const undecided = new Set<string>();
    for (const id of [...left.map(([id]) => id), ...pendingLeft]) {
      if (!mirror.has(id)) continue;
      if (mirror.get(id)?.reason === "deleted") { gone.add(id); continue; }
      const c = await checkWorkspace(id);
      if (c.state === "gone") gone.add(id);
      else if (c.state === "unknown") undecided.add(id);
    }
    for (const id of gone) if (mirror.get(id)?.reason !== "deleted") await orphaned(id, "deleted");
    // Earlier undecided departures now decided as removals: logged and audited now, once.
    const removedLater = pendingLeft.filter((id) => !gone.has(id) && !undecided.has(id));
    const name = joined.length || left.length || removedLater.length ? await memberName(accountId, account) : "";
    const actor = CONTROL_POINT_ACTOR, subject = `member:${accountId}`;
    // Guarded on the cache row (read again inside the transaction), so two refreshes racing log a change once.
    const cachedRow = (id: string) => ({ sql: "EXISTS (SELECT 1 FROM workspace_members WHERE account_id = ? AND cp_workspace_id = ?)", args: [accountId, id] });
    const pendingRow = (id: string) => ({ sql: "EXISTS (SELECT 1 FROM workspace_pending_departures WHERE account_id = ? AND cp_workspace_id = ?)", args: [accountId, id] });
    // A removal Scout itself is making (removeMember) is recorded there, once, with the admin as actor.
    const logs = [
      ...left.filter(([id]) => !removing.has(dropKey(accountId, id)) && !gone.has(id) && !undecided.has(id)).map(([id, role]) => ({ id, stmt: activityStatement(id, actor, "member.left", subject, { accountId, name, role }, now, cachedRow(id)) })),
      ...removedLater.map((id) => ({ id, stmt: activityStatement(id, actor, "member.left", subject, { accountId, name, role: pending.get(id)!.role === "admin" ? "admin" : "member" }, now, pendingRow(id)) })),
      ...joined.map((w) => {
        const g = cachedRow(w.id);
        return { id: w.id, stmt: activityStatement(w.id, actor, "member.joined", subject, { accountId, name, role: w.role }, now, { sql: `NOT ${g.sql}`, args: g.args }) };
      }),
    ];
    const marks = (xs: string[]) => xs.map(() => "?").join(", ");
    const settled = [...listed, ...gone];
    const res = await db().batch([
      ...logs.map((l) => l.stmt),
      {
        sql: `DELETE FROM workspace_members WHERE account_id = ?${list.length ? ` AND cp_workspace_id NOT IN (${marks(list.map((w) => w.id))})` : ""}
              RETURNING cp_workspace_id, workspace_name, role`,
        args: [accountId, ...list.map((w) => w.id)],
      },
      // Earlier undecided departures decided as removals (RETURNING: only this write's, so each is audited once).
      {
        sql: `DELETE FROM workspace_pending_departures WHERE account_id = ? AND cp_workspace_id IN (${removedLater.length ? marks(removedLater) : "NULL"})
              RETURNING cp_workspace_id, workspace_name, role`,
        args: [accountId, ...removedLater],
      },
      ...[...undecided].filter((id) => was.has(id)).map((id) => ({
        sql: `INSERT INTO workspace_pending_departures (account_id, cp_workspace_id, role, workspace_name, at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(account_id, cp_workspace_id) DO UPDATE SET role = excluded.role`,
        args: [accountId, id, was.get(id)!, String(cached.find((r) => String(r.cp_workspace_id) === id)?.workspace_name ?? ""), now],
      })),
      // A pending departure from a workspace now known deleted: a former member (markOrphaned takes the others).
      ...[...gone].filter((id) => pending.has(id)).map((id) => ({
        sql: "INSERT OR IGNORE INTO workspace_former_members (workspace_id, account_id, role) SELECT id, ?, ? FROM workspaces WHERE cp_workspace_id = ? AND orphan_reason = 'deleted'",
        args: [accountId, pending.get(id)!.role, id],
      })),
      // Listed again, or decided deleted: nothing pending any more.
      ...(settled.length ? [{ sql: `DELETE FROM workspace_pending_departures WHERE account_id = ? AND cp_workspace_id IN (${marks(settled)})`, args: [accountId, ...settled] }] : []),
      ...list.map((w) => ({
        sql: `INSERT INTO workspace_members (account_id, cp_workspace_id, workspace_name, role, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(account_id, cp_workspace_id) DO UPDATE SET workspace_name = excluded.workspace_name, role = excluded.role, updated_at = excluded.updated_at`,
        args: [accountId, w.id, w.name, w.role, now],
      })),
      // Renamed in Control Point: follow it on the mirror row (never creates one).
      ...list.map((w) => ({ sql: "UPDATE workspaces SET name = ?, updated_at = ? WHERE cp_workspace_id = ? AND name <> ?", args: [w.name, iso, w.id, w.name] })),
    ], "write");
    logs.forEach((l, i) => publishLogged(l.id, [...res[i].rows]));
    // Rows this write actually dropped (a racing refresh that dropped them first reports none): the
    // account's open streams there end now, and the owner audit records the removal Control Point made.
    type Dropped = { cp_workspace_id: string; workspace_name: string; role: string };
    const droppedRows = [...(res[logs.length].rows as unknown as Dropped[]), ...(res[logs.length + 1].rows as unknown as Dropped[])];
    for (const r of droppedRows) {
      const workspaceId = String(r.cp_workspace_id);
      if (gone.has(workspaceId) || undecided.has(workspaceId)) continue; // deleted (read-only), or not decided yet: not a removal
      publishRevoked(workspaceId, accountId);
      if (removing.has(dropKey(accountId, workspaceId))) {
        // Scout's own removal is in flight: it records this (or, if its call fails, records what we saw).
        deferred.set(dropKey(accountId, workspaceId), {
          name: name || await memberName(accountId, account), role: r.role === "admin" ? "admin" : "member", workspaceName: String(r.workspace_name ?? ""),
        });
        continue;
      }
      await auditRemoval("Control Point", {
        origin: "control-point", workspaceId, workspaceName: String(r.workspace_name ?? ""),
        accountId, name: name || await memberName(accountId, account), role: r.role === "admin" ? "admin" : "member", actorAccountId: null,
      });
    }
    await adminChecks(accountId, list, was, gone, mirror);
    // A workspace joined (or re-added) or a role changed: the account's open streams tell the app to re-read /me now.
    if (joined.length || roleChanged) publishAccountChanged(accountId);
  } catch (e) { console.warn(`[shared-accounts] membership cache write failed: ${(e as Error)?.name ?? "error"}`); }
}

// ---------------------------------------------------------------------------
// Orphaned workspaces (Task 19; scout/orphans.ts, docs/shared-accounts.md "Orphaned workspaces").
// Decided here, from each membership answer, and only for workspaces with a scout space:
// (a) deleted: a workspace drops out of an account's answer and Control Point's members route says it no
//     longer exists (404 not_found). A personal removal (the route still lists the workspace) is not this.
// (b) no admin: an account that was an admin there no longer is (it left, or was demoted) and Control Point
//     lists no admin. An older Control Point (no members route) can't say, so it never orphans a workspace:
//     Scout's own cache only knows the admins who have used Control Scout, so "none in the cache" proves nothing.
// Back: an orphaned workspace listed again with an admin (this account, or anyone Control Point lists).
// Control Point unreachable: nothing is decided; the question is asked again (storeMemberships, adminChecks).
// ---------------------------------------------------------------------------

type WorkspaceCheck = { state: "gone" } | { state: "exists"; admins: number } | { state: "unsupported" } | { state: "unknown" };
const workspaceChecks = new Map<string, { at: number; p: Promise<WorkspaceCheck> }>();
/** How often a read-only workspace still listed for its members is asked about again (has an admin come back?). */
export const ORPHAN_RECHECK_MS = 60_000;
const CHECK_REUSE_MS = 5_000;

/** Does the workspace still exist in Control Point, and how many admins has it? Coalesced per workspace; an answer is reused for `maxAge`. */
function checkWorkspace(workspaceId: string, maxAge = CHECK_REUSE_MS): Promise<WorkspaceCheck> {
  const hit = workspaceChecks.get(workspaceId);
  if (hit && Date.now() - hit.at < maxAge) return hit.p;
  const p = (async (): Promise<WorkspaceCheck> => {
    try {
      const r = await internal<{ members?: unknown }>(`/internal/workspaces/${encodeURIComponent(workspaceId)}/members`);
      if (!Array.isArray(r?.members)) return { state: "unknown" };
      return { state: "exists", admins: r.members.filter((m) => !!m && typeof m === "object" && (m as { role?: unknown }).role === "admin").length };
    } catch (e) {
      // Only Control Point's own answer that the workspace doesn't exist counts as deleted: 404 with error "not_found".
      // Any other 404 (an older deploy's bare "Not found", a proxy's page) proves nothing.
      if ((e as { status?: number }).status === 404 && (e as Error).message === "not_found") return { state: "gone" };
      // Any other 404 is a Control Point without the route (an older deploy's bare "Not found"): it can never say.
      if (missingRoute(e) || (e as { status?: number }).status === 404) return { state: "unsupported" };
      logFailure("workspace members", e);
      return { state: "unknown" };
    }
  })();
  workspaceChecks.delete(workspaceId);
  workspaceChecks.set(workspaceId, { at: Date.now(), p });
  if (workspaceChecks.size > 2000) workspaceChecks.delete(workspaceChecks.keys().next().value!);
  return p;
}

/** Admins the workspace has in Control Point: a count, "unknown" (it couldn't answer right now), or "never" (no members route). */
const adminsOf = (c: WorkspaceCheck): number | "unknown" | "never" =>
  c.state === "exists" ? c.admins : c.state === "unsupported" ? "never" : "unknown";

/** Mark it read-only; the accounts it concerns re-read /me (their open streams say so). */
async function orphaned(workspaceId: string, reason: OrphanReason): Promise<void> {
  const accounts = await markOrphaned(workspaceId, reason);
  for (const a of accounts ?? []) publishAccountChanged(a);
}

/**
 * Writable again: the accounts it concerns forget their cached /me answer (all but `current`, whose answer
 * this is) and re-read it now, so a former member who wasn't re-added loses the space promptly too.
 */
async function restored(workspaceId: string, current: number): Promise<void> {
  const accounts = await restoreWorkspace(workspaceId);
  if (!accounts) return;
  for (const a of new Set([...accounts, current])) {
    if (a !== current) { infoCache.delete(a); lastForced.delete(a); }
    publishAccountChanged(a);
  }
}

/** After a membership answer is stored: (b) no admin left, and orphaned workspaces coming back. Never throws. */
async function adminChecks(accountId: number, list: Workspace[], was: Map<string, string>, gone: Set<string>, mirror: Map<string, OrphanState | null>): Promise<void> {
  try {
    // This account was an admin of a scout space and isn't any more (left, or demoted): any admin left?
    for (const [id, role] of was) {
      if (role !== "admin" || gone.has(id) || !mirror.has(id) || mirror.get(id)) continue;
      if (list.find((w) => w.id === id)?.role === "admin") continue;
      const admins = adminsOf(await checkWorkspace(id));
      if (admins === 0) await orphaned(id, "no_admin");
      // Control Point couldn't say: owed a check, made from the next answer that lists the workspace (anyone's).
      else if (admins === "unknown") await run("UPDATE workspaces SET orphan_check_at = ? WHERE cp_workspace_id = ?", [Date.now(), id]);
    }
    // Checks owed from earlier (above): any answer listing the workspace settles them, at most once a minute.
    const owed = list.length ? await all<{ cp_workspace_id: string }>(
      `SELECT cp_workspace_id FROM workspaces WHERE orphan_check_at IS NOT NULL AND orphaned_at IS NULL AND cp_workspace_id IN (${list.map(() => "?").join(", ")})`, list.map((w) => w.id)) : [];
    for (const { cp_workspace_id: id } of owed) {
      const admins = adminsOf(await checkWorkspace(String(id), ORPHAN_RECHECK_MS));
      if (admins === "unknown") continue;
      if (admins === 0) await orphaned(String(id), "no_admin");
      await run("UPDATE workspaces SET orphan_check_at = NULL WHERE cp_workspace_id = ?", [String(id)]);
    }
    // A read-only scout space this answer lists: it exists. An admin here brings it back at once; otherwise
    // ask Control Point who's in it (at most once a minute per workspace while it stays read-only).
    for (const w of list) {
      const st = mirror.get(w.id);
      if (!st) continue;
      if (w.role === "admin") { await restored(w.id, accountId); continue; }
      const admins = adminsOf(await checkWorkspace(w.id, ORPHAN_RECHECK_MS));
      if (admins === "unknown") continue;
      if (admins === "never" || admins > 0) await restored(w.id, accountId); // listed, so it exists; no route: can't say it has no admin
      else if (st.reason === "deleted") await orphaned(w.id, "no_admin"); // back, but with no admin
    }
  } catch (e) { console.warn(`[shared-accounts] orphan check failed: ${(e as Error)?.name ?? "error"}`); }
}

/** What the owner audit records for each workspace removal (Task 9). `origin`: the app it was made in. */
export interface RemovalAudit {
  origin: "control-scout" | "control-point"; workspaceId: string; workspaceName: string;
  accountId: number; name: string; role: "admin" | "member"; actorAccountId: number | null; actorName?: string;
}
/** Record a removal in the owner audit (`workspace.member_removed`). Never throws: the removal already happened. */
async function auditRemoval(actor: string, d: RemovalAudit): Promise<void> {
  try { await recordAudit(actor, "workspace.member_removed", { ...d }); }
  catch (e) { console.warn(`[shared-accounts] removal audit failed: ${(e as Error)?.name ?? "error"}`); }
}

/** How a member is named in the feed: as on their entries (the Scout profile's name, else the email before the @), else Control Point's. */
async function memberName(accountId: number, account?: Pick<SharedAccount, "displayName" | "email">): Promise<string> {
  const u = await get<{ display_name: string | null; email: string | null }>(
    "SELECT u.display_name, u.email FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ? ORDER BY u.id LIMIT 1", [CP_PROVIDER, String(accountId)]);
  const pick = (displayName?: string | null, email?: string | null) => displayName?.trim() || email?.split("@")[0] || "";
  return (pick(u?.display_name, u?.email) || pick(account?.displayName, account?.email) || "A member").slice(0, 60);
}

const refreshing = new Map<number, Promise<Workspace[] | null>>();
/** The last forced answer per account: when, and the list (null: Control Point couldn't answer). */
const lastForced = new Map<number, { at: number; list: Workspace[] | null }>();
const FORCED_GAP = 5_000;

/**
 * Ask Control Point for the account now (bypassing /me's one-minute cache, ME_TTL) and
 * rewrite its memberships. One call per account at a time, and at most one
 * every 5 s (within that, the last answer is reused), so a stream of refused
 * writes can't hammer Control Point. Returns the workspaces Control Point
 * listed (an unknown account has none), or null when it couldn't answer.
 * Callers decide from this list, not from the cache, so a failed cache write
 * can never keep a removed member in.
 */
export async function refreshAccount(accountId: number): Promise<Workspace[] | null> {
  const inflight = refreshing.get(accountId);
  if (inflight) return inflight;
  const last = lastForced.get(accountId);
  if (last && Date.now() - last.at < FORCED_GAP) return last.list;
  const p = (async () => {
    let list: Workspace[] | null = null;
    try {
      const a = await getAccount(accountId);
      list = a ? withoutDropped(a, validWorkspaces(a.workspaces)) : [];
      // Saved before the cache write: any answer that lands later (a sign-in, /me) replaces it in storeMemberships.
      lastForced.set(accountId, { at: Date.now(), list });
      if (a) await rememberInfo(a);
      else { infoCache.delete(accountId); await storeMemberships(accountId, []); }
    } catch (e) { logFailure("account", e); lastForced.set(accountId, { at: Date.now(), list: null }); }
    if (lastForced.size > 5000) lastForced.clear();
    refreshing.delete(accountId);
    // A newer answer may have arrived while this one was being saved: report the latest.
    return lastForced.get(accountId)?.list ?? list;
  })();
  refreshing.set(accountId, p);
  return p;
}

export interface Membership { accountId: number; workspaceId: string; workspaceName: string; role: "admin" | "member" }

/**
 * Is this shared account a member of the workspace, and with what role?
 * Uses the cached membership while it's fresh; on a miss (or a stale row) asks
 * Control Point once and goes by its answer. If Control Point can't be
 * reached, a stale row still counts: losing the link mid-event shouldn't stop
 * a team scouting. Null: not a member (or Control Point isn't configured).
 */
export async function workspaceMembership(accountId: number, workspaceId: string): Promise<Membership | null> {
  if (!controlPointEnabled() || !isWorkspaceId(workspaceId)) return null;
  const row = await get<{ workspace_name: string; role: string; updated_at: number }>(
    "SELECT workspace_name, role, updated_at FROM workspace_members WHERE account_id = ? AND cp_workspace_id = ?", [accountId, workspaceId]);
  if (row && Date.now() - Number(row.updated_at) < MEMBERSHIP_TTL) {
    return { accountId, workspaceId, workspaceName: String(row.workspace_name), role: row.role === "admin" ? "admin" : "member" };
  }
  const list = await refreshAccount(accountId);
  if (list) {
    const w = list.find((x) => x.id === workspaceId);
    return w ? { accountId, workspaceId, workspaceName: w.name, role: w.role } : null;
  }
  return row ? { accountId, workspaceId, workspaceName: String(row.workspace_name), role: row.role === "admin" ? "admin" : "member" } : null;
}

// ---------------------------------------------------------------------------
// Workspace members (Task 9: Settings → Workspace → Members). Control Point's
// `members` table is the source of truth; Scout lists it and asks Control
// Point to remove someone, then drops its own cached row at once.
// ---------------------------------------------------------------------------

/** One person in a workspace, as Control Point lists them. `accountId` null: they've never used Control Scout. */
export interface WorkspaceMember { accountId: number | null; name: string; role: "admin" | "member" }

/**
 * An older Control Point (before the members routes) answers any unknown /internal path with a bare
 * 404 "Not found"; the new routes' own 404s carry a code ("not_found", "not_member").
 */
const missingRoute = (e: unknown) => (e as { status?: number }).status === 404 && (e as Error).message === "Not found";

/**
 * Everyone in the workspace, from Control Point (GET /internal/workspaces/:id/members).
 * "unsupported": Control Point doesn't have the route yet. null: no such workspace. Throws when
 * Control Point can't be reached or answers oddly.
 */
export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[] | "unsupported" | null> {
  try {
    const r = await internal<{ members?: unknown }>(`/internal/workspaces/${encodeURIComponent(workspaceId)}/members`);
    if (!Array.isArray(r?.members)) throw new Error("Control Point sent an unexpected account");
    return r.members.slice(0, 1000).flatMap((m): WorkspaceMember[] => {
      if (!m || typeof m !== "object") return [];
      const { accountId, name, role } = m as { accountId?: unknown; name?: unknown; role?: unknown };
      return [{
        accountId: Number.isSafeInteger(accountId) && (accountId as number) > 0 ? accountId as number : null,
        name: (typeof name === "string" ? name.trim() : "").slice(0, 80) || "Member",
        role: role === "admin" ? "admin" : "member",
      }];
    });
  } catch (e) {
    if (missingRoute(e)) return "unsupported";
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/** The members Scout knows (its cached memberships: people who have used Control Scout), when Control Point can't list them. */
export async function cachedWorkspaceMembers(workspaceId: string): Promise<(WorkspaceMember & { accountId: number })[]> {
  // Named as memberName does (the Scout profile's name, else the email before the @), in one query.
  const rows = await all<{ account_id: number; role: string; display_name: string | null; email: string | null }>(
    `SELECT wm.account_id, wm.role, u.display_name, u.email FROM workspace_members wm
       LEFT JOIN users u ON u.id = (SELECT i.user_id FROM identities i WHERE i.provider = ? AND i.subject = CAST(wm.account_id AS TEXT) ORDER BY i.user_id LIMIT 1)
      WHERE wm.cp_workspace_id = ? ORDER BY wm.account_id LIMIT 1000`, [CP_PROVIDER, workspaceId]);
  return rows.map((r) => ({
    accountId: Number(r.account_id),
    name: (r.display_name?.trim() || r.email?.split("@")[0] || "A member").slice(0, 60),
    role: r.role === "admin" ? "admin" as const : "member" as const,
  }));
}

export type RemoveResult = { ok: true } | { ok: false; reason: "unsupported" | "not_admin" | "not_member" | "last_admin" | "invalid_input" };

/**
 * Ask Control Point to remove `accountId` from the workspace on behalf of `actorAccountId`
 * (POST /internal/workspaces/:id/members/remove). Control Point checks the actor is an admin and that
 * the last admin stays. Throws when it can't be reached or fails (nothing removed, as far as Scout knows).
 */
async function removeWorkspaceMember(workspaceId: string, accountId: number, actorAccountId: number): Promise<RemoveResult> {
  try {
    await internal(`/internal/workspaces/${encodeURIComponent(workspaceId)}/members/remove`, { method: "POST", body: { accountId, actorAccountId } }, 8000);
    return { ok: true };
  } catch (e) {
    if (missingRoute(e)) return { ok: false, reason: "unsupported" };
    const status = (e as { status?: number }).status;
    if (status === 403) return { ok: false, reason: "not_admin" };
    if (status === 404) return { ok: false, reason: "not_member" };
    if (status === 409) return { ok: false, reason: "last_admin" };
    if (status === 400) return { ok: false, reason: "invalid_input" };
    throw e;
  }
}

const dropKey = (accountId: number, workspaceId: string) => `${accountId}:${workspaceId}`;
/** Removals Scout is making right now: a refresh that sees one first drops the row but leaves the record to removeMember. */
const removing = new Set<string>();
/** Removals a refresh saw while Scout's own was in flight (it skipped recording them): what removeMember needs to record them if its call fails. */
const deferred = new Map<string, { name: string; role: "admin" | "member"; workspaceName: string }>();
/**
 * When Scout last dropped a membership itself. An account answer asked for before that (a sign-in,
 * /me or re-check already on its way) may still list the workspace and must not put the row back.
 * Answers asked for after it are Control Point's word, so a quick re-add still counts. Entries are
 * kept for DROP_HOLD_MS, longer than any Control Point call can take (3 to 8 s timeouts).
 */
const dropped = new Map<string, number>();
export const DROP_HOLD_MS = 15_000;
function withoutDropped(account: { id: number }, list: Workspace[]): Workspace[] {
  if (!dropped.size) return list;
  const t = Date.now();
  for (const [k, at] of dropped) if (t - at > DROP_HOLD_MS) dropped.delete(k);
  // Unknown (an account not read through this module): assume the oldest a read can be.
  const asked = askedAtOf.get(account) ?? t - DROP_HOLD_MS;
  return list.filter((w) => {
    const at = dropped.get(dropKey(account.id, w.id));
    return at == null || asked > at;
  });
}

type Target = { accountId: number; name?: string; role?: "admin" | "member" };

/**
 * An admin's Remove in Scout: Control Point removes `target` (checking the admin and the last admin
 * itself), then Scout drops its cached membership at once (dropMembership). While Control Point is
 * deciding, a refresh that already sees the removal drops the row but doesn't record it, so the
 * removal is logged and audited once, with the admin as actor. Throws when Control Point can't be
 * reached or fails: the removal may or may not have happened.
 */
export async function removeMember(workspaceId: string, workspaceName: string, target: Target,
  actor: ActivityActor & { accountId: number }, actorAudit: string): Promise<RemoveResult> {
  const key = dropKey(target.accountId, workspaceId);
  removing.add(key);
  let ok = false;
  try {
    const r = await removeWorkspaceMember(workspaceId, target.accountId, actor.accountId);
    ok = r.ok;
    if (r.ok) await dropMembership(workspaceId, workspaceName, target, actor, actorAudit);
    return r;
  } finally {
    removing.delete(key);
    // Scout's call failed or went unanswered, but a refresh meanwhile saw them gone and left the record
    // to this removal: record it now, as Control Point's (Scout can't say its own call did it).
    const seen = deferred.get(key);
    deferred.delete(key);
    if (!ok && seen) await recordControlPointRemoval(target.accountId, workspaceId, seen);
  }
}

/** member.left (actor Control Point) and the owner audit for a removal Scout saw but didn't make. Never throws. */
async function recordControlPointRemoval(accountId: number, workspaceId: string, seen: { name: string; role: "admin" | "member"; workspaceName: string }): Promise<void> {
  try {
    const res = await db().batch([activityStatement(workspaceId, CONTROL_POINT_ACTOR, "member.left", `member:${accountId}`, { accountId, name: seen.name, role: seen.role })], "write");
    publishLogged(workspaceId, [...res[0].rows]);
  } catch (e) { console.warn(`[shared-accounts] removal log failed: ${(e as Error)?.name ?? "error"}`); }
  await auditRemoval("Control Point", { origin: "control-point", workspaceId, workspaceName: seen.workspaceName, accountId, name: seen.name, role: seen.role, actorAccountId: null });
}

/**
 * Control Point removed `target` from the workspace at an admin's request in Scout: drop Scout's
 * cached membership now (no waiting for the next refresh), log member.left in the workspace's feed
 * with the admin as actor (details.origin "control-scout"; details.self when they removed
 * themselves), end the account's open streams there, and record it in the owner audit. Their Scout
 * account, personal data and entries are untouched; their workspace entries keep their authorship.
 * Never throws (Control Point has already removed them).
 */
async function dropMembership(workspaceId: string, workspaceName: string, target: Target,
  actor: ActivityActor & { accountId: number }, actorAudit: string): Promise<void> {
  const { accountId } = target;
  // Forget every cached answer that still lists the workspace, so the next check asks Control Point,
  // and keep answers already on their way from putting it back.
  dropped.set(dropKey(accountId, workspaceId), Date.now());
  infoCache.delete(accountId);
  lastForced.delete(accountId);
  let name = target.name?.trim().slice(0, 60) || "";
  let role: "admin" | "member" = target.role ?? "member";
  try {
    if (!name) name = await memberName(accountId);
    const row = await get<{ role: string }>("SELECT role FROM workspace_members WHERE account_id = ? AND cp_workspace_id = ?", [accountId, workspaceId]);
    if (!target.role && row) role = row.role === "admin" ? "admin" : "member";
    const self = accountId === actor.accountId;
    const res = await db().batch([
      activityStatement(workspaceId, actor, "member.left", `member:${accountId}`, { accountId, name, role, origin: "control-scout", ...(self ? { self } : {}) }),
      { sql: "DELETE FROM workspace_members WHERE account_id = ? AND cp_workspace_id = ?", args: [accountId, workspaceId] },
    ], "write");
    publishLogged(workspaceId, [...res[0].rows]);
  } catch (e) { console.warn(`[shared-accounts] membership drop failed: ${(e as Error)?.name ?? "error"}`); }
  publishRevoked(workspaceId, accountId);
  await auditRemoval(actorAudit, {
    origin: "control-scout", workspaceId, workspaceName, accountId, name: name || "A member", role,
    actorAccountId: actor.accountId, actorName: actor.name,
  });
}
