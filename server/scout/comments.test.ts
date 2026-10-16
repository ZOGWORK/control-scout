// Task 15: comments on workspace entries, against a stub Control Point. Who may post, edit and delete
// (own, others', admin); members only, paused answers 503; length and trimming; the per-account rate
// limit; live delivery as `event: comment`; the comment.created activity with its exact details and the
// entry author's inbox item (never the commenter's); a deleted entry takes no new comments; the counts.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { invalidateFlags, setFlag } from "../flags";
import { subscribeComments } from "./bus";
import { closeAllStreams } from "./stream";
import { COMMENT_RATE, resetCommentRate, takeCommentToken } from "./comments";
import { inboxSettled } from "../inbox/inbox";
import { closeInboxStreams } from "../inbox/routes";
import { COMMENT_MAX, type CommentEvent, type EntryComment } from "../../src/shared/comments";
import type { InboxItem } from "../../src/shared/inbox";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const codes = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 9700 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};
const ENV = ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL"];
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
  resetCommentRate();
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
  await setFlag("workspaceScouting", true, "test");
  await setFlag("realtime", true, "test");
});
afterEach(() => { closeAllStreams(); closeInboxStreams(); invalidateFlags(); });

let clients = 0;
function client() {
  let cookie = "";
  const ip = `10.15.${Math.floor(++clients / 250)}.${clients % 250}`; // sign-in is rate limited per IP
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
    return { status: r.status, json: body, headers: r.headers };
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

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({ uuid: `c${String(++n).padStart(10, "0")}`, season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: { auto: 3 }, notes: "fast", updatedAt: 1000 + n, ...over });
const push = async (call: Call, ws: string, e: Record<string, unknown>) => {
  const r = await call("POST", "/api/me/scout/sync", { workspaceId: ws, entries: [e] });
  expect(r.status).toBe(200);
  expect(r.json.results[0].ok).toBe(true);
};

/** Workspace `ws`: an admin (Coach), two members (Priya, who made the first entry, and Marcus), and Olly, in no workspace. */
async function team(ws: string) {
  join(`coach-${ws}@example.com`, ws, "admin"); join(`priya-${ws}@example.com`, ws, "member"); join(`marcus-${ws}@example.com`, ws, "member");
  const admin = await signIn(`coach-${ws}@example.com`, "Coach");
  const member = await signIn(`priya-${ws}@example.com`, "Priya");
  const other = await signIn(`marcus-${ws}@example.com`, "Marcus");
  const outsider = await signIn(`olly-${ws}@example.com`, "Olly");
  const first = entry();
  await push(member, ws, first);
  await inboxSettled();
  return { admin, member, other, outsider, first, coach: accountFor(`coach-${ws}@example.com`).id, priya: accountFor(`priya-${ws}@example.com`).id };
}

const thread = (ws: string, uuid: string) => `/api/scout/workspaces/${ws}/entries/${uuid}/comments`;
const post = (call: Call, ws: string, uuid: string, body: unknown) => call("POST", thread(ws, uuid), { body });
const list = async (call: Call, ws: string, uuid: string) => {
  const r = await call("GET", thread(ws, uuid));
  expect(r.status).toBe(200);
  return r.json as { comments: EntryComment[]; entryDeleted: boolean };
};
const inbox = async (call: Call) => {
  await inboxSettled();
  const r = await call("GET", "/api/inbox");
  expect(r.status).toBe(200);
  return r.json as { items: InboxItem[] };
};
const feed = async (call: Call, ws: string) => (await call("GET", `/api/scout/workspaces/${ws}/activity`)).json.items as { type: string; actor: { name: string; accountId: number }; subject: string; details: Record<string, unknown> }[];

describe("comments: who may do what", () => {
  it("any member posts; the thread is oldest first, with author and time", async () => {
    const { admin, member, other, first, coach } = await team("1501");
    const a = await post(member, "1501", first.uuid, "Great auto");
    expect(a.status).toBe(201);
    expect(a.json).toMatchObject({ action: "created", workspaceId: "1501", entryUuid: first.uuid, count: 1, comment: { authorName: "Priya", body: "Great auto", editedAt: null } });
    expect((await post(admin, "1501", first.uuid, "Agreed")).status).toBe(201);
    expect((await post(other, "1501", first.uuid, "Slow in endgame though")).status).toBe(201);
    const { comments, entryDeleted } = await list(other, "1501", first.uuid);
    expect(entryDeleted).toBe(false);
    expect(comments.map((c) => [c.authorName, c.body])).toEqual([["Priya", "Great auto"], ["Coach", "Agreed"], ["Marcus", "Slow in endgame though"]]);
    expect(comments[1].authorAccountId).toBe(coach);
    expect(comments[0].createdAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it("only the author edits a comment (an admin can't edit someone else's); an edit says so", async () => {
    const { admin, member, other, first } = await team("1502");
    const id = (await post(member, "1502", first.uuid, "first try")).json.commentId;
    expect((await other("PATCH", `${thread("1502", first.uuid)}/${id}`, { body: "hijack" })).status).toBe(403);
    expect((await admin("PATCH", `${thread("1502", first.uuid)}/${id}`, { body: "admin edit" })).status).toBe(403);
    const ok = await member("PATCH", `${thread("1502", first.uuid)}/${id}`, { body: "  second try  " });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ action: "edited", count: 1, comment: { body: "second try" } });
    expect(ok.json.comment.editedAt).toEqual(expect.any(Number));
    const same = await member("PATCH", `${thread("1502", first.uuid)}/${id}`, { body: "second try" });
    expect(same.json.comment.editedAt).toBe(ok.json.comment.editedAt); // nothing changed: not edited again
    expect((await list(admin, "1502", first.uuid)).comments.map((c) => c.body)).toEqual(["second try"]);
  });

  it("members delete their own only; admins delete anyone's; a deleted comment disappears", async () => {
    const { admin, member, other, first } = await team("1503");
    const mine = (await post(member, "1503", first.uuid, "mine")).json.commentId;
    const marcus = (await post(other, "1503", first.uuid, "his")).json.commentId;
    const coach = (await post(admin, "1503", first.uuid, "coach's")).json.commentId;
    expect((await member("DELETE", `${thread("1503", first.uuid)}/${marcus}`)).status).toBe(403);
    expect((await member("DELETE", `${thread("1503", first.uuid)}/${coach}`)).status).toBe(403);
    const own = await member("DELETE", `${thread("1503", first.uuid)}/${mine}`);
    expect(own.status).toBe(200);
    expect(own.json).toMatchObject({ action: "deleted", commentId: mine, count: 2 });
    expect(own.json.comment).toBeUndefined();
    expect((await admin("DELETE", `${thread("1503", first.uuid)}/${marcus}`)).status).toBe(200);
    expect((await admin("DELETE", `${thread("1503", first.uuid)}/${marcus}`)).status).toBe(404); // already gone
    expect((await member("PATCH", `${thread("1503", first.uuid)}/${mine}`, { body: "back?" })).status).toBe(404);
    expect((await list(other, "1503", first.uuid)).comments.map((c) => c.body)).toEqual(["coach's"]);
    // Moderation shows in the feed; deleting your own doesn't.
    const items = await feed(admin, "1503");
    expect(items.filter((i) => i.type === "comment.deleted").map((i) => [i.actor.name, i.details.authorName, i.details.commentId])).toEqual([["Coach", "Marcus", marcus]]);
  });

  it("members only (403), signed in (401), paused (503), JSON only (415), a bad id (400), an entry not on the server (404)", async () => {
    const { admin, outsider, first } = await team("1504");
    expect((await outsider("GET", thread("1504", first.uuid))).status).toBe(403);
    expect((await post(outsider, "1504", first.uuid, "hello")).status).toBe(403);
    expect((await outsider("GET", "/api/scout/workspaces/1504/comment-counts")).status).toBe(403);
    expect((await client()("GET", thread("1504", first.uuid))).status).toBe(401);
    expect((await admin("POST", thread("1504", first.uuid), undefined, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await admin("DELETE", `${thread("1504", first.uuid)}/abc`)).status).toBe(400);
    expect((await post(admin, "1504", "nosuchentry1", "hi")).status).toBe(404);
    const id = (await post(admin, "1504", first.uuid, "before the pause")).json.commentId;
    await setFlag("workspaceScouting", false, "test");
    invalidateFlags();
    for (const r of [
      await admin("GET", thread("1504", first.uuid)), await post(admin, "1504", first.uuid, "x"),
      await admin("PATCH", `${thread("1504", first.uuid)}/${id}`, { body: "y" }), await admin("DELETE", `${thread("1504", first.uuid)}/${id}`),
      await admin("GET", "/api/scout/workspaces/1504/comment-counts"),
    ]) {
      expect(r.status).toBe(503);
      expect(r.json.paused).toBe(true);
    }
  });

  it("another workspace's entry is unknown here", async () => {
    const { admin, first } = await team("1505");
    join("coach-1505@example.com", "1506", "admin");
    clearInfoCache();
    expect((await admin("GET", thread("1506", first.uuid))).status).toBe(404);
    expect((await post(admin, "1506", first.uuid, "wrong place")).status).toBe(404);
  });
});

describe("comments: the body", () => {
  it("is trimmed, kept as plain text, and limited to 2,000 characters", async () => {
    const { member, first } = await team("1510");
    const html = await post(member, "1510", first.uuid, "  <b>bold</b>\r\n<script>alert(1)</script>\u0007  ");
    expect(html.status).toBe(201);
    expect(html.json.comment.body).toBe("<b>bold</b>\n<script>alert(1)</script>"); // stored as text; the app renders it as text
    expect((await post(member, "1510", first.uuid, "x".repeat(COMMENT_MAX))).status).toBe(201);
    const long = await post(member, "1510", first.uuid, "x".repeat(COMMENT_MAX + 1));
    expect(long.status).toBe(400);
    expect(long.json.error).toMatch(/2,000/);
    expect((await post(member, "1510", first.uuid, `  ${"y".repeat(COMMENT_MAX)}  \n`)).status).toBe(201); // over only before trimming
    expect((await post(member, "1510", first.uuid, "   \n ")).status).toBe(400);
    expect((await post(member, "1510", first.uuid, 42)).status).toBe(400);
    expect((await list(member, "1510", first.uuid)).comments).toHaveLength(3);
  });
});

describe("comments: rate limit", () => {
  it(`an account may write ${COMMENT_RATE.burst} quickly, then waits; others are unaffected`, async () => {
    const { admin, member, first } = await team("1520");
    for (let i = 0; i < COMMENT_RATE.burst; i++) expect((await post(member, "1520", first.uuid, `c${i}`)).status).toBe(201);
    const slow = await post(member, "1520", first.uuid, "one too many");
    expect(slow.status).toBe(429);
    expect(Number(slow.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post(admin, "1520", first.uuid, "still fine")).status).toBe(201);
    expect((await list(admin, "1520", first.uuid)).comments).toHaveLength(COMMENT_RATE.burst + 1);
  });

  it("refills over time", () => {
    const t = 1_000_000;
    for (let i = 0; i < COMMENT_RATE.burst; i++) expect(takeCommentToken(1, t)).toBeNull();
    expect(takeCommentToken(1, t)).toBeGreaterThan(0);
    expect(takeCommentToken(1, t + 60_000 / COMMENT_RATE.perMinute + 1)).toBeNull();
  });

  it("with very many accounts tracked, a spent allowance is still remembered (only refilled ones are forgotten)", () => {
    const t = 5_000_000;
    for (let i = 0; i < COMMENT_RATE.burst; i++) expect(takeCommentToken(42, t)).toBeNull();
    for (let a = 100_000; a < 120_100; a++) takeCommentToken(a, t); // 20,100 others, each one comment in
    expect(takeCommentToken(42, t + 1000)).toBeGreaterThan(0); // still out of allowance
    expect(takeCommentToken(130_000, t + 1000)).toBeNull(); // a newcomer is charged, not forgotten at once
  });
});

describe("comments: live", () => {
  it("another member's open stream gets `event: comment` (no id) for a post, an edit and a delete", async () => {
    const { admin, member, first } = await team("1530");
    const heard: CommentEvent[] = [];
    const off = subscribeComments("1530", (c) => heard.push(c));
    const ac = new AbortController();
    const res = await fetch(`${base}/api/scout/stream?workspaceId=1530&since=0`, { headers: { Cookie: admin.cookie() }, signal: ac.signal });
    let raw = "";
    const reading = (async () => {
      const dec = new TextDecoder();
      try { for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) raw += dec.decode(chunk, { stream: true }); } catch { /* aborted */ }
    })();
    const until = async (ok: () => boolean) => { const end = Date.now() + 3000; while (!ok()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); } };
    await until(() => raw.includes("event: ready"));
    const frames = () => raw.split("\n\n").filter((f) => f.includes("event: comment"));
    const id = (await post(member, "1530", first.uuid, "live one")).json.commentId;
    await member("PATCH", `${thread("1530", first.uuid)}/${id}`, { body: "live two" });
    await member("DELETE", `${thread("1530", first.uuid)}/${id}`);
    await until(() => frames().length === 3);
    for (const f of frames()) expect(f).not.toMatch(/^id:/m);
    const events = frames().map((f) => JSON.parse(f.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as CommentEvent);
    expect(events.map((e) => [e.action, e.count, e.comment?.body])).toEqual([["created", 1, "live one"], ["edited", 1, "live two"], ["deleted", 0, undefined]]);
    expect(events[0]).toMatchObject({ workspaceId: "1530", entryUuid: first.uuid, commentId: id, comment: { authorName: "Priya" } });
    expect(heard).toEqual(events);
    expect(events[0].rev).toBeLessThan(events[1].rev);
    expect(events[1].rev).toBeLessThan(events[2].rev);
    off(); ac.abort(); await reading;
  });
});

describe("comments: activity and the inbox", () => {
  it("comment.created with the exact details; the entry's author gets an inbox item, the commenter doesn't", async () => {
    const { admin, member, other, first, coach } = await team("1540");
    const id = (await post(admin, "1540", first.uuid, "Great   auto,\nwatch their lift")).json.commentId;
    const created = (await feed(member, "1540")).find((i) => i.type === "comment.created")!;
    expect(created.subject).toBe(`entry:${first.uuid}`);
    expect(created.actor).toEqual({ accountId: coach, name: "Coach" });
    expect(created.details).toEqual({ uuid: first.uuid, season: 2025, team: 18360, kind: "match", eventCode: "USNJQ1", matchLabel: "Q1", commentId: id, excerpt: "Great auto, watch their lift" });
    const mine = (await inbox(member)).items.filter((i) => i.category === "comments");
    expect(mine.map((i) => [i.title, i.body, i.link])).toEqual([["Coach commented on your entry", "team 18360 · match Q1 · USNJQ1 · “Great auto, watch their lift”", `/scout?space=1540&season=2025&entry=${first.uuid}`]]);
    expect((await inbox(admin)).items.filter((i) => i.category === "comments")).toEqual([]);
    expect((await inbox(other)).items.filter((i) => i.category === "comments")).toEqual([]); // not their entry
    // The author commenting on their own entry: no item for anyone.
    await post(member, "1540", first.uuid, "thanks");
    expect((await inbox(member)).items.filter((i) => i.category === "comments")).toHaveLength(1);
  });

  it("a comment deleted the moment it streams: its notification never keeps the text (the feed records it first)", async () => {
    const { admin, member, first } = await team("1542");
    const off = subscribeComments("1542", (c) => { if (c.action === "created") void admin("DELETE", `${thread("1542", first.uuid)}/${c.commentId}`); });
    expect((await post(admin, "1542", first.uuid, "oops, wrong entry")).status).toBe(201);
    off();
    await new Promise((r) => setTimeout(r, 300));
    expect((await list(member, "1542", first.uuid)).comments).toEqual([]);
    const created = (await feed(member, "1542")).find((i) => i.type === "comment.created")!;
    expect(created.details).toMatchObject({ deleted: true });
    expect(created.details.excerpt).toBeUndefined();
    expect((await inbox(member)).items.filter((i) => i.category === "comments").map((i) => i.body)).toEqual(["team 18360 · match Q1 · USNJQ1"]);
  });

  it("the excerpt follows an edit, and goes when the comment is deleted (feed and inbox)", async () => {
    const { admin, member, first } = await team("1541");
    const id = (await post(admin, "1541", first.uuid, "typo heer")).json.commentId;
    await inboxSettled();
    await admin("PATCH", `${thread("1541", first.uuid)}/${id}`, { body: "typo here" });
    expect((await feed(member, "1541")).find((i) => i.type === "comment.created")!.details.excerpt).toBe("typo here");
    expect((await inbox(member)).items[0].body).toBe("team 18360 · match Q1 · USNJQ1 · “typo here”");
    await admin("DELETE", `${thread("1541", first.uuid)}/${id}`);
    const after = (await feed(member, "1541")).find((i) => i.type === "comment.created")!;
    expect(after.details.excerpt).toBeUndefined();
    expect(after.details.deleted).toBe(true);
    expect((await inbox(member)).items[0].body).toBe("team 18360 · match Q1 · USNJQ1");
    // An admin deleting their own comment isn't moderation: nothing logged.
    expect((await feed(member, "1541")).some((i) => i.type === "comment.deleted")).toBe(false);
  });
});

describe("comments: deleted entries and counts", () => {
  it("a deleted entry refuses new comments and edits; its thread still reads", async () => {
    const { member, first } = await team("1550");
    const id = (await post(member, "1550", first.uuid, "before")).json.commentId;
    await push(member, "1550", { ...first, deleted: true, updatedAt: first.updatedAt + 10 });
    const r = await post(member, "1550", first.uuid, "after");
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/deleted/);
    expect((await member("PATCH", `${thread("1550", first.uuid)}/${id}`, { body: "changed" })).status).toBe(409);
    expect(await list(member, "1550", first.uuid)).toMatchObject({ entryDeleted: true, comments: [{ body: "before" }] });
  });

  it("counts per entry, for the cards: only entries with comments, deleted comments not counted", async () => {
    const { admin, member, first } = await team("1551");
    const second = entry();
    await push(member, "1551", second);
    const a = (await post(member, "1551", first.uuid, "one")).json.commentId;
    await post(admin, "1551", first.uuid, "two");
    await post(admin, "1551", second.uuid, "three");
    const counts = async () => (await admin("GET", "/api/scout/workspaces/1551/comment-counts")).json.counts;
    expect(await counts()).toEqual({ [first.uuid]: 2, [second.uuid]: 1 });
    await member("DELETE", `${thread("1551", first.uuid)}/${a}`);
    expect(await counts()).toEqual({ [first.uuid]: 1, [second.uuid]: 1 });
    expect((await admin("GET", "/api/scout/workspaces/1599/comment-counts")).status).toBe(403);
  });
});
