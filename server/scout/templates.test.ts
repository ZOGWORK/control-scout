// Task 5: a workspace's scout template, against a stub Control Point. Admins save (versioned, every
// change bumps the version), members read and get 403 on a save, validation drops a bad field and
// keeps the rest, old versions stay retrievable, entries record the template they were made with,
// and a change reaches open live streams as `event: template`.
import type { AddressInfo } from "node:net";
import { get as httpGet, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { subscribeTemplate, type TemplateNotice } from "./bus";
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
  join("tpl-coach@example.com", "admin"); join("tpl-priya@example.com", "member");
  people ??= { admin: await signIn("tpl-coach@example.com", "Coach"), member: await signIn("tpl-priya@example.com", "Priya"), outsider: await signIn("tpl-olly@example.com") };
  return people;
}

const field = (over: Record<string, unknown> = {}) => ({ id: "cones", label: "Cones stacked", type: "counter", phase: "teleop", max: 30, ...over });
const url = (ws: string, q = "season=2025") => `/api/scout/workspaces/${ws}/template?${q}`;
const put = (call: Call, ws: string, body: unknown) => call("PUT", url(ws, ""), body);

describe("workspace templates", () => {
  it("never customised: version 0, built-in defaults, and reading creates nothing", async () => {
    const { member } = await team("401");
    const r = await member("GET", url("401"));
    expect(r.status).toBe(200);
    expect(r.json.template).toMatchObject({ workspaceId: "401", season: 2025, version: 0, match: null, pit: null });
    expect(await get("SELECT 1 FROM workspaces WHERE cp_workspace_id = ?", ["401"])).toBeUndefined();
  });

  it("an admin saves (creating the mirror row); members read it; each change bumps the version, a no-op doesn't", async () => {
    const { admin, member } = await team("402");
    const r1 = await put(admin, "402", { season: 2025, match: [field()], baseVersion: 0 });
    expect(r1.status).toBe(200);
    expect(r1.json).toMatchObject({ changed: true, dropped: [], template: { version: 1, settingsVersion: 1, match: [field()], pit: null, updatedBy: "Coach" } });
    expect((await member("GET", url("402"))).json.template).toMatchObject({ version: 1, match: [field()] });

    const r2 = await put(admin, "402", { season: 2025, pit: [{ id: "arm", label: "Has an arm", type: "toggle", phase: "pit" }], baseVersion: 1 });
    expect(r2.json.template).toMatchObject({ version: 2, settingsVersion: 2, match: [field()], pit: [{ id: "arm" }] });

    const same = await put(admin, "402", { season: 2025, match: [field()], baseVersion: 2 });
    expect(same.json).toMatchObject({ changed: false, template: { version: 2, settingsVersion: 2 } });

    // Another season has its own version; the workspace's settings version counts every change.
    const other = await put(admin, "402", { season: 2024, match: [field({ id: "samples", label: "Samples" })] });
    expect(other.json.template).toMatchObject({ season: 2024, version: 1, settingsVersion: 3 });
    expect((await member("GET", url("402"))).json.template).toMatchObject({ version: 2, settingsVersion: 3 });
    // Stored on the mirror row's settings JSON (Task 6 adds its keys beside scoutTemplate).
    const row = await get<{ settings: string; settings_version: number }>("SELECT settings, settings_version FROM workspaces WHERE cp_workspace_id = ?", ["402"]);
    expect(Number(row!.settings_version)).toBe(3);
    expect(Object.keys(JSON.parse(row!.settings).scoutTemplate)).toEqual(["2024", "2025"]);
  });

  it("a member gets 403 on a save, and so does someone outside the workspace; signed out is 401; nothing is written", async () => {
    const { member, outsider } = await team("403");
    expect((await put(member, "403", { season: 2025, match: [field()] })).status).toBe(403);
    expect((await put(outsider, "403", { season: 2025, match: [field()] })).status).toBe(403);
    expect((await outsider("GET", url("403"))).status).toBe(403);
    expect((await client()("PUT", url("403", ""), { season: 2025, match: [field()] })).status).toBe(401);
    expect(await get("SELECT 1 FROM workspaces WHERE cp_workspace_id = ?", ["403"])).toBeUndefined();
  });

  it("CSRF: a save must be JSON", async () => {
    const { admin } = await team("404");
    const r = await fetch(base + url("404", ""), { method: "PUT", headers: { Cookie: admin.cookie(), "Content-Type": "text/plain" }, body: JSON.stringify({ season: 2025, match: [field()] }) });
    expect(r.status).toBe(415);
  });

  it("validation drops a bad field and keeps the rest: numbers clamped, unknown properties dropped", async () => {
    const { admin } = await team("405");
    const r = await put(admin, "405", {
      season: 2025,
      match: [
        field({ max: 5000, min: -3, colour: "red" }),            // clamped, extra property dropped
        { id: "bad", label: "No type", phase: "auto" },             // dropped
        { id: "rate", label: "  Driver   ", type: "rating", phase: "overall", max: 99 },
        { id: "pick", label: "Park", type: "choice", phase: "endgame", options: ["Full", "full", " Partial "] },
        { id: "cones", label: "Repeated id", type: "toggle", phase: "auto" }, // dropped
        { id: "pitty", label: "Wrong phase", type: "toggle", phase: "pit" },  // dropped (pit phase on a match template)
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.template.match).toEqual([
      { id: "cones", label: "Cones stacked", type: "counter", phase: "teleop", max: 999 },
      { id: "rate", label: "Driver", type: "rating", phase: "overall", max: 10 },
      { id: "pick", label: "Park", type: "choice", phase: "endgame", options: ["Full", "Partial"] },
    ]);
    expect(r.json.dropped.map((d: any) => [d.kind, d.id, d.reason])).toEqual([
      ["match", "bad", "unknown type"], ["match", "cones", "repeated id"], ["match", "pitty", "phase doesn't fit this kind"],
    ]);
  });

  it("a list with nothing usable is refused (nothing saved); bad input shapes are 400", async () => {
    const { admin } = await team("406");
    expect((await put(admin, "406", { season: 2025, match: [{ id: "x" }] })).status).toBe(400);
    expect((await put(admin, "406", { season: 2025, match: "nope" })).status).toBe(400);
    expect((await put(admin, "406", { match: [field()] })).status).toBe(400);
    expect((await admin("GET", url("406", "season=abc"))).status).toBe(400);
    expect((await admin("GET", url("406"))).json.template.version).toBe(0);
  });

  it("two admins: a save on top of an old version is a 409 with the current template", async () => {
    const { admin } = await team("407");
    await put(admin, "407", { season: 2025, match: [field()], baseVersion: 0 });
    const stale = await put(admin, "407", { season: 2025, match: [field({ label: "Mine" })], baseVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.json.template).toMatchObject({ version: 1, match: [field()] });
  });

  it("old versions stay retrievable (immutable), and null puts a kind back to the built-in default", async () => {
    const { admin, member } = await team("408");
    await put(admin, "408", { season: 2025, match: [field()] });
    await put(admin, "408", { season: 2025, match: null });
    expect((await member("GET", url("408"))).json.template).toMatchObject({ version: 2, match: null });
    const v1 = await member("GET", url("408", "season=2025&version=1"));
    expect(v1.json.template).toMatchObject({ version: 1, match: [field()], updatedBy: "Coach" });
    expect((await member("GET", url("408", "season=2025&version=9"))).status).toBe(404);
    expect((await member("GET", url("408", "season=2025&version=0"))).json.template).toMatchObject({ version: 0, match: null });
    expect((await all("SELECT version FROM workspace_template_versions WHERE season = 2025 AND workspace_id = (SELECT id FROM workspaces WHERE cp_workspace_id = '408') ORDER BY version")).map((r: any) => Number(r.version))).toEqual([1, 2]);
  });

  it("cached by version: an unchanged template revalidates as 304", async () => {
    const { admin, member } = await team("409");
    await put(admin, "409", { season: 2025, match: [field()] });
    const first = await member("GET", url("409"));
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    // As a browser's cache revalidates (Node's fetch would add Cache-Control: no-cache to a conditional request).
    const revalidate = () => new Promise<number>((resolve, reject) => {
      httpGet(base + url("409"), { headers: { Cookie: member.cookie(), "If-None-Match": etag } }, (res) => { res.resume(); resolve(res.statusCode!); }).on("error", reject);
    });
    expect(await revalidate()).toBe(304);
    await put(admin, "409", { season: 2025, match: [field({ label: "Changed" })] });
    expect(await revalidate()).toBe(200);
  });

  it("entries record the template id and version they were made with; an edit from an older build keeps it", async () => {
    const { admin, member } = await team("410");
    await put(admin, "410", { season: 2025, match: [field()] });
    const e = { uuid: "tplentry0001", season: 2025, team: 18360, eventCode: null, matchLabel: "Q1", kind: "match", data: { cones: 4 }, notes: "", updatedAt: 1000, templateId: "ws:410:2025:match", templateVersion: 1 };
    const r = await member("POST", "/api/me/scout/sync", { workspaceId: "410", entries: [e] });
    expect(r.json.results[0]).toMatchObject({ ok: true, entry: { templateId: "ws:410:2025:match", templateVersion: 1 } });
    const { templateId: _t, templateVersion: _v, ...older } = e;
    await member("POST", "/api/me/scout/sync", { workspaceId: "410", entries: [{ ...older, updatedAt: 2000, notes: "edited" }] });
    expect((await member("GET", "/api/scout/sync?workspaceId=410&since=0")).json.entries[0]).toMatchObject({ notes: "edited", templateId: "ws:410:2025:match", templateVersion: 1 });
  });

  it("a change is announced on the workspace's live channel (season, version, settings version)", async () => {
    const { admin } = await team("411");
    const heard: TemplateNotice[] = [];
    const off = subscribeTemplate("411", (n) => heard.push(n));
    try {
      await put(admin, "411", { season: 2025, match: [field()] });
      await put(admin, "411", { season: 2025, match: [field()] }); // no change: no notice
    } finally { off(); }
    expect(heard).toEqual([{ season: 2025, version: 1, settingsVersion: 1 }]);
  });

  it("an open stream passes the change on as `event: template`", async () => {
    const { admin, member } = await team("412");
    const ac = new AbortController();
    const res = await fetch(`${base}/api/scout/stream?workspaceId=412`, { headers: { Cookie: member.cookie() }, signal: ac.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const until = async (re: RegExp) => { while (!re.test(buf)) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } return re.exec(buf); };
    try {
      await until(/event: ready/);
      await put(admin, "412", { season: 2025, match: [field()] });
      const m = await until(/event: template\ndata: (.*)\n\n/);
      expect(JSON.parse(m![1])).toEqual({ season: 2025, version: 1, settingsVersion: 1 });
    } finally { ac.abort(); }
  });

  it("workspace scouting paused in the owner portal: reads and saves answer 503", async () => {
    const { admin } = await team("413");
    await setFlag("workspaceScouting", false, "owner@test");
    try {
      expect((await admin("GET", url("413"))).status).toBe(503);
      expect((await put(admin, "413", { season: 2025, match: [field()] })).status).toBe(503);
    } finally { await setFlag("workspaceScouting", true, "owner@test"); }
  });
});
