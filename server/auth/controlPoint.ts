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
  controlPoint: { member: boolean; teams: { teamNumber: number | null; name: string }[] };
}

export const controlPointEnabled = () => !!(env.controlPointInternalUrl && env.controlPointPublicUrl && env.controlPointInternalKey);

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
 * `how` is how Scout proved the email.
 */
export async function linkToSharedAccount(user: User, how: "scout-email-code" | "google"): Promise<SharedAccount | null> {
  if (!controlPointEnabled() || !user.email) return null;
  try {
    const account = await resolveAccount(user.email, how, user.displayName);
    // The same shared account may already be linked to another Scout user (an
    // older duplicate): keep the existing link; userForIdentity merges by email.
    await run("INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES (?, ?, ?)", [CP_PROVIDER, String(account.id), user.id]);
    return account;
  } catch {
    return null;
  }
}

/** How the user's email was proven, for linking an existing session later. */
export async function provenBy(userId: number): Promise<"scout-email-code" | "google" | null> {
  const r = await get<{ provider: string }>("SELECT provider FROM identities WHERE user_id = ? AND provider IN ('email', 'google') ORDER BY provider = 'email' DESC LIMIT 1", [userId]);
  return r?.provider === "email" ? "scout-email-code" : r?.provider === "google" ? "google" : null;
}
