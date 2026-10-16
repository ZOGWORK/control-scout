// Task 9: Settings → Workspace → Members against a stub Control Point whose `members` table is the
// source of truth. Scout lists it, an admin's Remove goes through Control Point's internal API, Scout
// drops its cached row at once, and a removal made in Control Point reaches Scout on the next refresh.
// Removal only ever ends workspace access: the person's account and every entry stay.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache, MEMBERSHIP_TTL, rememberInfo } from "../auth/controlPoint";
import { subscribeRevoked } from "./bus";
import { LAST_ADMIN_SELF, REMOVE_UNSUPPORTED } from "../../src/shared/workspaceMembers";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();

// The stub's Control Point: shared accounts, and per workspace its members (email → name, role).
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] } }>();
const teams = new Map<string, { name: string; members: Map<string, { name: string; role: "admin" | "member" }> }>();
let membersRoutes = true; // false: an older Control Point (no members routes)
let cpDown = false;
let cpHangs = false;
let afterRemove: null | (() => Promise<unknown>) = null;
const removeCalls: { workspaceId: string; body: any }[] = [];
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 3000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};
const byId = (id: number) => [...accounts.values()].find((a) => a.id === id);
const payload = (a: { email: string }) => ({
  ...a,
  workspaces: [...teams].filter(([, t]) => t.members.has(a.email)).map(([id, t]) => ({ id, name: t.name, role: t.members.get(a.email)!.role })),
});

beforeAll(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use("/internal", (req, res, next) => {
    if (cpDown) { res.status(500).json({ error: "down" }); return; }
    if (req.get("X-Internal-Key") !== KEY) { res.status(401).json({ error: "bad key" }); return; }
    next();
  });
  stub.post("/internal/accounts/resolve", (req, res) => { res.json({ account: payload(accountFor(String(req.body.email).toLowerCase())) }); });
  stub.get("/internal/accounts/:id", (req, res) => {
    const a = byId(Number(req.params.id));
    if (!a) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ account: payload(a) });
  });
  stub.get("/internal/workspaces/:id/members", (req, res, next) => {
    if (!membersRoutes) { next(); return; }
    const t = teams.get(req.params.id);
    if (!t) { res.status(404).json({ error: "not_found" }); return; }
    res.json({
      workspace: { id: req.params.id, name: t.name },
      members: [...t.members].map(([email, m]) => ({ accountId: accounts.get(email)?.id ?? null, name: m.name, role: m.role })),
    });
  });
  // Control Point's rules, as in its sharedAccounts.ts: actor admin (403), target a member (404), last admin (409).
  stub.post("/internal/workspaces/:id/members/remove", (req, res, next) => {
    if (!membersRoutes) { next(); return; }
    removeCalls.push({ workspaceId: req.params.id, body: req.body });
    if (cpHangs) return; // never answers: Scout's call times out

    const t = teams.get(req.params.id);
    const actor = byId(req.body.actorAccountId), target = byId(req.body.accountId);
    if (!t || !actor || t.members.get(actor.email)?.role !== "admin") { res.status(403).json({ error: "not_admin" }); return; }
    if (!target || !t.members.has(target.email)) { res.status(404).json({ error: "not_member" }); return; }
    const admins = [...t.members.values()].filter((m) => m.role === "admin").length;
    if (t.members.get(target.email)!.role === "admin" && admins <= 1) { res.status(409).json({ error: "last_admin" }); return; }
    t.members.delete(target.email);
    // Something else sees the removal before Control Point answers Scout (e.g. the target's /me).
    if (afterRemove) { void afterRemove().then(() => res.json({ ok: true })); return; }
    res.json({ ok: true });
  });
  stub.get("/api/auth/config", (_req, res) => { res.json({}); });
  stub.use("/internal", (_req, res) => { res.status(404).json({ error: "Not found" }); });
  cp = stub.listen(0);
  await new Promise((r) => cp.once("listening", r));
  cpBase = `http://127.0.0.1:${(cp.address() as AddressInfo).port}`;

  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  setMailer(async (to, _s, text) => { inbox.set(to, /\b(\d{6})\b/.exec(text)![1]); });
  scout = createApp().listen(0);
  await new Promise((r) => scout.once("listening", r));
  base = `http://127.0.0.1:${(scout.address() as AddressInfo).port}`;
});
afterAll(() => {
  setMailer(null); scout?.close(); cp?.close();
  for (const k of ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL"]) delete process.env[k];
});
beforeEach(() => {
  cpDown = false; cpHangs = false; afterRemove = null; membersRoutes = true; removeCalls.length = 0;
  clearInfoCache();
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});

let ip = 0;
function client() {
  let cookie = "";
  // Each client its own address (the app trusts one proxy hop), so sign-ins stay under the per-IP limit.
  const from = `10.9.${Math.floor(++ip / 250)}.${ip % 250}`;
  return async (method: string, path: string, json?: unknown) => {
    const r = await fetch(base + path, {
      method, headers: { "X-Forwarded-For": from, ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k] = kv.split("=");
      cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${k}=`)), ...(kv.endsWith("=") ? [] : [kv])].join("; ");
    }
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null };
  };
}
type Call = ReturnType<typeof client>;
async function signIn(email: string, displayName: string): Promise<Call> {
  const call = client();
  await call("POST", "/api/auth/email/start", { email });
  expect((await call("POST", "/api/auth/email/verify", { email, code: inbox.get(email) })).status).toBe(200);
  await call("PATCH", "/api/me", { displayName });
  return call;
}

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({ uuid: `m${String(++n).padStart(10, "0")}`, season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: { auto: 3 }, notes: "fast", updatedAt: 1000 + n, ...over });
const push = (call: Call, workspaceId: string | null, entries: unknown[]) => call("POST", "/api/me/scout/sync", { workspaceId, entries });
const members = (call: Call, ws: string) => call("GET", `/api/scout/workspaces/${ws}/members`);
const remove = (call: Call, ws: string, accountId: unknown) => call("POST", `/api/scout/workspaces/${ws}/members/remove`, { accountId });
const cached = (accountId: number, ws: string) => get("SELECT role FROM workspace_members WHERE account_id = ? AND cp_workspace_id = ?", [accountId, ws]);
const audits = async () => (await all<any>("SELECT actor, action, details FROM owner_audit WHERE action = 'workspace.member_removed' ORDER BY id")).map((r) => ({ actor: r.actor, details: JSON.parse(r.details) }));
const activity = async (ws: string) => (await all<any>(
  "SELECT a.actor_account_id, a.actor_name, a.type, a.subject, a.details FROM workspace_activity a JOIN workspaces w ON w.id = a.workspace_id WHERE w.cp_workspace_id = ? ORDER BY a.id", [ws]))
  .map((r) => ({ actor: { accountId: r.actor_account_id == null ? null : Number(r.actor_account_id), name: r.actor_name }, type: r.type, subject: r.subject, details: JSON.parse(r.details) }));

let wsN = 0;
/** A workspace with an admin (Ada), a member (Max) and, optionally, someone who never used Scout; all signed in but the last. */
async function workspace() {
  const id = String(500 + ++wsN);
  const tag = `w${wsN}`;
  const t = { name: `Gearheads ${tag}`, members: new Map<string, { name: string; role: "admin" | "member" }>() };
  t.members.set(`ada.${tag}@example.com`, { name: "Ada Admin", role: "admin" });
  t.members.set(`max.${tag}@example.com`, { name: "Max Member", role: "member" });
  t.members.set(`bea.${tag}@example.com`, { name: "Bea Builder", role: "member" }); // never signs in to Scout
  teams.set(id, t);
  const ada = await signIn(`ada.${tag}@example.com`, "Ada");
  const max = await signIn(`max.${tag}@example.com`, "Max");
  const adaId = accounts.get(`ada.${tag}@example.com`)!.id, maxId = accounts.get(`max.${tag}@example.com`)!.id;
  // The first entry creates the scout space (the mirror row the feed lives on).
  expect((await push(ada, id, [entry()])).status).toBe(200);
  return { id, t, tag, ada, max, adaId, maxId };
}

describe("workspace members", () => {
  it("lists everyone from Control Point, marks you, and says who can remove", async () => {
    const w = await workspace();
    const r = await members(w.ada, w.id);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      source: "control-point", canRemove: true, removeUnavailable: null,
      members: [
        { accountId: w.adaId, name: "Ada Admin", role: "admin", you: true },
        { accountId: null, name: "Bea Builder", role: "member", you: false },
        { accountId: w.maxId, name: "Max Member", role: "member", you: false },
      ],
    });
    // A member sees the same list, without Remove.
    expect((await members(w.max, w.id)).json).toMatchObject({ canRemove: false, members: expect.arrayContaining([expect.objectContaining({ accountId: w.maxId, you: true })]) });
    // Not a member: 403; signed out: 401.
    const outsider = await signIn(`out.${w.tag}@example.com`, "Out");
    expect((await members(outsider, w.id)).status).toBe(403);
    expect((await members(client(), w.id)).status).toBe(401);
  });

  it("Control Point unreachable: the members Scout knows (who use Control Scout), still with Remove", async () => {
    const w = await workspace();
    await members(w.ada, w.id); // warm: the memberships are cached
    cpDown = true;
    const r = await members(w.ada, w.id);
    expect(r.status).toBe(200);
    expect(r.json.source).toBe("scout");
    expect(r.json.members.map((m: any) => [m.accountId, m.name, m.role])).toEqual([[w.adaId, "Ada", "admin"], [w.maxId, "Max", "member"]]);
  });

  it("an admin removes a member: Control Point is called with both ids, the cache row goes at once, audit and activity written", async () => {
    const w = await workspace();
    expect((await push(w.max, w.id, [entry({ notes: "by max" })])).status).toBe(200);
    expect(await cached(w.maxId, w.id)).toBeTruthy();
    const revoked: number[] = [];
    const off = subscribeRevoked(w.id, (a) => revoked.push(a));
    const r = await remove(w.ada, w.id, w.maxId);
    off();
    expect(r).toEqual({ status: 200, json: { ok: true, self: false } });
    expect(removeCalls).toEqual([{ workspaceId: w.id, body: { accountId: w.maxId, actorAccountId: w.adaId } }]);
    expect(await cached(w.maxId, w.id)).toBeUndefined();
    expect(revoked).toEqual([w.maxId]); // Max's open streams there end now
    expect((await audits()).at(-1)).toEqual({
      actor: `ada.${w.tag}@example.com`,
      details: { origin: "control-scout", workspaceId: w.id, workspaceName: w.t.name, accountId: w.maxId, name: "Max Member", role: "member", actorAccountId: w.adaId, actorName: "Ada" },
    });
    expect((await activity(w.id)).filter((a) => a.type.startsWith("member."))).toEqual([
      { actor: { accountId: w.adaId, name: "Ada" }, type: "member.left", subject: `member:${w.maxId}`, details: { accountId: w.maxId, name: "Max Member", role: "member", origin: "control-scout" } },
    ]);
    // Max is out straight away (no 10-minute wait): writes refused, the list no longer has him.
    expect((await push(w.max, w.id, [entry()])).status).toBe(403);
    expect((await w.max("GET", "/api/auth/me")).json.user.controlPoint.workspaces).toEqual([]);
    expect((await members(w.ada, w.id)).json.members.map((m: any) => m.name)).toEqual(["Ada Admin", "Bea Builder"]);
    // The refresh that follows logs nothing more (the row is already gone).
    await run("UPDATE workspace_members SET updated_at = 0");
    clearInfoCache();
    await w.max("GET", "/api/auth/me");
    expect((await activity(w.id)).filter((a) => a.type.startsWith("member."))).toHaveLength(1);
  });

  it("a non-admin is refused with 403 without asking Control Point", async () => {
    const w = await workspace();
    const r = await remove(w.max, w.id, w.adaId);
    expect(r.status).toBe(403);
    expect(removeCalls).toEqual([]);
    expect(w.t.members.has(`ada.${w.tag}@example.com`)).toBe(true);
    expect((await remove(client(), w.id, w.adaId)).status).toBe(401);
  });

  it("bad input: 400, and JSON only", async () => {
    const w = await workspace();
    for (const id of [0, -1, 1.5, "3001", null, undefined]) expect((await remove(w.ada, w.id, id)).status, String(id)).toBe(400);
    expect((await w.ada("POST", `/api/scout/workspaces/${w.id}/members/remove`)).status).toBe(415);
    expect(removeCalls).toEqual([]);
  });

  it("the last admin can't be removed, by themselves either: Control Point's 409 is shown", async () => {
    const w = await workspace();
    const self = await remove(w.ada, w.id, w.adaId);
    expect(self).toEqual({ status: 409, json: { error: LAST_ADMIN_SELF, code: "last_admin" } });
    expect(await cached(w.adaId, w.id)).toBeTruthy();
    // Scout's cached role is out of date (an admin here, not in Control Point): Control Point's 403 stands.
    await run("UPDATE workspace_members SET role = 'admin' WHERE account_id = ?", [w.maxId]);
    expect(await remove(w.max, w.id, w.adaId)).toMatchObject({ status: 403, json: { code: "not_admin" } });
    expect(w.t.members.get(`ada.${w.tag}@example.com`)).toBeTruthy();
    // With two admins, one may leave.
    w.t.members.get(`max.${w.tag}@example.com`)!.role = "admin";
    expect((await remove(w.ada, w.id, w.adaId)).json).toEqual({ ok: true, self: true });
    expect(await cached(w.adaId, w.id)).toBeUndefined();
    expect((await activity(w.id)).at(-1)).toMatchObject({ type: "member.left", details: { accountId: w.adaId, self: true, origin: "control-scout" } });
  });

  it("an older Control Point (no members routes): the list says so, and Remove explains without breaking anything", async () => {
    const w = await workspace();
    membersRoutes = false;
    const r = await members(w.ada, w.id);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ source: "scout", canRemove: false, removeUnavailable: REMOVE_UNSUPPORTED });
    expect(r.json.members.map((m: any) => m.accountId).sort()).toEqual([w.adaId, w.maxId].sort());
    // A member isn't told about a button they don't have.
    expect((await members(w.max, w.id)).json.removeUnavailable).toBeNull();
    const rm = await remove(w.ada, w.id, w.maxId);
    expect(rm).toEqual({ status: 501, json: { error: REMOVE_UNSUPPORTED, code: "unsupported" } });
    expect(await cached(w.maxId, w.id)).toBeTruthy();
    expect((await push(w.max, w.id, [entry()])).status).toBe(200);
  });

  it("Control Point unreachable while removing: 502 and nothing changes", async () => {
    const w = await workspace();
    await members(w.ada, w.id);
    cpDown = true;
    const r = await remove(w.ada, w.id, w.maxId);
    expect(r).toMatchObject({ status: 502, json: { code: "unconfirmed", error: expect.stringMatching(/Couldn't confirm/) } });
    expect(await cached(w.maxId, w.id)).toBeTruthy();
    expect(w.t.members.has(`max.${w.tag}@example.com`)).toBe(true);
  });

  it("a timeout after Control Point removed them: 502 unconfirmed, and the background re-check catches up", async () => {
    const w = await workspace();
    await members(w.ada, w.id);
    cpHangs = true; // the stub removes nothing and never answers
    w.t.members.delete(`max.${w.tag}@example.com`); // ...but Control Point did remove Max
    const r = await remove(w.ada, w.id, w.maxId);
    expect(r).toMatchObject({ status: 502, json: { code: "unconfirmed" } });
    cpHangs = false;
    await expect.poll(() => cached(w.maxId, w.id), { timeout: 10_000 }).toBeUndefined();
  }, 30_000);

  it("a refresh that sees the removal first doesn't record it twice: once, with the admin as actor", async () => {
    const w = await workspace();
    afterRemove = async () => { clearInfoCache(); await w.max("GET", "/api/auth/me"); };
    expect((await remove(w.ada, w.id, w.maxId)).status).toBe(200);
    const left = (await activity(w.id)).filter((a) => a.type === "member.left");
    expect(left).toHaveLength(1);
    expect(left[0].actor).toEqual({ accountId: w.adaId, name: "Ada" });
    expect((await audits()).filter((a) => a.details.workspaceId === w.id)).toHaveLength(1);
  });

  it("an account read already on its way can't put a removed member back", async () => {
    const w = await workspace();
    const stale = { ...payload(accounts.get(`max.${w.tag}@example.com`)!) }; // read before the removal
    expect((await remove(w.ada, w.id, w.maxId)).status).toBe(200);
    await rememberInfo(stale as any); // ...and landing after it
    expect(await cached(w.maxId, w.id)).toBeUndefined();
    expect((await push(w.max, w.id, [entry()])).status).toBe(403);
  });

  it("someone already gone: 404, and the cache catches up", async () => {
    const w = await workspace();
    w.t.members.delete(`max.${w.tag}@example.com`); // removed in Control Point meanwhile
    const r = await remove(w.ada, w.id, w.maxId);
    expect(r).toMatchObject({ status: 404, json: { code: "not_member" } });
    await expect.poll(() => cached(w.maxId, w.id)).toBeUndefined();
  });

  it("removed in Control Point: the next refresh drops access, logs it as Control Point's, audits it and ends their streams", async () => {
    const w = await workspace();
    const revoked: number[] = [];
    const off = subscribeRevoked(w.id, (a) => revoked.push(a));
    w.t.members.delete(`max.${w.tag}@example.com`);
    // Within the cache window Scout still trusts its row; the refresh (/me with a cold cache) is the signal.
    clearInfoCache();
    const me = (await w.max("GET", "/api/auth/me")).json;
    off();
    expect(me.user.controlPoint.workspaces).toEqual([]);
    expect(await cached(w.maxId, w.id)).toBeUndefined();
    expect(revoked).toEqual([w.maxId]);
    expect((await activity(w.id)).filter((a) => a.type === "member.left")).toEqual([
      { actor: { accountId: null, name: "Control Point" }, type: "member.left", subject: `member:${w.maxId}`, details: { accountId: w.maxId, name: "Max", role: "member" } },
    ]);
    expect((await audits()).at(-1)).toEqual({
      actor: "Control Point",
      details: { origin: "control-point", workspaceId: w.id, workspaceName: w.t.name, accountId: w.maxId, name: "Max", role: "member", actorAccountId: null },
    });
    expect((await push(w.max, w.id, [entry()])).status).toBe(403);
    // A stale row with no /me in between: the write's re-check is the refresh.
    const a = await workspace();
    a.t.members.delete(`max.${a.tag}@example.com`);
    await run("UPDATE workspace_members SET updated_at = ? WHERE account_id = ?", [Date.now() - MEMBERSHIP_TTL - 1, a.maxId]);
    expect((await push(a.max, a.id, [entry()])).status).toBe(403);
    expect(await cached(a.maxId, a.id)).toBeUndefined();
  });

  it("removal never touches the person's account, personal data, personal entries or workspace entries", async () => {
    const w = await workspace();
    const personal = entry({ notes: "mine" });
    expect((await push(w.max, null, [personal])).status).toBe(200);
    const shared = entry({ notes: "for the team" });
    expect((await push(w.max, w.id, [shared])).status).toBe(200);
    const user = await get<any>("SELECT u.* FROM users u JOIN identities i ON i.user_id = u.id WHERE i.provider = 'control-point' AND i.subject = ?", [String(w.maxId)]);
    expect((await remove(w.ada, w.id, w.maxId)).status).toBe(200);
    // The account and its sign-in are intact.
    expect({ ...(await get<any>("SELECT * FROM users WHERE id = ?", [user.id])) }).toEqual({ ...user });
    expect((await w.max("GET", "/api/auth/me")).json.user).toMatchObject({ id: user.id, displayName: "Max" });
    // Personal entries: all there.
    expect((await w.max("GET", "/api/me/scout")).json.entries.map((e: any) => e.uuid)).toContain(personal.uuid);
    // Workspace entries: still there, still credited to Max, for the members who remain.
    const pulled = (await w.ada("GET", `/api/scout/sync?workspaceId=${w.id}&since=0`)).json.entries;
    expect(pulled.find((e: any) => e.uuid === shared.uuid)).toMatchObject({ authorAccountId: w.maxId, authorDisplayName: "Max", deleted: false, notes: "for the team" });
  });
});
