// Shared accounts: Control Point owns the account store (docs/shared-accounts.md).
// This is Scout's client for Control Point's internal API, plus the linking
// rule: every Scout user with a verified email is tied to one shared account,
// recorded as identities(provider 'control-point', subject = account id).
// Off unless all three env settings are present (Render, the rollback host,
// runs without it: it can't reach Control Point's loopback port).
import { all, db, get, run } from "../db.js";
import { activityStatement, CONTROL_POINT_ACTOR, publishLogged, type ActivityActor } from "../scout/activityLog.js";
import { publishRevoked } from "../scout/bus.js";
import { recordAudit } from "../portal/audit.js";
import { env } from "../env.js";
import type { User } from "./session.js";

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

export async function resolveAccount(email: string, verifiedBy: "scout-email-code" | "google", displayName?: string | null): Promise<SharedAccount> {
  const r = await internal<{ account: unknown }>("/internal/accounts/resolve", { method: "POST", body: { email, verifiedBy, ...(displayName ? { displayName } : {}) } });
  if (!isAccount(r.account)) throw new Error("Control Point sent an unexpected account");
  return r.account;
}

export async function redeemHandoff(code: string, state: string): Promise<SharedAccount> {
  const r = await internal<{ account: unknown }>("/internal/handoff/redeem", { method: "POST", body: { code, state } });
  if (!isAccount(r.account)) throw new Error("Control Point sent an unexpected account");
  return r.account;
}

export async function getAccount(id: number): Promise<SharedAccount | null> {
  try { return (await internal<{ account: SharedAccount }>(`/internal/accounts/${id}`)).account; }
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

/** What a signed-in user sees about their Control Point side: membership, teams and workspaces. */
export interface ControlPointInfo { /** The shared account's id: what workspace entries record as author/editor, so the app can tell which are yours. */ accountId: number; member: boolean; teams: { teamNumber: number | null; name: string }[]; shortlist: number[]; workspaces: Workspace[]; url: string }

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
  const workspaces = withoutDropped(account.id, validWorkspaces(account.workspaces));
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
export const clearInfoCache = () => { infoCache.clear(); lastForced.clear(); dropped.clear(); };

/** Membership for a linked account, cached for 10 minutes; null when Control Point can't be reached or sends something unexpected. */
export async function controlPointInfo(accountId: number): Promise<ControlPointInfo | null> {
  try {
    const hit = infoCache.get(accountId);
    if (hit && Date.now() - hit.at < INFO_TTL) return toInfo(accountId, hit.info);
    infoCache.delete(accountId);
    const a = await getAccount(accountId);
    if (!a) { await storeMemberships(accountId, []); return null; } // gone from Control Point: no workspaces
    await rememberInfo(a);
    const info = infoCache.get(accountId)?.info;
    return info ? toInfo(accountId, info) : null;
  } catch (e) { logFailure("account", e); return null; }
}

// ---------------------------------------------------------------------------
// Workspace membership cache (workspace_members). Control Point decides who
// belongs where; Scout keeps the last answer so a write needn't ask every time.
// ---------------------------------------------------------------------------

/** A cached membership younger than this is trusted as is; older, it's re-checked with Control Point first. */
export const MEMBERSHIP_TTL = 10 * 60_000;

/**
 * Replace the account's cached memberships with what Control Point just said. Writes only the cache (and a
 * mirror row's name, if one exists), plus the activity feed: a workspace that appears in the list, or drops
 * out of it, is logged as member.joined / member.left (actor Control Point: Scout doesn't know who added or
 * removed them) in the same transaction, guarded on the cache row so each change is logged once. Only for
 * workspaces with a scout space (a mirror row). Never throws.
 */
async function storeMemberships(accountId: number, list: Workspace[], account?: Pick<SharedAccount, "displayName" | "email">): Promise<void> {
  const now = Date.now(), iso = new Date(now).toISOString();
  // Every fresh answer passes through here: a re-check's saved answer must never be older than it.
  const last = lastForced.get(accountId);
  if (last) lastForced.set(accountId, { at: last.at, list });
  try {
    const cached = await all<{ cp_workspace_id: string; role: string }>("SELECT cp_workspace_id, role FROM workspace_members WHERE account_id = ?", [accountId]);
    const was = new Map(cached.map((r) => [String(r.cp_workspace_id), String(r.role)]));
    const joined = list.filter((w) => !was.has(w.id));
    const left = [...was].filter(([id]) => !list.some((w) => w.id === id));
    const name = joined.length || left.length ? await memberName(accountId, account) : "";
    const actor = CONTROL_POINT_ACTOR, subject = `member:${accountId}`;
    // Guarded on the cache row (read again inside the transaction), so two refreshes racing log a change once.
    const cachedRow = (id: string) => ({ sql: "EXISTS (SELECT 1 FROM workspace_members WHERE account_id = ? AND cp_workspace_id = ?)", args: [accountId, id] });
    // A removal Scout itself is making (removeMember) is recorded there, once, with the admin as actor.
    const logs = [
      ...left.filter(([id]) => !removing.has(dropKey(accountId, id))).map(([id, role]) => ({ id, stmt: activityStatement(id, actor, "member.left", subject, { accountId, name, role }, now, cachedRow(id)) })),
      ...joined.map((w) => {
        const g = cachedRow(w.id);
        return { id: w.id, stmt: activityStatement(w.id, actor, "member.joined", subject, { accountId, name, role: w.role }, now, { sql: `NOT ${g.sql}`, args: g.args }) };
      }),
    ];
    const res = await db().batch([
      ...logs.map((l) => l.stmt),
      {
        sql: `DELETE FROM workspace_members WHERE account_id = ?${list.length ? ` AND cp_workspace_id NOT IN (${list.map(() => "?").join(", ")})` : ""}
              RETURNING cp_workspace_id, workspace_name, role`,
        args: [accountId, ...list.map((w) => w.id)],
      },
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
    for (const r of res[logs.length].rows as unknown as { cp_workspace_id: string; workspace_name: string; role: string }[]) {
      const workspaceId = String(r.cp_workspace_id);
      publishRevoked(workspaceId, accountId);
      if (removing.has(dropKey(accountId, workspaceId))) continue;
      await auditRemoval("Control Point", {
        origin: "control-point", workspaceId, workspaceName: String(r.workspace_name ?? ""),
        accountId, name: name || await memberName(accountId, account), role: r.role === "admin" ? "admin" : "member", actorAccountId: null,
      });
    }
  } catch (e) { console.warn(`[shared-accounts] membership cache write failed: ${(e as Error)?.name ?? "error"}`); }
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
 * Ask Control Point for the account now (bypassing the 10-minute cache) and
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
      list = a ? withoutDropped(accountId, validWorkspaces(a.workspaces)) : [];
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
/**
 * When Scout last dropped a membership itself. An account read that was already on its way (sign-in,
 * /me, a re-check) may still list the workspace; within DROP_HOLD_MS that answer is out of date and
 * must not put the row back. Longer than any Control Point call can take (3 to 8 s timeouts).
 */
const dropped = new Map<string, number>();
export const DROP_HOLD_MS = 15_000;
function withoutDropped(accountId: number, list: Workspace[]): Workspace[] {
  if (!dropped.size) return list;
  const t = Date.now();
  for (const [k, at] of dropped) if (t - at > DROP_HOLD_MS) dropped.delete(k);
  return list.filter((w) => !dropped.has(dropKey(accountId, w.id)));
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
  try {
    const r = await removeWorkspaceMember(workspaceId, target.accountId, actor.accountId);
    if (r.ok) await dropMembership(workspaceId, workspaceName, target, actor, actorAudit);
    return r;
  } finally { removing.delete(key); }
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
