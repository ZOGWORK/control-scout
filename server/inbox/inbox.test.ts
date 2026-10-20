// Task 14: the notification inbox, against a stub Control Point and the in-process R2 stand-in.
// Who gets an item for each kind of activity (never the actor), the per-kind switches, read state
// shared by every session of an account (and streamed to them), pages, 90-day pruning, and the
// owner-alert hand-off (one item per owner per alert, however often it runs). Follow-up state: mark unread,
// the follow-up flag and filter (per account, streamed, kept through mark all read and coalescing); migration 32.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { SESSION_COOKIE, sha256, token } from "../auth/session";
import { clearInfoCache } from "../auth/controlPoint";
import { invalidateFlags, setFlag } from "../flags";
import { fakeR2 } from "../scout/fakeR2";
import { closeAllStreams } from "../scout/stream";
import { logActivity } from "../scout/activityLog";
import { raiseAlert, resolveAlert } from "../portal/alerts";
import { INBOX_RETENTION_MS, type InboxItem } from "../../src/shared/inbox";
import { deliverOwnerAlerts, inboxSettled, pruneInbox } from "./inbox";
import { closeInboxStreams } from "./routes";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const codes = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 9400 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};
const ENV = ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL", "R2_FAKE", "R2_ENDPOINT", "R2_FAKE_DIR", "OWNER_EMAILS"];
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
  setMailer(async (to, _s, text) => { codes.set(to, /\b(\d{6})\b/.exec(text)![1]); });
  delete process.env.R2_FAKE_DIR;
  process.env.R2_FAKE = "1";
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
  delete process.env.OWNER_EMAILS;
  await setFlag("photos", true, "test");
  await setFlag("workspaceScouting", true, "test");
  await setFlag("realtime", true, "test");
  fakeR2.clear();
});
afterEach(() => { closeAllStreams(); closeInboxStreams(); invalidateFlags(); });

let clients = 0;
function client() {
  let cookie = "";
  const ip = `10.14.${Math.floor(++clients / 250)}.${clients % 250}`; // sign-in is rate limited per IP
  const call = async (method: string, path: string, json?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, {
      method, redirect: "manual", headers: { "X-Forwarded-For": ip, ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
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

/** Another session of the same account (another device), without a second sign-in code. */
async function secondSession(call: Call): Promise<Call> {
  const me = (await call("GET", "/api/me")).json.user.id as number;
  const t = token();
  await startSessionRow(me, t);
  return Object.assign((m: string, p: string, j?: unknown) => fetchAs(t, m, p, j), { cookie: () => `${SESSION_COOKIE}=${t}` }) as Call;
}
const startSessionRow = (userId: number, t: string) => run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, 'phone')", [sha256(t), userId, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
async function fetchAs(t: string, method: string, path: string, json?: unknown) {
  const r = await fetch(base + path, { method, headers: { Cookie: `${SESSION_COOKIE}=${t}`, ...(json !== undefined ? { "Content-Type": "application/json" } : {}) }, body: json !== undefined ? JSON.stringify(json) : undefined });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}

const join = (email: string, ws: string, role: "admin" | "member") => {
  const a = accountFor(email);
  a.workspaces = [...(a.workspaces ?? []).filter((w) => w.id !== ws), { id: ws, name: "Gearheads", role }];
};
const leave = (email: string, ws: string) => { const a = accountFor(email); a.workspaces = (a.workspaces ?? []).filter((w) => w.id !== ws); };

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({ uuid: `i${String(++n).padStart(10, "0")}`, season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: { auto: 3 }, notes: "fast", updatedAt: 1000 + n, ...over });
const push = async (call: Call, ws: string, e: Record<string, unknown>) => {
  const r = await call("POST", "/api/me/scout/sync", { workspaceId: ws, entries: [e] });
  expect(r.status).toBe(200);
  expect(r.json.results[0].ok).toBe(true);
};

/** Workspace `ws` with a scout space (Priya's first entry made it), an admin (Coach) and a member (Priya). */
async function team(ws: string) {
  join(`coach-${ws}@example.com`, ws, "admin"); join(`priya-${ws}@example.com`, ws, "member");
  const admin = await signIn(`coach-${ws}@example.com`, "Coach");
  const member = await signIn(`priya-${ws}@example.com`, "Priya");
  const first = entry();
  await push(member, ws, first);
  await inboxSettled();
  return { admin, member, first, coach: accountFor(`coach-${ws}@example.com`).id, priya: accountFor(`priya-${ws}@example.com`).id };
}

const inbox = async (call: Call, q = "") => {
  await inboxSettled();
  const r = await call("GET", `/api/inbox${q}`);
  expect(r.status).toBe(200);
  return r.json as { items: InboxItem[]; more: boolean; unread: number; followUp: number };
};
const titles = async (call: Call) => (await inbox(call)).items.map((i) => i.title);
const unread = async (call: Call) => { await inboxSettled(); return (await call("GET", "/api/inbox/unread-count")).json.unread as number; };

describe("inbox: who gets what", () => {
  it("someone edits or deletes my entry: I get an item (with a link to the entry); the editor gets nothing", async () => {
    const { admin, member, first } = await team("1401");
    await push(admin, "1401", { ...first, notes: "slow", updatedAt: first.updatedAt + 1 });
    const mine = await inbox(member);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ category: "edits", type: "entry.edited", title: "Coach edited your entry", body: "team 18360 · match Q1 · USNJQ1", workspaceId: "1401", workspaceName: "Gearheads", read: false });
    expect(mine.items[0].link).toBe(`/scout?space=1401&season=2025&entry=${first.uuid}`);
    expect(mine.unread).toBe(1);
    expect(await titles(admin)).toEqual([]);
    await push(admin, "1401", { ...first, deleted: true, updatedAt: first.updatedAt + 2 });
    const after = await inbox(member);
    expect(after.items[0]).toMatchObject({ type: "entry.deleted", title: "Coach deleted your entry", link: "/scout?space=1401&view=activity" });
  });

  it("the actor never notifies themselves: editing my own entry, or adding one, makes nothing", async () => {
    const { member, first } = await team("1402");
    await push(member, "1402", { ...first, notes: "mine", updatedAt: first.updatedAt + 1 });
    await push(member, "1402", entry());
    expect(await titles(member)).toEqual([]);
  });

  it("an author who has left the workspace hears nothing more about their entries", async () => {
    const { admin, member, first } = await team("1419");
    leave("priya-1419@example.com", "1419");
    clearInfoCache();
    expect((await member("GET", "/api/auth/me")).status).toBe(200); // the refresh drops her cached membership
    await push(admin, "1419", { ...first, notes: "after she left", updatedAt: first.updatedAt + 1 });
    expect((await inbox(member)).items.map((i) => i.type)).toEqual(["member.left"]);
  });

  it("repeated edits by the same person (coalesced in the feed) stay one unread item", async () => {
    const { admin, member, first } = await team("1403");
    await push(admin, "1403", { ...first, notes: "one", updatedAt: first.updatedAt + 1 });
    await push(admin, "1403", { ...first, notes: "two", updatedAt: first.updatedAt + 2 });
    await push(admin, "1403", { ...first, notes: "three", updatedAt: first.updatedAt + 3 });
    const { items } = await inbox(member);
    expect(items.map((i) => [i.title, i.body])).toEqual([["Coach edited your entry", "team 18360 · match Q1 · USNJQ1 · 3 edits"]]);
  });

  it("a photo added to my entry by someone else", async () => {
    const { admin, member } = await team("1404");
    const e = entry({ kind: "pit", matchLabel: null });
    await push(member, "1404", e);
    const slot = await admin("POST", "/api/scout/photos/presign", { workspaceId: "1404", entryUuid: e.uuid, bytes: 1000 });
    expect(slot.status).toBe(200);
    const body = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(996, 7)]);
    expect((await fetch(slot.json.uploadUrl, { method: "PUT", headers: slot.json.headers, body })).status).toBe(200);
    expect((await admin("POST", `/api/scout/photos/${slot.json.photoId}/complete`, { workspaceId: "1404" })).status).toBe(200);
    expect(await titles(member)).toEqual(["Coach added a photo to your entry"]);
    expect(await titles(admin)).toEqual([]);
  });

  it("a template change: every other member (members to the activity, admins to the editor)", async () => {
    const { admin, member } = await team("1405");
    join("ada-1405@example.com", "1405", "admin");
    const admin2 = await signIn("ada-1405@example.com", "Ada");
    await inboxSettled();
    const field = { id: "cones", label: "Cones", type: "counter", phase: "teleop", max: 30 };
    expect((await admin("PUT", "/api/scout/workspaces/1405/template", { season: 2025, match: [field], baseVersion: 0 })).status).toBe(200);
    const m = (await inbox(member)).items;
    expect(m.map((i) => [i.title, i.body, i.link])).toEqual([["Coach changed the scouting template", "2025 match fields · version 1", "/scout?space=1405&view=activity"]]);
    expect((await inbox(admin2)).items.map((i) => i.link)).toContain("/scout?space=1405&season=2025&view=template");
    expect(await titles(admin)).toEqual([]);
  });

  it("workspace settings (Task 6's settings.changed): every other member, under the template switch", async () => {
    const { admin, member } = await team("1418");
    expect((await admin("PUT", "/api/scout/workspaces/1418/settings", { defaults: { season: 2025, eventCode: "USNJQ1" }, baseVersion: 0 })).status).toBe(200);
    expect((await inbox(member)).items.map((i) => [i.category, i.title, i.body, i.link])).toEqual([["template", "Coach changed the defaults for new entries", "season 2025, event USNJQ1", "/scout?space=1418&view=activity"]]);
    expect(await titles(admin)).toEqual([]);
  });

  it("added to and removed from a workspace: the member it's about (from the Control Point refresh)", async () => {
    await team("1406");
    join("newbie-1406@example.com", "1406", "member");
    const newbie = await signIn("newbie-1406@example.com", "Newbie");
    const added = (await inbox(newbie)).items;
    expect(added.map((i) => [i.category, i.title, i.link])).toEqual([["membership", "You were added to Gearheads", "/scout?space=1406"]]);
    leave("newbie-1406@example.com", "1406");
    clearInfoCache();
    expect((await newbie("GET", "/api/auth/me")).status).toBe(200);
    expect((await inbox(newbie)).items[0]).toMatchObject({ type: "member.left", title: "You were removed from Gearheads", link: "/scout?space=personal" });
  });

  it("assignments (Task 10's assignment.created): the assignee, unless they assigned themselves", async () => {
    const { admin, member, coach, priya } = await team("1407");
    await logActivity("1407", { accountId: coach, name: "Coach" }, "assignment.created", "assignment:a1", { team: 4321, season: 2025, eventCode: "USNJQ1", matchLabel: "Q7", assigneeAccountId: priya });
    await logActivity("1407", { accountId: coach, name: "Coach" }, "assignment.created", "assignment:a2", { team: 99, season: 2025, assigneeAccountId: coach });
    const items = (await inbox(member)).items;
    expect(items.map((i) => [i.title, i.body, i.link])).toEqual([["Coach assigned you to scout team 4321", "match Q7 · USNJQ1", "/scout?space=1407&season=2025&view=assignments"]]);
    expect(await titles(admin)).toEqual([]);
  });

  it("the pick list (Task 11's picklist.*): every other member, one unread line per workspace", async () => {
    const { admin, member, coach } = await team("1408");
    await logActivity("1408", { accountId: coach, name: "Coach" }, "picklist.changed", "picklist:2025", { season: 2025 });
    await logActivity("1408", { accountId: coach, name: "Coach" }, "picklist.changed", "picklist:2025", { season: 2025 });
    expect(await titles(member)).toEqual(["Coach updated the pick list"]);
    expect(await unread(member)).toBe(1);
    expect(await titles(admin)).toEqual([]);
  });

  it("comments (Task 15's comment.created) on my entry: me, not the commenter", async () => {
    const { admin, member, first, coach, priya } = await team("1409");
    const d = { uuid: first.uuid, season: 2025, team: 18360, kind: "match", eventCode: "USNJQ1", matchLabel: "Q1", commentId: 1, excerpt: "Great auto" };
    await logActivity("1409", { accountId: coach, name: "Coach" }, "comment.created", `entry:${first.uuid}`, d);
    await logActivity("1409", { accountId: priya, name: "Priya" }, "comment.created", `entry:${first.uuid}`, { ...d, commentId: 2 });
    const items = (await inbox(member)).items;
    expect(items.map((i) => [i.title, i.body])).toEqual([["Coach commented on your entry", "team 18360 · match Q1 · USNJQ1 · “Great auto”"]]);
    expect(items[0].link).toBe(`/scout?space=1409&season=2025&entry=${first.uuid}`);
    expect(await titles(admin)).toEqual([]);
  });

  it("activity no one needs to hear about (an entry added) makes nothing", async () => {
    const { admin } = await team("1410");
    expect(await titles(admin)).toEqual([]);
  });
});

describe("inbox: per-kind switches", () => {
  it("a kind switched off in settings makes no item; others still arrive; switching back on brings new ones", async () => {
    const { admin, member, first } = await team("1411");
    const settings = (notify: Record<string, boolean>) => member("PUT", "/api/me/state/settings", { value: { theme: "dark", density: "comfortable", ambient: true, notify: { myTeamMatches: true, trackedTeams: false, upsets: false, eventStart: true, ...notify } }, updatedAt: Date.now() });
    expect((await settings({ inboxEdits: false })).status).toBe(200);
    await push(admin, "1411", { ...first, notes: "x", updatedAt: first.updatedAt + 1 });
    const field = { id: "cones", label: "Cones", type: "counter", phase: "teleop", max: 30 };
    await admin("PUT", "/api/scout/workspaces/1411/template", { season: 2025, match: [field], baseVersion: 0 });
    expect(await titles(member)).toEqual(["Coach changed the scouting template"]);
    expect((await settings({ inboxEdits: true, inboxTemplate: false })).status).toBe(200);
    await push(admin, "1411", { ...first, deleted: true, updatedAt: first.updatedAt + 2 });
    await admin("PUT", "/api/scout/workspaces/1411/template", { season: 2025, match: [{ ...field, max: 40 }], baseVersion: 1 });
    expect(await titles(member)).toEqual(["Coach deleted your entry", "Coach changed the scouting template"]);
  });
});

describe("inbox: read state", () => {
  it("is the account's, on every session: mark read on one, the other's count drops (and its stream hears it)", async () => {
    const { admin, member, first } = await team("1412");
    const phone = await secondSession(member); // the same account on another device
    await push(admin, "1412", { ...first, notes: "a", updatedAt: first.updatedAt + 1 });
    const field = { id: "cones", label: "Cones", type: "counter", phase: "teleop", max: 30 };
    await admin("PUT", "/api/scout/workspaces/1412/template", { season: 2025, match: [field], baseVersion: 0 });
    expect(await unread(member)).toBe(2);
    expect(await unread(phone)).toBe(2);

    // The phone listens live.
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/inbox/stream`, { headers: { Cookie: phone.cookie() }, signal: ctl.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const events: { unread: number }[] = [];
    let buf = "";
    const next = async () => {
      while (true) {
        const m = /event: inbox\ndata: (.*)\n\n/.exec(buf);
        if (m) { buf = buf.slice(m.index + m[0].length); events.push(JSON.parse(m[1])); return events.at(-1)!; }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buf += new TextDecoder().decode(value);
      }
    };
    expect((await next()).unread).toBe(2);

    const items = (await inbox(member)).items;
    expect((await member("POST", "/api/inbox/read", { ids: [items[0].id] })).json.unread).toBe(1);
    expect((await next()).unread).toBe(1);
    expect(await unread(phone)).toBe(1);
    expect((await inbox(phone)).items.map((i) => i.read)).toEqual([true, false]);
    expect((await phone("POST", "/api/inbox/read", { all: true })).json.unread).toBe(0);
    expect((await next()).unread).toBe(0);
    expect(await unread(member)).toBe(0);
    ctl.abort();
  });

  it("all read up to the newest seen leaves a newer item unread; nobody can mark another account's items", async () => {
    const { admin, member, first } = await team("1413");
    await push(admin, "1413", { ...first, notes: "a", updatedAt: first.updatedAt + 1 });
    const seen = (await inbox(member)).items[0].id;
    await push(admin, "1413", { ...first, deleted: true, updatedAt: first.updatedAt + 2 });
    expect((await member("POST", "/api/inbox/read", { all: true, upTo: seen })).json.unread).toBe(1);
    const theirs = (await inbox(member)).items.find((i) => !i.read)!.id;
    expect((await admin("POST", "/api/inbox/read", { ids: [theirs] })).status).toBe(200);
    expect(await unread(member)).toBe(1);
  });

  it("signed out: 401; writes must be JSON; bad requests: 400", async () => {
    const anon = client();
    expect((await anon("GET", "/api/inbox")).status).toBe(401);
    expect((await anon("GET", "/api/inbox/unread-count")).status).toBe(401);
    expect((await anon("GET", "/api/inbox/stream")).status).toBe(401);
    const { member } = await team("1414");
    const form = await fetch(`${base}/api/inbox/read`, { method: "POST", headers: { Cookie: member.cookie(), "Content-Type": "application/x-www-form-urlencoded" }, body: "all=true" });
    expect(form.status).toBe(415);
    expect((await member("POST", "/api/inbox/read", { ids: [] })).status).toBe(400);
    expect((await member("POST", "/api/inbox/read", { ids: ["1"] })).status).toBe(400);
    expect((await member("GET", "/api/inbox?before=abc")).status).toBe(400);
    expect((await member("GET", "/api/inbox?limit=500")).status).toBe(400);
  });

  it("the stream is off with live updates switched off (503: the app polls the count)", async () => {
    const { member } = await team("1415");
    await setFlag("realtime", false, "test");
    expect((await member("GET", "/api/inbox/stream")).status).toBe(503);
    expect((await member("GET", "/api/inbox/unread-count")).status).toBe(200);
  });
});

describe("inbox: pages and retention", () => {
  it("pages newest first with before/limit", async () => {
    const { member, coach } = await team("1416");
    for (let i = 0; i < 5; i++) await logActivity("1416", { accountId: coach, name: "Coach" }, "assignment.created", `assignment:${i}`, { team: 100 + i, assigneeAccountId: accountFor("priya-1416@example.com").id });
    const p1 = await inbox(member, "?limit=2");
    expect(p1.items.map((i) => i.title)).toEqual(["Coach assigned you to scout team 104", "Coach assigned you to scout team 103"]);
    expect(p1.more).toBe(true);
    expect(p1.unread).toBe(5);
    const p2 = await inbox(member, `?limit=2&before=${p1.items[1].id}`);
    expect(p2.items.map((i) => i.title)).toEqual(["Coach assigned you to scout team 102", "Coach assigned you to scout team 101"]);
    const p3 = await inbox(member, `?limit=2&before=${p2.items[1].id}`);
    expect(p3.items.map((i) => i.title)).toEqual(["Coach assigned you to scout team 100"]);
    expect(p3.more).toBe(false);
  });

  it("items older than 90 days are pruned (and never listed or counted meanwhile)", async () => {
    const { admin, member, first } = await team("1417");
    await push(admin, "1417", { ...first, notes: "a", updatedAt: first.updatedAt + 1 });
    await inboxSettled();
    const old = Date.now() - INBOX_RETENTION_MS - 60_000;
    const uid = (await get<{ user_id: number }>("SELECT user_id FROM inbox_items WHERE workspace_id = '1417'"))!.user_id;
    await run("INSERT INTO inbox_items (user_id, at, workspace_id, category, type, title) VALUES (?, ?, '1417', 'edits', 'entry.edited', 'Old news')", [uid, old]);
    expect(await titles(member)).toEqual(["Coach edited your entry"]);
    expect(await unread(member)).toBe(1);
    expect(await pruneInbox()).toBeGreaterThanOrEqual(1);
    expect((await all("SELECT title FROM inbox_items WHERE title = 'Old news'")).length).toBe(0);
    expect(await titles(member)).toEqual(["Coach edited your entry"]);
  });
});

describe("inbox: owner alerts", () => {
  it("one item per owner per alert, however often the hand-off runs; resolving marks it read", async () => {
    process.env.OWNER_EMAILS = "boss-14@example.com";
    const boss = await signIn("boss-14@example.com", "Boss");
    const other = await signIn("someone-14@example.com");
    const { alert, created } = await raiseAlert("inbox-test-1", "warning", "Photo storage approaching the 10 GB free tier limit", "Purge an event or uploads will pause.");
    expect(created).toBe(true);
    await deliverOwnerAlerts();
    await deliverOwnerAlerts();
    await raiseAlert("inbox-test-1", "warning", "Photo storage approaching the 10 GB free tier limit", "Still high."); // a refresh, not a new alert
    await deliverOwnerAlerts();
    const items = (await inbox(boss)).items.filter((i) => i.category === "ownerAlerts");
    expect(items.map((i) => [i.title, i.workspaceId, i.link, i.read])).toEqual([["Photo storage approaching the 10 GB free tier limit", null, "/owner", false]]);
    const row = await get<{ inbox_item_id: number }>("SELECT inbox_item_id FROM owner_alerts WHERE id = ?", [alert.id]);
    expect(row!.inbox_item_id).toBe(items[0].id);
    expect(await titles(other)).toEqual([]);
    await resolveAlert("inbox-test-1");
    expect((await inbox(boss)).items.find((i) => i.id === items[0].id)!.read).toBe(true);
  });

  it("the storage alert links to the owner portal's storage panel; an owner with the switch off gets none", async () => {
    process.env.OWNER_EMAILS = "boss-15@example.com,quiet-15@example.com";
    const boss = await signIn("boss-15@example.com");
    const quiet = await signIn("quiet-15@example.com");
    await quiet("PUT", "/api/me/state/settings", { value: { theme: "dark", density: "comfortable", ambient: true, notify: { myTeamMatches: true, trackedTeams: false, upsets: false, eventStart: true, inboxOwnerAlerts: false } }, updatedAt: Date.now() });
    await resolveAlert("photo-storage");
    await raiseAlert("photo-storage", "warning", "Photo storage high", "9 GB used.");
    expect((await inbox(boss)).items.map((i) => i.link)).toEqual(["/owner?panel=storage"]);
    expect(await titles(quiet)).toEqual([]);
    await resolveAlert("photo-storage");
  });

  it("with no owner account yet, the alert waits (and is delivered once one exists)", async () => {
    process.env.OWNER_EMAILS = "later-16@example.com";
    await raiseAlert("inbox-test-3", "info", "Waiting", "For an owner.");
    const r = await get<{ inbox_item_id: number | null }>("SELECT inbox_item_id FROM owner_alerts WHERE kind = 'inbox-test-3'");
    expect(r!.inbox_item_id).toBeNull();
    const later = await signIn("later-16@example.com");
    expect(await deliverOwnerAlerts()).toBeGreaterThanOrEqual(1);
    expect((await inbox(later)).items.map((i) => i.title)).toContain("Waiting");
    await resolveAlert("inbox-test-3");
  });
});

describe("inbox: follow-up state (mark unread, follow up)", () => {
  /** A live stream of this session's inbox events. */
  async function listen(call: Call) {
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/inbox/stream`, { headers: { Cookie: call.cookie() }, signal: ctl.signal });
    const reader = res.body!.getReader();
    let buf = "";
    const next = async (): Promise<{ unread: number; latest: number | null; followUp: number }> => {
      while (true) {
        const m = /event: inbox\ndata: (.*)\n\n/.exec(buf);
        if (m) { buf = buf.slice(m.index + m[0].length); return JSON.parse(m[1]); }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buf += new TextDecoder().decode(value);
      }
    };
    return { next, stop: () => ctl.abort() };
  }
  const assign = async (ws: string, coach: number, email: string, count: number) => {
    for (let i = 0; i < count; i++) await logActivity(ws, { accountId: coach, name: "Coach" }, "assignment.created", `assignment:${i}`, { team: 100 + i, assigneeAccountId: accountFor(email).id });
  };

  it("mark unread puts a read item back in the count; follow up never changes it; both are the account's on every session", async () => {
    const { member, coach } = await team("1430");
    const phone = await secondSession(member);
    await assign("1430", coach, "priya-1430@example.com", 2);
    const [newer, older] = (await inbox(member)).items;
    expect(newer.followUp).toBe(false);
    expect((await member("POST", "/api/inbox/read", { all: true })).json.unread).toBe(0);

    expect((await member("POST", "/api/inbox/unread", { ids: [older.id] })).json).toEqual({ unread: 1 });
    expect(await unread(phone)).toBe(1);
    // Already unread: no change, no double count.
    expect((await member("POST", "/api/inbox/unread", { ids: [older.id, older.id] })).json).toEqual({ unread: 1 });

    expect((await member("POST", "/api/inbox/follow-up", { ids: [newer.id], on: true })).json).toEqual({ unread: 1, followUp: 1 });
    const p = await inbox(phone);
    expect(p.items.map((i) => [i.id, i.read, i.followUp])).toEqual([[newer.id, true, true], [older.id, false, false]]);
    expect(p).toMatchObject({ unread: 1, followUp: 1 });
    // A read item can be flagged; flagging an unread one leaves it unread.
    expect((await phone("POST", "/api/inbox/follow-up", { ids: [older.id], on: true })).json).toEqual({ unread: 1, followUp: 2 });
    expect((await phone("POST", "/api/inbox/follow-up", { ids: [newer.id], on: false })).json).toEqual({ unread: 1, followUp: 1 });
    expect((await inbox(member)).items.map((i) => [i.read, i.followUp])).toEqual([[true, false], [false, true]]);
  });

  it("mark all read keeps follow-up flags", async () => {
    const { member, coach } = await team("1431");
    await assign("1431", coach, "priya-1431@example.com", 3);
    const ids = (await inbox(member)).items.map((i) => i.id);
    await member("POST", "/api/inbox/follow-up", { ids: [ids[0], ids[2]], on: true });
    expect((await member("POST", "/api/inbox/read", { all: true })).json.unread).toBe(0);
    const after = await inbox(member);
    expect(after.items.map((i) => [i.read, i.followUp])).toEqual([[true, true], [true, false], [true, true]]);
    expect(after.followUp).toBe(2);
  });

  it("is never visible to or changeable by another account", async () => {
    const { admin, member, coach } = await team("1432");
    await assign("1432", coach, "priya-1432@example.com", 1);
    const [mine] = (await inbox(member)).items;
    await member("POST", "/api/inbox/read", { ids: [mine.id] });
    // Someone else's ids change nothing (and say nothing about whether they exist).
    expect((await admin("POST", "/api/inbox/unread", { ids: [mine.id] })).json).toEqual({ unread: 0 });
    expect((await admin("POST", "/api/inbox/follow-up", { ids: [mine.id], on: true })).json).toEqual({ unread: 0, followUp: 0 });
    expect((await inbox(member)).items[0]).toMatchObject({ read: true, followUp: false });
    // My flag isn't in their filter or counts, and they can't clear it.
    await member("POST", "/api/inbox/follow-up", { ids: [mine.id], on: true });
    expect(await inbox(admin, "?filter=followUp")).toEqual({ items: [], more: false, unread: 0, followUp: 0 });
    expect((await admin("POST", "/api/inbox/follow-up", { ids: [mine.id], on: false })).json.followUp).toBe(0);
    expect((await inbox(member)).items[0].followUp).toBe(true);
  });

  it("the Follow up filter pages newest first with before/limit; the counts are the whole inbox's", async () => {
    const { member, coach } = await team("1433");
    await assign("1433", coach, "priya-1433@example.com", 6);
    const ids = (await inbox(member)).items.map((i) => i.id); // newest first: teams 105..100
    await member("POST", "/api/inbox/follow-up", { ids: [ids[0], ids[2], ids[3], ids[5]], on: true });
    const p1 = await inbox(member, "?filter=followUp&limit=2");
    expect(p1.items.map((i) => i.id)).toEqual([ids[0], ids[2]]);
    expect(p1).toMatchObject({ more: true, unread: 6, followUp: 4 });
    const p2 = await inbox(member, `?filter=followUp&limit=2&before=${p1.items[1].id}`);
    expect(p2.items.map((i) => i.id)).toEqual([ids[3], ids[5]]);
    expect(p2.more).toBe(false);
    expect((await inbox(member, "?filter=all&limit=2")).items.map((i) => i.id)).toEqual([ids[0], ids[1]]);
  });

  it("bad requests: 400; signed out: 401; writes must be JSON", async () => {
    const anon = client();
    expect((await anon("POST", "/api/inbox/unread", { ids: [1] })).status).toBe(401);
    expect((await anon("POST", "/api/inbox/follow-up", { ids: [1], on: true })).status).toBe(401);
    const { member } = await team("1434");
    expect((await member("GET", "/api/inbox?filter=starred")).status).toBe(400);
    expect((await member("POST", "/api/inbox/unread", { ids: [] })).status).toBe(400);
    expect((await member("POST", "/api/inbox/unread", { all: true })).status).toBe(400);
    expect((await member("POST", "/api/inbox/follow-up", { ids: [1] })).status).toBe(400);
    expect((await member("POST", "/api/inbox/follow-up", { ids: [1], on: "yes" })).status).toBe(400);
    expect((await member("POST", "/api/inbox/follow-up", { ids: [0], on: true })).status).toBe(400);
    expect((await member("POST", "/api/inbox/follow-up", { ids: Array.from({ length: 201 }, (_, i) => i + 1), on: true })).status).toBe(400);
    const form = await fetch(`${base}/api/inbox/follow-up`, { method: "POST", headers: { Cookie: member.cookie(), "Content-Type": "application/x-www-form-urlencoded" }, body: "ids=1&on=true" });
    expect(form.status).toBe(415);
  });

  it("every open stream of the account hears it (unread and follow-up counts); another account's doesn't", async () => {
    const { admin, member, coach } = await team("1435");
    await assign("1435", coach, "priya-1435@example.com", 1);
    const phone = await secondSession(member);
    const [it1] = (await inbox(member)).items;
    const mine = await listen(phone);
    const theirs = await listen(admin);
    expect(await mine.next()).toMatchObject({ unread: 1, followUp: 0 });
    expect(await theirs.next()).toMatchObject({ unread: 0, followUp: 0 });
    await member("POST", "/api/inbox/follow-up", { ids: [it1.id], on: true });
    expect(await mine.next()).toMatchObject({ unread: 1, followUp: 1 });
    await member("POST", "/api/inbox/read", { ids: [it1.id] });
    expect(await mine.next()).toMatchObject({ unread: 0, followUp: 1 });
    await member("POST", "/api/inbox/unread", { ids: [it1.id] });
    expect(await mine.next()).toMatchObject({ unread: 1, followUp: 1 });
    // Nothing changed: nothing sent. The admin's stream stays quiet throughout.
    await member("POST", "/api/inbox/follow-up", { ids: [it1.id], on: true });
    await admin("POST", "/api/inbox/follow-up", { ids: [it1.id], on: false });
    await member("POST", "/api/inbox/follow-up", { ids: [it1.id], on: false });
    expect(await mine.next()).toMatchObject({ unread: 1, followUp: 0 });
    const quiet = await Promise.race([theirs.next().then(() => "event"), new Promise((r) => setTimeout(() => r("quiet"), 150))]);
    expect(quiet).toBe("quiet");
    mine.stop(); theirs.stop();
  });

  it("a coalesced item that replaces a flagged one keeps the flag (edits and the pick list)", async () => {
    const { admin, member, first, coach } = await team("1436");
    await push(admin, "1436", { ...first, notes: "one", updatedAt: first.updatedAt + 1 });
    const [edit] = (await inbox(member)).items;
    await member("POST", "/api/inbox/follow-up", { ids: [edit.id], on: true });
    await push(admin, "1436", { ...first, notes: "two", updatedAt: first.updatedAt + 2 });
    let items = (await inbox(member)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ body: "team 18360 · match Q1 · USNJQ1 · 2 edits", followUp: true, read: false });
    expect(items[0].id).not.toBe(edit.id);

    await logActivity("1436", { accountId: coach, name: "Coach" }, "picklist.changed", "picklist:2025", { season: 2025 });
    const pick = (await inbox(member)).items.find((i) => i.category === "picklist")!;
    await member("POST", "/api/inbox/follow-up", { ids: [pick.id], on: true });
    await logActivity("1436", { accountId: coach, name: "Coach" }, "picklist.changed", "picklist:2025", { season: 2025 });
    items = (await inbox(member)).items.filter((i) => i.category === "picklist");
    expect(items).toHaveLength(1);
    expect(items[0].id).not.toBe(pick.id);
    expect(items[0].followUp).toBe(true);
    // An unflagged one replaced: still unflagged.
    await member("POST", "/api/inbox/follow-up", { ids: [items[0].id], on: false });
    await logActivity("1436", { accountId: coach, name: "Coach" }, "picklist.changed", "picklist:2025", { season: 2025 });
    expect((await inbox(member)).items.filter((i) => i.category === "picklist").map((i) => i.followUp)).toEqual([false]);
  });

  it("resolving an owner alert marks its items read but keeps a follow-up flag", async () => {
    process.env.OWNER_EMAILS = "owner-1437@example.com";
    const owner = await signIn("owner-1437@example.com", "Owner");
    await raiseAlert("inbox-test-1437", "warning", "Photo storage approaching the 10 GB free tier limit", "Purge an event or uploads will pause.");
    await deliverOwnerAlerts();
    const alert = (await inbox(owner)).items.find((i) => i.category === "ownerAlerts")!;
    await owner("POST", "/api/inbox/follow-up", { ids: [alert.id], on: true });
    await resolveAlert("inbox-test-1437");
    expect((await inbox(owner)).items.find((i) => i.id === alert.id)).toMatchObject({ read: true, followUp: true });
  });
});

describe("migration 32 (inbox follow-up flags)", () => {
  it("adds follow_up_at to an existing inbox: items keep everything and start unflagged", async () => {
    const c = openDb(":memory:");
    expect((await migrate(c, 31)).at(-1)).toBe(31);
    await c.execute({ sql: "INSERT INTO inbox_items (user_id, at, category, type, title, read_at) VALUES (1, ?, 'edits', 'entry.edited', 'Coach edited your entry', ?)", args: [Date.now(), Date.now()] });
    expect(await migrate(c)).toEqual([32]);
    const r = (await c.execute("SELECT title, read_at, follow_up_at FROM inbox_items")).rows[0];
    expect(r.title).toBe("Coach edited your entry");
    expect(r.read_at).not.toBeNull();
    expect(r.follow_up_at).toBeNull();
    const idx = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'inbox_items_follow_up'")).rows;
    expect(idx).toHaveLength(1);
    expect(await migrate(c)).toEqual([]);
  });
});

describe("inbox: the Follow up view's kept rows (keep=)", () => {
  it("lists the account's own kept items with their real state alongside flagged ones; never another account's", async () => {
    const { admin, member, coach } = await team("1438");
    for (let i = 0; i < 4; i++) await logActivity("1438", { accountId: coach, name: "Coach" }, "assignment.created", `assignment:${i}`, { team: 100 + i, assigneeAccountId: accountFor("priya-1438@example.com").id });
    const ids = (await inbox(member)).items.map((i) => i.id); // newest first
    await member("POST", "/api/inbox/follow-up", { ids: [ids[0], ids[3]], on: true });
    await member("POST", "/api/inbox/read", { ids: [ids[2]] });
    // ids[2] was unflagged in the view: it comes back, read and unflagged, in id order.
    const p = await inbox(member, `?filter=followUp&keep=${ids[2]}`);
    expect(p.items.map((i) => [i.id, i.followUp, i.read])).toEqual([[ids[0], true, false], [ids[2], false, true], [ids[3], true, false]]);
    expect(p.followUp).toBe(2);
    // Paging covers the same set.
    const p1 = await inbox(member, `?filter=followUp&keep=${ids[2]}&limit=2`);
    expect(p1.items.map((i) => i.id)).toEqual([ids[0], ids[2]]);
    expect((await inbox(member, `?filter=followUp&keep=${ids[2]}&limit=2&before=${ids[2]}`)).items.map((i) => i.id)).toEqual([ids[3]]);
    // keep only applies to the Follow up view.
    expect((await inbox(member, `?keep=${ids[2]}`)).items).toHaveLength(4);
    // Another account can't pull someone's items in by id.
    expect((await inbox(admin, `?filter=followUp&keep=${ids.join(",")}`)).items).toEqual([]);
    expect((await member("GET", "/api/inbox?filter=followUp&keep=abc")).status).toBe(400);
    expect((await member("GET", "/api/inbox?filter=followUp&keep=0")).status).toBe(400);
    expect((await member("GET", `/api/inbox?filter=followUp&keep=${Array.from({ length: 201 }, (_, i) => i + 1).join(",")}`)).status).toBe(400);
  });
});
