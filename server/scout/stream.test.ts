// The live stream of workspace entries (GET /api/scout/stream), read raw over
// HTTP against a stub Control Point: auth, catch-up then live with no gaps or
// duplicates, tombstones as delete events, heartbeat, cleanup, caps, the kill
// switch, and no compression in front of it.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache, MEMBERSHIP_TTL } from "../auth/controlPoint";
import { activeStreamCount, closeAllStreams, setStreamLimits, streamRouter } from "./stream";
import { subscriberCount } from "./bus";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();
type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 3000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};

beforeAll(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use("/internal", (req, res, next) => { if (req.get("X-Internal-Key") !== KEY) { res.status(401).json({ error: "bad key" }); return; } next(); });
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
  scout = createApp().listen(0);
  await new Promise((r) => scout.once("listening", r));
  base = `http://127.0.0.1:${(scout.address() as AddressInfo).port}`;
});
afterAll(() => {
  closeAllStreams();
  setMailer(null); scout?.close(); cp?.close();
  for (const k of ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL"]) delete process.env[k];
});
beforeEach(() => {
  clearInfoCache();
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});
afterEach(async () => {
  closeAllStreams();
  await until(() => activeStreamCount() === 0);
});

interface Member { cookie: string; call: (method: string, path: string, json?: unknown) => Promise<{ status: number; json: any }> }
async function signIn(email: string, displayName?: string): Promise<Member> {
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
  await call("POST", "/api/auth/email/start", { email });
  expect((await call("POST", "/api/auth/email/verify", { email, code: inbox.get(email) })).status).toBe(200);
  if (displayName) await call("PATCH", "/api/me", { displayName });
  return { get cookie() { return cookie; }, call };
}

async function until(ok: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Frame { id?: string; event?: string; data?: string; comment?: string; retry?: string }
/** Open the stream and parse it as it arrives (raw text, the way a browser's EventSource reads it). */
async function stream(m: Member | null, query: string, headers: Record<string, string> = {}, at = base) {
  const ac = new AbortController();
  const r = await fetch(`${at}/api/scout/stream?${query}`, { headers: { ...(m ? { Cookie: m.cookie } : {}), ...headers }, signal: ac.signal });
  const frames: Frame[] = [];
  let raw = "";
  if (r.headers.get("content-type")?.startsWith("text/event-stream")) {
    void (async () => {
      const dec = new TextDecoder();
      try {
        for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
          raw += dec.decode(chunk, { stream: true });
          let i;
          while ((i = raw.indexOf("\n\n")) >= 0) {
            const block = raw.slice(0, i); raw = raw.slice(i + 2);
            const f: Frame = {};
            for (const line of block.split("\n")) {
              if (line.startsWith(":")) f.comment = line.slice(1).trim();
              else { const k = line.slice(0, line.indexOf(":")) as keyof Frame; f[k] = (f[k] ? `${f[k]}\n` : "") + line.slice(line.indexOf(":") + 1).replace(/^ /, ""); }
            }
            frames.push(f);
          }
        }
      } catch { /* aborted */ }
    })();
  }
  const entries = () => frames.filter((f) => f.event === "upsert" || f.event === "delete");
  return {
    res: r, frames, entries,
    seqs: () => entries().map((f) => Number(f.id)),
    data: () => entries().map((f) => JSON.parse(f.data!)),
    ready: () => until(() => frames.some((f) => f.event === "ready")),
    close: () => ac.abort(),
  };
}

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({ uuid: `s${String(++n).padStart(10, "0")}`, season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: { auto: 3 }, notes: "fast", updatedAt: 1000 + n, ...over });
const push = (m: Member, workspaceId: string, entries: unknown[]) => m.call("POST", "/api/me/scout/sync", { workspaceId, entries });

// Two members, signed in once (sign-in is rate limited per IP); each test puts them in a new workspace.
let members: { A: Member; B: Member } | null = null;
async function team(ws: string) {
  members ??= { A: await signIn("priya@example.com", "Priya"), B: await signIn("marcus@example.com", "Marcus") };
  for (const [email, role] of [["priya@example.com", "admin"], ["marcus@example.com", "member"]] as const) {
    const a = accountFor(email);
    a.workspaces = [...(a.workspaces ?? []), { id: ws, name: `Team ${ws}`, role }];
  }
  return members;
}

describe("GET /api/scout/stream", () => {
  it("401 signed out, 403 for a non-member, 400 for a bad workspace or cursor; refusals are plain JSON", async () => {
    accountFor("owner1@example.com").workspaces = [{ id: "201", name: "Private", role: "admin" }];
    accountFor("stranger1@example.com").workspaces = [{ id: "202", name: "Elsewhere", role: "admin" }];
    const s = await signIn("stranger1@example.com");
    const out = await stream(null, "workspaceId=201");
    expect(out.res.status).toBe(401);
    const denied = await stream(s, "workspaceId=201");
    expect(denied.res.status).toBe(403);
    expect((await denied.res.json()).error).toMatch(/not a member/);
    expect(denied.res.headers.get("cache-control")).toBe("no-store");
    expect((await stream(s, "workspaceId=../x")).res.status).toBe(400);
    expect((await stream(s, "workspaceId=202&since=-1")).res.status).toBe(400);
    expect((await stream(s, "workspaceId=202", { "Last-Event-ID": "abc" })).res.status).toBe(400);
    expect(activeStreamCount()).toBe(0);
  });

  it("headers for proxies: event-stream, no-store, no nginx buffering, never compressed", async () => {
    const { B } = await team("211");
    const s = await stream(B, "workspaceId=211", { "Accept-Encoding": "gzip, deflate, br" });
    expect(s.res.status).toBe(200);
    expect(s.res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(s.res.headers.get("cache-control")).toBe("no-store");
    expect(s.res.headers.get("x-accel-buffering")).toBe("no");
    expect(s.res.headers.get("content-encoding")).toBeNull();
    await s.ready();
    expect(s.frames.find((f) => f.event === "ready")!.data).toBe(JSON.stringify({ cursor: 0 }));
    s.close();
  });

  it("A's write reaches B's open stream as an upsert, id = seq, with the server-stamped author", async () => {
    const { A, B } = await team("221");
    const s = await stream(B, "workspaceId=221");
    await s.ready();
    const e = entry();
    expect((await push(A, "221", [e])).status).toBe(200);
    await until(() => s.entries().length === 1);
    const [f] = s.entries();
    expect(f.event).toBe("upsert");
    expect(f.id).toBe("1");
    expect(JSON.parse(f.data!)).toMatchObject({ uuid: e.uuid, workspaceId: "221", notes: "fast", deleted: false, authorDisplayName: "Priya", editorDisplayName: "Priya" });
    expect(JSON.parse(f.data!).seq).toBeUndefined(); // the entry exactly as the pull sends it
    // B edits it: B's own stream hears it too, the author stays Priya.
    await push(B, "221", [{ ...e, notes: "faster", updatedAt: e.updatedAt + 10 }]);
    await until(() => s.entries().length === 2);
    expect(s.data()[1]).toMatchObject({ notes: "faster", authorDisplayName: "Priya", editorDisplayName: "Marcus" });
    expect(s.seqs()).toEqual([1, 2]);
    s.close();
  });

  it("a tombstone is a delete event", async () => {
    const { A, B } = await team("231");
    const e = entry();
    await push(A, "231", [e]);
    const s = await stream(B, "workspaceId=231&since=1");
    await s.ready();
    await push(A, "231", [{ ...e, deleted: true, data: {}, notes: "", updatedAt: e.updatedAt + 1 }]);
    await until(() => s.entries().length === 1);
    expect(s.entries()[0]).toMatchObject({ event: "delete", id: "2" });
    expect(s.data()[0]).toMatchObject({ uuid: e.uuid, deleted: true });
    s.close();
  });

  it("only actual writes are sent: an older edit that loses, or a resend of the same version, sends nothing", async () => {
    const { A, B } = await team("236");
    const e = entry({ updatedAt: 5000 });
    await push(A, "236", [e]);
    const s = await stream(B, "workspaceId=236");
    await s.ready();
    await push(B, "236", [{ ...e, updatedAt: 4000, notes: "older" }]);
    await push(A, "236", [e]);
    const later = entry();
    await push(A, "236", [later]);
    await until(() => s.entries().length === 2);
    expect(s.data().map((x) => x.uuid)).toEqual([e.uuid, later.uuid]); // catch-up, then the one real write
    s.close();
  });

  it("catch-up from ?since= or Last-Event-ID, then live, with no gaps or duplicates even while writes race the connect", async () => {
    const { A, B } = await team("241");
    for (let i = 0; i < 3; i++) await push(A, "241", [entry()]);
    // Resume after seq 2 (the browser's Last-Event-ID wins over ?since=).
    const resumed = await stream(B, "workspaceId=241&since=0", { "Last-Event-ID": "2" });
    await resumed.ready();
    expect(resumed.seqs()).toEqual([3]);
    resumed.close();
    // Writes fired while the stream connects and catches up: every seq exactly once, in order.
    const writes = Array.from({ length: 25 }, (_, i) => push(i % 2 ? A : B, "241", [entry()]));
    const s = await stream(B, "workspaceId=241&since=1");
    await Promise.all(writes);
    await s.ready();
    await until(() => s.seqs().at(-1) === 28);
    expect(s.seqs()).toEqual(Array.from({ length: 27 }, (_, i) => i + 2));
    expect(new Set(s.data().map((x) => x.uuid)).size).toBe(27);
    s.close();
  });

  it("heartbeat: a comment line on the interval", async () => {
    const restore = setStreamLimits({ heartbeatMs: 40 });
    try {
      const { B } = await team("251");
      const s = await stream(B, "workspaceId=251");
      await until(() => s.frames.filter((f) => f.comment === "ping").length >= 2);
      s.close();
    } finally { restore(); }
  });

  it("disconnect cleans up: the stream, its subscription and its timers go", async () => {
    const { A, B } = await team("261");
    const s = await stream(B, "workspaceId=261");
    await s.ready();
    expect(activeStreamCount()).toBe(1);
    expect(subscriberCount("261")).toBe(1);
    s.close();
    await until(() => activeStreamCount() === 0 && subscriberCount("261") === 0);
    // Writing afterwards is fine with nobody listening.
    expect((await push(A, "261", [entry()])).status).toBe(200);
  });

  it("caps connections per account and overall (429 with Retry-After)", async () => {
    const { A, B } = await team("271");
    const restore = setStreamLimits({ perAccount: 2, total: 3 });
    try {
      const b1 = await stream(B, "workspaceId=271"), b2 = await stream(B, "workspaceId=271");
      const b3 = await stream(B, "workspaceId=271");
      expect([b1.res.status, b2.res.status, b3.res.status]).toEqual([200, 200, 429]);
      expect(b3.res.headers.get("retry-after")).toBe("30");
      const a1 = await stream(A, "workspaceId=271");
      expect(a1.res.status).toBe(200); // another account still gets in…
      const a2 = await stream(A, "workspaceId=271");
      expect(a2.res.status).toBe(429); // …until the server-wide cap
      expect(activeStreamCount()).toBe(3);
      expect(activeStreamCount((await B.call("GET", "/api/auth/me")).json.user.id)).toBe(2);
      b1.close();
      await until(() => activeStreamCount() === 2);
      expect((await stream(A, "workspaceId=271")).res.status).toBe(200);
    } finally { restore(); }
  });

  it("a member removed in Control Point is told and dropped at the next re-check", async () => {
    const restore = setStreamLimits({ recheckMs: 50 });
    try {
      const { B } = await team("281");
      const s = await stream(B, "workspaceId=281");
      await s.ready();
      const b = accountFor("marcus@example.com");
      b.workspaces = [];
      await run("UPDATE workspace_members SET updated_at = ? WHERE account_id = ?", [Date.now() - MEMBERSHIP_TTL - 1, b.id]);
      clearInfoCache(); // past the 5 s re-check window of the connect's own refresh
      await until(() => s.frames.some((f) => f.event === "membership_revoked"));
      await until(() => activeStreamCount() === 0);
    } finally { restore(); }
  });

  it("a reader that stops reading is let go once its backlog passes the limit (it reconnects from its cursor)", async () => {
    const { A, B } = await team("285");
    const restore = setStreamLimits({ maxBufferedBytes: 64 * 1024 });
    try {
      const { request } = await import("node:http");
      const req = request(`${base}/api/scout/stream?workspaceId=285`, { headers: { Cookie: B.cookie } });
      const res = await new Promise<import("node:http").IncomingMessage>((r) => { req.on("response", r); req.end(); });
      expect(res.statusCode).toBe(200);
      res.pause(); // never reads
      await until(() => activeStreamCount() === 1);
      const big = "x".repeat(18_000);
      for (let i = 0; i < 40 && activeStreamCount() > 0; i++) {
        await push(A, "285", Array.from({ length: 50 }, () => entry({ data: { note: big } })));
      }
      await until(() => activeStreamCount() === 0, 5000);
      res.destroy();
    } finally { restore(); }
  });

  it("the kill switch: off answers 503 before anything else", async () => {
    const app = express().use("/api/scout", streamRouter({ enabled: async () => false }));
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    try {
      const s = await stream(null, "workspaceId=1", {}, `http://127.0.0.1:${(srv.address() as AddressInfo).port}`);
      expect(s.res.status).toBe(503);
      expect(s.res.headers.get("cache-control")).toBe("no-store");
    } finally { srv.close(); }
  });

  it("closeAllStreams (SIGTERM) ends every stream", async () => {
    const { B } = await team("291");
    const s = await stream(B, "workspaceId=291");
    await s.ready();
    closeAllStreams();
    expect(activeStreamCount()).toBe(0);
    expect(subscriberCount()).toBe(0);
    s.close();
  });
});
