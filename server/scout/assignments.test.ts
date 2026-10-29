// Task 10: scouting assignments, against a stub Control Point. Admins create (one or many at once),
// members can't; a team someone else holds is a warning, not a refusal; the assignee or an admin marks
// one done, only an admin reopens or deletes; progress counts the assignee's entries; every change is
// logged, reaches the assignee's inbox (unless they did it) and streams live as `event: assignment`.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { invalidateFlags, setFlag } from "../flags";
import { inboxSettled } from "../inbox/inbox";
import { subscribeAssignments } from "./bus";
import { closeAllStreams } from "./stream";
import type { Assignment, AssignmentNotice } from "../../src/shared/assignments";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const codes = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 9500 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};
const ENV = ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL"];
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

const S = 2025, EV = "USTST1";

beforeAll(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use("/internal", (req, res, next) => { if (req.get("X-Internal-Key") !== KEY) { res.status(401).end(); return; } next(); });
  stub.post("/internal/accounts/resolve", (req, res) => { res.json({ account: accountFor(String(req.body.email).toLowerCase()) }); });
  stub.get("/internal/accounts/:id", (req, res) => {
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
  // The event's teams, as the data sync stores them.
  for (const t of [1234, 5678, 9999]) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, EV, t]);
  setMailer(async (to, _s, text) => { codes.set(to, /\b(\d{6})\b/.exec(text)![1]); });
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
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
  await setFlag("workspaceScouting", true, "test");
  await setFlag("realtime", true, "test");
});
afterEach(() => { closeAllStreams(); invalidateFlags(); });

let clients = 0;
function client() {
  let cookie = "";
  const ip = `10.21.${Math.floor(++clients / 250)}.${clients % 250}`; // sign-in is rate limited per IP
  const call = async (method: string, path: string, json?: unknown) => {
    const r = await fetch(base + path, {
      method, redirect: "manual", headers: { "X-Forwarded-For": ip, ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
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
    return { status: r.status, json: body };
  };
  return Object.assign(call, { cookie: () => cookie });
}
type Call = ReturnType<typeof client>;
async function signIn(email: string, displayName?: string): Promise<Call> {
  const call = client();
  await call("POST", "/api/auth/email/start", { email });
  expect((await call("POST", "/api/auth/email/verify", { email, code: codes.get(email) })).status).toBe(200);
  if (displayName) await call("PATCH", "/api/me", { displayName });
  return call;
}
const join = (email: string, ws: string, role: "admin" | "member") => {
  const a = accountFor(email);
  a.workspaces = [...(a.workspaces ?? []).filter((w) => w.id !== ws), { id: ws, name: "Gearheads", role }];
};
/** Workspace `ws`: an admin (Coach), two members (Priya, Sam), and Olly in no workspace. */
async function team(ws: string) {
  join(`coach-${ws}@example.com`, ws, "admin"); join(`priya-${ws}@example.com`, ws, "member"); join(`sam-${ws}@example.com`, ws, "member");
  return {
    admin: await signIn(`coach-${ws}@example.com`, "Coach"),
    member: await signIn(`priya-${ws}@example.com`, "Priya"),
    sam: await signIn(`sam-${ws}@example.com`, "Sam"),
    outsider: await signIn(`olly-${ws}@example.com`, "Olly"),
    coach: accountFor(`coach-${ws}@example.com`).id, priya: accountFor(`priya-${ws}@example.com`).id, samId: accountFor(`sam-${ws}@example.com`).id,
  };
}
const path = (ws: string, rest = "") => `/api/scout/workspaces/${ws}/assignments${rest}`;
const create = (call: Call, ws: string, teams: number[], assigneeAccountIds: number[], over: Record<string, unknown> = {}) =>
  call("POST", path(ws), { season: S, eventCode: EV, teams, assigneeAccountIds, ...over });
const list = async (call: Call, ws: string, q = "") => {
  const r = await call("GET", path(ws, q));
  expect(r.status).toBe(200);
  return r.json.assignments as Assignment[];
};
const inbox = async (call: Call) => {
  await inboxSettled();
  const r = await call("GET", "/api/inbox");
  expect(r.status).toBe(200);
  return r.json.items as { title: string; body: string; link: string; type: string }[];
};
const feedTypes = async (call: Call, ws: string) => ((await call("GET", `/api/scout/workspaces/${ws}/activity`)).json.items as { type: string }[]).map((i) => i.type);

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({ uuid: `s${String(++n).padStart(10, "0")}`, season: S, team: 1234, eventCode: EV, matchLabel: "Q1", kind: "match", data: {}, notes: "", updatedAt: 1000 + n, ...over });
const push = async (call: Call, ws: string, e: Record<string, unknown>) => {
  const r = await call("POST", "/api/me/scout/sync", { workspaceId: ws, entries: [e] });
  expect(r.status).toBe(200);
  expect(r.json.results[0].ok).toBe(true);
};

describe("assignments: create", () => {
  it("an admin assigns teams 1234 + 5678 to a member: both listed under the member's own, and one inbox item names both", async () => {
    const { admin, member, priya } = await team("2001");
    const r = await create(admin, "2001", [1234, 5678], [priya]);
    expect(r.status).toBe(201);
    expect(r.json.created.map((a: Assignment) => [a.team, a.assigneeName, a.status, a.eventCode, a.createdByName])).toEqual([[1234, "Priya", "open", EV, "Coach"], [5678, "Priya", "open", EV, "Coach"]]);
    expect(r.json.duplicates).toEqual([]);
    const mine = await list(member, "2001", "?assignee=me");
    expect(mine.map((a) => a.team)).toEqual([1234, 5678]);
    const items = await inbox(member);
    expect(items.map((i) => [i.type, i.title, i.body, i.link])).toEqual([["assignment.created", "Coach assigned you to scout teams 1234 and 5678", EV, `/scout?space=2001&season=${S}&view=assignments`]]);
    expect(await inbox(admin)).toEqual([]);
    expect(await feedTypes(admin, "2001")).toEqual(["assignment.created"]);
  });

  it("one team to several members: one assignment each, an inbox item each, and a duplicate warning that names them", async () => {
    const { admin, member, sam, priya, samId } = await team("2002");
    const r = await create(admin, "2002", [9999], [priya, samId]);
    expect(r.status).toBe(201);
    expect(r.json.created).toHaveLength(2);
    expect(r.json.duplicates).toEqual([{ team: 9999, assignees: [{ accountId: priya, name: "Priya" }, { accountId: samId, name: "Sam" }] }]);
    expect((await inbox(member)).map((i) => i.title)).toEqual(["Coach assigned you to scout team 9999"]);
    expect((await inbox(sam)).map((i) => i.title)).toEqual(["Coach assigned you to scout team 9999"]);
  });

  it("assigning a team someone already holds warns but still creates; the same pair again makes nothing new", async () => {
    const { admin, priya, samId } = await team("2003");
    await create(admin, "2003", [1234], [priya]);
    const r = await create(admin, "2003", [1234, 5678], [samId]);
    expect(r.status).toBe(201);
    expect(r.json.created.map((a: Assignment) => a.team)).toEqual([1234, 5678]);
    expect(r.json.duplicates).toEqual([{ team: 1234, assignees: [{ accountId: priya, name: "Priya" }, { accountId: samId, name: "Sam" }] }]);
    const again = await create(admin, "2003", [1234], [priya]);
    expect(again.status).toBe(201);
    expect(again.json.created).toEqual([]);
    expect(again.json.existing.map((a: Assignment) => [a.team, a.assigneeAccountId])).toEqual([[1234, priya]]);
    expect(await all("SELECT 1 FROM workspace_assignments a JOIN workspaces w ON w.id = a.workspace_id WHERE w.cp_workspace_id = '2003'")).toHaveLength(3);
  });

  it("members can't create (403); teams must be at the event, assignees must be known members", async () => {
    const { admin, member, priya, samId } = await team("2004");
    expect((await create(member, "2004", [1234], [samId])).status).toBe(403);
    expect((await create(admin, "2004", [4242], [priya])).status).toBe(400);
    expect((await create(admin, "2004", [1234], [priya], { eventCode: "NOPE1" })).json.error).toMatch(/no team list/);
    expect((await create(admin, "2004", [1234], [accountFor("olly-2004@example.com").id])).status).toBe(400);
    expect((await create(admin, "2004", [], [priya])).status).toBe(400);
    expect(await list(admin, "2004")).toEqual([]);
  });

  it("options (admins): the cached members by name and the event's teams", async () => {
    const { admin, member } = await team("2005");
    const r = await admin("GET", path("2005", `/options?season=${S}&event=${EV.toLowerCase()}`));
    expect(r.status).toBe(200);
    expect(r.json.members.map((m: { name: string; role: string }) => `${m.name}:${m.role}`)).toEqual(["Coach:admin", "Priya:member", "Sam:member"]);
    expect(r.json.teams.map((t: { team: number }) => t.team)).toEqual([1234, 5678, 9999]);
    expect((await member("GET", path("2005", `/options?season=${S}&event=${EV}`))).status).toBe(403);
  });
});

describe("assignments: many", () => {
  it("past 2,000 assignments: a new one is still returned, published and logged, and the list has every row", async () => {
    const { admin, member, priya } = await team("2006");
    await create(admin, "2006", [9999], [priya]); // the scout space
    const ws = (await all<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = '2006'"))[0].id;
    await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2100)
      INSERT INTO workspace_assignments (workspace_id, season, event_code, team, assignee_account_id, assignee_name, created_by_account_id, created_by_name, created_at)
      SELECT ?, ?, ?, 100000 + i, ?, 'Priya', 1, 'Coach', 0 FROM n`, [ws, S, EV, priya]);
    const r = await create(admin, "2006", [1234], [priya]);
    expect(r.json.created.map((a: Assignment) => a.team)).toEqual([1234]);
    expect((await inbox(member)).map((i) => i.title)[0]).toBe("Coach assigned you to scout team 1234");
    expect(await list(admin, "2006")).toHaveLength(2102);
  });
});

describe("assignments: done, reopen, delete", () => {
  it("the assignee marks it done; another member can't; only an admin reopens; only an admin deletes", async () => {
    const { admin, member, sam, priya } = await team("2011");
    const [a] = (await create(admin, "2011", [1234], [priya])).json.created as Assignment[];
    expect((await sam("PATCH", path("2011", `/${a.id}`), { status: "done" })).status).toBe(403);
    const done = await member("PATCH", path("2011", `/${a.id}`), { status: "done" });
    expect(done.status).toBe(200);
    expect(done.json.assignment).toMatchObject({ status: "done", doneByName: "Priya", version: 2 });
    expect((await member("PATCH", path("2011", `/${a.id}`), { status: "open" })).status).toBe(403);
    const reopened = await admin("PATCH", path("2011", `/${a.id}`), { status: "open" });
    expect(reopened.json.assignment).toMatchObject({ status: "open", doneAt: null, doneByName: null, version: 3 });
    // An admin can mark it done too: the assignee hears about it (they didn't do it themselves).
    expect((await admin("PATCH", path("2011", `/${a.id}`), { status: "done" })).json.changed).toBe(true);
    expect((await member("DELETE", path("2011", `/${a.id}`))).status).toBe(403);
    expect((await admin("DELETE", path("2011", `/${a.id}`))).json).toEqual({ deleted: a.id });
    expect((await admin("DELETE", path("2011", `/${a.id}`))).status).toBe(404);
    expect(await list(member, "2011")).toEqual([]);
    expect(await feedTypes(admin, "2011")).toEqual(["assignment.deleted", "assignment.completed", "assignment.reopened", "assignment.completed", "assignment.created"]);
    // Priya marked it done herself (no item for that); the admin's reopen, done and delete reached her.
    expect((await inbox(member)).map((i) => i.title)).toEqual([
      "Coach removed your assignment", "Coach marked your assignment done", "Coach reopened your assignment", "Coach assigned you to scout team 1234",
    ]);
  });

  it("progress counts the assignee's own live entries for that team at that event", async () => {
    const { admin, member, sam, priya } = await team("2012");
    await create(admin, "2012", [1234, 5678], [priya]);
    await push(member, "2012", entry({ team: 1234 }));
    await push(member, "2012", entry({ team: 1234, eventCode: EV.toLowerCase() }));
    const gone = entry({ team: 1234 });
    await push(member, "2012", gone);
    await push(member, "2012", { ...gone, deleted: true, updatedAt: gone.updatedAt + 1 });
    await push(member, "2012", entry({ team: 1234, eventCode: "OTHER" })); // another event
    await push(sam, "2012", entry({ team: 1234 })); // someone else's
    const byTeam = Object.fromEntries((await list(member, "2012", "?assignee=me")).map((a) => [a.team, a.progress]));
    expect(byTeam).toEqual({ 1234: 2, 5678: 0 });
  });
});

describe("assignments: access", () => {
  it("signed out 401, outsider 403, paused 403 feature_disabled", async () => {
    const { admin, outsider, priya } = await team("2021");
    expect((await client()("GET", path("2021"))).status).toBe(401);
    expect((await outsider("GET", path("2021"))).status).toBe(403);
    expect((await outsider("POST", path("2021"), { season: S, eventCode: EV, teams: [1234], assigneeAccountIds: [priya] })).status).toBe(403);
    expect((await outsider("PATCH", path("2021", "/1"), { status: "done" })).status).toBe(403);
    await setFlag("workspaceScouting", false, "test");
    expect((await admin("GET", path("2021"))).status).toBe(403);
    expect((await create(admin, "2021", [1234], [priya])).status).toBe(403);
    expect((await admin("PATCH", path("2021", "/1"), { status: "done" })).status).toBe(403);
    expect((await admin("DELETE", path("2021", "/1"))).status).toBe(403);
  });

  it("filters by season and event; bad filters are 400", async () => {
    const { admin, priya } = await team("2022");
    await create(admin, "2022", [1234], [priya]);
    expect(await list(admin, "2022", `?season=${S}&event=${EV.toLowerCase()}`)).toHaveLength(1);
    expect(await list(admin, "2022", `?season=${S - 1}`)).toHaveLength(0);
    expect((await admin("GET", path("2022", "?season=abc"))).status).toBe(400);
    expect((await admin("GET", path("2022", "?assignee=x"))).status).toBe(400);
  });
});

describe("assignments: live", () => {
  it("creates and status changes are published once and streamed as `event: assignment` (no id)", async () => {
    const { admin, member, priya } = await team("2031");
    await create(admin, "2031", [5678], [priya]); // the scout space exists
    const heard: AssignmentNotice[] = [];
    const off = subscribeAssignments("2031", (x) => heard.push(x));
    const ac = new AbortController();
    const res = await fetch(`${base}/api/scout/stream?workspaceId=2031&since=0`, { headers: { Cookie: member.cookie() }, signal: ac.signal });
    let raw = "";
    const reading = (async () => {
      const dec = new TextDecoder();
      try { for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) raw += dec.decode(chunk, { stream: true }); } catch { /* aborted */ }
    })();
    const until = async (ok: () => boolean) => { const end = Date.now() + 3000; while (!ok()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); } };
    await until(() => raw.includes("event: ready"));
    const [a] = (await create(admin, "2031", [1234], [priya])).json.created as Assignment[];
    await member("PATCH", path("2031", `/${a.id}`), { status: "done" });
    await until(() => raw.split("event: assignment").length === 3);
    const frames = raw.split("\n\n").filter((f) => f.includes("event: assignment"));
    for (const f of frames) expect(f).not.toMatch(/^id:/m);
    const data = frames.map((f) => JSON.parse(f.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as AssignmentNotice);
    expect(data.map((d) => [d.action, d.assignments[0].team, d.assignments[0].status])).toEqual([["created", 1234, "open"], ["updated", 1234, "done"]]);
    expect(heard.map((h) => h.action)).toEqual(["created", "updated"]);
    off(); ac.abort(); await reading;
  });
});
