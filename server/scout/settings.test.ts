// Task 6: a workspace's settings (Tier 2), against a stub Control Point. Admins save, members read
// and get 403 on a save, a bad field is dropped while the rest are kept, every change bumps the
// settings version (shared with template saves), a stale baseVersion is a 409, personal settings
// (theme, density, notifications) can never be stored on a workspace, and a change reaches open
// live streams as `event: settings`.
import type { AddressInfo } from "node:net";
import { get as httpGet, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { subscribeSettings, type SettingsNotice } from "./bus";
import { setFlag } from "../flags";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 7000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
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
  setMailer(null); scout?.close(); cp?.close();
  for (const k of ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL"]) delete process.env[k];
});
beforeEach(() => {
  clearInfoCache();
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});

function client() {
  let cookie = "";
  const call = async (method: string, path: string, json?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, {
      method, headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k] = kv.split("=");
      cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${k}=`)), ...(kv.endsWith("=") ? [] : [kv])].join("; ");
    }
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null, headers: r.headers };
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

let people: { member: Call; admin: Call; outsider: Call } | null = null;
/** Workspace `ws`: Coach is its admin, Priya a member; Olly is in no workspace. */
async function team(ws: string) {
  const join = (email: string, role: "admin" | "member") => { const a = accountFor(email); a.workspaces = [...(a.workspaces ?? []), { id: ws, name: "Gearheads", role }]; };
  join("set-coach@example.com", "admin"); join("set-priya@example.com", "member");
  people ??= { admin: await signIn("set-coach@example.com", "Coach"), member: await signIn("set-priya@example.com", "Priya"), outsider: await signIn("set-olly@example.com") };
  return people;
}

const url = (ws: string) => `/api/scout/workspaces/${ws}/settings`;
const put = (call: Call, ws: string, body: unknown) => call("PUT", url(ws), body);
const tplPut = (call: Call, ws: string, body: unknown) => call("PUT", `/api/scout/workspaces/${ws}/template`, body);
const POLICY = { create: "members", edit: "members", delete: "author-or-admin" };
const stored = async (ws: string) => JSON.parse((await get<{ settings: string }>("SELECT settings FROM workspaces WHERE cp_workspace_id = ?", [ws]))!.settings);

describe("workspace settings", () => {
  it("never set: version 0, no defaults, the fixed entry policy; reading creates nothing", async () => {
    const { member } = await team("501");
    const r = await member("GET", url("501"));
    expect(r.status).toBe(200);
    expect(r.json.settings).toEqual({ workspaceId: "501", settingsVersion: 0, defaults: { season: null, eventCode: null }, entryPolicy: POLICY, updatedAt: null, updatedBy: null });
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect(await get("SELECT 1 FROM workspaces WHERE cp_workspace_id = ?", ["501"])).toBeUndefined();
  });

  it("an admin saves (creating the mirror row), members read it, each change bumps the version and a no-op doesn't", async () => {
    const { admin, member } = await team("502");
    const r1 = await put(admin, "502", { defaults: { season: 2025, eventCode: " usnyq1 " }, baseVersion: 0 });
    expect(r1.status).toBe(200);
    expect(r1.json).toMatchObject({ changed: true, dropped: [], settings: { settingsVersion: 1, defaults: { season: 2025, eventCode: "USNYQ1" }, entryPolicy: POLICY, updatedBy: "Coach" } });
    expect((await member("GET", url("502"))).json.settings).toMatchObject({ settingsVersion: 1, defaults: { season: 2025, eventCode: "USNYQ1" } });

    // Absent keeps a field, null clears it.
    const r2 = await put(admin, "502", { defaults: { eventCode: null }, baseVersion: 1 });
    expect(r2.json.settings).toMatchObject({ settingsVersion: 2, defaults: { season: 2025, eventCode: null } });
    const same = await put(admin, "502", { defaults: { season: 2025 }, baseVersion: 2 });
    expect(same.json).toMatchObject({ changed: false, settings: { settingsVersion: 2 } });

    // Stored beside the template with the policy written explicitly; a template save keeps the defaults and bumps the same version.
    await tplPut(admin, "502", { season: 2025, match: [{ id: "cones", label: "Cones", type: "counter", phase: "teleop" }] });
    const row = await get<{ settings_version: number }>("SELECT settings_version FROM workspaces WHERE cp_workspace_id = ?", ["502"]);
    expect(Number(row!.settings_version)).toBe(3);
    const s = await stored("502");
    expect(Object.keys(s).sort()).toEqual(["defaults", "entryPolicy", "scoutTemplate"]);
    expect(s.entryPolicy).toEqual(POLICY);
    expect(s.defaults).toMatchObject({ season: 2025, eventCode: null });
    // …and a settings save keeps the template.
    expect((await put(admin, "502", { defaults: { eventCode: "USNYQ2" }, baseVersion: 3 })).json.settings.settingsVersion).toBe(4);
    expect(Object.keys((await stored("502")).scoutTemplate)).toEqual(["2025"]);
  });

  it("a member gets 403 on a save, an outsider 403 on both, signed out 401; nothing is written", async () => {
    const { member, outsider } = await team("503");
    const m = await put(member, "503", { defaults: { season: 2025 }, baseVersion: 0 });
    expect(m.status).toBe(403);
    expect(m.json.error).toMatch(/Only workspace admins/);
    expect((await put(outsider, "503", { defaults: { season: 2025 }, baseVersion: 0 })).status).toBe(403);
    expect((await outsider("GET", url("503"))).status).toBe(403);
    expect((await client()("PUT", url("503"), { defaults: { season: 2025 }, baseVersion: 0 })).status).toBe(401);
    expect((await client()("GET", url("503"))).status).toBe(401);
    expect(await get("SELECT 1 FROM workspaces WHERE cp_workspace_id = ?", ["503"])).toBeUndefined();
  });

  it("CSRF: a save must be JSON", async () => {
    const { admin } = await team("504");
    const r = await fetch(base + url("504"), { method: "PUT", headers: { Cookie: admin.cookie(), "Content-Type": "text/plain" }, body: JSON.stringify({ defaults: { season: 2025 }, baseVersion: 0 }) });
    expect(r.status).toBe(415);
  });

  it("a bad field is dropped and the rest kept; unknown fields dropped; personal settings refused; the policy can't change", async () => {
    const { admin } = await team("505");
    const r = await put(admin, "505", {
      defaults: { season: 1850, eventCode: "USCAFFL", colour: "red" },
      theme: "light", density: "compact", notify: { upsets: true }, ambient: false,
      entryPolicy: { create: "admins", edit: "admins", delete: "admins" },
      bogus: 1, baseVersion: 0,
    });
    expect(r.status).toBe(200);
    expect(r.json.settings).toMatchObject({ settingsVersion: 1, defaults: { season: null, eventCode: "USCAFFL" }, entryPolicy: POLICY });
    expect(r.json.dropped.map((d: any) => d.field).sort()).toEqual(["ambient", "bogus", "defaults.colour", "defaults.season", "density", "entryPolicy", "notify", "theme"]);
    expect(JSON.stringify(await stored("505"))).not.toMatch(/theme|density|notify|ambient|bogus|colour/);
    // A bad event code alone: dropped, the season saved.
    const r2 = await put(admin, "505", { defaults: { season: 2024, eventCode: "no spaces!" }, baseVersion: 1 });
    expect(r2.json.settings.defaults).toEqual({ season: 2024, eventCode: "USCAFFL" });
    expect(r2.json.dropped).toEqual([{ field: "defaults.eventCode", reason: expect.stringMatching(/event code/) }]);
  });

  it("a stale baseVersion is a 409 with the current settings (a template save in between counts); a missing one is 400", async () => {
    const { admin } = await team("506");
    await put(admin, "506", { defaults: { season: 2025 }, baseVersion: 0 });
    const stale = await put(admin, "506", { defaults: { season: 2024 }, baseVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.json.settings).toMatchObject({ settingsVersion: 1, defaults: { season: 2025 } });
    await tplPut(admin, "506", { season: 2025, match: [{ id: "cones", label: "Cones", type: "counter", phase: "teleop" }] });
    expect((await put(admin, "506", { defaults: { season: 2024 }, baseVersion: 1 })).status).toBe(409);
    expect((await put(admin, "506", { defaults: { season: 2024 }, baseVersion: 2 })).status).toBe(200);
    expect((await put(admin, "506", { defaults: { season: 2023 } })).status).toBe(400);
    expect((await put(admin, "506", { defaults: { season: 2023 }, baseVersion: "3" })).status).toBe(400);
  });

  it("cached by version: unchanged settings revalidate as 304, a change doesn't", async () => {
    const { admin, member } = await team("507");
    await put(admin, "507", { defaults: { season: 2025 }, baseVersion: 0 });
    const etag = (await member("GET", url("507"))).headers.get("etag")!;
    expect(etag).toBeTruthy();
    // As a browser's cache revalidates (Node's fetch would add Cache-Control: no-cache to a conditional request).
    const revalidate = () => new Promise<number>((resolve, reject) => {
      httpGet(base + url("507"), { headers: { Cookie: member.cookie(), "If-None-Match": etag } }, (res) => { res.resume(); resolve(res.statusCode!); }).on("error", reject);
    });
    expect(await revalidate()).toBe(304);
    await put(admin, "507", { defaults: { season: 2024 }, baseVersion: 1 });
    expect(await revalidate()).toBe(200);
  });

  it("a change is announced on the live channel, and an open stream passes it on as `event: settings`", async () => {
    const { admin, member } = await team("508");
    const heard: SettingsNotice[] = [];
    const off = subscribeSettings("508", (n) => heard.push(n));
    const ac = new AbortController();
    try {
      const res = await fetch(`${base}/api/scout/stream?workspaceId=508`, { headers: { Cookie: member.cookie() }, signal: ac.signal });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const until = async (re: RegExp) => { while (!re.test(buf)) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } return re.exec(buf); };
      await until(/event: ready/);
      await put(admin, "508", { defaults: { season: 2025 }, baseVersion: 0 });
      await put(admin, "508", { defaults: { season: 2025 }, baseVersion: 1 }); // no change: no notice
      const m = await until(/event: settings\ndata: (.*)\n\n/);
      expect(JSON.parse(m![1])).toEqual({ settingsVersion: 1 });
    } finally { off(); ac.abort(); }
    expect(heard).toEqual([{ settingsVersion: 1 }]);
  });

  it("workspace scouting paused in the owner portal: reads and saves answer 503", async () => {
    const { admin } = await team("509");
    await setFlag("workspaceScouting", false, "owner@test");
    try {
      expect((await admin("GET", url("509"))).status).toBe(503);
      expect((await put(admin, "509", { defaults: { season: 2025 }, baseVersion: 0 })).status).toBe(503);
    } finally { await setFlag("workspaceScouting", true, "owner@test"); }
  });
});
