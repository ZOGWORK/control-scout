// Shared accounts: Control Point owns the account store (docs/shared-accounts.md).
// This is Scout's client for Control Point's internal API, plus the linking
// rule: every Scout user with a verified email is tied to one shared account,
// recorded as identities(provider 'control-point', subject = account id).
// Off unless all three env settings are present (Render, the rollback host,
// runs without it: it can't reach Control Point's loopback port).
import { get, run } from "../db.js";
import { env } from "../env.js";
import type { User } from "./session.js";

export const CP_PROVIDER = "control-point";

export interface SharedAccount {
  id: number;
  email: string;
  displayName: string | null;
  createdAt: string;
  controlPoint: { member: boolean; teams: { teamNumber: number | null; name: string }[]; shortlist?: number[] };
}

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
    rememberInfo(account);
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

/** What a signed-in user sees about their Control Point side: membership and teams. */
export interface ControlPointInfo { member: boolean; teams: { teamNumber: number | null; name: string }[]; shortlist: number[]; url: string }

const infoCache = new Map<number, { at: number; info: SharedAccount["controlPoint"] }>();
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
const toInfo = (cp: SharedAccount["controlPoint"]): ControlPointInfo => ({ member: cp.member, teams: cp.teams, shortlist: cp.shortlist ?? [], url: env.controlPointPublicUrl!.replace(/\/$/, "") });

/** Remember an account's Control Point side (from resolve or redeem), so /me needn't ask again. Bounded: expired entries go first, then the oldest. */
export function rememberInfo(account: SharedAccount): void {
  const info = validInfo(account.controlPoint);
  if (!info) return;
  const t = Date.now();
  infoCache.delete(account.id);
  infoCache.set(account.id, { at: t, info });
  if (infoCache.size > INFO_MAX) {
    for (const [k, v] of infoCache) if (t - v.at >= INFO_TTL) infoCache.delete(k);
    while (infoCache.size > INFO_MAX) infoCache.delete(infoCache.keys().next().value!);
  }
}
/** Tests: forget everything (a cold cache). */
export const clearInfoCache = () => infoCache.clear();

/** Membership for a linked account, cached for 10 minutes; null when Control Point can't be reached or sends something unexpected. */
export async function controlPointInfo(accountId: number): Promise<ControlPointInfo | null> {
  try {
    const hit = infoCache.get(accountId);
    if (hit && Date.now() - hit.at < INFO_TTL) return toInfo(hit.info);
    infoCache.delete(accountId);
    const a = await getAccount(accountId);
    if (!a) return null;
    rememberInfo(a);
    const info = infoCache.get(accountId)?.info;
    return info ? toInfo(info) : null;
  } catch (e) { logFailure("account", e); return null; }
}
