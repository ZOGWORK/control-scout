// The owner portal's API (/api/owner/*) against the real app on an in-memory database: who gets in,
// flags that take effect without a restart, the audit log, the feedback inbox and the data ops.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import { FLAG_TTL_MS, allFlags, invalidateFlags, isEnabled } from "../flags";
import { tryAcquire, release } from "../data/lock";
import { resetOps, setOpRunner, settleOps } from "./ops";
import { pageModule, pageTitle } from "../../src/shared/routes";
import { PRIVATE_TABLES } from "../data/snapshot";
import { openLiveConnection, resetLiveConnections } from "../liveConnections";
import { resetMetrics } from "../metrics";

let server: Server;
let base = "";
const saved = process.env.OWNER_EMAILS;
let ownerCookie = "", otherCookie = "";

async function signIn(email: string): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return `cs_session=${t}`;
}

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; type?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = opts.type ?? "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers };
}

const OWNER_GETS = ["/api/owner/overview", "/api/owner/users", "/api/owner/users/1", "/api/owner/workspaces", "/api/owner/usage", "/api/owner/predictions", "/api/owner/flags", "/api/owner/feedback", "/api/owner/errors", "/api/owner/ops", "/api/owner/audit"];
const OWNER_WRITES: [string, string, unknown][] = [
  ["PUT", "/api/owner/flags/offlinePacks", { enabled: false }],
  ["PATCH", "/api/owner/feedback/1", { status: "resolved" }],
  ["POST", "/api/owner/ops/caches", { confirm: true }],
];
const audit = () => all<{ actor: string; action: string; details: string | null; result: string | null }>("SELECT * FROM owner_audit ORDER BY id");

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerCookie = await signIn("owner@example.com");
  otherCookie = await signIn("scout@example.com");
});
afterAll(() => {
  server?.close();
  if (saved === undefined) delete process.env.OWNER_EMAILS; else process.env.OWNER_EMAILS = saved;
});
beforeEach(async () => {
  process.env.OWNER_EMAILS = "Owner@Example.com";
  for (const t of ["owner_audit", "feature_flags", "contact_messages", "request_metrics_daily"]) await run(`DELETE FROM ${t}`);
  await run("DELETE FROM kv WHERE key = 'lock:data-writer'");
  invalidateFlags();
  resetOps();
  resetMetrics();
  resetLiveConnections();
});

describe("who gets in", () => {
  it("answers 404 to signed-out visitors and to accounts that aren't owners, on every owner API", async () => {
    for (const cookie of [undefined, otherCookie]) {
      for (const p of OWNER_GETS) {
        const r = await call("GET", p, { cookie });
        expect(r.status, `${p} ${cookie ? "signed in" : "anonymous"}`).toBe(404);
        expect(r.json).toEqual({ error: "Not found" });
      }
      for (const [m, p, body] of OWNER_WRITES) expect((await call(m, p, { cookie, body })).status).toBe(404);
    }
    // Nothing was done on their behalf.
    expect(await audit()).toEqual([]);
    expect(await all("SELECT * FROM feature_flags")).toEqual([]);
  });

  it("answers 404 to everyone when no OWNER_EMAILS is set, owner included", async () => {
    delete process.env.OWNER_EMAILS;
    expect((await call("GET", "/api/owner/overview", { cookie: ownerCookie })).status).toBe(404);
  });

  it("looks exactly like an unknown API path, so the portal's existence isn't revealed", async () => {
    const unknown = await call("GET", "/api/nothing-here", { cookie: otherCookie });
    const gated = await call("GET", "/api/owner/overview", { cookie: otherCookie });
    expect(gated.status).toBe(unknown.status);
    expect(gated.json).toEqual(unknown.json);
    expect(gated.headers.get("cache-control")).toBe("no-store");
  });

  it("lets the owner in on every panel", async () => {
    for (const p of OWNER_GETS) expect((await call("GET", p, { cookie: ownerCookie })).status, p).toBe(200);
  });

  it("marks only the owner as an owner in /api/auth/me, and tells nobody else anything", async () => {
    const me = await call("GET", "/api/auth/me", { cookie: ownerCookie });
    expect(me.json.user.isOwner).toBe(true);
    const other = await call("GET", "/api/auth/me", { cookie: otherCookie });
    expect(other.json.user).not.toHaveProperty("isOwner");
    expect(JSON.stringify(other.json)).not.toMatch(/owner/i);
  });

  it("keeps /owner a not-found page on the server for everyone (the app shows the portal to owners only)", () => {
    expect(pageModule("/owner")).toBe("NotFound");
    expect(pageTitle("/owner")).toBe("Not found");
  });

  it("refuses a change sent as anything but JSON (CSRF)", async () => {
    const r = await call("PUT", "/api/owner/flags/offlinePacks", { cookie: ownerCookie, body: "enabled=false", type: "application/x-www-form-urlencoded" });
    expect(r.status).toBe(415);
    expect(await isEnabled("offlinePacks")).toBe(true);
  });
});

describe("feature flags", () => {
  it("are all on by default, for the app too", async () => {
    const r = await call("GET", "/api/flags");
    // photos and push: on, yet false for the app here: they also need R2 and VAPID keys, which this server doesn't have.
    expect(r.json.flags).toEqual({ realtime: true, workspaceScouting: true, errorReporting: true, offlinePacks: true, photos: false, push: false, autoPowerRankings: true, dailyPowerRankings: true });
    expect(r.headers.get("cache-control")).toBe("public, max-age=15");
  });

  it("switching error reports off takes effect at once: reports are accepted and dropped", async () => {
    const off = await call("PUT", "/api/owner/flags/errorReporting", { cookie: ownerCookie, body: { enabled: false } });
    expect(off.status).toBe(200);
    expect(off.json.flags.find((f: any) => f.name === "errorReporting")).toMatchObject({ enabled: false, updatedBy: "owner@example.com" });
    expect((await call("GET", "/api/flags")).json.flags.errorReporting).toBe(false);
    const report = { message: "Error: boom", stack: "", route: "/", appVersion: "dev", timestamp: new Date().toISOString(), userAgent: "test" };
    const before = Number((await get<{ n: number }>("SELECT COUNT(*) n FROM error_reports"))!.n);
    const sent = await call("POST", "/api/reports/error", { body: report });
    expect(sent.status).toBe(202);
    expect(Number((await get<{ n: number }>("SELECT COUNT(*) n FROM error_reports"))!.n)).toBe(before);
    // And back on.
    await call("PUT", "/api/owner/flags/errorReporting", { cookie: ownerCookie, body: { enabled: true } });
    await call("POST", "/api/reports/error", { body: report });
    expect(Number((await get<{ n: number }>("SELECT COUNT(*) n FROM error_reports"))!.n)).toBe(before + 1);
  });

  it("switching offline packs off makes every pack URL say so", async () => {
    await call("PUT", "/api/owner/flags/offlinePacks", { cookie: ownerCookie, body: { enabled: false } });
    for (const p of ["/packs/latest.json", "/packs/scout-pack-2026-10-15-1-lite.json.gz"]) {
      const r = await call("GET", p);
      expect(r.status, p).toBe(503);
      expect(r.json).toMatchObject({ paused: true });
      expect(r.json.error).toMatch(/paused/);
    }
    await call("PUT", "/api/owner/flags/offlinePacks", { cookie: ownerCookie, body: { enabled: true } });
    expect((await call("GET", "/packs/latest.json")).status).not.toBe(503);
  });

  it("a change made by another process shows here within the cache's lifetime, no restart", async () => {
    expect(await isEnabled("realtime")).toBe(true);
    await run("INSERT INTO feature_flags (name, enabled, updated_at, updated_by) VALUES ('realtime', 0, ?, 'elsewhere')", [new Date().toISOString()]);
    expect((await allFlags()).realtime).toBe(true); // still the cached value
    expect((await allFlags(Date.now() + FLAG_TTL_MS + 1)).realtime).toBe(false);
  });

  it("rejects unknown flags and non-boolean values", async () => {
    expect((await call("PUT", "/api/owner/flags/everything", { cookie: ownerCookie, body: { enabled: false } })).status).toBe(404);
    expect((await call("PUT", "/api/owner/flags/realtime", { cookie: ownerCookie, body: { enabled: "no" } })).status).toBe(400);
    expect(await audit()).toEqual([]);
  });
});

describe("feedback inbox", () => {
  const add = async (message: string) => Number((await get<{ id: number }>(
    "INSERT INTO contact_messages (created_at, topic, name, email, message) VALUES (?, 'bug', 'Ada', 'ada@example.com', ?) RETURNING id", [new Date().toISOString(), message],
  ))!.id);

  it("resolves and archives messages, moving them between lists", async () => {
    const a = await add("The odds tab is blank on my event");
    const b = await add("Please add a dark map");
    let list = await call("GET", "/api/owner/feedback", { cookie: ownerCookie });
    expect(list.json.counts).toEqual({ open: 2, resolved: 0, archived: 0 });
    expect(list.json.messages.map((m: any) => m.id)).toEqual([b, a]);

    const res = await call("PATCH", `/api/owner/feedback/${a}`, { cookie: ownerCookie, body: { status: "resolved" } });
    expect(res.json.message).toMatchObject({ id: a, status: "resolved" });
    expect(res.json.message.statusAt).toBeTruthy();
    await call("PATCH", `/api/owner/feedback/${b}`, { cookie: ownerCookie, body: { status: "archived" } });

    list = await call("GET", "/api/owner/feedback", { cookie: ownerCookie });
    expect(list.json.counts).toEqual({ open: 0, resolved: 1, archived: 1 });
    expect(list.json.messages).toEqual([]);
    expect((await call("GET", "/api/owner/feedback?status=resolved", { cookie: ownerCookie })).json.messages.map((m: any) => m.id)).toEqual([a]);
    expect((await call("GET", "/api/owner/feedback?status=all", { cookie: ownerCookie })).json.messages).toHaveLength(2);
    // Reopened.
    await call("PATCH", `/api/owner/feedback/${b}`, { cookie: ownerCookie, body: { status: "open" } });
    expect((await call("GET", "/api/owner/feedback", { cookie: ownerCookie })).json.messages.map((m: any) => m.id)).toEqual([b]);
  });

  it("pages through older messages, so none is out of reach", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(await add(`Paged message number ${i}, long enough`));
    const first = (await call("GET", "/api/owner/feedback?limit=2", { cookie: ownerCookie })).json;
    expect(first.messages.map((m: any) => m.id)).toEqual([ids[4], ids[3]]);
    expect(first.more).toBe(true);
    const second = (await call("GET", `/api/owner/feedback?limit=2&before=${ids[3]}`, { cookie: ownerCookie })).json;
    expect(second.messages.map((m: any) => m.id)).toEqual([ids[2], ids[1]]);
    const last = (await call("GET", `/api/owner/feedback?limit=2&before=${ids[1]}`, { cookie: ownerCookie })).json;
    expect(last.messages.map((m: any) => m.id)).toEqual([ids[0]]);
    expect(last.more).toBe(false);
  });

  it("refuses an unknown status or message", async () => {
    const a = await add("Hello there, one more message");
    expect((await call("PATCH", `/api/owner/feedback/${a}`, { cookie: ownerCookie, body: { status: "deleted" } })).status).toBe(400);
    expect((await call("PATCH", "/api/owner/feedback/999999", { cookie: ownerCookie, body: { status: "resolved" } })).status).toBe(404);
  });
});

describe("data ops", () => {
  it("need the confirmation, start in the background and report how they ended", async () => {
    expect((await call("POST", "/api/owner/ops/caches", { cookie: ownerCookie, body: {} })).status).toBe(400);
    const started = await call("POST", "/api/owner/ops/caches", { cookie: ownerCookie, body: { confirm: true } });
    expect(started.status).toBe(202);
    expect(started.json.job).toMatchObject({ op: "caches", state: "running", by: "owner@example.com" });
    await settleOps();
    const status = await call("GET", "/api/owner/ops", { cookie: ownerCookie });
    expect(status.json.jobs.caches.state).toBe("done");
    expect(status.json.jobs.caches.message).toMatch(/Prediction ratings/);
    // The lease was given back.
    expect(status.json.writer).toBeNull();
  });

  it("never run while the data writer lease is held (a scheduled sync, the live lane)", async () => {
    const token = await tryAcquire("cycle", 60_000);
    expect(token).toBeTruthy();
    let ran = false;
    setOpRunner("resync", async () => { ran = true; return "ok"; });
    try {
      const r = await call("POST", "/api/owner/ops/resync", { cookie: ownerCookie, body: { confirm: true } });
      expect(r.status).toBe(409);
      expect(r.json.error).toMatch(/busy \(cycle\)/);
      expect(ran).toBe(false);
    } finally { await release(token!); setOpRunner("resync", null); }
  });

  it("refuse a second start of the same op while the first runs", async () => {
    let finish!: () => void;
    setOpRunner("resync", () => new Promise((r) => { finish = () => r("Data updated."); }));
    try {
      const [a, b] = await Promise.all([
        call("POST", "/api/owner/ops/resync", { cookie: ownerCookie, body: { confirm: true } }),
        call("POST", "/api/owner/ops/resync", { cookie: ownerCookie, body: { confirm: true } }),
      ]);
      expect([a.status, b.status].sort()).toEqual([202, 409]);
      finish();
      await settleOps();
      expect((await call("GET", "/api/owner/ops", { cookie: ownerCookie })).json.jobs.resync).toMatchObject({ state: "done", message: "Data updated." });
    } finally { setOpRunner("resync", null); }
  });

  it("say why a failed op failed", async () => {
    setOpRunner("packs", async () => { throw new Error("disk full"); });
    try {
      await call("POST", "/api/owner/ops/packs", { cookie: ownerCookie, body: { confirm: true } });
      await settleOps();
      expect((await call("GET", "/api/owner/ops", { cookie: ownerCookie })).json.jobs.packs).toMatchObject({ state: "failed", message: "disk full" });
    } finally { setOpRunner("packs", null); }
  });
});

describe("audit log", () => {
  it("records every owner action: who, what, when, details, and how jobs ended (refusals too)", async () => {
    const id = Number((await get<{ id: number }>("INSERT INTO contact_messages (created_at, topic, email, message) VALUES (?, 'data', 'a@example.com', 'Wrong score in Q12 here') RETURNING id", [new Date().toISOString()]))!.id);
    setOpRunner("packs", async () => "Packs built.");
    try {
      await call("PUT", "/api/owner/flags/realtime", { cookie: ownerCookie, body: { enabled: false } });
      await call("PATCH", `/api/owner/feedback/${id}`, { cookie: ownerCookie, body: { status: "archived" } });
      await call("POST", "/api/owner/ops/packs", { cookie: ownerCookie, body: { confirm: true } });
      await settleOps();
      const token = await tryAcquire("live", 60_000);
      await call("POST", "/api/owner/ops/caches", { cookie: ownerCookie, body: { confirm: true } });
      await release(token!);
    } finally { setOpRunner("packs", null); }
    const rows = await audit();
    expect(rows.map((r) => [r.actor, r.action])).toEqual([
      ["owner@example.com", "flag.set"], ["owner@example.com", "feedback.status"], ["owner@example.com", "ops.packs"], ["owner@example.com", "ops.caches"],
    ]);
    expect(JSON.parse(rows[0].details!)).toEqual({ flag: "realtime", enabled: false });
    expect(JSON.parse(rows[1].details!)).toEqual({ id, status: "archived" });
    expect(rows[2].result).toBe("done: Packs built.");
    expect(rows[3].result).toMatch(/^refused: The data writer is busy \(live\)/);
    const shown = await call("GET", "/api/owner/audit", { cookie: ownerCookie });
    expect(shown.json.entries.map((e: any) => e.action)).toEqual(["ops.caches", "ops.packs", "feedback.status", "flag.set"]);
    expect(shown.json.entries[0].at).toBeTruthy();
  });

  it("stays out of the public snapshot, with the other operational tables", () => {
    for (const t of ["owner_audit", "feature_flags", "request_metrics_daily", "contact_messages"]) expect(PRIVATE_TABLES).toContain(t);
  });
});

describe("overview and usage", () => {
  it("counts workspaces and their live (not deleted) shared entries", async () => {
    const now = new Date().toISOString();
    await run("INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES ('w1', 'One', ?, ?), ('w2', 'Two', ?, ?)", [now, now, now, now]);
    const ws = Number((await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = 'w1'"))!.id);
    const add = (uuid: string, seq: number, deleted: number) => run(
      `INSERT INTO workspace_scout_entries (workspace_id, uuid, season, team, kind, data, updated_at, deleted, author_account_id, editor_account_id, seq)
       VALUES (?, ?, 2025, 18360, 'match', '{}', 1, ?, 7, 7, ?)`, [ws, uuid, deleted, seq]);
    await add("a", 1, 0);
    await add("b", 2, 1);
    try {
      const o = (await call("GET", "/api/owner/overview", { cookie: ownerCookie })).json;
      expect(o.accounts.total).toBeGreaterThanOrEqual(2);
      expect(o.storage.databaseBytes).toBeGreaterThan(0);
      expect(o.workspaces).toBe(2);
      expect(o.scoutEntries.workspace).toBe(1);
    } finally {
      await run("DELETE FROM workspace_scout_entries");
      await run("DELETE FROM workspaces");
    }
  });

  it("shows workspace counts as unknown on a database without workspace scouting's tables", async () => {
    // An older database (before migration 12): the tables are moved aside for the check.
    await run("ALTER TABLE workspace_scout_entries RENAME TO wse_aside");
    await run("ALTER TABLE workspaces RENAME TO ws_aside");
    try {
      const o = (await call("GET", "/api/owner/overview", { cookie: ownerCookie })).json;
      expect(o.workspaces).toBeNull();
      expect(o.scoutEntries.workspace).toBeNull();
    } finally {
      await run("ALTER TABLE ws_aside RENAME TO workspaces");
      await run("ALTER TABLE wse_aside RENAME TO workspace_scout_entries");
    }
  });

  it("counts API requests by route pattern, today's included, and live connections", async () => {
    for (const t of [18360, 4215, 18360]) await call("GET", `/api/teams/${t}`);
    await call("GET", "/api/health");
    const done = openLiveConnection("event-stream");
    const u = (await call("GET", "/api/owner/usage?days=7", { cookie: ownerCookie })).json;
    done();
    expect(u.daily).toHaveLength(7);
    const teams = u.busiest.find((r: any) => r.route === "GET /api/teams/:n");
    expect(teams.count).toBe(3);
    expect(u.busiest.some((r: any) => /health|owner/.test(r.route))).toBe(false);
    expect(u.totals.requests).toBeGreaterThanOrEqual(3);
    expect(u.live).toMatchObject({ total: 1, byKind: { "event-stream": 1 } });
  });
});
