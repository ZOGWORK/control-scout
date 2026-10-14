// /api/auth/* (sign in/out) and /api/me/* (personal data, signed in only).
//
// CSRF: the session cookie is SameSite=Lax and every state-changing request
// must be JSON (a cross-site form can't send application/json without a
// preflight we never allow).
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all, db, get, run, writeBatch } from "../db.js";
import { env } from "../env.js";
import { cleanValue, mergeValue, PERSONAL_KEYS, type PersonalKey, type Stamped } from "../../src/shared/personal.js";
import { currentUser, deleteUser, endSession, readCookie, startSession, token, userForIdentity, type User } from "./session.js";
import { emailEnabled, startEmailSignIn, verifyEmailCode } from "./email.js";
import { CP_PROVIDER, controlPointEnabled, linkedAccountId, linkToSharedAccount, logFailure, provenEmailFor, redeemHandoff } from "./controlPoint.js";

export const authProviders = () => ({ email: emailEnabled(), google: !!(env.googleClientId && env.googleClientSecret), controlPoint: controlPointEnabled() });

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};
const jsonOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" && !req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
  next();
};

/** Small per-IP limiter for sign-in attempts. */
const attempts = new Map<string, { n: number; at: number }>();
function ipLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const k = `${req.path}|${req.ip}`;
    const now = Date.now();
    const a = attempts.get(k);
    if (a && now - a.at < windowMs && a.n >= max) { res.status(429).json({ error: "Too many attempts — wait a few minutes." }); return; }
    attempts.set(k, a && now - a.at < windowMs ? { n: a.n + 1, at: a.at } : { n: 1, at: now });
    if (attempts.size > 20000) attempts.clear();
    next();
  };
}

const publicUser = (u: User) => ({ id: u.id, email: u.email, displayName: u.displayName, createdAt: u.createdAt });

export function authRouter(): Router {
  const r = express.Router();
  r.use(jsonOnly);

  r.get("/me", h(async (req) => {
    const u = await currentUser(req);
    if (!u) return { user: null, providers: authProviders() };
    let linked = controlPointEnabled() ? await linkedAccountId(u.id) : null;
    // Signed in before linking worked (or Control Point was briefly down): link now.
    if (controlPointEnabled() && linked == null) {
      const proven = await provenEmailFor(u);
      if (proven) linked = (await linkToSharedAccount(u, "scout-email-code", proven))?.id ?? null;
    }
    return { user: { ...publicUser(u), controlPointLinked: linked != null }, providers: authProviders() };
  }));

  r.post("/email/start", ipLimit(20, 15 * 60_000), h(async (req, res) => {
    const out = await startEmailSignIn(String(req.body?.email ?? ""));
    if (out.ok) return { ok: true };
    const msg = {
      invalid: "That doesn't look like an email address.",
      cooldown: `A code was just sent — wait ${out.retryAfter ?? 30}s before asking for another.`,
      limit: "Too many codes for this address in the last hour. Try again later.",
      "send-failed": "We couldn't send the email. Try again in a minute.",
      disabled: "Email sign-in isn't set up on this server.",
    }[out.reason];
    res.status(out.reason === "invalid" ? 400 : out.reason === "disabled" ? 503 : out.reason === "send-failed" ? 502 : 429).json({ error: msg, retryAfter: out.retryAfter });
  }));

  r.post("/email/verify", ipLimit(30, 15 * 60_000), h(async (req, res) => {
    const out = await verifyEmailCode(String(req.body?.email ?? ""), String(req.body?.code ?? ""));
    if (!out.ok) {
      const msg = { invalid: "That code isn't right.", expired: "That code has expired — ask for a new one.", attempts: "Too many wrong codes — ask for a new one." }[out.reason];
      res.status(400).json({ error: msg, reason: out.reason });
      return;
    }
    const user = await userForIdentity("email", out.email, out.email);
    const linked = await linkToSharedAccount(user, "scout-email-code", out.email); // the shared account (best effort, 3 s max)
    await startSession(res, user, req.get("user-agent"));
    return { user: { ...publicUser(user), controlPointLinked: linked != null || (controlPointEnabled() && (await linkedAccountId(user.id)) != null) } };
  }));

  r.post("/logout", h(async (req, res) => { await endSession(req, res); return { ok: true }; }));

  // --- Google (dormant until GOOGLE_CLIENT_ID/SECRET are set) ---------------
  const googleRedirect = () => `${env.appUrl.replace(/\/$/, "")}/api/auth/google/callback`;
  r.get("/google/start", (req, res) => {
    if (!authProviders().google) { res.status(503).json({ error: "Google sign-in isn't set up on this server." }); return; }
    // Start on the APP_URL host (the site also answers on aliases such as www):
    // Google returns there, and the state cookie below is host-only.
    const home = new URL(env.appUrl);
    if (req.hostname !== home.hostname) { res.redirect(302, `${home.origin}${req.originalUrl}`); return; }
    const state = token(16);
    res.cookie("cs_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: env.production, path: "/api/auth/google", maxAge: 10 * 60_000 });
    const p = new URLSearchParams({ client_id: env.googleClientId!, redirect_uri: googleRedirect(), response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
  });
  r.get("/google/callback", h(async (req, res) => {
    const state = readCookie(req, "cs_oauth_state");
    res.clearCookie("cs_oauth_state", { path: "/api/auth/google" });
    if (!authProviders().google || !state || state !== req.query.state || typeof req.query.code !== "string") { res.redirect("/settings?signin=failed"); return; }
    const tok = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: req.query.code, client_id: env.googleClientId!, client_secret: env.googleClientSecret!, redirect_uri: googleRedirect(), grant_type: "authorization_code" }),
    }).then((x) => x.json()).catch(() => null);
    const info = tok?.access_token ? await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((x) => x.json()).catch(() => null) : null;
    if (!info?.sub || !info.email || info.email_verified === false) { res.redirect("/settings?signin=failed"); return; }
    const user = await userForIdentity("google", String(info.sub), String(info.email).toLowerCase(), info.name ?? null);
    await linkToSharedAccount(user, "google", String(info.email).toLowerCase());
    await startSession(res, user, req.get("user-agent"));
    res.redirect("/my-team?signin=ok");
  }));

  // --- Continue with Control Point (docs/shared-accounts.md) -----------------
  // Control Point proves who you are with a single-use code; Scout redeems it
  // server to server. Off unless the CONTROL_POINT_* settings are present.
  r.get("/control-point/start", (req, res) => {
    if (!controlPointEnabled()) { res.status(503).json({ error: "Control Point sign-in isn't set up on this server." }); return; }
    const home = new URL(env.appUrl);
    if (req.hostname !== home.hostname) { res.redirect(302, `${home.origin}${req.originalUrl}`); return; }
    const state = token(24); // base64url: 32 characters of [A-Za-z0-9_-]
    res.cookie("cs_cp_state", state, { httpOnly: true, sameSite: "lax", secure: env.production, path: "/api/auth/control-point", maxAge: 10 * 60_000 });
    res.redirect(`${env.controlPointPublicUrl!.replace(/\/$/, "")}/api/auth/scout/start?${new URLSearchParams({ state })}`);
  });
  r.get("/control-point/callback", h(async (req, res) => {
    const state = readCookie(req, "cs_cp_state");
    res.clearCookie("cs_cp_state", { path: "/api/auth/control-point" });
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!controlPointEnabled() || !state || state !== req.query.state || !code) { res.redirect("/settings?signin=failed"); return; }
    const account = await redeemHandoff(code, state).catch((e) => { logFailure("redeem", e); return null; });
    if (!account) { res.redirect("/settings?signin=failed"); return; }
    const user = await userForIdentity(CP_PROVIDER, String(account.id), account.email.toLowerCase(), account.displayName);
    await startSession(res, user, req.get("user-agent"));
    res.redirect("/my-team?signin=ok");
  }));
  return r;
}

// ---------------------------------------------------------------------------
// /api/me — personal data (signed in)
// ---------------------------------------------------------------------------

const MAX_VALUE_BYTES = 256 * 1024;

async function readState(userId: number): Promise<Partial<Record<PersonalKey, Stamped<unknown>>>> {
  const rows = await all<any>("SELECT key, value, updated_at FROM user_state WHERE user_id = ?", [userId]);
  return Object.fromEntries(rows.filter((r) => PERSONAL_KEYS.includes(r.key)).map((r) => [r.key, { value: JSON.parse(r.value), updatedAt: Number(r.updated_at) }]));
}

/**
 * Write a key only if it's at least as new as what's stored — one statement,
 * so two overlapping requests can't let the older one land last.
 */
const WRITE_IF_NEWER = `INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  WHERE excluded.updated_at >= user_state.updated_at`;

async function writeStateIfNewer(userId: number, key: PersonalKey, s: Stamped<unknown>): Promise<Stamped<unknown>> {
  await run(WRITE_IF_NEWER, [userId, key, JSON.stringify(s.value), s.updatedAt]);
  const row = await get<any>("SELECT value, updated_at FROM user_state WHERE user_id = ? AND key = ?", [userId, key]);
  return { value: JSON.parse(row.value), updatedAt: Number(row.updated_at) };
}

export interface ScoutEntryInput { uuid: string; season: number; team: number; eventCode: string | null; matchLabel: string | null; kind: "match" | "pit"; data: Record<string, unknown>; notes: string; updatedAt: number; deleted?: boolean }

export function cleanScoutEntry(x: any): ScoutEntryInput | null {
  if (!x || typeof x !== "object") return null;
  if (typeof x.uuid !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(x.uuid)) return null;
  const season = Number(x.season), team = Number(x.team), updatedAt = Number(x.updatedAt);
  if (!Number.isInteger(season) || season < 2000 || !Number.isInteger(team) || team < 1 || team > 999999 || !Number.isFinite(updatedAt)) return null;
  if (x.kind !== "match" && x.kind !== "pit") return null;
  const data = x.data && typeof x.data === "object" ? x.data : {};
  if (JSON.stringify(data).length > 20_000) return null;
  return {
    uuid: x.uuid, season, team, eventCode: typeof x.eventCode === "string" ? x.eventCode.slice(0, 24) : null, matchLabel: typeof x.matchLabel === "string" ? x.matchLabel.slice(0, 24) : null,
    kind: x.kind, data, notes: typeof x.notes === "string" ? x.notes.slice(0, 4000) : "", updatedAt, deleted: !!x.deleted,
  };
}

const scoutRow = (r: any) => ({ uuid: r.uuid, season: r.season, team: r.team, eventCode: r.event_code, matchLabel: r.match_label, kind: r.kind, data: JSON.parse(r.data), notes: r.notes, updatedAt: Number(r.updated_at), deleted: !!r.deleted });

export function meRouter(): Router {
  const r = express.Router();
  r.use(jsonOnly);
  r.use(async (req, res, next) => {
    try {
      const u = await currentUser(req);
      if (!u) { res.status(401).json({ error: "Sign in to sync this across devices." }); return; }
      (req as any).user = u;
      next();
    } catch (e) { next(e); }
  });
  const uid = (req: Request) => ((req as any).user as User).id;

  r.get("/", h(async (req) => ({ user: publicUser((req as any).user) })));
  r.patch("/", h(async (req) => {
    const name = typeof req.body?.displayName === "string" ? req.body.displayName.trim().slice(0, 60) : null;
    await run("UPDATE users SET display_name = ? WHERE id = ?", [name || null, uid(req)]);
    return { ok: true };
  }));
  r.delete("/", h(async (req, res) => {
    if (req.body?.confirm !== "DELETE") { res.status(400).json({ error: "Confirm with {\"confirm\":\"DELETE\"}" }); return; }
    await deleteUser(uid(req));
    await endSession(req, res);
    return { ok: true };
  }));

  r.get("/state", h(async (req) => ({ state: await readState(uid(req)) })));

  /** Last write wins per key (client clock). Returns the stored value. */
  r.put("/state/:key", h(async (req, res) => {
    const key = req.params.key as PersonalKey;
    if (!PERSONAL_KEYS.includes(key)) { res.status(404).json({ error: "Unknown key" }); return; }
    if (JSON.stringify(req.body ?? {}).length > MAX_VALUE_BYTES) { res.status(413).json({ error: "Too large" }); return; }
    const value = cleanValue(key, req.body?.value);
    const updatedAt = Number(req.body?.updatedAt);
    if (value === null && key !== "myTeam") { res.status(400).json({ error: "Invalid value" }); return; }
    if (!Number.isFinite(updatedAt)) { res.status(400).json({ error: "updatedAt required" }); return; }
    return { stored: await writeStateIfNewer(uid(req), key, { value, updatedAt }) };
  }));

  /** First sign-in on a device: merge its local data into the account. */
  r.post("/migrate", h(async (req) => {
    const local = (req.body?.state ?? {}) as Record<string, Stamped<unknown>>;
    const merged: Record<string, Stamped<unknown>> = {};
    // Read, merge and write in one transaction: a concurrent PUT can't slip
    // between the read and the write and be overwritten by an older snapshot.
    const tx = await db().transaction("write");
    try {
      const rows = (await tx.execute({ sql: "SELECT key, value, updated_at FROM user_state WHERE user_id = ?", args: [uid(req)] })).rows as any[];
      const account = Object.fromEntries(rows.map((r) => [r.key, { value: JSON.parse(r.value), updatedAt: Number(r.updated_at) }]));
      for (const key of PERSONAL_KEYS) {
        const l = local[key];
        const lv = l ? cleanValue(key, l.value) : null;
        const m = mergeValue(key, (account[key] as any) ?? null, lv !== null && Number.isFinite(Number(l?.updatedAt)) ? { value: lv as any, updatedAt: Number(l!.updatedAt) } : null);
        if (!m) continue;
        // Merged lists get a fresh stamp so they win over both inputs.
        const stamped = { ...m, updatedAt: Math.max(m.updatedAt, (account[key] as any)?.updatedAt ?? 0) };
        await tx.execute({ sql: WRITE_IF_NEWER, args: [uid(req), key, JSON.stringify(stamped.value), stamped.updatedAt] });
        merged[key] = stamped;
      }
      await tx.commit();
    } catch (e) { await tx.rollback().catch(() => {}); throw e; } finally { tx.close(); }
    const entries = Array.isArray(req.body?.scout) ? req.body.scout.slice(0, 5000).map(cleanScoutEntry).filter(Boolean) as ScoutEntryInput[] : [];
    if (entries.length) await upsertScout(uid(req), entries);
    return { state: merged, scoutMerged: entries.length };
  }));

  r.get("/scout", h(async (req) => {
    const season = Number(req.query.season);
    const rows = await all<any>(`SELECT * FROM scout_entries WHERE user_id = ?${Number.isInteger(season) ? " AND season = ?" : ""} ORDER BY updated_at DESC`, Number.isInteger(season) ? [uid(req), season] : [uid(req)]);
    return { entries: rows.map(scoutRow) };
  }));

  /** Offline-first sync: the device sends queued entries; newer updatedAt wins. */
  r.post("/scout/sync", h(async (req, res) => {
    const raw = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (raw.length > 200) { res.status(413).json({ error: "Send at most 200 entries per request" }); return; }
    const results: { uuid: string; ok: boolean; error?: string }[] = [];
    const good: ScoutEntryInput[] = [];
    for (const x of raw) {
      const e = cleanScoutEntry(x);
      if (!e) { results.push({ uuid: String(x?.uuid ?? ""), ok: false, error: "invalid entry" }); continue; }
      const owner = await get<{ user_id: number }>("SELECT user_id FROM scout_entries WHERE uuid = ?", [e.uuid]);
      if (owner && Number(owner.user_id) !== uid(req)) { results.push({ uuid: e.uuid, ok: false, error: "not yours" }); continue; }
      good.push(e); results.push({ uuid: e.uuid, ok: true });
    }
    await upsertScout(uid(req), good);
    return { results };
  }));
  return r;
}

async function upsertScout(userId: number, entries: ScoutEntryInput[]) {
  await writeBatch(entries.map((e) => ({
    sql: `INSERT INTO scout_entries (uuid, user_id, season, team, event_code, match_label, kind, data, notes, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(uuid) DO UPDATE SET season = excluded.season, team = excluded.team, event_code = excluded.event_code, match_label = excluded.match_label, kind = excluded.kind,
            data = excluded.data, notes = excluded.notes, updated_at = excluded.updated_at, deleted = excluded.deleted
          WHERE scout_entries.user_id = excluded.user_id AND excluded.updated_at >= scout_entries.updated_at`,
    args: [e.uuid, userId, e.season, e.team, e.eventCode, e.matchLabel, e.kind, JSON.stringify(e.data), e.notes, e.updatedAt, e.deleted ? 1 : 0],
  })));
}
