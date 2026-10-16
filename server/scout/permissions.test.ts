// Task 3 permissions on workspace entries, against a stub Control Point:
// members create and edit any entry, delete only their own; admins delete
// any. A refused write is reported per entry with the server's copy, never
// stored and never published to the live streams. Authorship never changes.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache, MEMBERSHIP_TTL, rememberInfo } from "../auth/controlPoint";
import { subscribe, type LiveEntry } from "./bus";
import { mayWrite, requireWorkspaceAdmin } from "./entries";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
let accountReads = 0;
let cpDown = false;
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 5000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};

beforeAll(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use("/internal", (req, res, next) => {
    if (cpDown) { res.status(500).json({ error: "down" }); return; }
    if (req.get("X-Internal-Key") !== KEY) { res.status(401).json({ error: "bad key" }); return; }
    next();
  });
  stub.post("/internal/accounts/resolve", (req, res) => { res.json({ account: accountFor(String(req.body.email).toLowerCase()) }); });
  stub.get("/internal/accounts/:id", (req, res) => {
    accountReads++;
    const a = [...accounts.values()].find((x) => x.id === Number(req.params.id));
    if (!a) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ account: a });
  });
  stub.get("/api/auth/config", (_req, res) => { res.json({}); });
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
  cpDown = false;
  clearInfoCache();
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});

function client() {
  let cookie = "";
  const call = async (method: string, path: string, json?: unknown) => {
    const r = await fetch(base + path, {
      method, headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
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
  return Object.assign(call, { cookie: () => cookie });
}
type Call = ReturnType<typeof client>;
async function signIn(email: string, displayName?: string): Promise<Call> {
  const call = client();
  await call("POST", "/api/auth/email/start", { email });
  expect((await call("POST", "/api/auth/email/verify", { email, code: inbox.get(email) })).status).toBe(200);
  if (displayName) await call("PATCH", "/api/me", { displayName });
  return call;
}

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({ uuid: `e${String(++n).padStart(10, "0")}`, season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: { auto: 3 }, notes: "fast", updatedAt: 1000, ...over });
const push = (call: Call, workspaceId: string | null, entries: unknown[]) => call("POST", "/api/me/scout/sync", { workspaceId, entries });
const pull = (call: Call, workspaceId: string, since = 0) => call("GET", `/api/scout/sync?workspaceId=${workspaceId}&since=${since}`);
const count = async (table: string) => Number((await all<any>(`SELECT COUNT(*) n FROM ${table}`))[0].n);

type Team = { a: Call; b: Call; admin: Call; ids: { a: number; b: number; admin: number } };
// Three accounts signed in once (sign-in is rate limited per IP), joining a fresh workspace per test.
let people: Team | null = null;
const EMAILS = { a: "priya@example.com", b: "marcus@example.com", admin: "coach@example.com" } as const;
/** Workspace `ws`: A (Priya) and B (Marcus) are members, Coach is its admin. */
async function team(ws: string): Promise<Team> {
  const join = (email: string, role: "admin" | "member") => { const acct = accountFor(email); acct.workspaces = [...(acct.workspaces ?? []), { id: ws, name: "Gearheads", role }]; };
  join(EMAILS.a, "member"); join(EMAILS.b, "member"); join(EMAILS.admin, "admin");
  people ??= {
    a: await signIn(EMAILS.a, "Priya"), b: await signIn(EMAILS.b, "Marcus"), admin: await signIn(EMAILS.admin, "Coach"),
    ids: { a: accountFor(EMAILS.a).id, b: accountFor(EMAILS.b).id, admin: accountFor(EMAILS.admin).id },
  };
  return people;
}
const tomb = (e: ReturnType<typeof entry>, updatedAt: number) => ({ ...e, updatedAt, deleted: true, data: {}, notes: "" });
const stored = async (ws: string, uuid: string) => (await all<any>(
  "SELECT w.* FROM workspace_scout_entries w JOIN workspaces s ON s.id = w.workspace_id WHERE s.cp_workspace_id = ? AND w.uuid = ?", [ws, uuid]))[0];
/** Everything published to the workspace's live streams while `fn` runs. */
async function published(ws: string, fn: () => Promise<unknown>): Promise<LiveEntry[]> {
  const got: LiveEntry[] = [];
  const off = subscribe(ws, (e) => got.push(e));
  try { await fn(); } finally { off(); }
  return got;
}

describe("workspace permissions", () => {
  it("a member deletes their own entry", async () => {
    const { a } = await team("301");
    const e = entry({ updatedAt: 1000 });
    await push(a, "301", [e]);
    const live = await published("301", async () => {
      const r = await push(a, "301", [tomb(e, 2000)]);
      expect(r.status).toBe(200);
      expect(r.json.results[0]).toMatchObject({ uuid: e.uuid, ok: true, entry: { deleted: true } });
    });
    expect(live.map((x) => [x.uuid, x.deleted])).toEqual([[e.uuid, true]]);
    expect(Number((await stored("301", e.uuid)).deleted)).toBe(1);
  });

  it("a member can't delete someone else's entry: refused with the server's copy, not written, not published", async () => {
    const { a, b, ids } = await team("302");
    const e = entry({ updatedAt: 1000, notes: "A's note" });
    await push(a, "302", [e]);
    const before = { ...(await stored("302", e.uuid)) };
    const other = entry({ updatedAt: 1000 }); // a write in the same push still goes through
    const live = await published("302", async () => {
      const r = await push(b, "302", [tomb(e, 2000), other]);
      expect(r.status).toBe(200);
      expect(r.json.results[0]).toEqual({
        uuid: e.uuid, ok: false, error: "forbidden",
        entry: expect.objectContaining({ uuid: e.uuid, deleted: false, notes: "A's note", updatedAt: 1000, authorAccountId: ids.a, editorAccountId: ids.a }),
      });
      expect(r.json.results[1]).toMatchObject({ uuid: other.uuid, ok: true });
    });
    expect(live.map((x) => x.uuid)).toEqual([other.uuid]);
    expect({ ...(await stored("302", e.uuid)) }).toEqual(before);
  });

  it("an admin deletes anyone's entry", async () => {
    const { a, admin, ids } = await team("303");
    const e = entry({ updatedAt: 1000 });
    await push(a, "303", [e]);
    const r = await push(admin, "303", [tomb(e, 2000)]);
    expect(r.json.results[0]).toMatchObject({ ok: true, entry: { deleted: true, authorAccountId: ids.a, editorAccountId: ids.admin } });
    expect((await pull(a, "303")).json.entries[0]).toMatchObject({ uuid: e.uuid, deleted: true });
  });

  it("a member edits someone else's entry; the author never changes", async () => {
    const { a, b, ids } = await team("304");
    const e = entry({ updatedAt: 1000 });
    await push(a, "304", [e]);
    const r = await push(b, "304", [{ ...e, updatedAt: 2000, notes: "B's edit", authorAccountId: ids.b, authorDisplayName: "Marcus" }]);
    expect(r.json.results[0]).toMatchObject({ ok: true, entry: { notes: "B's edit", authorAccountId: ids.a, authorDisplayName: "Priya", editorAccountId: ids.b, editorDisplayName: "Marcus" } });
    const row = await stored("304", e.uuid);
    expect([Number(row.author_account_id), row.author_name]).toEqual([ids.a, "Priya"]);
  });

  it("resurrection: only the author or an admin can edit an entry that's been deleted", async () => {
    const { a, b, admin, ids } = await team("305");
    const e = entry({ updatedAt: 1000, notes: "first" });
    await push(a, "305", [e]);
    await push(admin, "305", [tomb(e, 2000)]); // the admin deletes A's entry
    // B (not the author) edits it from a device that missed the delete: refused, the tombstone comes back.
    const live = await published("305", async () => {
      const r = await push(b, "305", [{ ...e, updatedAt: 3000, notes: "B revives" }]);
      expect(r.json.results[0]).toMatchObject({ ok: false, error: "forbidden", entry: { deleted: true, updatedAt: 2000 } });
    });
    expect(live).toEqual([]);
    // B can't re-delete it either (not B's); nothing changes.
    expect((await push(b, "305", [tomb(e, 3500)])).json.results[0]).toMatchObject({ ok: false, error: "forbidden" });
    // A, the author, may bring it back; authorship is still A's.
    const back = await push(a, "305", [{ ...e, updatedAt: 4000, notes: "A revives" }]);
    expect(back.json.results[0]).toMatchObject({ ok: true, entry: { deleted: false, notes: "A revives", authorAccountId: ids.a } });
    // So may an admin, for an entry its author deleted.
    await push(a, "305", [tomb(e, 5000)]);
    expect((await push(admin, "305", [{ ...e, updatedAt: 6000 }])).json.results[0]).toMatchObject({ ok: true, entry: { deleted: false, authorAccountId: ids.a } });
  });

  it("an entry created and deleted offline (never synced) may be sent as a tombstone: it's the sender's", async () => {
    const { b, ids } = await team("306");
    const e = entry({ updatedAt: 1000 });
    const r = await push(b, "306", [tomb(e, 1500)]);
    expect(r.json.results[0]).toMatchObject({ ok: true, entry: { deleted: true, authorAccountId: ids.b } });
  });

  it("an older delete loses to a newer edit as before: ok with the newer copy, not 'forbidden'", async () => {
    const { a, b } = await team("307");
    const e = entry({ updatedAt: 3000 });
    await push(a, "307", [e]);
    const r = await push(b, "307", [tomb(e, 2000)]);
    expect(r.json.results[0]).toMatchObject({ ok: true, entry: { deleted: false, updatedAt: 3000 } });
  });

  it("a promotion in Control Point (member to admin) counts from the next membership refresh, and so does a demotion", async () => {
    const { a, b } = await team("308");
    const e = entry({ updatedAt: 1000 });
    await push(a, "308", [e]);
    expect((await push(b, "308", [tomb(e, 2000)])).json.results[0]).toMatchObject({ ok: false, error: "forbidden" });
    const acct = accountFor(EMAILS.b);
    const setRole = (role: "admin" | "member") => { acct.workspaces = acct.workspaces!.map((w) => (w.id === "308" ? { ...w, role } : w)); };
    setRole("admin");
    // Later (past the 5 s re-check gap) the cached membership is stale, so the next write re-checks with Control Point and sees the new role.
    clearInfoCache();
    await run("UPDATE workspace_members SET updated_at = ? WHERE account_id = ?", [Date.now() - MEMBERSHIP_TTL - 1, acct.id]);
    expect((await push(b, "308", [tomb(e, 2000)])).json.results[0]).toMatchObject({ ok: true, entry: { deleted: true } });
    // A demotion, brought by a fresh answer (a sign-in), takes it away again.
    const f = entry({ updatedAt: 1000 });
    await push(a, "308", [f]);
    setRole("member");
    await rememberInfo(acct as any);
    expect((await push(b, "308", [tomb(f, 2000)])).json.results[0]).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("/me tells the app its shared account id, to match against entry authors", async () => {
    const { a, ids } = await team("309");
    const me = (await a("GET", "/api/auth/me")).json;
    expect(me.user.controlPoint.accountId).toBe(ids.a);
    expect(me.user.controlPoint.workspaces).toContainEqual({ id: "309", name: "Gearheads", role: "member" });
  });

  it("mayWrite: the rule the upsert enforces", () => {
    const live = { authorAccountId: 1, deleted: false }, gone = { authorAccountId: 1, deleted: true };
    expect(mayWrite("member", 2, null, true)).toBe(true); // new (offline create + delete)
    expect(mayWrite("member", 2, live, false)).toBe(true); // edit anyone's
    expect(mayWrite("member", 2, live, true)).toBe(false); // delete someone else's
    expect(mayWrite("member", 1, live, true)).toBe(true); // delete own
    expect(mayWrite("member", 2, gone, false)).toBe(false); // revive someone else's
    expect(mayWrite("member", 1, gone, false)).toBe(true); // revive own
    expect(mayWrite("admin", 2, live, true)).toBe(true);
    expect(mayWrite("admin", 2, gone, false)).toBe(true);
  });

  it("requireWorkspaceAdmin: admins through, members and non-members 403, signed out 401, bad id 400", async () => {
    const { a, admin } = await team("310");
    const app = express();
    app.use(express.json());
    app.post("/t/:workspaceId", requireWorkspaceAdmin(), (_req, res) => { res.json({ role: res.locals.membership.role }); });
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const hit = async (call: Call | null, ws: string) => {
      const r = await fetch(`${url}/t/${ws}`, { method: "POST", headers: call ? { Cookie: call.cookie() } : {} });
      return [r.status, (await r.json()).role ?? null];
    };
    try {
      expect(await hit(admin, "310")).toEqual([200, "admin"]);
      expect(await hit(a, "310")).toEqual([403, null]);
      expect(await hit(a, "999")).toEqual([403, null]);
      expect(await hit(null, "310")).toEqual([401, null]);
      expect(await hit(admin, "bad%20id")).toEqual([400, null]);
    } finally { srv.close(); }
  });
});
