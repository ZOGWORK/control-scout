// Task 13: the workspace activity feed, against a stub Control Point and the in-process R2 stand-in.
// Each kind of event is logged exactly once with its author; refused and no-op writes log nothing;
// repeated edits coalesce; membership changes come from the Control Point refresh; the feed pages
// newest first, is members-only, keeps 90 days, and streams live as `event: activity`.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { invalidateFlags, setFlag } from "../flags";
import { subscribeActivity, type ActivityNotice } from "./bus";
import { fakeR2 } from "./fakeR2";
import { closeAllStreams } from "./stream";
import { COALESCE_MS, entryChange, logActivity, pruneActivity, RETENTION_MS } from "./activityLog";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 9100 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};
const ENV = ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL", "R2_FAKE", "R2_ENDPOINT", "R2_FAKE_DIR"];
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

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
  setMailer(async (to, _s, text) => { inbox.set(to, /\b(\d{6})\b/.exec(text)![1]); });
  delete process.env.R2_FAKE_DIR;
  process.env.R2_FAKE = "1"; // before createApp: it mounts the stand-in
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
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1", R2_FAKE: "1", R2_ENDPOINT: `${base}/__fake-r2` });
  await setFlag("photos", true, "test");
  await setFlag("workspaceScouting", true, "test");
  await setFlag("realtime", true, "test");
  fakeR2.clear();
});
afterEach(() => { closeAllStreams(); invalidateFlags(); });

let clients = 0;
function client() {
  let cookie = "";
  const ip = `10.13.${Math.floor(++clients / 250)}.${clients % 250}`; // sign-in is rate limited per IP
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
  expect((await call("POST", "/api/auth/email/verify", { email, code: inbox.get(email) })).status).toBe(200);
  if (displayName) await call("PATCH", "/api/me", { displayName });
  return call;
}

const join = (email: string, ws: string, role: "admin" | "member") => {
  const a = accountFor(email);
  a.workspaces = [...(a.workspaces ?? []).filter((w) => w.id !== ws), { id: ws, name: "Gearheads", role }];
};
/** Workspace `ws` with an admin (Coach) and a member (Priya); Olly is in no workspace. */
async function team(ws: string) {
  join(`coach-${ws}@example.com`, ws, "admin"); join(`priya-${ws}@example.com`, ws, "member");
  return {
    admin: await signIn(`coach-${ws}@example.com`, "Coach"),
    member: await signIn(`priya-${ws}@example.com`, "Priya"),
    outsider: await signIn(`olly-${ws}@example.com`, "Olly"),
  };
}

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({ uuid: `a${String(++n).padStart(10, "0")}`, season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: { auto: 3 }, notes: "fast", updatedAt: 1000 + n, ...over });
const push = async (call: Call, ws: string, e: Record<string, unknown>) => {
  const r = await call("POST", "/api/me/scout/sync", { workspaceId: ws, entries: [e] });
  expect(r.status).toBe(200);
  return r.json.results[0];
};
const feed = async (call: Call, ws: string, q = "") => {
  const r = await call("GET", `/api/scout/workspaces/${ws}/activity${q}`);
  expect(r.status).toBe(200);
  return r.json as { items: ActivityNotice[]; more: boolean };
};
const brief = (items: ActivityNotice[]) => items.map((i) => `${i.type} ${i.actor.name}`);

describe("activity feed: what gets logged", () => {
  it("entry added, edited, deleted and restored: each once, with its author and subject, newest first", async () => {
    const { admin, member } = await team("1301");
    const e = entry({ team: 4321, matchLabel: "Q7" });
    await push(member, "1301", e);
    await push(admin, "1301", { ...e, notes: "slow", updatedAt: e.updatedAt + 1 });
    await push(admin, "1301", { ...e, deleted: true, updatedAt: e.updatedAt + 2 });
    await push(admin, "1301", { ...e, deleted: false, updatedAt: e.updatedAt + 3 });
    const { items, more } = await feed(member, "1301");
    expect(more).toBe(false);
    expect(brief(items)).toEqual(["entry.restored Coach", "entry.deleted Coach", "entry.edited Coach", "entry.added Priya"]);
    expect(items[3]).toMatchObject({ workspaceId: "1301", subject: `entry:${e.uuid}`, details: { uuid: e.uuid, team: 4321, kind: "match", matchLabel: "Q7", eventCode: "USNJQ1", season: 2025 } });
    expect(items[2].details.changed).toEqual(["notes"]);
    expect(items[3].actor.accountId).toBe(accountFor("priya-1301@example.com").id);
  });

  it("a refused write (a member deleting someone else's entry) logs nothing", async () => {
    const { admin, member } = await team("1302");
    const e = entry();
    await push(admin, "1302", e);
    const r = await push(member, "1302", { ...e, deleted: true, updatedAt: e.updatedAt + 1 });
    expect(r).toMatchObject({ ok: false, error: "forbidden" });
    expect(brief((await feed(admin, "1302")).items)).toEqual(["entry.added Coach"]);
  });

  it("no-op writes log nothing: a resend, an older version, a newer one that changes nothing, a tombstone never seen", async () => {
    const { member } = await team("1303");
    const e = entry();
    await push(member, "1303", e);
    await push(member, "1303", e); // resent unchanged
    await push(member, "1303", { ...e, notes: "older", updatedAt: e.updatedAt - 1 }); // beaten by the stored one
    await push(member, "1303", { ...e, updatedAt: e.updatedAt + 5 }); // newer, same content
    await push(member, "1303", entry({ deleted: true })); // created and deleted on the device before it ever synced
    expect(brief((await feed(member, "1303")).items)).toEqual(["entry.added Priya"]);
  });

  it("a template change is logged once (season, version, which kinds); a save that changes nothing isn't", async () => {
    const { admin, member } = await team("1304");
    const field = { id: "cones", label: "Cones", type: "counter", phase: "teleop", max: 30 };
    expect((await admin("PUT", "/api/scout/workspaces/1304/template", { season: 2025, match: [field], baseVersion: 0 })).status).toBe(200);
    expect((await admin("PUT", "/api/scout/workspaces/1304/template", { season: 2025, match: [field], baseVersion: 1 })).json.changed).toBe(false);
    const { items } = await feed(member, "1304");
    expect(brief(items)).toEqual(["template.changed Coach"]);
    expect(items[0]).toMatchObject({ subject: "template:2025", details: { season: 2025, version: 1, kinds: ["match"] } });
  });

  it("a photo added and removed: each once, by who did it", async () => {
    const { admin, member } = await team("1305");
    const e = entry({ kind: "pit", matchLabel: null });
    await push(member, "1305", e);
    const slot = await member("POST", "/api/scout/photos/presign", { workspaceId: "1305", entryUuid: e.uuid, bytes: 1000 });
    expect(slot.status).toBe(200);
    const body = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(996, 7)]);
    expect((await fetch(slot.json.uploadUrl, { method: "PUT", headers: slot.json.headers, body })).status).toBe(200);
    expect((await member("POST", `/api/scout/photos/${slot.json.photoId}/complete`, { workspaceId: "1305" })).status).toBe(200);
    expect((await member("POST", `/api/scout/photos/${slot.json.photoId}/complete`, { workspaceId: "1305" })).status).toBe(200); // a retry: no second item
    expect((await admin("DELETE", `/api/scout/photos/${slot.json.photoId}?workspaceId=1305`)).status).toBe(200);
    const { items } = await feed(member, "1305");
    expect(brief(items)).toEqual(["photo.removed Coach", "photo.added Priya", "entry.added Priya"]);
    expect(items[1]).toMatchObject({ subject: `entry:${e.uuid}`, details: { uuid: e.uuid, kind: "pit", photoId: slot.json.photoId } });
  });
});

describe("activity feed: edit coalescing", () => {
  it("repeated edits by the same person within 5 minutes become one item; someone else's edit in between starts a new one", async () => {
    const { admin, member } = await team("1306");
    const e = entry();
    await push(member, "1306", e);
    await push(member, "1306", { ...e, notes: "one", updatedAt: e.updatedAt + 1 });
    await push(member, "1306", { ...e, notes: "two", data: { auto: 5 }, updatedAt: e.updatedAt + 2 });
    await push(member, "1306", { ...e, notes: "three", updatedAt: e.updatedAt + 3 });
    let { items } = await feed(member, "1306");
    expect(brief(items)).toEqual(["entry.edited Priya", "entry.added Priya"]);
    expect(items[0].details).toMatchObject({ edits: 3, changed: ["notes", "auto"] });
    expect(items[0].details.firstId).toBeLessThan(items[0].id);
    expect(items[0].details.firstId).toBeGreaterThan(items[1].id);
    await push(admin, "1306", { ...e, notes: "four", updatedAt: e.updatedAt + 4 });
    await push(member, "1306", { ...e, notes: "five", updatedAt: e.updatedAt + 5 });
    ({ items } = await feed(member, "1306"));
    expect(brief(items)).toEqual(["entry.edited Priya", "entry.edited Coach", "entry.edited Priya", "entry.added Priya"]);
    expect(items[0].details.edits).toBeUndefined();
  });

  it("an edit more than 5 minutes after the last one is a new item", async () => {
    const { admin } = await team("1307");
    await push(admin, "1307", entry()); // the scout space exists
    const actor = { accountId: 1, name: "Priya" };
    const t = Date.now();
    await logActivity("1307", actor, "entry.edited", "entry:x1", {}, { coalesce: true, at: t - COALESCE_MS - 60_000 });
    await logActivity("1307", actor, "entry.edited", "entry:x1", {}, { coalesce: true, at: t });
    await logActivity("1307", actor, "entry.edited", "entry:x1", {}, { coalesce: true, at: t + 1000 });
    const rows = await all<{ details: string }>("SELECT a.details FROM workspace_activity a JOIN workspaces w ON w.id = a.workspace_id WHERE w.cp_workspace_id = '1307' AND a.subject = 'entry:x1' ORDER BY a.id");
    expect(rows.map((r) => JSON.parse(r.details).edits ?? 1)).toEqual([1, 2]);
  });

  it("entryChange classifies writes", () => {
    const b = { deleted: false, season: 2025, team: 1, eventCode: null, matchLabel: "Q1", kind: "match", data: '{"a":1}', notes: "" };
    const a = { uuid: "u", deleted: false, season: 2025, team: 1, eventCode: null, matchLabel: "Q1", kind: "match", data: { a: 1 }, notes: "" };
    expect(entryChange(undefined, a)).toEqual({ type: "entry.added" });
    expect(entryChange(undefined, { ...a, deleted: true })).toBeNull();
    expect(entryChange(b, a)).toBeNull();
    expect(entryChange(b, { ...a, data: { a: 2 }, team: 2 })).toEqual({ type: "entry.edited", changed: ["team", "a"] });
    expect(entryChange(b, { ...a, deleted: true })).toEqual({ type: "entry.deleted" });
    expect(entryChange({ ...b, deleted: true }, { ...a, deleted: true })).toBeNull();
    expect(entryChange({ ...b, deleted: true }, a)).toEqual({ type: "entry.restored" });
  });
});

describe("activity feed: membership", () => {
  it("joining and leaving in Control Point are logged once each (actor Control Point), only where a scout space exists", async () => {
    const { admin } = await team("1308");
    await push(admin, "1308", entry()); // the scout space exists from its first entry
    join("sam-1308@example.com", "1308", "member");
    join("sam-1308@example.com", "1399", "member"); // no scout space there: nothing to log
    const sam = await signIn("sam-1308@example.com", "Sam");
    clearInfoCache();
    await sam("GET", "/api/auth/me"); // a second refresh with the same answer: no new item
    let { items } = await feed(admin, "1308");
    expect(items[0]).toMatchObject({ type: "member.joined", actor: { accountId: null, name: "Control Point" }, subject: `member:${accountFor("sam-1308@example.com").id}`, details: { name: "sam-1308", role: "member" } }); // named as on entries: no display name yet at sign-in
    expect(items.filter((i) => i.type === "member.joined" && i.details.name === "sam-1308")).toHaveLength(1);
    expect(await get("SELECT 1 FROM workspaces WHERE cp_workspace_id = '1399'")).toBeUndefined();

    accountFor("sam-1308@example.com").workspaces = [];
    clearInfoCache();
    await sam("GET", "/api/auth/me");
    clearInfoCache();
    await sam("GET", "/api/auth/me");
    ({ items } = await feed(admin, "1308"));
    expect(items.filter((i) => i.type === "member.left")).toEqual([expect.objectContaining({ actor: { accountId: null, name: "Control Point" }, details: expect.objectContaining({ name: "Sam" }) })]); // renamed since
    expect((await sam("GET", "/api/scout/workspaces/1308/activity")).status).toBe(403); // and has lost the feed
  });
});

describe("activity feed: API", () => {
  it("pages newest first with before/limit, no overlaps, more until the end", async () => {
    const { member } = await team("1309");
    await push(member, "1309", entry());
    for (let i = 0; i < 119; i++) await logActivity("1309", { accountId: 5, name: "Bot" }, "picklist.changed", `picklist:${i}`, { i });
    const seen: number[] = [];
    let before = "";
    for (const size of [50, 50, 20]) {
      const page = await feed(member, "1309", `?limit=50${before}`);
      expect(page.items).toHaveLength(size);
      expect(page.more).toBe(size === 50);
      seen.push(...page.items.map((i) => i.id));
      before = `&before=${page.items.at(-1)!.id}`;
    }
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    expect(new Set(seen).size).toBe(120);
    expect((await feed(member, "1309")).items).toHaveLength(50); // the default page
  });

  it("members only: signed out 401, outsider 403, bad cursor or limit 400", async () => {
    const { admin, outsider } = await team("1310");
    await push(admin, "1310", entry());
    expect((await client()("GET", "/api/scout/workspaces/1310/activity")).status).toBe(401);
    expect((await outsider("GET", "/api/scout/workspaces/1310/activity")).status).toBe(403);
    expect((await admin("GET", "/api/scout/workspaces/1310/activity?before=abc")).status).toBe(400);
    expect((await admin("GET", "/api/scout/workspaces/1310/activity?limit=500")).status).toBe(400);
    expect((await admin("GET", "/api/scout/workspaces/1310/activity")).status).toBe(200);
    // A member of a workspace with no scout space yet sees an empty feed (and reading creates nothing).
    join("coach-1310@example.com", "1311", "admin");
    clearInfoCache();
    expect(await feed(admin, "1311")).toEqual({ items: [], more: false });
    expect(await get("SELECT 1 FROM workspaces WHERE cp_workspace_id = '1311'")).toBeUndefined();
  });

  it("keeps 90 days: older items are pruned (and never listed meanwhile)", async () => {
    const { member } = await team("1312");
    await push(member, "1312", entry());
    const now = Date.now();
    await logActivity("1312", { accountId: 5, name: "Old" }, "entry.added", "entry:old", {}, { at: now - RETENTION_MS - 1000 });
    expect(brief((await feed(member, "1312")).items)).toEqual(["entry.added Priya"]);
    const before = Number((await get<{ n: number }>("SELECT COUNT(*) n FROM workspace_activity"))!.n);
    expect(await pruneActivity(now)).toBeGreaterThanOrEqual(1);
    expect(Number((await get<{ n: number }>("SELECT COUNT(*) n FROM workspace_activity"))!.n)).toBe(before - 1);
    expect(await get("SELECT 1 FROM workspace_activity WHERE subject = 'entry:old'")).toBeUndefined();
  });
});

describe("activity feed: live", () => {
  it("each item is published once to the bus, and open streams get it as `event: activity`", async () => {
    const { admin, member } = await team("1313");
    await push(admin, "1313", entry());
    const heard: ActivityNotice[] = [];
    const off = subscribeActivity("1313", (a) => heard.push(a));
    const ac = new AbortController();
    const res = await fetch(`${base}/api/scout/stream?workspaceId=1313&since=0`, { headers: { Cookie: member.cookie() }, signal: ac.signal });
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    let raw = "";
    const reading = (async () => {
      const dec = new TextDecoder();
      try { for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) raw += dec.decode(chunk, { stream: true }); } catch { /* aborted */ }
    })();
    const until = async (ok: () => boolean) => { const end = Date.now() + 3000; while (!ok()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); } };
    await until(() => raw.includes("event: ready"));
    const e = entry({ team: 777 });
    await push(admin, "1313", e);
    await until(() => raw.includes("event: activity"));
    const frame = raw.slice(raw.indexOf("event: activity")).split("\n\n")[0];
    expect(frame).not.toMatch(/^id:/m);
    const item = JSON.parse(frame.split("\n").find((l) => l.startsWith("data: "))!.slice(6));
    expect(item).toMatchObject({ type: "entry.added", actor: { name: "Coach" }, details: { team: 777, uuid: e.uuid } });
    expect(heard.map((h) => h.type)).toEqual(["entry.added"]);
    expect((await feed(member, "1313")).items[0]).toEqual(item);
    off(); ac.abort(); await reading;
  });
});

