// Task 11: a workspace's shared pick list, against a stub Control Point. Any member adds, removes,
// reorders and notes (attributed in the activity feed, live to the other members' streams, one inbox line);
// concurrent reorders merge the same way every time; the note is last-write-wins and attributed; outsiders
// get 403, paused 503; the members' personal shortlists are never touched.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { subscribePicklist, type PicklistNotice } from "./bus";
import { closeAllStreams } from "./stream";
import { inboxSettled } from "../inbox/inbox";
import { setFlag } from "../flags";

const KEY = "k".repeat(40);
const S = 2025;
let scout: Server, cp: Server;
let base = "", cpBase = "";
const codes = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 9100 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
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
  await run("INSERT INTO teams (number, name) VALUES (101, 'Alpha'), (102, 'Beta'), (103, 'Gamma'), (104, 'Delta'), (105, 'Epsilon'), (18360, 'Pyro')");
  await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, wins, losses, ties, matches, events) VALUES (?, 101, 80, 20, 45, 15, 3, 500, 8, 2, 0, 10, 2)", [S]);
  setMailer(async (to, _s, text) => { codes.set(to, /\b(\d{6})\b/.exec(text)![1]); });
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
afterEach(() => { closeAllStreams(); });

function client() {
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

let people: { coach: Call; priya: Call; marcus: Call; olly: Call } | null = null;
/** Workspace `ws`: Coach its admin, Priya and Marcus members, Olly in no workspace (signed in once, for every test). */
async function team(ws: string) {
  const join = (email: string, role: "admin" | "member") => { const a = accountFor(email); a.workspaces = [...(a.workspaces ?? []), { id: ws, name: "Gearheads", role }]; };
  join("pl-coach@example.com", "admin"); join("pl-priya@example.com", "member"); join("pl-marcus@example.com", "member");
  people ??= { coach: await signIn("pl-coach@example.com", "Coach"), priya: await signIn("pl-priya@example.com", "Priya"), marcus: await signIn("pl-marcus@example.com", "Marcus"), olly: await signIn("pl-olly@example.com") };
  const t = { ...people, ids: { coach: accountFor("pl-coach@example.com").id, priya: accountFor("pl-priya@example.com").id, marcus: accountFor("pl-marcus@example.com").id } };
  // Each member reads once, so their membership is cached (what the inbox fans out to).
  for (const c of [t.coach, t.priya, t.marcus]) expect((await c("GET", `${url(ws)}?season=${S}`)).status).toBe(200);
  return t;
}

const url = (ws: string) => `/api/scout/workspaces/${ws}/picklist`;
const op = (call: Call, ws: string, body: Record<string, unknown>) => call("POST", url(ws), { season: S, ...body });
const order = (r: { json: any }) => (r.json.list.picks as { team: number }[]).map((p) => p.team);
const activity = async (ws: string) => (await all<{ type: string; actor_name: string; details: string }>(
  "SELECT a.type, a.actor_name, a.details FROM workspace_activity a JOIN workspaces w ON w.id = a.workspace_id WHERE w.cp_workspace_id = ? AND a.type LIKE 'picklist.%' ORDER BY a.id", [ws]))
  .map((r) => ({ type: r.type, actor: r.actor_name, ...JSON.parse(r.details) }));

/** An open stream for a member, read raw: wait for what you need with until(). */
async function stream(call: Call, ws: string) {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/scout/stream?workspaceId=${ws}`, { headers: { Cookie: call.cookie() }, signal: ac.signal });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const until = async (re: RegExp) => { while (!re.test(buf)) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } return re.exec(buf); };
  const all = (re: RegExp) => [...buf.matchAll(re)];
  await until(/event: ready/);
  return { until, all, close: () => ac.abort() };
}

describe("shared pick list", () => {
  it("never changed: empty, version 0, and reading creates nothing", async () => {
    const { priya } = await team("1101");
    const r = await priya("GET", `${url("1101")}?season=${S}`);
    expect(r.json.list).toEqual({ workspaceId: "1101", season: S, version: 0, picks: [] });
    expect(await get("SELECT 1 FROM workspaces WHERE cp_workspace_id = ?", ["1101"])).toBeUndefined();
  });

  it("any member adds, reorders and removes; each change is attributed, logged, and reaches another member's open stream live", async () => {
    const { priya, marcus, coach, ids } = await team("1102");
    const heard: PicklistNotice[] = [];
    const off = subscribePicklist("1102", (n) => heard.push(n));
    const live = await stream(coach, "1102");
    try {
      const a = await op(priya, "1102", { op: "add", team: 101 });
      expect(a.status).toBe(200);
      expect(a.json).toMatchObject({ changed: true, list: { version: 1, picks: [{ team: 101, rank: 1, addedBy: { accountId: ids.priya, name: "Priya" }, note: "", noteBy: null }] } });
      expect(order(await op(marcus, "1102", { op: "add", team: 102 }))).toEqual([101, 102]);
      expect(order(await op(marcus, "1102", { op: "add", team: 103, beforeTeam: 101 }))).toEqual([103, 101, 102]);
      expect(order(await op(priya, "1102", { op: "move", team: 102, beforeTeam: 103 }))).toEqual([102, 103, 101]);
      const rm = await op(coach, "1102", { op: "remove", team: 103 });
      expect(rm.json.list).toMatchObject({ version: 5, picks: [{ team: 102, rank: 1 }, { team: 101, rank: 2 }] });

      // Everyone reads the same list.
      expect((await coach("GET", `${url("1102")}?season=${S}`)).json.list).toEqual(rm.json.list);
      // The coach's stream heard each version, the latest last, plus the activity items.
      const m = await live.until(/event: picklist\ndata: (\{[^\n]*"version":5[^\n]*\})\n\n/);
      expect(JSON.parse(m![1])).toEqual(rm.json.list);
      expect(live.all(/event: picklist\n/g)).toHaveLength(5);
      expect(live.all(/id: [^\n]*\nevent: picklist/g)).toHaveLength(0); // no id: it never moves the entry cursor
      await live.until(/event: activity\ndata: [^\n]*picklist\.removed/);
      expect(heard.map((n) => n.version)).toEqual([1, 2, 3, 4, 5]);
    } finally { off(); live.close(); }

    expect(await activity("1102")).toEqual([
      { type: "picklist.added", actor: "Priya", season: S, team: 101, rank: 1 },
      { type: "picklist.added", actor: "Marcus", season: S, team: 102, rank: 2 },
      { type: "picklist.added", actor: "Marcus", season: S, team: 103, rank: 1 },
      { type: "picklist.moved", actor: "Priya", season: S, team: 102, from: 3, to: 1, teams: [102] },
      { type: "picklist.removed", actor: "Coach", season: S, team: 103, rank: 2 },
    ]);
  });

  it("a member's rapid reorders coalesce into one moved item; another member's move is its own", async () => {
    const { priya, marcus } = await team("1103");
    for (const t of [101, 102, 103, 104]) await op(priya, "1103", { op: "add", team: t });
    await op(marcus, "1103", { op: "move", team: 104, beforeTeam: 101 });
    await op(marcus, "1103", { op: "move", team: 103, beforeTeam: 101 });
    await op(marcus, "1103", { op: "move", team: 104, beforeTeam: null });
    await op(priya, "1103", { op: "move", team: 101, beforeTeam: null });
    const moved = (await activity("1103")).filter((a) => a.type === "picklist.moved");
    expect(moved).toHaveLength(2);
    expect(moved[0]).toMatchObject({ actor: "Marcus", team: 104, to: 4, edits: 3, teams: [104, 103] });
    expect(moved[1]).toMatchObject({ actor: "Priya", team: 101, teams: [101] });
    expect(moved[1].edits).toBeUndefined();
    // Read back as the feed lists them (the coalesced item replaced the earlier ones).
    const feed = (await priya("GET", "/api/scout/workspaces/1103/activity")).json.items.filter((i: any) => i.type === "picklist.moved");
    expect(feed).toHaveLength(2);
  });

  it("concurrent reorders merge deterministically: both apply, in arrival order, and everyone ends on the same list", async () => {
    const { priya, marcus, coach } = await team("1104");
    for (const t of [101, 102, 103, 104]) await op(coach, "1104", { op: "add", team: t });
    // Made against the same list (version 4), sent at once.
    const [a, b] = await Promise.all([
      op(priya, "1104", { op: "move", team: 104, beforeTeam: 101 }),
      op(marcus, "1104", { op: "move", team: 102, beforeTeam: null }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // Either arrival order gives the same list: each move names teams, not positions.
    const final = (await coach("GET", `${url("1104")}?season=${S}`)).json.list;
    expect(final.picks.map((p: any) => p.team)).toEqual([104, 101, 103, 102]);
    expect(final.picks.map((p: any) => p.rank)).toEqual([1, 2, 3, 4]);
    expect(final.version).toBe(6);
    expect([a.json.list.version, b.json.list.version].sort()).toEqual([5, 6]);

    // Two members moving the same team at once: the later arrival wins, the list stays whole.
    const [c, d] = await Promise.all([
      op(priya, "1104", { op: "move", team: 103, beforeTeam: 104 }),
      op(marcus, "1104", { op: "move", team: 103, beforeTeam: null }),
    ]);
    const last = [c, d].sort((x, y) => x.json.list.version - y.json.list.version)[1];
    const after = (await coach("GET", `${url("1104")}?season=${S}`)).json.list;
    expect(after.picks.map((p: any) => p.team)).toEqual(last.json.list.picks.map((p: any) => p.team));
    expect([...after.picks.map((p: any) => p.team)].sort()).toEqual([101, 102, 103, 104]);

    // A move whose anchor was removed meanwhile can't mean anything: 409 with the current list, nothing changed.
    await op(coach, "1104", { op: "remove", team: 101 });
    const stale = await op(priya, "1104", { op: "move", team: 102, beforeTeam: 101 });
    expect(stale.status).toBe(409);
    expect(stale.json.list.picks.map((p: any) => p.team)).not.toContain(101);
    expect(stale.json.list.version).toBe(after.version + 1);
    // Adding what's there, or removing what's gone, is not an error and changes nothing.
    const again = await op(marcus, "1104", { op: "remove", team: 101 });
    expect(again.json).toMatchObject({ changed: false, list: { version: after.version + 1 } });
  });

  it("the shared note: last write wins, attributed to its writer with the time; logged; clearing it works", async () => {
    const { priya, marcus, ids } = await team("1105");
    await op(priya, "1105", { op: "add", team: 18360 });
    const t0 = Date.now();
    await op(priya, "1105", { op: "note", team: 18360, note: "  Strong auto  " });
    const r = await op(marcus, "1105", { op: "note", team: 18360, note: "Endgame unreliable" });
    const p = r.json.list.picks[0];
    expect(p).toMatchObject({ note: "Endgame unreliable", noteBy: { accountId: ids.marcus, name: "Marcus" }, addedBy: { name: "Priya" } });
    expect(p.noteUpdatedAt).toBeGreaterThanOrEqual(t0);
    expect((await priya("GET", `${url("1105")}?season=${S}`)).json.list.picks[0].note).toBe("Endgame unreliable");
    const noted = (await activity("1105")).filter((a) => a.type === "picklist.noted");
    expect(noted.map((n) => [n.actor, n.excerpt])).toEqual([["Priya", "Strong auto"], ["Marcus", "Endgame unreliable"]]);
    // Same text again: nothing changes, nothing logged.
    expect((await op(marcus, "1105", { op: "note", team: 18360, note: "Endgame unreliable" })).json.changed).toBe(false);
    expect((await op(marcus, "1105", { op: "note", team: 18360, note: "" })).json.list.picks[0]).toMatchObject({ note: "", noteBy: { name: "Marcus" } });
    // A note on a team that isn't on the list: 409.
    expect((await op(marcus, "1105", { op: "note", team: 101, note: "x" })).status).toBe(409);
  });

  it("Undo of a remove brings the pick back as it was (who added it, its note); adding it again otherwise starts afresh", async () => {
    const { priya, marcus, ids } = await team("1112");
    await op(priya, "1112", { op: "add", team: 101 });
    await op(priya, "1112", { op: "add", team: 102 });
    await op(priya, "1112", { op: "note", team: 101, note: "Keep" });
    const kept = (await priya("GET", `${url("1112")}?season=${S}`)).json.list.picks[0];
    await op(marcus, "1112", { op: "remove", team: 101 });
    expect(order(await priya("GET", `${url("1112")}?season=${S}`))).toEqual([102]);
    const back = await op(marcus, "1112", { op: "add", team: 101, beforeTeam: 102, restore: true });
    expect(back.json.list.picks[0]).toEqual({ ...kept, rank: 1 });
    expect(back.json.list.picks[0]).toMatchObject({ addedBy: { accountId: ids.priya }, note: "Keep", noteBy: { name: "Priya" } });
    expect((await activity("1112")).at(-1)).toMatchObject({ type: "picklist.added", actor: "Marcus", team: 101, restored: true });
    await op(marcus, "1112", { op: "remove", team: 101 });
    const fresh = await op(marcus, "1112", { op: "add", team: 101 });
    expect(fresh.json.list.picks.find((p: any) => p.team === 101)).toMatchObject({ addedBy: { accountId: ids.marcus }, note: "", noteBy: null });
  });

  it("the inline stats come from the Shortlist's own request for the picks", async () => {
    const { priya } = await team("1106");
    await op(priya, "1106", { op: "add", team: 101 });
    const teams = (await priya("GET", `${url("1106")}?season=${S}`)).json.list.picks.map((p: any) => p.team).join(",");
    const stats = (await priya("GET", `/api/shortlist?teams=${teams}&season=${S}`)).json.teams;
    expect(stats[0]).toMatchObject({ team: 101, opr: 80, oprRank: 3 });
  });

  it("copy from my shortlist adds the teams not yet on the list, at the end, as one item; the personal shortlist is untouched", async () => {
    const { priya, coach } = await team("1107");
    expect((await priya("PUT", "/api/me/state/bookmarks", { value: [103, 101, 999999, 102], updatedAt: Date.now() })).status).toBe(200);
    const before = (await priya("GET", "/api/me/state")).json.state;
    await op(coach, "1107", { op: "add", team: 101 });
    const r = await op(priya, "1107", { op: "import", teams: [103, 101, 999999, 102] });
    expect(order(r)).toEqual([101, 103, 102]);
    expect((await activity("1107")).at(-1)).toMatchObject({ type: "picklist.added", actor: "Priya", teams: [103, 102], count: 2, from: "shortlist" });
    await op(priya, "1107", { op: "remove", team: 103 });
    await op(priya, "1107", { op: "move", team: 102, beforeTeam: 101 });
    await op(priya, "1107", { op: "note", team: 102, note: "hi" });
    expect((await priya("GET", "/api/me/state")).json.state).toEqual(before);
    const rows = await all<{ key: string }>("SELECT key FROM user_state");
    expect(rows.map((x) => x.key).filter((k) => /pick/i.test(k))).toEqual([]);
  });

  it("the other members get one unread inbox line per workspace, linking to the pick list; the actor gets none", async () => {
    const { priya, marcus, coach } = await team("1108");
    await op(priya, "1108", { op: "add", team: 101 });
    await op(priya, "1108", { op: "add", team: 102 });
    await op(priya, "1108", { op: "move", team: 102, beforeTeam: 101 });
    await inboxSettled();
    for (const c of [marcus, coach]) {
      const items = (await c("GET", "/api/inbox")).json.items.filter((i: any) => i.category === "picklist" && i.workspaceId === "1108");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ title: "Priya updated the pick list", link: `/scout?space=1108&season=${S}&view=picklist`, read: false });
    }
    expect((await priya("GET", "/api/inbox")).json.items.filter((i: any) => i.category === "picklist" && i.workspaceId === "1108")).toEqual([]);
  });

  it("refuses: outsiders 403, signed out 401, not JSON 415, bad bodies and unknown teams 400; paused 503", async () => {
    const { priya, olly } = await team("1109");
    expect((await olly("GET", `${url("1109")}?season=${S}`)).status).toBe(403);
    expect((await op(olly, "1109", { op: "add", team: 101 })).status).toBe(403);
    expect((await client()("GET", `${url("1109")}?season=${S}`)).status).toBe(401);
    expect((await client()("POST", url("1109"), { season: S, op: "add", team: 101 })).status).toBe(401);
    const form = await fetch(base + url("1109"), { method: "POST", headers: { Cookie: priya.cookie(), "Content-Type": "text/plain" }, body: JSON.stringify({ season: S, op: "add", team: 101 }) });
    expect(form.status).toBe(415);
    expect((await priya("GET", url("1109"))).status).toBe(400);
    expect((await op(priya, "1109", { op: "add", team: "101" })).status).toBe(400);
    expect((await op(priya, "1109", { op: "fly", team: 101 })).status).toBe(400);
    expect((await op(priya, "1109", { op: "move", team: 101 })).status).toBe(400);
    expect((await op(priya, "1109", { op: "add", team: 4242 })).json.error).toMatch(/no team 4242/);
    expect((await priya("POST", url("1109"), { op: "add", team: 101 })).status).toBe(400);
    expect(await get("SELECT 1 FROM workspace_picklist p JOIN workspaces w ON w.id = p.workspace_id WHERE w.cp_workspace_id = '1109'")).toBeUndefined();
    await setFlag("workspaceScouting", false, "owner@test");
    try {
      expect((await priya("GET", `${url("1109")}?season=${S}`)).status).toBe(503);
      expect((await op(priya, "1109", { op: "add", team: 101 })).status).toBe(503);
    } finally { await setFlag("workspaceScouting", true, "owner@test"); }
  });

  it("lists are per season and per workspace", async () => {
    const { priya, olly } = await team("1110");
    await op(priya, "1110", { op: "add", team: 101 });
    await priya("POST", url("1110"), { season: 2024, op: "add", team: 102 });
    expect(order(await priya("GET", `${url("1110")}?season=${S}`))).toEqual([101]);
    expect(order(await priya("GET", `${url("1110")}?season=2024`))).toEqual([102]);
    expect((await priya("GET", `${url("1111")}?season=${S}`)).status).toBe(403); // no one joined 1111
    expect((await olly("GET", `${url("1110")}?season=${S}`)).status).toBe(403);
  });
});
