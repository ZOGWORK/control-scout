// The live stream of workspace entries (GET /api/scout/stream), read raw over
// HTTP against a stub Control Point: auth, catch-up then live with no gaps or
// duplicates, tombstones as delete events, heartbeat, cleanup, caps, the kill
// switch, and no compression in front of it. Task 12: membership cached for at most 60 s on reads
// and writes, the re-check sweep that ends a removed member's streams within a minute, per-account
// coalescing and the 5 s floor, and deletes going out the moment they're pushed.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache, MEMBERSHIP_TTL } from "../auth/controlPoint";
import { activeStreamCount, closeAllStreams, LIMITS, setStreamLimits, streamRouter, sweep } from "./stream";
import { subscriberCount } from "./bus";
import { setFlag } from "../flags";
import { liveConnections } from "../liveConnections";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();
type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
/** Account reads Scout asked Control Point for (GET /internal/accounts/:id), answered or not; cpDown: it answers 503. */
let cpCalls = 0;
let cpDown = false;
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 3000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};

beforeAll(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use("/internal", (req, res, next) => {
    if (req.get("X-Internal-Key") !== KEY) { res.status(401).json({ error: "bad key" }); return; }
    if (req.method === "GET" && /^\/accounts\/\d+$/.test(req.path)) cpCalls++;
    if (cpDown) { res.status(503).json({ error: "down" }); return; }
    next();
  });
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
  vi.useRealTimers();
  cpDown = false;
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

// (performance.now, not Date: some tests move the clock by hand.)
async function until(ok: () => boolean, ms = 3000) {
  const end = performance.now() + ms;
  while (!ok()) {
    if (performance.now() > end) throw new Error("timed out waiting");
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

  it("a member removed in Control Point is told and dropped by the running re-check sweep", async () => {
    const restore = setStreamLimits({ recheckMs: 300, sweepMs: 20 });
    try {
      const { B } = await team("281");
      const s = await stream(B, "workspaceId=281");
      await s.ready();
      const b = accountFor("marcus@example.com");
      b.workspaces = (b.workspaces ?? []).filter((w) => w.id !== "281");
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

  it("the app wires the owner portal's realtime switch: off answers 503 (the app polls), back on streams", async () => {
    const { B } = await team("293");
    await setFlag("realtime", false, "owner@example.com");
    try {
      const off = await stream(B, "workspaceId=293");
      expect(off.res.status).toBe(503);
      expect((await off.res.json()).error).toMatch(/paused/);
      expect(activeStreamCount()).toBe(0);
    } finally { await setFlag("realtime", true, "owner@example.com"); }
    // Workspace scouting paused: no catch-up download through the stream either (403 feature_disabled).
    await setFlag("workspaceScouting", false, "owner@example.com");
    try {
      const paused = await stream(B, "workspaceId=293&since=0");
      expect(paused.res.status).toBe(403);
      expect(activeStreamCount()).toBe(0);
    } finally { await setFlag("workspaceScouting", true, "owner@example.com"); }
    const on = await stream(B, "workspaceId=293");
    expect(on.res.status).toBe(200);
    await on.ready();
    on.close();
  });

  it("each open stream counts once in the owner portal's live connections, and is let go when it closes", async () => {
    const { A, B } = await team("294");
    const before = liveConnections().total;
    const a = await stream(A, "workspaceId=294");
    const b = await stream(B, "workspaceId=294");
    await a.ready(); await b.ready();
    expect(liveConnections().total).toBe(before + 2);
    expect(liveConnections().byKind["scout-stream"]).toBe(2);
    expect(liveConnections().total).toBe(activeStreamCount()); // one count, not two
    a.close();
    await until(() => activeStreamCount() === 1);
    expect(liveConnections().total).toBe(before + 1);
    b.close();
    await until(() => activeStreamCount() === 0);
    expect(liveConnections().total).toBe(before);
  });

  it("Task 12 defaults: the sweep re-checks within a minute, every 5 s; the cache lasts 60 s", () => {
    expect(LIMITS.recheckMs).toBeLessThanOrEqual(60_000);
    expect(LIMITS.sweepMs).toBeLessThanOrEqual(5_000);
    expect(MEMBERSHIP_TTL).toBe(60_000);
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

// Task 12: the clock moves by hand (Date only: sockets, the database and timers run as normal).
describe("live sync hardening (Task 12)", () => {
  const removeFrom = (email: string, ws: string) => {
    const a = accountFor(email);
    a.workspaces = (a.workspaces ?? []).filter((w) => w.id !== ws);
  };
  const clockAt = (t: number) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(t); };
  const pull = (m: Member, ws: string) => m.call("GET", `/api/scout/sync?workspaceId=${ws}&since=0`);

  it("writes: the cached membership counts for 60 s, then Control Point decides (a removal there is refused within the minute)", async () => {
    const { B } = await team("301");
    expect((await push(B, "301", [entry()])).status).toBe(200); // asks Control Point: the row is fresh now
    const t0 = Date.now();
    clockAt(t0);
    removeFrom("marcus@example.com", "301");
    const calls = cpCalls;
    vi.setSystemTime(t0 + 59_000);
    expect((await push(B, "301", [entry()])).status).toBe(200); // still within the cache
    expect(cpCalls).toBe(calls);
    vi.setSystemTime(t0 + 61_000);
    const refused = await push(B, "301", [entry()]);
    expect(refused.status).toBe(403);
    expect(refused.json.error).toMatch(/not a member/);
    expect(cpCalls).toBe(calls + 1);
  });

  it("reads: a pull re-checks once the cached row is over 60 s old", async () => {
    const { B } = await team("302");
    expect((await pull(B, "302")).status).toBe(200);
    const t0 = Date.now();
    clockAt(t0);
    removeFrom("marcus@example.com", "302");
    const calls = cpCalls;
    vi.setSystemTime(t0 + 30_000);
    expect((await pull(B, "302")).status).toBe(200);
    expect(cpCalls).toBe(calls);
    vi.setSystemTime(t0 + 60_500);
    expect((await pull(B, "302")).status).toBe(403);
    expect(cpCalls).toBe(calls + 1);
  });

  it("per-account coalescing and the 5 s floor; Control Point down: a stale row still counts, a missing one doesn't", async () => {
    const { B } = await team("303");
    expect((await pull(B, "303")).status).toBe(200);
    const t0 = Date.now();
    clockAt(t0);
    // Stale: five reads at once ask Control Point once.
    vi.setSystemTime(t0 + 61_000);
    let calls = cpCalls;
    expect((await Promise.all(Array.from({ length: 5 }, () => pull(B, "303")))).map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(cpCalls).toBe(calls + 1);
    // Control Point goes down once the row is stale again: reads carry on (stale row), at most one call per 5 s.
    cpDown = true;
    vi.setSystemTime(t0 + 123_000);
    calls = cpCalls;
    expect((await Promise.all(Array.from({ length: 3 }, () => pull(B, "303")))).map((r) => r.status)).toEqual([200, 200, 200]);
    expect(cpCalls).toBe(calls + 1);
    vi.setSystemTime(t0 + 126_000);
    expect((await push(B, "303", [entry()])).status).toBe(200);
    expect(cpCalls).toBe(calls + 1); // within 5 s of the last try: no call
    vi.setSystemTime(t0 + 129_000);
    expect((await pull(B, "303")).status).toBe(200);
    expect(cpCalls).toBe(calls + 2);
    // A workspace with no cached row is refused while Control Point can't say.
    accountFor("marcus@example.com").workspaces!.push({ id: "304", name: "Team 304", role: "member" });
    vi.setSystemTime(t0 + 135_000);
    expect((await pull(B, "304")).status).toBe(403);
  });

  // These run the sweep by hand (its own timer, every 5 s, doesn't fire within a test this short).
  it("the sweep ends an open stream within 60 s of a removal in Control Point, one call per account however many streams", async () => {
    const { B } = await team("305");
    const s1 = await stream(B, "workspaceId=305"), s2 = await stream(B, "workspaceId=305");
    await s1.ready(); await s2.ready(); // each connect checked membership: Control Point's answer is fresh
    const t0 = Date.now();
    clockAt(t0);
    const calls = cpCalls;
    vi.setSystemTime(t0 + 1_000);
    removeFrom("marcus@example.com", "305"); // removed in Control Point
    vi.setSystemTime(t0 + 50_000);
    await sweep();
    expect(cpCalls).toBe(calls); // the answer is under a minute old: nothing to ask
    expect(activeStreamCount()).toBe(2);
    vi.setSystemTime(t0 + 56_000);
    await sweep(); // due before the next tick: asks once for both streams
    expect(cpCalls).toBe(calls + 1);
    await until(() => s1.frames.some((f) => f.event === "membership_revoked") && s2.frames.some((f) => f.event === "membership_revoked"));
    await until(() => activeStreamCount() === 0);
    // Removed at +1 s, told at +56 s: within the minute.
  });

  it("the sweep keeps streams while Control Point is down, asks again a minute later (not every tick), then revokes", async () => {
    const { B } = await team("306");
    const s = await stream(B, "workspaceId=306");
    await s.ready();
    const t0 = Date.now();
    clockAt(t0);
    cpDown = true;
    const calls = cpCalls;
    vi.setSystemTime(t0 + 56_000);
    await sweep();
    expect(cpCalls).toBe(calls + 1);
    vi.setSystemTime(t0 + 61_000);
    await sweep();
    vi.setSystemTime(t0 + 66_000);
    await sweep();
    expect(cpCalls).toBe(calls + 1); // not every tick
    expect(activeStreamCount()).toBe(1);
    expect(s.frames.some((f) => f.event === "membership_revoked")).toBe(false);
    cpDown = false;
    removeFrom("marcus@example.com", "306");
    vi.setSystemTime(t0 + 112_000);
    await sweep();
    expect(cpCalls).toBe(calls + 2);
    await until(() => s.frames.some((f) => f.event === "membership_revoked"));
    await until(() => activeStreamCount() === 0);
  });

  it("a delete goes out on the other members' streams the moment it's pushed, like an add", async () => {
    const { A, B } = await team("307");
    const s = await stream(B, "workspaceId=307");
    await s.ready();
    const e = entry();
    let t = performance.now();
    await push(A, "307", [e]);
    await until(() => s.entries().length === 1, 1000);
    const add = performance.now() - t;
    t = performance.now();
    await push(A, "307", [{ ...e, deleted: true, data: {}, notes: "", updatedAt: e.updatedAt + 1 }]);
    await until(() => s.entries().length === 2, 1000);
    const del = performance.now() - t;
    expect(s.entries()[1]).toMatchObject({ event: "delete", id: "2" });
    expect(s.data()[1]).toMatchObject({ uuid: e.uuid, deleted: true });
    // Published in the push itself: both reach the stream well inside the 1-2 s target.
    expect(add).toBeLessThan(1000);
    expect(del).toBeLessThan(1000);
    s.close();
  });
});
