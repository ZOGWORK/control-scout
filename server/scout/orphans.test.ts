// Task 19: orphaned workspaces, against a stub Control Point. A workspace deleted there (its members route
// answers 404 not_found), or left with no admin, turns its scout space read-only: former members keep
// reading (entries, comments, assignments, photos, export) and every write is refused with 423
// workspace_read_only, never 403. A personal removal is not this. The workspace coming back restores
// writing, and /api/auth/me follows within a minute. The owner portal lists the read-only spaces.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache, ME_TTL, MEMBERSHIP_TTL } from "../auth/controlPoint";
import { invalidateFlags, setFlag } from "../flags";
import { subscribeAccountChanged, subscribeRevoked, subscribeWorkspaceState } from "./bus";
import { fakeR2 } from "./fakeR2";
import { inboxSettled } from "../inbox/inbox";
import { sweep } from "./stream";
import { READ_ONLY_CODE, READ_ONLY_STATUS, type OrphanState } from "../../src/shared/orphaned";

const KEY = "k".repeat(40);
const ENV = ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL", "R2_FAKE", "R2_ENDPOINT", "OWNER_EMAILS", "R2_FAKE_DIR"];
const savedEnv: Record<string, string | undefined> = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();

// The stub's Control Point: accounts, and per workspace its members (email → name, role). Deleting a
// workspace removes it from every account's payload and its members route answers 404 not_found.
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] } }>();
const teams = new Map<string, { name: string; members: Map<string, { name: string; role: "admin" | "member" }> }>();
let membersCalls = 0;
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 7000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
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
  stub.use("/internal", (req, res, next) => { if (req.get("X-Internal-Key") !== KEY) { res.status(401).json({ error: "bad key" }); return; } next(); });
  stub.post("/internal/accounts/resolve", (req, res) => { res.json({ account: payload(accountFor(String(req.body.email).toLowerCase())) }); });
  stub.get("/internal/accounts/:id", (req, res) => {
    const a = byId(Number(req.params.id));
    if (!a) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ account: payload(a) });
  });
  stub.get("/internal/workspaces/:id/members", (req, res) => {
    membersCalls++;
    const t = teams.get(req.params.id);
    if (!t) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ workspace: { id: req.params.id, name: t.name }, members: [...t.members].map(([email, m]) => ({ accountId: accounts.get(email)?.id ?? null, name: m.name, role: m.role })) });
  });
  stub.get("/api/auth/config", (_req, res) => { res.json({}); });
  stub.use("/internal", (_req, res) => { res.status(404).json({ error: "Not found" }); });
  cp = stub.listen(0);
  await new Promise((r) => cp.once("listening", r));
  cpBase = `http://127.0.0.1:${(cp.address() as AddressInfo).port}`;

  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const t of [18360, 7]) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [2025, "USNJQ1", t]); // assignable teams
  setMailer(async (to, _s, text) => { inbox.set(to, /\b(\d{6})\b/.exec(text)![1]); });
  delete process.env.R2_FAKE_DIR;
  process.env.R2_FAKE = "1"; // before createApp: it mounts the photo storage stand-in
  scout = createApp().listen(0);
  await new Promise((r) => scout.once("listening", r));
  base = `http://127.0.0.1:${(scout.address() as AddressInfo).port}`;
});
afterAll(() => {
  setMailer(null); scout?.close(); cp?.close();
  for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});
beforeEach(async () => {
  clearInfoCache();
  Object.assign(process.env, {
    CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1",
    R2_FAKE: "1", R2_ENDPOINT: `${base}/__fake-r2`, OWNER_EMAILS: "owner@example.com",
  });
  await setFlag("photos", true, "test");
  await setFlag("workspaceScouting", true, "test");
  fakeR2.clear();
});
afterEach(async () => { vi.useRealTimers(); invalidateFlags(); await inboxSettled(); });

let ip = 0;
function client() {
  let cookie = "";
  const from = `10.19.${Math.floor(++ip / 250)}.${ip % 250}`;
  const call = async (method: string, path: string, json?: unknown) => {
    const r = await fetch(base + path, {
      method, redirect: "manual", headers: { "X-Forwarded-For": from, ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k] = kv.split("=");
      cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${k}=`)), ...(kv.endsWith("=") ? [] : [kv])].join("; ");
    }
    const text = await r.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: r.status, json: body, text };
  };
  return Object.assign(call, { cookie: () => cookie });
}

// (performance.now, not Date: some tests move the clock by hand.)
async function until(ok: () => boolean, ms = 3000) {
  const end = performance.now() + ms;
  while (!ok()) {
    if (performance.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A live stream, its events as they arrive. */
async function openStream(call: Call, ws: string) {
  const ac = new AbortController();
  const r = await fetch(`${base}/api/scout/stream?workspaceId=${ws}&since=0`, { headers: { Cookie: call.cookie() }, signal: ac.signal });
  const events: { event?: string; data?: string }[] = [];
  let ended = false;
  void (async () => {
    const dec = new TextDecoder();
    let raw = "";
    try {
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        raw += dec.decode(chunk, { stream: true });
        let i;
        while ((i = raw.indexOf("\n\n")) >= 0) {
          const block = raw.slice(0, i); raw = raw.slice(i + 2);
          const f: { event?: string; data?: string } = {};
          for (const line of block.split("\n")) if (!line.startsWith(":")) (f as any)[line.slice(0, line.indexOf(":"))] = line.slice(line.indexOf(":") + 1).trim();
          events.push(f);
        }
      }
    } catch { /* aborted */ }
    ended = true;
  })();
  return { status: r.status, events, ended: () => ended, of: (e: string) => events.filter((f) => f.event === e), close: () => ac.abort() };
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
const entry = (over: Record<string, unknown> = {}) => ({ uuid: `o${String(++n).padStart(10, "0")}`, season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: { auto: 3 }, notes: "fast", updatedAt: 1000 + n, ...over });
const push = (call: Call, ws: string, entries: unknown[]) => call("POST", "/api/me/scout/sync", { workspaceId: ws, entries });
const pull = (call: Call, ws: string) => call("GET", `/api/scout/sync?workspaceId=${ws}&since=0`);
const me = async (call: Call) => (await call("GET", "/api/auth/me")).json.user.controlPoint;
const state = (ws: string) => get<{ orphaned_at: string | null; orphan_reason: string | null }>("SELECT orphaned_at, orphan_reason FROM workspaces WHERE cp_workspace_id = ?", [ws]);
/** Every cached membership is past its minute: the next read or write asks Control Point. */
const stale = async () => { clearInfoCache(); await run("UPDATE workspace_members SET updated_at = ?", [Date.now() - MEMBERSHIP_TTL - 1]); };
const audits = async (action: string) => (await all<any>("SELECT details FROM owner_audit WHERE action = ? ORDER BY id", [action])).map((r) => JSON.parse(r.details));

let wsN = 0;
/** A workspace with an admin (Ada) and a member (Max), both in Scout, with an entry, a comment and an assignment. */
async function workspace() {
  const id = String(900 + ++wsN);
  const tag = `o${wsN}`;
  const t = { name: `Orphan Bots ${tag}`, members: new Map<string, { name: string; role: "admin" | "member" }>() };
  t.members.set(`ada.${tag}@example.com`, { name: "Ada Admin", role: "admin" });
  t.members.set(`max.${tag}@example.com`, { name: "Max Member", role: "member" });
  teams.set(id, t);
  const ada = await signIn(`ada.${tag}@example.com`, "Ada");
  const max = await signIn(`max.${tag}@example.com`, "Max");
  const adaId = accounts.get(`ada.${tag}@example.com`)!.id, maxId = accounts.get(`max.${tag}@example.com`)!.id;
  const first = entry({ notes: "kept" });
  expect((await push(ada, id, [first])).status).toBe(200);
  expect((await push(max, id, [entry({ notes: "by max" })])).status).toBe(200);
  const comment = await max("POST", `/api/scout/workspaces/${id}/entries/${first.uuid}/comments`, { body: "Nice auto" });
  expect(comment.status).toBe(201);
  const assigned = await ada("POST", `/api/scout/workspaces/${id}/assignments`, { season: 2025, eventCode: "USNJQ1", teams: [18360], assigneeAccountIds: [maxId] });
  expect(assigned.status).toBe(201);
  return { id, t, tag, ada, max, adaId, maxId, first, commentId: comment.json.comment.id as string, assignmentId: assigned.json.created[0].id as number };
}

/** Every kind of write a member or admin can make, each of which a read-only space must refuse. */
function writes(w: Awaited<ReturnType<typeof workspace>>) {
  const e = w.first.uuid;
  return [
    ["entry add", w.max, () => push(w.max, w.id, [entry()])],
    ["entry edit", w.max, () => push(w.max, w.id, [{ ...w.first, notes: "changed", updatedAt: Date.now() }])],
    ["entry delete", w.ada, () => push(w.ada, w.id, [{ ...w.first, deleted: true, updatedAt: Date.now() }])],
    ["comment add", w.max, () => w.max("POST", `/api/scout/workspaces/${w.id}/entries/${e}/comments`, { body: "late" })],
    ["comment edit", w.max, () => w.max("PATCH", `/api/scout/workspaces/${w.id}/entries/${e}/comments/${w.commentId}`, { body: "edited" })],
    ["comment delete", w.max, () => w.max("DELETE", `/api/scout/workspaces/${w.id}/entries/${e}/comments/${w.commentId}`)],
    ["assignment create", w.ada, () => w.ada("POST", `/api/scout/workspaces/${w.id}/assignments`, { season: 2025, eventCode: "USNJQ1", teams: [7], assigneeAccountIds: [w.maxId] })],
    ["assignment done", w.max, () => w.max("PATCH", `/api/scout/workspaces/${w.id}/assignments/${w.assignmentId}`, { status: "done" })],
    ["assignment delete", w.ada, () => w.ada("DELETE", `/api/scout/workspaces/${w.id}/assignments/${w.assignmentId}`)],
    ["photo upload", w.max, () => w.max("POST", "/api/scout/photos/presign", { workspaceId: w.id, entryUuid: e, bytes: 10 })],
    ["photo complete", w.max, () => w.max("POST", "/api/scout/photos/00000000-0000-0000-0000-000000000000/complete", { workspaceId: w.id })],
    ["photo delete", w.max, () => w.max("DELETE", `/api/scout/photos/00000000-0000-0000-0000-000000000000?workspaceId=${w.id}`)],
    ["template change", w.ada, () => w.ada("PUT", `/api/scout/workspaces/${w.id}/template`, { season: 2025, fields: [] })],
    ["settings change", w.ada, () => w.ada("PUT", `/api/scout/workspaces/${w.id}/settings`, { settings: {} })],
    ["member removal", w.ada, () => w.ada("POST", `/api/scout/workspaces/${w.id}/members/remove`, { accountId: w.maxId })],
  ] as const;
}

/** Every read a former member keeps: entries, comments, assignments, members, activity, export, settings, template. */
async function expectReads(call: Call, w: Awaited<ReturnType<typeof workspace>>) {
  const p = await pull(call, w.id);
  expect(p.status).toBe(200);
  expect(p.json.entries.map((e: any) => e.notes).sort()).toEqual(["by max", "kept"]);
  const c = await call("GET", `/api/scout/workspaces/${w.id}/entries/${w.first.uuid}/comments`);
  expect(c.status).toBe(200);
  expect(c.json.comments.map((x: any) => x.body)).toEqual(["Nice auto"]);
  const a = await call("GET", `/api/scout/workspaces/${w.id}/assignments`);
  expect(a.status).toBe(200);
  expect(a.json.assignments).toHaveLength(1);
  for (const path of [`/api/scout/workspaces/${w.id}/members`, `/api/scout/workspaces/${w.id}/activity`, `/api/scout/workspaces/${w.id}/settings`,
    `/api/scout/workspaces/${w.id}/template?season=2025`, `/api/scout/workspaces/${w.id}/export.csv?season=2025`]) {
    expect((await call("GET", path)).status, path).toBe(200);
  }
}

describe("orphaned workspaces: detection", () => {
  it("(a) deleted in Control Point: read-only for its former members, entries intact, no removal recorded", async () => {
    const w = await workspace();
    const states: (OrphanState | null)[] = [];
    const offState = subscribeWorkspaceState(w.id, (s) => states.push(s));
    const revoked: number[] = [];
    const offRevoked = subscribeRevoked(w.id, (a) => revoked.push(a));
    teams.delete(w.id); // deleted in Control Point
    await stale();
    // Max's next read asks Control Point: the workspace is gone from his answer and its members route says not_found.
    await expectReads(w.max, w);
    const st = await state(w.id);
    expect(st?.orphan_reason).toBe("deleted");
    expect(st?.orphaned_at).toBeTruthy();
    // Everyone in Scout's cache for it then is a former member, with the role they had.
    expect(await all("SELECT account_id, role FROM workspace_former_members ORDER BY account_id"))
      .toEqual(expect.arrayContaining([{ account_id: w.adaId, role: "admin" }, { account_id: w.maxId, role: "member" }]));
    // Ada, whose own answer comes later (and drops her cached row), reads it too.
    await expectReads(w.ada, w);
    expect(await get("SELECT 1 x FROM workspace_members WHERE account_id = ? AND cp_workspace_id = ?", [w.adaId, w.id])).toBeUndefined();
    // Not a removal: nobody's stream was ended, no member.left, no removal audit; one orphan audit.
    expect(revoked).toEqual([]);
    expect(await all("SELECT 1 FROM workspace_activity a JOIN workspaces ws ON ws.id = a.workspace_id WHERE ws.cp_workspace_id = ? AND a.type = 'member.left'", [w.id])).toEqual([]);
    expect((await audits("workspace.member_removed")).filter((d) => d.workspaceId === w.id)).toEqual([]);
    expect((await audits("workspace.orphaned")).filter((d) => d.workspaceId === w.id)).toEqual([expect.objectContaining({ reason: "deleted", workspaceName: w.t.name })]);
    expect(states).toEqual([expect.objectContaining({ reason: "deleted" })]);
    // /me still lists it for both, marked read-only (the banner state), though Control Point no longer does.
    for (const call of [w.ada, w.max]) {
      expect((await me(call)).workspaces).toEqual([expect.objectContaining({ id: w.id, name: w.t.name, orphaned: { at: st!.orphaned_at, reason: "deleted" } })]);
    }
    expect((await w.max("GET", `/api/scout/workspaces/${w.id}/members`)).json).toMatchObject({ canRemove: false, members: expect.arrayContaining([expect.objectContaining({ accountId: w.maxId, you: true })]) });
    offState(); offRevoked();
  });

  it("(a) every write type is refused with 423 workspace_read_only (never 403), for admins and members", async () => {
    const w = await workspace();
    teams.delete(w.id);
    await stale();
    await pull(w.max, w.id); // detected
    for (const [what, , write] of writes(w)) {
      const r = await write();
      expect(r.status, what).toBe(READ_ONLY_STATUS);
      expect(r.json, what).toEqual({ error: expect.stringMatching(/read-only/), code: READ_ONLY_CODE });
    }
    // Nothing changed: the entries, the comment and the assignment are as they were.
    expect((await pull(w.ada, w.id)).json.entries.map((e: any) => [e.notes, e.deleted]).sort()).toEqual([["by max", false], ["kept", false]]);
    expect((await w.ada("GET", `/api/scout/workspaces/${w.id}/entries/${w.first.uuid}/comments`)).json.comments).toHaveLength(1);
    expect((await w.ada("GET", `/api/scout/workspaces/${w.id}/assignments`)).json.assignments[0].status).toBe("open");
  });

  it("a personal removal does not orphan the workspace: the removed member gets 403, the rest write as ever", async () => {
    const w = await workspace();
    w.t.members.delete(`max.${w.tag}@example.com`); // Max removed in Control Point; the workspace stays
    await stale();
    expect((await pull(w.max, w.id)).status).toBe(403);
    expect((await push(w.max, w.id, [entry()])).status).toBe(403);
    expect((await state(w.id))?.orphaned_at).toBeNull();
    expect(await all("SELECT 1 FROM workspace_former_members f JOIN workspaces ws ON ws.id = f.workspace_id WHERE ws.cp_workspace_id = ?", [w.id])).toEqual([]);
    expect((await push(w.ada, w.id, [entry()])).status).toBe(200);
    expect((await audits("workspace.member_removed")).filter((d) => d.workspaceId === w.id)).toEqual([expect.objectContaining({ accountId: w.maxId })]);
    expect((await me(w.max)).workspaces).toEqual([]);
  });

  it("(b) no admin left: read-only for its members (still Control Point's), writes refused with 423", async () => {
    const w = await workspace();
    w.t.members.set(`ada.${w.tag}@example.com`, { name: "Ada Admin", role: "member" }); // demoted: no admin left
    await stale();
    expect((await pull(w.ada, w.id)).status).toBe(200); // Ada's answer: she was an admin and isn't
    expect((await state(w.id))?.orphan_reason).toBe("no_admin");
    expect(await all("SELECT 1 FROM workspace_former_members f JOIN workspaces ws ON ws.id = f.workspace_id WHERE ws.cp_workspace_id = ?", [w.id])).toEqual([]);
    await expectReads(w.max, w);
    for (const [what, , write] of writes(w)) expect((await write()).status, what).toBe(READ_ONLY_STATUS);
    expect((await me(w.max)).workspaces).toEqual([expect.objectContaining({ id: w.id, orphaned: expect.objectContaining({ reason: "no_admin" }) })]);
    // Someone removed from a no-admin workspace is removed (not kept as a former member).
    w.t.members.delete(`max.${w.tag}@example.com`);
    await stale();
    expect((await pull(w.max, w.id)).status).toBe(403);
  });

  it("(b) a demotion that leaves another admin changes nothing", async () => {
    const w = await workspace();
    w.t.members.set(`max.${w.tag}@example.com`, { name: "Max Member", role: "admin" });
    await stale();
    await pull(w.max, w.id); // Max is an admin now
    w.t.members.set(`ada.${w.tag}@example.com`, { name: "Ada Admin", role: "member" });
    await stale();
    await pull(w.ada, w.id);
    expect((await state(w.id))?.orphaned_at).toBeNull();
    expect((await push(w.ada, w.id, [entry()])).status).toBe(200);
  });

  it("a personal removal asks Control Point about the workspace once, which says it exists", async () => {
    const w = await workspace();
    const before = membersCalls;
    w.t.members.delete(`max.${w.tag}@example.com`);
    await stale();
    expect((await pull(w.max, w.id)).status).toBe(403);
    expect(membersCalls).toBe(before + 1); // asked once, said the workspace exists
    expect((await state(w.id))?.orphaned_at).toBeNull();
  });
});

describe("orphaned workspaces: restore", () => {
  it("the workspace back in Control Point: writes work again, the flag clears, /me updates within a minute", async () => {
    const w = await workspace();
    const saved = w.t;
    teams.delete(w.id);
    await stale();
    await pull(w.max, w.id);
    await pull(w.ada, w.id);
    expect((await state(w.id))?.orphan_reason).toBe("deleted");
    expect((await me(w.max)).workspaces[0].orphaned).toBeTruthy();
    const states: (OrphanState | null)[] = [];
    const offState = subscribeWorkspaceState(w.id, (s) => states.push(s));
    const changed: number[] = [];
    const offAccount = subscribeAccountChanged(w.maxId, () => changed.push(w.maxId));
    teams.set(w.id, saved); // re-created (same id) in Control Point
    // Ada's /me is a minute old: it asks Control Point again (not ten minutes later) and sees it, with her admin role.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + ME_TTL + 1);
    const ada = await me(w.ada);
    expect(ada.workspaces).toEqual([{ id: w.id, name: saved.name, role: "admin" }]);
    expect(await state(w.id)).toEqual({ orphaned_at: null, orphan_reason: null });
    expect(await all("SELECT 1 FROM workspace_former_members f JOIN workspaces ws ON ws.id = f.workspace_id WHERE ws.cp_workspace_id = ?", [w.id])).toEqual([]);
    expect(states).toEqual([null]);
    expect(changed.length).toBeGreaterThan(0); // Max's open streams tell his app to re-read /me at once
    // Max's cached /me answer was dropped: his next /me is fresh, writable.
    expect((await me(w.max)).workspaces).toEqual([{ id: w.id, name: saved.name, role: "member" }]);
    expect((await push(w.max, w.id, [entry({ notes: "back" })])).status).toBe(200);
    expect((await audits("workspace.restored")).filter((d) => d.workspaceId === w.id)).toEqual([expect.objectContaining({ was: "deleted" })]);
    offState(); offAccount();
  });

  it("a former member not re-added loses the space once it's back (a removal like any other)", async () => {
    const w = await workspace();
    const saved = w.t;
    teams.delete(w.id);
    await stale();
    await pull(w.max, w.id);
    saved.members.delete(`max.${w.tag}@example.com`);
    teams.set(w.id, saved);
    await stale();
    expect((await pull(w.ada, w.id)).status).toBe(200); // Ada (admin) is listed again: restored
    expect((await state(w.id))?.orphaned_at).toBeNull();
    await stale();
    expect((await pull(w.max, w.id)).status).toBe(403);
    expect((await me(w.max)).workspaces).toEqual([]);
  });

  it("(b) an admin again: writable again", async () => {
    const w = await workspace();
    w.t.members.set(`ada.${w.tag}@example.com`, { name: "Ada Admin", role: "member" });
    await stale();
    await pull(w.ada, w.id);
    expect((await state(w.id))?.orphan_reason).toBe("no_admin");
    w.t.members.set(`max.${w.tag}@example.com`, { name: "Max Member", role: "admin" });
    await stale();
    expect((await push(w.max, w.id, [entry()])).status).toBe(200);
    expect((await state(w.id))?.orphaned_at).toBeNull();
  });

  it("re-added in Control Point after a personal removal: /me shows the space within a minute (no 10-minute wait)", async () => {
    const w = await workspace();
    const email = `max.${w.tag}@example.com`;
    w.t.members.delete(email);
    await stale();
    expect((await me(w.max)).workspaces).toEqual([]);
    w.t.members.set(email, { name: "Max Member", role: "member" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 30_000);
    expect((await me(w.max)).workspaces).toEqual([]); // within the minute: the cached answer
    vi.setSystemTime(Date.now() + ME_TTL);
    expect((await me(w.max)).workspaces).toEqual([{ id: w.id, name: w.t.name, role: "member" }]);
  });
});

describe("orphaned workspaces: live", () => {
  it("open streams stay open, hear `workspace` going read-only and back, and `account`; the sweep keeps a former member", async () => {
    const w = await workspace();
    const saved = w.t;
    const s = await openStream(w.max, w.id);
    expect(s.status).toBe(200);
    await until(() => s.of("ready").length > 0);
    teams.delete(w.id);
    await stale();
    await pull(w.ada, w.id); // Ada's answer finds it deleted
    await until(() => s.of("workspace").length > 0 && s.of("account").length > 0);
    expect(JSON.parse(s.of("workspace")[0].data!)).toEqual({ orphaned: { at: expect.any(String), reason: "deleted" } });
    // The re-check sweep, a minute on: Max's answer no longer lists it, but he's a former member: kept.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * MEMBERSHIP_TTL);
    await sweep();
    vi.useRealTimers();
    expect(s.of("membership_revoked")).toEqual([]);
    expect(s.ended()).toBe(false);
    // Back in Control Point: the same stream hears it.
    teams.set(w.id, saved);
    await stale();
    await pull(w.ada, w.id);
    await until(() => s.of("workspace").length > 1);
    expect(JSON.parse(s.of("workspace")[1].data!)).toEqual({ orphaned: null });
    s.close();
  });
});

describe("orphaned workspaces: owner portal", () => {
  it("lists them with name, when, reason, entries and members, counts them on the Overview; nobody else sees it", async () => {
    const w = await workspace();
    teams.delete(w.id);
    await stale();
    await pull(w.max, w.id);
    const owner = await signIn("owner@example.com", "Owner");
    const r = await owner("GET", "/api/owner/orphaned-workspaces");
    expect(r.status).toBe(200);
    const row = r.json.workspaces.find((x: any) => x.workspaceId === w.id);
    expect(row).toEqual({
      workspaceId: w.id, name: w.t.name, orphanedAt: expect.any(String), reason: "deleted", entries: 2,
      members: expect.arrayContaining([{ accountId: w.adaId, name: "Ada", role: "admin" }, { accountId: w.maxId, name: "Max", role: "member" }]),
    });
    const o = await owner("GET", "/api/owner/overview");
    expect(o.json.orphanedWorkspaces).toBeGreaterThanOrEqual(1);
    // Not an owner (a member of the very workspace, too): the same 404 as any unknown path.
    for (const call of [w.max, client()]) {
      const x = await call("GET", "/api/owner/orphaned-workspaces");
      expect(x.status).toBe(404);
      expect(JSON.stringify(x.json)).not.toContain(w.t.name);
    }
  });
});
