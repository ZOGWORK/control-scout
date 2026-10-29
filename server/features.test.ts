// The owner console's feature toggles (server/flags.ts, server/portal/features.ts) against the real app on an
// in-memory database: the resolution matrix (workspace override, global switch, default), every gated public route
// refusing reads and writes with 403 feature_disabled while its toggle is off (and answering while it's on), the
// console itself never gated, switching off and back on keeping every byte of data, and the audit log's old → new.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { sha256 } from "./auth/session";
import { FLAG_TTL_MS, hasWorkspaceOverrides, invalidateFlags, isEnabledFor, setFlag, setWorkspaceOverride, workspaceFlags } from "./flags";
import { FEATURE_FLAGS, FLAGS, KILL_SWITCHES, WORKSPACE_FLAGS, type Flag } from "../src/shared/flags";
import { ownerRouter } from "./portal/routes";
import { publishNow, autoPowerRankingsTick } from "./powerRankings/auto";
import { dailyRefreshTick } from "./powerRankings/refresh";
import { invalidateGenerated } from "./powerRankings/generated";

let server: Server;
let base = "";
let ownerCookie = "";
let dataDir = "";
const saved = { owners: process.env.OWNER_EMAILS, data: process.env.DATA_DIR };

async function signIn(email: string): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return `cs_session=${t}`;
}

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const ctrl = new AbortController();
  const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: ctrl.signal });
  // A stream that opened (the toggle on): its headers are the answer; don't wait for it to end.
  if ((res.headers.get("content-type") ?? "").startsWith("text/event-stream")) { ctrl.abort(); return { status: res.status, json: null as any, headers: res.headers, text: "" }; }
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers, text };
}

const auditFrom = async () => Number((await get<{ n: number }>("SELECT COALESCE(MAX(id), 0) n FROM owner_audit"))!.n);
const auditSince = (from: number) => all<{ action: string; details: string; old_value: string | null; new_value: string | null }>("SELECT * FROM owner_audit WHERE id > ? ORDER BY id", [from]);

/** Every public route behind a feature toggle, as [toggle, method, path, body?]: reads and writes alike. */
const GATED: [Flag, string, string, unknown?][] = [
  ["livePredictions", "GET", "/api/predict/match?red=1,2&blue=3,4"],
  ["livePredictions", "GET", "/api/predict/upcoming"],
  ["livePredictions", "GET", "/api/predict/event?code=USNJQ1"],
  ["livePredictions", "GET", "/api/predict/partners?code=USNJQ1&team=1"],
  ["livePredictions", "GET", "/api/share/match.png?red=1,2&blue=3,4"],
  ["advancementOdds", "GET", "/api/projections/2025/USNJQ1"],
  ["advancementOdds", "GET", "/api/projections/2025/USNJQ1/stream"],
  ["coinFlips", "GET", "/api/home/coin-flips"],
  ["powerRankings", "GET", "/api/power-rankings"],
  ["powerRankings", "GET", "/api/power-rankings/2026-w42"],
  ["offlinePacks", "GET", "/packs/latest.json"],
  ["offlinePacks", "GET", "/packs/scout-pack-2026-10-15-1-lite.json.gz"],
];
/** The owner's own writes that publish power rankings: refused too (the console's reads never are). */
const GATED_OWNER_WRITES: [Flag, string, string, unknown][] = [
  ["powerRankings", "POST", "/api/owner/power-rankings/publish-now", { confirm: true }],
  ["powerRankings", "POST", "/api/owner/power-rankings/2026/2026-w42/regenerate", { confirm: true }],
];

const allOff = async () => { for (const f of FEATURE_FLAGS) await setFlag(f, false, "owner@example.com"); };

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "cs-features-"));
  process.env.DATA_DIR = dataDir;
  mkdirSync(join(dataDir, "packs"), { recursive: true });
  writeFileSync(join(dataDir, "packs", "latest.json"), JSON.stringify({ version: "2026-10-15.1", engineVersion: "test", lite: null, full: [] }));
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerCookie = await signIn("owner@example.com");
  // A published power rankings week, and two workspaces Scout knows (one with an entry).
  await run("INSERT INTO power_rankings_generated (season, week, published, status, intro, intro_source, entries, packet, generated_at) VALUES (2026, '2026-w42', '2026-10-16', 'published', 'Week 42.', 'template', '[]', ?, ?)", [JSON.stringify({ season: 2026, week: "2026-w42", teams: [], comparedWith: null }), new Date().toISOString()]);
  invalidateGenerated();
  for (const [id, name] of [["ws-a", "Alpha Robotics"], ["ws-b", "Beta Bots"]]) {
    await run("INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", [id, name, new Date().toISOString(), new Date().toISOString()]);
  }
});
afterAll(() => {
  server?.close();
  for (const [k, v] of [["OWNER_EMAILS", saved.owners], ["DATA_DIR", saved.data]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* a temp dir */ }
});
beforeEach(async () => {
  process.env.OWNER_EMAILS = "owner@example.com";
  await run("DELETE FROM feature_flags");
  await run("DELETE FROM workspace_flag_overrides");
  invalidateFlags();
});

describe("the registry", () => {
  it("has exactly the seven v1 feature toggles, the kill switches apart, and only workspace scouting per workspace", () => {
    expect([...FEATURE_FLAGS]).toEqual(["livePredictions", "advancementOdds", "powerRankings", "coinFlips", "offlinePacks", "discordBot", "workspaceScouting"]);
    expect([...KILL_SWITCHES]).toEqual(["realtime", "errorReporting", "photos", "push", "autoPowerRankings", "dailyPowerRankings", "weeklyDigest"]);
    expect([...WORKSPACE_FLAGS]).toEqual(["workspaceScouting"]);
    expect(FLAGS.length).toBe(14);
  });

  it("keeps the stored values of the switches that already existed", async () => {
    await run("INSERT INTO feature_flags (name, enabled, updated_at, updated_by) VALUES ('offlinePacks', 0, ?, 'before'), ('workspaceScouting', 0, ?, 'before')", [new Date().toISOString(), new Date().toISOString()]);
    invalidateFlags();
    expect(await isEnabledFor("offlinePacks", null)).toBe(false);
    expect(await isEnabledFor("workspaceScouting", "ws-a")).toBe(false);
    const flags = (await call("GET", "/api/owner/flags", { cookie: ownerCookie })).json.flags;
    expect(flags.find((f: any) => f.name === "offlinePacks")).toMatchObject({ enabled: false, updatedBy: "before", group: "feature", scope: "global" });
  });
});

describe("resolution: workspace override, else global, else on", () => {
  // [global, override for ws-a, expected for ws-a, expected for ws-b (no override), expected with no workspace]
  const MATRIX: [boolean | null, boolean | null, boolean, boolean, boolean][] = [
    [null, null, true, true, true], // default: on
    [true, null, true, true, true],
    [false, null, false, false, false],
    [null, false, false, true, true],
    [true, false, false, true, true],
    [false, true, true, false, false], // the override wins over a global off
    [true, true, true, true, true],
    [false, false, false, false, false],
  ];
  it.each(MATRIX)("global %s, ws-a's override %s → ws-a %s, ws-b %s, no workspace %s", async (global, override, a, b, none) => {
    if (global !== null) await setFlag("workspaceScouting", global, "owner@example.com");
    if (override !== null) await setWorkspaceOverride("workspaceScouting", "ws-a", override, "owner@example.com");
    expect(await isEnabledFor("workspaceScouting", "ws-a")).toBe(a);
    expect(await isEnabledFor("workspaceScouting", "ws-b")).toBe(b);
    expect(await isEnabledFor("workspaceScouting", null)).toBe(none);
    expect(await workspaceFlags(["ws-a", "ws-b"])).toEqual({ "ws-a": { workspaceScouting: a }, "ws-b": { workspaceScouting: b } });
  });

  it("a global-only flag ignores a stray workspace row; an unregistered key is never gated", async () => {
    await setFlag("coinFlips", true, "owner@example.com");
    await run("INSERT INTO workspace_flag_overrides (cp_workspace_id, name, enabled, updated_at, updated_by) VALUES ('ws-a', 'coinFlips', 0, ?, 'x')", [new Date().toISOString()]);
    invalidateFlags();
    expect(await isEnabledFor("coinFlips", "ws-a")).toBe(true);
    expect(await hasWorkspaceOverrides()).toBe(false);
    expect(await isEnabledFor("somethingNew", "ws-a")).toBe(true);
    expect(await isEnabledFor("somethingNew", null)).toBe(true);
  });

  it("is cached like the flags: another process's override counts within the cache's lifetime", async () => {
    expect(await isEnabledFor("workspaceScouting", "ws-a")).toBe(true);
    await run("INSERT INTO workspace_flag_overrides (cp_workspace_id, name, enabled, updated_at, updated_by) VALUES ('ws-a', 'workspaceScouting', 0, ?, 'elsewhere')", [new Date().toISOString()]);
    expect(await isEnabledFor("workspaceScouting", "ws-a")).toBe(true); // still the cached value
    expect(await isEnabledFor("workspaceScouting", "ws-a", Date.now() + FLAG_TTL_MS + 1)).toBe(false);
  });
});

describe("gated routes", () => {
  it.each(GATED)("%s off: %s %s answers 403 feature_disabled, never cached", async (flag, method, path, body) => {
    await setFlag(flag, false, "owner@example.com");
    const r = await call(method, path, { body });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: "feature_disabled", feature: flag });
    expect(typeof r.json.message).toBe("string");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it.each(GATED)("%s on: %s %s is answered (never feature_disabled)", async (flag, method, path, body) => {
    await setFlag(flag, true, "owner@example.com");
    const r = await call(method, path, { body });
    expect(r.json?.error).not.toBe("feature_disabled");
    expect(r.status).not.toBe(403);
  });

  it.each(GATED_OWNER_WRITES)("%s off: the owner's %s %s is refused with 403 feature_disabled", async (flag, method, path, body) => {
    await setFlag(flag, false, "owner@example.com");
    const r = await call(method, path, { cookie: ownerCookie, body });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: "feature_disabled", feature: flag });
  });

  it("power rankings publishing off: the automatic jobs skip and Publish now is refused", async () => {
    await setFlag("powerRankings", false, "owner@example.com");
    expect((await publishNow()).status).toBe("off");
    const friday = Date.parse("2026-10-23T05:00:00Z");
    expect((await autoPowerRankingsTick(friday))?.status).toBe("off");
    expect((await dailyRefreshTick(Date.parse("2026-10-24T05:00:00Z"))).status).toBe("off");
  });

  it("the track record, public team and event data and the home headlines are never gated", async () => {
    await allOff();
    for (const p of ["/api/predict/accuracy", "/api/teams/1", "/api/events/2025/USNJQ1", "/api/events?season=2025", "/api/search?q=a", "/api/rankings", "/api/meta", "/api/home/headlines", "/api/home/overview"]) {
      const r = await call("GET", p);
      expect(r.json?.error, p).not.toBe("feature_disabled");
      expect(r.status, p).not.toBe(403);
    }
  });
});

describe("the console is never gated", () => {
  it("every owner read still answers with every v1 toggle off, and the toggles can be switched back on", async () => {
    await allOff();
    const gets = (ownerRouter().stack as any[]).filter((l) => l.route?.methods?.get).map((l) => `/api/owner${String(l.route.path).replace(/:[A-Za-z]+/g, (k) => (k === ":season" ? "2025" : "1"))}`);
    expect(gets.length).toBeGreaterThan(10);
    for (const p of gets) {
      const r = await call("GET", p, { cookie: ownerCookie });
      expect(r.json?.error, p).not.toBe("feature_disabled");
      expect(r.status, p).not.toBe(403);
    }
    for (const p of ["/api/owner/overview", "/api/owner/flags", "/api/owner/power-rankings", "/api/owner/audit", "/api/owner/workspaces"]) {
      expect((await call("GET", p, { cookie: ownerCookie })).status, p).toBe(200);
    }
    // The console's own view of power rankings still lists the week the public page doesn't show.
    expect((await call("GET", "/api/owner/power-rankings", { cookie: ownerCookie })).json.weeks.map((w: any) => w.week)).toContain("2026-w42");
    for (const f of FEATURE_FLAGS) expect((await call("PUT", `/api/owner/flags/${f}`, { cookie: ownerCookie, body: { enabled: true, confirm: true } })).status).toBe(200);
    expect((await call("GET", "/api/flags")).json.flags).toMatchObject(Object.fromEntries(FEATURE_FLAGS.map((f) => [f, true])));
  });
});

describe("switching off and back on keeps everything", () => {
  it("power rankings weeks, offline pack files and workspace rows come back exactly as they were", async () => {
    const before = {
      latest: (await call("GET", "/api/power-rankings")).text,
      week: (await call("GET", "/api/power-rankings/2026-w42")).text,
      pack: (await call("GET", "/packs/latest.json")).text,
      rows: await all("SELECT * FROM power_rankings_generated ORDER BY season, week"),
      workspaces: await all("SELECT * FROM workspaces ORDER BY id"),
    };
    expect(JSON.parse(before.week).week.week).toBe("2026-w42");
    for (const f of FEATURE_FLAGS) await call("PUT", `/api/owner/flags/${f}`, { cookie: ownerCookie, body: { enabled: false, confirm: true } });
    await call("PUT", "/api/owner/flags/workspaceScouting/workspaces/ws-a", { cookie: ownerCookie, body: { enabled: false } });
    expect((await call("GET", "/api/power-rankings")).status).toBe(403);
    expect((await call("GET", "/packs/latest.json")).status).toBe(403);
    for (const f of FEATURE_FLAGS) await call("PUT", `/api/owner/flags/${f}`, { cookie: ownerCookie, body: { enabled: true, confirm: true } });
    await call("PUT", "/api/owner/flags/workspaceScouting/workspaces/ws-a", { cookie: ownerCookie, body: { enabled: null } });
    expect({
      latest: (await call("GET", "/api/power-rankings")).text,
      week: (await call("GET", "/api/power-rankings/2026-w42")).text,
      pack: (await call("GET", "/packs/latest.json")).text,
      rows: await all("SELECT * FROM power_rankings_generated ORDER BY season, week"),
      workspaces: await all("SELECT * FROM workspaces ORDER BY id"),
    }).toEqual(before);
    expect(await all("SELECT * FROM workspace_flag_overrides")).toEqual([]);
  });
});

describe("owner routes", () => {
  it("GET lists groups, scopes, values, overrides and the workspaces (ids and names only)", async () => {
    await setWorkspaceOverride("workspaceScouting", "ws-b", false, "owner@example.com");
    const r = await call("GET", "/api/owner/flags", { cookie: ownerCookie });
    expect(r.status).toBe(200);
    expect(r.json.flags.map((f: any) => [f.name, f.group, f.scope])).toEqual(FLAGS.map((f) => [f, FEATURE_FLAGS.includes(f) ? "feature" : "kill", f === "workspaceScouting" ? "workspace" : "global"]));
    expect(r.json.overrides).toEqual([{ workspaceId: "ws-b", flag: "workspaceScouting", enabled: false, updatedAt: expect.any(String), updatedBy: "owner@example.com" }]);
    expect(r.json.workspaces).toEqual([{ id: "ws-a", name: "Alpha Robotics" }, { id: "ws-b", name: "Beta Bots" }]);
  });

  it("a feature toggle's global flip needs {confirm: true}; a kill switch's doesn't", async () => {
    const from = await auditFrom();
    expect((await call("PUT", "/api/owner/flags/coinFlips", { cookie: ownerCookie, body: { enabled: false } })).status).toBe(400);
    expect(await isEnabledFor("coinFlips", null)).toBe(true);
    expect((await call("PUT", "/api/owner/flags/realtime", { cookie: ownerCookie, body: { enabled: false } })).status).toBe(200);
    expect((await auditSince(from)).map((a) => a.action)).toEqual(["flag.set"]);
  });

  it("records every global and workspace flip with its old and new value (and nothing for a no-op)", async () => {
    const from = await auditFrom();
    await call("PUT", "/api/owner/flags/livePredictions", { cookie: ownerCookie, body: { enabled: false, confirm: true } });
    await call("PUT", "/api/owner/flags/livePredictions", { cookie: ownerCookie, body: { enabled: false, confirm: true } }); // already off
    await call("PUT", "/api/owner/flags/livePredictions", { cookie: ownerCookie, body: { enabled: true, confirm: true } });
    await call("PUT", "/api/owner/flags/workspaceScouting/workspaces/ws-a", { cookie: ownerCookie, body: { enabled: false } });
    await call("PUT", "/api/owner/flags/workspaceScouting/workspaces/ws-a", { cookie: ownerCookie, body: { enabled: true } });
    await call("PUT", "/api/owner/flags/workspaceScouting/workspaces/ws-a", { cookie: ownerCookie, body: { enabled: null } });
    const rows = await auditSince(from);
    expect(rows.map((r) => [r.action, r.old_value, r.new_value])).toEqual([
      ["flag.set", "true", "false"],
      ["flag.set", "false", "true"],
      ["flag.workspace", "null", "false"],
      ["flag.workspace", "false", "true"],
      ["flag.workspace", "true", "null"],
    ]);
    expect(JSON.parse(rows[2].details)).toEqual({ flag: "workspaceScouting", workspaceId: "ws-a", workspace: "Alpha Robotics", enabled: false });
    const shown = (await call("GET", "/api/owner/audit", { cookie: ownerCookie })).json.entries;
    expect(shown[0]).toMatchObject({ action: "flag.workspace", change: { from: true, to: null } });
  });

  it("a workspace override applies at once, only to a workspace Scout knows, only for a workspace-scoped flag", async () => {
    const r = await call("PUT", "/api/owner/flags/workspaceScouting/workspaces/ws-a", { cookie: ownerCookie, body: { enabled: false } });
    expect(r.status).toBe(200);
    expect(r.json.overrides).toEqual([expect.objectContaining({ workspaceId: "ws-a", enabled: false })]);
    expect(await isEnabledFor("workspaceScouting", "ws-a")).toBe(false); // no waiting for the cache
    expect((await call("PUT", "/api/owner/flags/workspaceScouting/workspaces/nope", { cookie: ownerCookie, body: { enabled: false } })).status).toBe(404);
    expect((await call("PUT", "/api/owner/flags/coinFlips/workspaces/ws-a", { cookie: ownerCookie, body: { enabled: false } })).status).toBe(400);
    expect((await call("PUT", "/api/owner/flags/workspaceScouting/workspaces/ws-a", { cookie: ownerCookie, body: { enabled: "off" } })).status).toBe(400);
    expect((await call("PUT", "/api/owner/flags/everything/workspaces/ws-a", { cookie: ownerCookie, body: { enabled: false } })).status).toBe(404);
    expect(await all("SELECT cp_workspace_id FROM workspace_flag_overrides")).toEqual([{ cp_workspace_id: "ws-a" }]);
  });

  it("non-owners get 403 on every flag route, and nothing changes", async () => {
    const other = await signIn(`scout-${Date.now()}@example.com`);
    for (const [m, p, b] of [["GET", "/api/owner/flags"], ["PUT", "/api/owner/flags/coinFlips", { enabled: false, confirm: true }], ["PUT", "/api/owner/flags/workspaceScouting/workspaces/ws-a", { enabled: false }]] as [string, string, unknown?][]) {
      expect((await call(m, p, { cookie: other, body: b })).status, p).toBe(403);
    }
    expect(await isEnabledFor("coinFlips", null)).toBe(true);
    expect(await all("SELECT * FROM workspace_flag_overrides")).toEqual([]);
  });
});

describe("GET /api/flags", () => {
  it("one public answer while no workspace has its own setting; private once one does", async () => {
    expect((await call("GET", "/api/flags")).headers.get("cache-control")).toBe("public, max-age=15");
    await setWorkspaceOverride("workspaceScouting", "ws-a", false, "owner@example.com");
    const r = await call("GET", "/api/flags");
    expect(r.headers.get("cache-control")).toBe("private, max-age=15");
    expect(r.json.workspaces).toBeUndefined(); // signed out: no workspaces of its own
    expect(r.json.flags.workspaceScouting).toBe(true);
  });
});
