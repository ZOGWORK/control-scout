// Match scouting assignments (slot / alliance / all for a range of quals), against a stub Control Point:
// admins create, edit and delete, members read; validation; the inbox and feed; the live stream; and
// migration 46 on a database that already has team assignments.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { invalidateFlags, setFlag } from "../flags";
import { inboxSettled } from "../inbox/inbox";
import { subscribeMatchAssignments } from "./bus";
import { closeAllStreams } from "./stream";
import type { MatchAssignment, MatchAssignmentNotice } from "../../src/shared/assignments";
import type { Watching } from "../../src/shared/scoutMatch";

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

const S = 2025, EV = "USTMA1";

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
  // The event, as the data sync stores it.
  await run("INSERT INTO events (season, code, name, source) VALUES (?, ?, ?, ?)", [S, EV, "Test Qualifier", "first"]);
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
const path = (ws: string, rest = "") => `/api/scout/workspaces/${ws}/assignments/matches${rest}`;
const RED1: Watching = { kind: "slot", slot: "red1" };
const body = (assigneeAccountId: number, over: Record<string, unknown> = {}) =>
  ({ season: S, eventCode: EV, watching: RED1, fromMatch: "Q1", toMatch: "Q30", assigneeAccountId, ...over });
const create = (call: Call, ws: string, assigneeAccountId: number, over: Record<string, unknown> = {}) => call("POST", path(ws), body(assigneeAccountId, over));
const list = async (call: Call, ws: string, q = "") => {
  const r = await call("GET", path(ws, q));
  expect(r.status).toBe(200);
  return r.json.matchAssignments as MatchAssignment[];
};
const inbox = async (call: Call) => {
  await inboxSettled();
  const r = await call("GET", "/api/inbox");
  expect(r.status).toBe(200);
  return r.json.items as { title: string; body: string; link: string; type: string }[];
};
const feedTypes = async (call: Call, ws: string) => ((await call("GET", `/api/scout/workspaces/${ws}/activity`)).json.items as { type: string }[]).map((i) => i.type);

describe("match assignments: create and read", () => {
  it("an admin gives Priya Red 1 for Q1–Q30: every member reads it, Priya is told, the feed logs it", async () => {
    const { admin, member, sam, priya } = await team("3001");
    const r = await create(admin, "3001", priya, { eventCode: EV.toLowerCase(), fromMatch: "q1", toMatch: "30" });
    expect(r.status).toBe(201);
    expect(r.json.matchAssignment).toMatchObject({ eventCode: EV, watching: RED1, fromMatch: "Q1", toMatch: "Q30", assigneeAccountId: priya, assigneeName: "Priya", createdByName: "Coach", version: 1 });
    expect(r.json.overlaps).toEqual([]);
    expect((await list(sam, "3001")).map((a) => a.id)).toEqual([r.json.matchAssignment.id]);
    expect(await list(member, "3001", `?season=${S}&event=${EV}&assignee=me`)).toHaveLength(1);
    expect(await list(sam, "3001", "?assignee=me")).toEqual([]);
    expect((await inbox(member)).map((i) => [i.title, i.body])).toEqual([["Coach assigned you to scout Red 1", `Q1–Q30 · ${EV}`]]);
    expect(await feedTypes(admin, "3001")).toEqual(["assignment.match_created"]);
    // Team assignments are a separate list, untouched.
    expect((await admin("GET", `/api/scout/workspaces/3001/assignments`)).json.assignments).toEqual([]);
  });

  it("open-ended ranges and alliances; the same slot in the same matches is a warning, not a refusal", async () => {
    const { admin, priya, samId } = await team("3002");
    const a = (await create(admin, "3002", priya, { watching: { kind: "alliance", side: "blue" }, fromMatch: "Q15", toMatch: null })).json.matchAssignment as MatchAssignment;
    expect([a.fromMatch, a.toMatch]).toEqual(["Q15", null]);
    const red = await create(admin, "3002", samId, { fromMatch: null, toMatch: "Q40" }); // red 1: no clash with blue
    expect(red.json.overlaps).toEqual([]);
    const clash = await create(admin, "3002", samId, { watching: { kind: "slot", slot: "blue2" }, fromMatch: "Q10", toMatch: "Q20" });
    expect(clash.status).toBe(201);
    expect(clash.json.overlaps.map((o: MatchAssignment) => o.id)).toEqual([a.id]);
  });

  it("validation: watching, range, member and event", async () => {
    const { admin, priya } = await team("3003");
    const bad = async (over: Record<string, unknown>, who = priya) => (await create(admin, "3003", who, over)).status;
    expect(await bad({ watching: { kind: "slot", slot: "red3" } })).toBe(400);
    expect(await bad({ watching: null })).toBe(400);
    expect(await bad({ fromMatch: "F1" })).toBe(400);
    expect(await bad({ toMatch: "Q0" })).toBe(400);
    expect((await create(admin, "3003", priya, { fromMatch: "Q30", toMatch: "Q10" })).json.error).toBe("Q30 comes after Q10.");
    expect((await create(admin, "3003", priya, { eventCode: "NOPE1" })).json.error).toMatch(/no event NOPE1/);
    expect(await bad({ season: 1999 })).toBe(400);
    expect(await bad({}, accountFor("olly-3003@example.com").id)).toBe(400);
    expect(await bad({}, 0)).toBe(400);
    expect(await list(admin, "3003")).toEqual([]);
  });
});

describe("match assignments: edit and delete", () => {
  it("an admin moves it to Sam and changes the range: both hear; the same values again change nothing; then delete", async () => {
    const { admin, member, sam, priya, samId } = await team("3011");
    const a = (await create(admin, "3011", priya)).json.matchAssignment as MatchAssignment;
    const moved = await admin("PATCH", path("3011", `/${a.id}`), body(samId, { watching: { kind: "all" }, fromMatch: "Q31", toMatch: "Q60" }));
    expect(moved.status).toBe(200);
    expect(moved.json.matchAssignment).toMatchObject({ assigneeName: "Sam", watching: { kind: "all" }, fromMatch: "Q31", toMatch: "Q60", version: 2 });
    const again = await admin("PATCH", path("3011", `/${a.id}`), body(samId, { watching: { kind: "all" }, fromMatch: "Q31", toMatch: "Q60" }));
    expect(again.json.matchAssignment.version).toBe(2);
    expect((await inbox(member)).map((i) => i.title)).toEqual(["Coach changed your match scouting", "Coach assigned you to scout Red 1"]);
    expect((await inbox(sam)).map((i) => [i.title, i.body])).toEqual([["Coach changed your match scouting", `All 4 teams · Q31–Q60 · ${EV}`]]);
    expect((await admin("DELETE", path("3011", `/${a.id}`))).json).toEqual({ deleted: a.id });
    expect((await admin("DELETE", path("3011", `/${a.id}`))).status).toBe(404);
    expect((await admin("PATCH", path("3011", `/${a.id}`), body(samId))).status).toBe(404);
    expect(await list(sam, "3011")).toEqual([]);
    expect((await inbox(sam)).map((i) => i.title)[0]).toBe("Coach removed your match scouting");
    expect(await feedTypes(admin, "3011")).toEqual(["assignment.match_deleted", "assignment.match_updated", "assignment.match_created"]);
  });
});

describe("match assignments: access", () => {
  it("members read but can't create, edit or delete; outsiders 403; signed out 401; paused 403 feature_disabled; bad ids 400", async () => {
    const { admin, member, outsider, priya } = await team("3021");
    const a = (await create(admin, "3021", priya)).json.matchAssignment as MatchAssignment;
    expect((await create(member, "3021", priya)).status).toBe(403);
    expect((await member("PATCH", path("3021", `/${a.id}`), body(priya, { toMatch: "Q50" }))).status).toBe(403);
    expect((await member("DELETE", path("3021", `/${a.id}`))).status).toBe(403);
    expect((await outsider("GET", path("3021"))).status).toBe(403);
    expect((await client()("GET", path("3021"))).status).toBe(401);
    expect((await admin("PATCH", path("3021", "/abc"), body(priya))).status).toBe(400);
    expect((await admin("GET", path("3021", "?season=x"))).status).toBe(400);
    // Another workspace's admin can't touch it, even by id.
    const other = await team("3022");
    expect((await other.admin("DELETE", path("3022", `/${a.id}`))).status).toBe(404);
    await setFlag("workspaceScouting", false, "test");
    expect((await admin("GET", path("3021"))).status).toBe(403);
    expect((await create(admin, "3021", priya)).status).toBe(403);
  });
});

describe("match assignments: live", () => {
  it("changes go out as `event: match-assignment` (no id)", async () => {
    const { admin, member, priya } = await team("3031");
    await create(admin, "3031", priya); // the scout space exists
    const heard: MatchAssignmentNotice[] = [];
    const off = subscribeMatchAssignments("3031", (x) => heard.push(x));
    const ac = new AbortController();
    const res = await fetch(`${base}/api/scout/stream?workspaceId=3031&since=0`, { headers: { Cookie: member.cookie() }, signal: ac.signal });
    let raw = "";
    const reading = (async () => {
      const dec = new TextDecoder();
      try { for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) raw += dec.decode(chunk, { stream: true }); } catch { /* aborted */ }
    })();
    const until = async (ok: () => boolean) => { const end = Date.now() + 3000; while (!ok()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); } };
    await until(() => raw.includes("event: ready"));
    const a = (await create(admin, "3031", priya, { fromMatch: "Q31", toMatch: null })).json.matchAssignment as MatchAssignment;
    await admin("DELETE", path("3031", `/${a.id}`));
    await until(() => raw.split("event: match-assignment").length === 3);
    const frames = raw.split("\n\n").filter((f) => f.includes("event: match-assignment"));
    for (const f of frames) expect(f).not.toMatch(/^id:/m);
    const data = frames.map((f) => JSON.parse(f.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as MatchAssignmentNotice);
    expect(data.map((d) => [d.action, d.matchAssignments[0].fromMatch])).toEqual([["created", "Q31"], ["deleted", "Q31"]]);
    expect(heard.map((h) => h.action)).toEqual(["created", "deleted"]);
    off(); ac.abort(); await reading;
  });
});

describe("migration 46 on an existing database", () => {
  it("adds the table and leaves team assignments as they were", async () => {
    const c = openDb(":memory:");
    await migrate(c, 45);
    await c.execute("INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES ('9', 'W', '', '')");
    await c.execute(`INSERT INTO workspace_assignments (workspace_id, season, event_code, team, assignee_account_id, assignee_name, created_by_account_id, created_by_name, created_at)
      VALUES (1, 2025, 'USTST1', 1234, 7, 'Priya', 1, 'Coach', 5)`);
    expect(await migrate(c)).toContain(46);
    const old = (await c.execute("SELECT team, assignee_name, status, version FROM workspace_assignments")).rows.map((r) => ({ ...r }));
    expect(old).toEqual([{ team: 1234, assignee_name: "Priya", status: "open", version: 1 }]);
    await c.execute(`INSERT INTO workspace_match_assignments (workspace_id, season, event_code, watching, from_match, to_match, assignee_account_id, created_by_account_id, created_at, updated_at)
      VALUES (1, 2025, 'USTST1', '{"kind":"all"}', NULL, 'Q9', 7, 1, 5, 5)`);
    expect((await c.execute("SELECT version, assignee_name FROM workspace_match_assignments")).rows.map((r) => ({ ...r }))).toEqual([{ version: 1, assignee_name: "" }]);
    expect(await migrate(c)).toEqual([]);
  });
});
