// Workspace scout entries against a stub Control Point that sends (or, like an
// older deploy, doesn't send) `workspaces` on the shared account: membership
// cache, auth on every write, server-side last-write-wins, the cursor pull,
// and lazy creation of the workspace mirror row.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache, MEMBERSHIP_TTL, rememberInfo } from "../auth/controlPoint";

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
  if (!a) { a = { id: 2000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
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
  return call;
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

describe("workspace scout entries", () => {
  it("an older Control Point (no workspaces field) means personal only: no error, no workspace access", async () => {
    const a = accountFor("old@example.com");
    delete a.workspaces;
    const call = await signIn("old@example.com");
    const me = (await call("GET", "/api/auth/me")).json;
    expect(me.user.controlPointLinked).toBe(true);
    expect(me.user.controlPoint.workspaces).toEqual([]);
    expect(await all("SELECT * FROM workspace_members WHERE account_id = ?", [a.id])).toEqual([]);
    expect((await push(call, "77", [entry()])).status).toBe(403);
    expect((await pull(call, "77")).status).toBe(403);
    // Personal scouting works exactly as before.
    const p = await push(call, null, [entry()]);
    expect(p.status).toBe(200);
    expect(p.json.results[0]).toEqual({ uuid: expect.any(String), ok: true });
    expect((await call("POST", "/api/me/scout/sync", { entries: [entry()] })).status).toBe(200); // no workspaceId at all: personal
  });

  it("caches membership on sign-in and /me, and a plain /me writes nothing else", async () => {
    const a = accountFor("lin@example.com");
    a.workspaces = [{ id: "41", name: "Hypnotic Robotics", role: "admin" }, { id: "bad id!", name: "x", role: "member" }];
    const call = await signIn("lin@example.com");
    const rows = await all<any>("SELECT cp_workspace_id, workspace_name, role FROM workspace_members WHERE account_id = ?", [a.id]);
    expect(rows.map((r) => ({ ...r }))).toEqual([{ cp_workspace_id: "41", workspace_name: "Hypnotic Robotics", role: "admin" }]);
    const before = { ws: await count("workspaces"), entries: await count("workspace_scout_entries"), personal: await count("scout_entries") };
    clearInfoCache(); // a cold cache: /me asks Control Point and rewrites the membership cache
    const me = (await call("GET", "/api/auth/me")).json;
    expect(me.user.controlPoint.workspaces).toEqual([{ id: "41", name: "Hypnotic Robotics", role: "admin" }]);
    expect(await call("GET", "/api/auth/me")).toMatchObject({ status: 200 });
    expect({ ws: await count("workspaces"), entries: await count("workspace_scout_entries"), personal: await count("scout_entries") }).toEqual(before);
    // Reading an untouched workspace doesn't create its mirror row either.
    expect((await pull(call, "41")).json).toEqual({ entries: [], cursor: 0, more: false });
    expect(await count("workspaces")).toBe(before.ws);
  });

  it("a member writes (200); the first entry creates the mirror row; the server stamps the author", async () => {
    const a = accountFor("priya@example.com");
    a.workspaces = [{ id: "51", name: "Gearheads", role: "member" }];
    const call = await signIn("priya@example.com", "Priya");
    expect(await all("SELECT * FROM workspaces WHERE cp_workspace_id = '51'")).toEqual([]);
    const e = entry({ authorAccountId: 1, authorDisplayName: "Not Priya" }); // client claims are ignored
    const r = await push(call, "51", [e]);
    expect(r.status).toBe(200);
    expect(r.json.results[0]).toMatchObject({ uuid: e.uuid, ok: true, entry: { uuid: e.uuid, workspaceId: "51", authorAccountId: a.id, authorDisplayName: "Priya", editorAccountId: a.id, notes: "fast", deleted: false } });
    const ws = await all<any>("SELECT name, settings, settings_version FROM workspaces WHERE cp_workspace_id = '51'");
    expect(ws.map((x) => ({ ...x }))).toEqual([{ name: "Gearheads", settings: null, settings_version: 0 }]);
    // Another member edits it: the author stays, the editor changes.
    const b = accountFor("marcus@example.com");
    b.workspaces = [{ id: "51", name: "Gearheads", role: "admin" }];
    const other = await signIn("marcus@example.com", "Marcus");
    const edit = await push(other, "51", [{ ...e, notes: "faster", updatedAt: 2000 }]);
    expect(edit.json.results[0].entry).toMatchObject({ notes: "faster", authorDisplayName: "Priya", editorDisplayName: "Marcus", editorAccountId: b.id });
    // A workspace entry is not a personal one.
    expect((await call("GET", "/api/me/scout")).json.entries).toEqual([]);
  });

  it("a non-member is refused (403) and nothing is written", async () => {
    accountFor("owner@example.com").workspaces = [{ id: "61", name: "Private", role: "admin" }];
    accountFor("stranger@example.com").workspaces = [{ id: "62", name: "Elsewhere", role: "admin" }];
    const call = await signIn("stranger@example.com");
    const before = await count("workspace_scout_entries");
    const r = await push(call, "61", [entry()]);
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/not a member/);
    expect(await count("workspace_scout_entries")).toBe(before);
    expect(await all("SELECT * FROM workspaces WHERE cp_workspace_id = '61'")).toEqual([]);
    expect((await pull(call, "61")).status).toBe(403);
    // Signed out: 401. Bad ids: 400.
    expect((await client()("GET", "/api/scout/sync?workspaceId=61")).status).toBe(401);
    expect((await push(call, "../61", [entry()])).status).toBe(400);
    expect((await pull(call, "61", -1)).status).toBe(400);
  });

  it("a membership miss asks Control Point once, then lets a new member in", async () => {
    const a = accountFor("new@example.com");
    a.workspaces = [];
    const call = await signIn("new@example.com");
    a.workspaces = [{ id: "71", name: "Just Joined", role: "member" }]; // added in Control Point after sign-in
    const reads = accountReads;
    expect((await push(call, "71", [entry()])).status).toBe(200);
    expect(accountReads).toBe(reads + 1);
    // Now cached: the next write doesn't ask again.
    expect((await push(call, "71", [entry()])).status).toBe(200);
    expect(accountReads).toBe(reads + 1);
  });

  it("removed in Control Point: once the cached row is stale, the re-check refuses the write", async () => {
    const a = accountFor("gone@example.com");
    a.workspaces = [{ id: "81", name: "Team", role: "member" }];
    const call = await signIn("gone@example.com");
    expect((await push(call, "81", [entry()])).status).toBe(200);
    a.workspaces = [];
    await run("UPDATE workspace_members SET updated_at = ? WHERE account_id = ?", [Date.now() - MEMBERSHIP_TTL - 1, a.id]);
    expect((await push(call, "81", [entry()])).status).toBe(403);
    expect(await all("SELECT * FROM workspace_members WHERE account_id = ?", [a.id])).toEqual([]);
  });

  it("removed in Control Point but the cache write fails: Control Point's answer still refuses the write", async () => {
    const a = accountFor("locked@example.com");
    a.workspaces = [{ id: "85", name: "Team", role: "member" }];
    const call = await signIn("locked@example.com");
    a.workspaces = [];
    await run("UPDATE workspace_members SET updated_at = ? WHERE account_id = ?", [Date.now() - MEMBERSHIP_TTL - 1, a.id]);
    await run("CREATE TRIGGER members_locked BEFORE DELETE ON workspace_members BEGIN SELECT RAISE(ABORT, 'locked'); END");
    try {
      expect((await push(call, "85", [entry()])).status).toBe(403);
      expect(await all("SELECT * FROM workspace_members WHERE account_id = ?", [a.id])).toHaveLength(1); // the stale row survived…
      expect((await pull(call, "85")).status).toBe(403); // …and still grants nothing
    } finally { await run("DROP TRIGGER members_locked"); }
  });

  it("a re-check's saved answer is replaced by a newer one (sign-in), so a removal sticks within the 5 s window", async () => {
    const a = accountFor("window@example.com");
    a.workspaces = [{ id: "87", name: "Team", role: "member" }];
    const call = await signIn("window@example.com");
    await run("UPDATE workspace_members SET updated_at = ? WHERE account_id = ?", [Date.now() - MEMBERSHIP_TTL - 1, a.id]);
    expect((await push(call, "87", [entry()])).status).toBe(200); // a forced re-check: its answer (member) is saved
    a.workspaces = [];
    await rememberInfo(a as any); // a newer answer, as a sign-in or hand-off brings it: removed
    expect((await push(call, "87", [entry()])).status).toBe(403);
  });

  it("Control Point unreachable: a stale cached membership still counts, so scouting carries on", async () => {
    const a = accountFor("venue@example.com");
    a.workspaces = [{ id: "91", name: "Team", role: "member" }];
    const call = await signIn("venue@example.com");
    await run("UPDATE workspace_members SET updated_at = ? WHERE account_id = ?", [Date.now() - MEMBERSHIP_TTL - 1, a.id]);
    cpDown = true;
    expect((await push(call, "91", [entry()])).status).toBe(200);
    expect((await call("GET", "/api/auth/me")).status).toBe(200); // and /me never fails over it
  });

  it("server-side last-write-wins: an older updatedAt never overwrites a newer row", async () => {
    accountFor("lww@example.com").workspaces = [{ id: "101", name: "Team", role: "member" }];
    const call = await signIn("lww@example.com");
    const e = entry({ updatedAt: 3000, notes: "newer" });
    await push(call, "101", [e]);
    const { cursor } = (await pull(call, "101")).json;
    const late = await push(call, "101", [{ ...e, updatedAt: 2000, notes: "older" }]);
    expect(late.status).toBe(200);
    expect(late.json.results[0].entry).toMatchObject({ notes: "newer", updatedAt: 3000 }); // the stored copy, for the device to adopt
    // The refused write didn't move the cursor either.
    expect((await pull(call, "101", cursor)).json.entries).toEqual([]);
    // An older tombstone doesn't delete it.
    await push(call, "101", [{ ...e, updatedAt: 2500, deleted: true, data: {}, notes: "" }]);
    expect((await pull(call, "101")).json.entries[0]).toMatchObject({ uuid: e.uuid, notes: "newer", deleted: false });
  });

  it("pull with since returns changes and tombstones in write order, with a stable cursor", async () => {
    accountFor("pull@example.com").workspaces = [{ id: "111", name: "Team", role: "member" }];
    const call = await signIn("pull@example.com");
    const a = entry({ updatedAt: 5000 }), b = entry({ updatedAt: 5000 }); // equal stamps: the cursor still orders them
    await push(call, "111", [a, b]);
    const first = (await pull(call, "111")).json;
    expect(first.entries.map((e: any) => e.uuid)).toEqual([a.uuid, b.uuid]);
    expect(first.more).toBe(false);
    // Delete a; add c from a device that was offline, with a clock older than everything so far.
    const c = entry({ updatedAt: 10 });
    await push(call, "111", [{ ...a, updatedAt: 6000, deleted: true, data: {}, notes: "" }]);
    await push(call, "111", [c]);
    const next = (await pull(call, "111", first.cursor)).json;
    expect(next.entries.map((e: any) => [e.uuid, e.deleted])).toEqual([[a.uuid, true], [c.uuid, false]]);
    expect(next.cursor).toBeGreaterThan(first.cursor);
    expect((await pull(call, "111", next.cursor)).json).toEqual({ entries: [], cursor: next.cursor, more: false });
  });

  it("one space per request: entries naming another space are refused", async () => {
    accountFor("space@example.com").workspaces = [{ id: "121", name: "Team", role: "member" }];
    const call = await signIn("space@example.com");
    const r = await push(call, "121", [entry({ workspaceId: "999" }), entry({ workspaceId: "121" })]);
    expect(r.json.results.map((x: any) => x.ok)).toEqual([false, true]);
    const p = await push(call, null, [entry({ workspaceId: "121" })]);
    expect(p.json.results[0]).toMatchObject({ ok: false, error: "wrong space" });
  });

  it("without the Control Point settings, workspaces are off and personal scouting is unchanged", async () => {
    accountFor("nocp@example.com").workspaces = [{ id: "131", name: "Team", role: "member" }];
    const call = await signIn("nocp@example.com");
    delete process.env.CONTROL_POINT_INTERNAL_KEY;
    expect((await push(call, "131", [entry()])).status).toBe(403);
    expect((await push(call, null, [entry()])).status).toBe(200);
    expect((await call("GET", "/api/auth/me")).json.user.controlPoint).toBeNull();
  });
});
