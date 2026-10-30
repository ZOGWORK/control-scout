// The scouting commons end to end, against a stub Control Point: the three switches (event, workspace opt-in, entry),
// pit only, credit by workspace name, the reader's own workspaces left out, the consensus layer, edits followed,
// opt-out withdrawing, the owner's per-event switch (audited), paused workspaces hidden, and commons photos.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { invalidateFlags, setFlag, setWorkspaceOverride } from "../flags";
import { closeAllStreams } from "./stream";
import type { CommonsAnswer } from "../../src/shared/commons";

const KEY = "k".repeat(40);
const S = 2025, EV = "USCMQ1";
let scout: Server, cp: Server;
let base = "", cpBase = "";
const codes = new Map<string, string>();
const ENV = ["CONTROL_POINT_INTERNAL_URL", "CONTROL_POINT_PUBLIC_URL", "CONTROL_POINT_INTERNAL_KEY", "APP_URL", "R2_FAKE", "R2_ENDPOINT", "OWNER_EMAILS", "R2_FAKE_DIR"];
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 9700 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
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
  await run("INSERT INTO teams (number, name) VALUES (18360, 'Pyro'), (101, 'Alpha')");
  await run("INSERT INTO events (season, code, name, start, end, source) VALUES (?, ?, 'Commons Qualifier', '2025-11-08', '2025-11-08', 'first'), (?, 'USCMQ2', 'Closed Meet', '2025-11-15', '2025-11-15', 'first')", [S, EV, S]);
  setMailer(async (to, _s, text) => { codes.set(to, /\b(\d{6})\b/.exec(text)![1]); });
  delete process.env.R2_FAKE_DIR;
  process.env.R2_FAKE = "1";
  scout = createApp().listen(0);
  await new Promise((r) => scout.once("listening", r));
  base = `http://127.0.0.1:${(scout.address() as AddressInfo).port}`;
});
afterAll(() => {
  closeAllStreams();
  setMailer(null); scout?.close(); cp?.close();
  for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});
beforeEach(async () => {
  clearInfoCache();
  Object.assign(process.env, {
    CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1",
    R2_FAKE: "1", R2_ENDPOINT: `${base}/__fake-r2`, OWNER_EMAILS: "owner@example.com",
  });
  await setFlag("photos", true, "test");
  await setFlag("workspaceScouting", true, "test");
  await setFlag("scoutingCommons", true, "test");
  await setWorkspaceOverride("scoutingCommons", A, null, "test");
  for (const t of ["commons_entries", "commons_workspaces", "commons_events", "entry_photos"]) await run(`DELETE FROM ${t}`);
  invalidateFlags();
});

function client() {
  let cookie = "";
  return async (method: string, path: string, json?: unknown) => {
    const r = await fetch(base + path, {
      method, redirect: "manual", headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k] = kv.split("=");
      cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${k}=`)), ...(kv.endsWith("=") ? [] : [kv])].join("; ");
    }
    const text = await r.text();
    let json2: any = null;
    try { json2 = text ? JSON.parse(text) : null; } catch { json2 = text; }
    return { status: r.status, json: json2, headers: r.headers };
  };
}
type Call = ReturnType<typeof client>;
async function signIn(email: string, displayName?: string): Promise<Call> {
  const call = client();
  await call("POST", "/api/auth/email/start", { email });
  expect((await call("POST", "/api/auth/email/verify", { email, code: codes.get(email) })).status).toBe(200);
  if (displayName) await call("PATCH", "/api/me", { displayName });
  return call;
}

const A = "3101", B = "3102";
let people: { adminA: Call; memberA: Call; adminB: Call; loner: Call; owner: Call } | null = null;
/** Workspace A ("Pyro Scouts"): an admin and a member. Workspace B ("Robo Owls"): an admin. A loner in no workspace. The owner. */
async function cast() {
  const join = (email: string, id: string, name: string, role: "admin" | "member") => { const a = accountFor(email); a.workspaces = [...(a.workspaces ?? []), { id, name, role }]; };
  if (!people) {
    join("cm-admin-a@example.com", A, "Pyro Scouts", "admin"); join("cm-member-a@example.com", A, "Pyro Scouts", "member");
    join("cm-admin-b@example.com", B, "Robo Owls", "admin");
    people = {
      adminA: await signIn("cm-admin-a@example.com", "Ada"), memberA: await signIn("cm-member-a@example.com", "Max"), adminB: await signIn("cm-admin-b@example.com", "Bo"),
      loner: await signIn("cm-loner@example.com"), owner: await signIn("owner@example.com"),
    };
  }
  return people;
}

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({
  uuid: `commons${String(++n).padStart(7, "0")}`, season: S, team: 18360, eventCode: EV, matchLabel: null, kind: "pit",
  data: { drivetrain: "Mecanum", weight: 38 }, notes: "Lift rebuilt Friday night", updatedAt: 1_762_600_000_000 + n * 1000, ...over,
});
const push = async (call: Call, ws: string, entries: unknown[]) => {
  const r = await call("POST", "/api/me/scout/sync", { workspaceId: ws, entries });
  expect(r.status).toBe(200);
  expect(r.json.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
};
const openEvent = async (owner: Call, code = EV, enabled = true) => {
  const r = await owner("PUT", `/api/owner/commons/events/${S}/${code}`, { enabled });
  expect(r.status).toBe(200);
};
const optIn = async (admin: Call, ws: string, optedIn = true) => {
  const r = await admin("PUT", `/api/scout/workspaces/${ws}/commons`, { optedIn });
  expect(r.status).toBe(200);
  return r.json;
};
const share = (call: Call, ws: string, uuid: string, publish = true) => call("PUT", `/api/scout/workspaces/${ws}/commons/entries/${uuid}`, { publish });
const read = async (call: Call, q = `season=${S}&team=18360`): Promise<CommonsAnswer> => {
  const r = await call("GET", `/api/scout/commons?${q}`);
  expect(r.status).toBe(200);
  return r.json;
};

describe("scouting commons", () => {
  it("shares a pit entry only with all three switches on, credited to the workspace, never to a person", async () => {
    const { adminA, adminB, loner, owner } = await cast();
    const e = entry();
    await push(adminA, A, [e]);
    // Workspace not opted in: refused.
    expect((await share(adminA, A, e.uuid)).json.code).toBe("not_opted_in");
    await optIn(adminA, A);
    // Event not open: refused.
    expect((await share(adminA, A, e.uuid)).json).toMatchObject({ code: "event_off" });
    await openEvent(owner);
    const ok = await share(adminA, A, e.uuid);
    expect(ok.status).toBe(200);
    expect(ok.json.commons.shares).toEqual([expect.objectContaining({ uuid: e.uuid, status: "published", eventCode: EV, team: 18360 })]);
    // Any signed-in account reads it: another workspace's admin, and someone in no workspace at all.
    for (const reader of [adminB, loner]) {
      const c = await read(reader);
      expect(c.entries).toHaveLength(1);
      expect(c.entries[0]).toMatchObject({ source: { name: "Pyro Scouts" }, eventCode: EV, team: 18360, notes: e.notes, scoutedAt: e.updatedAt, data: e.data });
      expect(c.entries[0].fields.length).toBeGreaterThan(0);
      expect(JSON.stringify(c)).not.toMatch(/Ada|cm-admin-a|3101/);
      expect(c.events).toEqual([{ code: EV, name: "Commons Qualifier", start: "2025-11-08", end: "2025-11-08", timezone: null }]);
    }
    // Signed out: 401.
    expect((await client()("GET", `/api/scout/commons?season=${S}&team=18360`)).status).toBe(401);
  });

  it("never shares match entries, pit entries without an event, or another member's entry (unless an admin)", async () => {
    const { adminA, memberA, owner } = await cast();
    await openEvent(owner);
    await optIn(adminA, A);
    const match = entry({ kind: "match", matchLabel: "Q3" });
    const noEvent = entry({ eventCode: null });
    const byAdmin = entry();
    await push(adminA, A, [match, noEvent, byAdmin]);
    expect((await share(adminA, A, match.uuid)).json.code).toBe("not_pit");
    expect((await share(adminA, A, noEvent.uuid)).json.code).toBe("no_event");
    expect((await share(memberA, A, byAdmin.uuid)).status).toBe(403);
    expect((await share(adminA, A, "nosuchentry000")).status).toBe(404);
    const mine = entry();
    await push(memberA, A, [mine]);
    expect((await share(memberA, A, mine.uuid)).status).toBe(200); // the author shares their own
  });

  it("leaves the reader's own workspace out, and rolls the rest into a labelled layer, one scout per workspace", async () => {
    const { adminA, adminB, loner, owner } = await cast();
    await openEvent(owner);
    await optIn(adminA, A); await optIn(adminB, B);
    const a = entry({ data: { weight: 40, drivetrain: "Mecanum" } });
    const b = entry({ data: { weight: 30, drivetrain: "Tank" } });
    await push(adminA, A, [a]); await push(adminB, B, [b]);
    await share(adminA, A, a.uuid); await share(adminB, B, b.uuid);
    const forA = await read(adminA);
    expect(forA.entries.map((x) => x.source.name)).toEqual(["Robo Owls"]);
    expect(forA.ownHidden).toBe(1);
    const all2 = await read(loner);
    expect(all2.entries.map((x) => x.source.name)).toEqual(["Robo Owls", "Pyro Scouts"]); // newest scouted first
    expect(all2.layer).toMatchObject({ team: 18360, entries: 2, pitEntries: 2, matchEntries: 0, scouts: 2 });
    expect(all2.layer.counters.find((r) => r.id === "weight")).toMatchObject({ kind: "pit", label: "Robot weight (lb)", avg: 35, n: 2 });
    expect(all2.layer.tags.map((t) => t.label).sort()).toEqual(["Drivetrain: Mecanum", "Drivetrain: Tank"]);
    // Asking for one event reads that event only.
    expect((await read(loner, `season=${S}&team=18360&event=USCMQ2`)).entries).toEqual([]);
  });

  it("follows edits: new answers show at once; a deleted entry, or one moved to a closed event, drops out", async () => {
    const { adminA, loner, owner } = await cast();
    await openEvent(owner);
    await optIn(adminA, A);
    const e = entry();
    await push(adminA, A, [e]);
    await share(adminA, A, e.uuid);
    await push(adminA, A, [{ ...e, notes: "Rebuilt Saturday: new claw", updatedAt: e.updatedAt + 60_000 }]);
    await new Promise((r) => setTimeout(r, 50)); // the key follows on the write hook
    expect((await read(loner)).entries[0]).toMatchObject({ notes: "Rebuilt Saturday: new claw", scoutedAt: e.updatedAt + 60_000 });
    await push(adminA, A, [{ ...e, eventCode: "USCMQ2", updatedAt: e.updatedAt + 120_000 }]);
    await new Promise((r) => setTimeout(r, 50));
    expect((await read(loner)).entries).toEqual([]);
    expect((await all("SELECT event_code FROM commons_entries"))[0]).toMatchObject({ event_code: "USCMQ2" });
    await push(adminA, A, [{ ...e, eventCode: EV, updatedAt: e.updatedAt + 180_000 }]);
    await new Promise((r) => setTimeout(r, 50));
    expect((await read(loner)).entries).toHaveLength(1);
    await push(adminA, A, [{ ...e, deleted: true, updatedAt: e.updatedAt + 240_000 }]);
    expect((await read(loner)).entries).toEqual([]);
  });

  it("unsharing, opting out (which withdraws everything), closing the event and pausing the workspace each hide it", async () => {
    const { adminA, memberA, loner, owner } = await cast();
    await openEvent(owner);
    await optIn(adminA, A);
    const e = entry();
    await push(adminA, A, [e]);
    await share(adminA, A, e.uuid);
    expect((await read(loner)).entries).toHaveLength(1);
    // Members read the workspace's opt-in and shares; only admins change the opt-in.
    expect((await memberA("GET", `/api/scout/workspaces/${A}/commons`)).json).toMatchObject({ optedIn: true, shares: [{ uuid: e.uuid, status: "published" }] });
    expect((await memberA("PUT", `/api/scout/workspaces/${A}/commons`, { optedIn: false })).status).toBe(403);
    expect((await loner("GET", `/api/scout/workspaces/${A}/commons`)).status).toBe(403);

    await setWorkspaceOverride("workspaceScouting", A, false, "test");
    invalidateFlags();
    expect((await read(loner)).entries).toEqual([]);
    await setWorkspaceOverride("workspaceScouting", A, null, "test");
    invalidateFlags();
    expect((await read(loner)).entries).toHaveLength(1);

    await openEvent(owner, EV, false);
    expect((await read(loner)).entries).toEqual([]);
    await openEvent(owner, EV, true);
    expect((await read(loner)).entries).toHaveLength(1);

    await share(adminA, A, e.uuid, false);
    expect((await read(loner)).entries).toEqual([]);
    await share(adminA, A, e.uuid, true);

    const out = await optIn(adminA, A, false);
    expect(out.shares).toEqual([expect.objectContaining({ status: "withdrawn" })]);
    expect((await read(loner)).entries).toEqual([]);
    await optIn(adminA, A, true);
    expect((await read(loner)).entries).toEqual([]); // opting back in republishes nothing by itself
  });

  it("the owner's per-event switch: owner only, a known event only, audited", async () => {
    const { adminA, owner } = await cast();
    expect((await adminA("PUT", `/api/owner/commons/events/${S}/${EV}`, { enabled: true })).status).toBe(403);
    expect((await owner("PUT", `/api/owner/commons/events/${S}/NOPE99`, { enabled: true })).status).toBe(404);
    expect((await owner("PUT", `/api/owner/commons/events/${S}/${EV}`, { enabled: "yes" })).status).toBe(400);
    await openEvent(owner);
    const list = await owner("GET", "/api/owner/commons/events");
    expect(list.json.events).toEqual([expect.objectContaining({ season: S, code: EV, name: "Commons Qualifier", enabled: true, updatedBy: "owner@example.com", shared: 0 })]);
    const audit = await all<any>("SELECT action, details, old_value, new_value FROM owner_audit WHERE action LIKE 'commons.%' ORDER BY id DESC LIMIT 1");
    expect(audit).toEqual([expect.objectContaining({ action: "commons.event.open", old_value: "null", new_value: "true" })]);
  });

  it("photos: a commons reader sees an entry's photos and opens them while it's shared, never otherwise", async () => {
    const { adminA, loner, owner } = await cast();
    await openEvent(owner);
    await optIn(adminA, A);
    const e = entry();
    await push(adminA, A, [e]);
    const ws = (await all<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", [A]))[0].id;
    const now = Date.now();
    await run(
      `INSERT INTO entry_photos (id, workspace_id, entry_uuid, season, event_code, object_key, bytes, status, added_by_account_id, added_by_name, created_at, expires_at)
       VALUES ('p-ready', ?, ?, ?, ?, 'photos/x/ready.jpg', 100, 'ready', 1, 'Ada', ?, ?), ('p-old', ?, ?, ?, ?, 'photos/x/old.jpg', 100, 'expired', 1, 'Ada', ?, ?)`,
      [ws, e.uuid, S, EV, now, now + 1e9, ws, e.uuid, S, EV, now - 1000, now]);
    expect((await loner("GET", "/api/scout/commons/photos/p-ready")).status).toBe(404); // not shared yet
    await share(adminA, A, e.uuid);
    const c = await read(loner);
    expect(c.entries[0].photos).toEqual([{ id: "p-old", createdAt: now - 1000, expired: true }, { id: "p-ready", createdAt: now, expired: false }]);
    const view = await loner("GET", "/api/scout/commons/photos/p-ready");
    expect(view.status).toBe(302);
    expect(view.headers.get("location")).toContain("photos/x/ready.jpg");
    expect((await loner("GET", "/api/scout/commons/photos/p-old")).status).toBe(410);
    expect((await client()("GET", "/api/scout/commons/photos/p-ready")).status).toBe(401);
    await share(adminA, A, e.uuid, false);
    expect((await loner("GET", "/api/scout/commons/photos/p-ready")).status).toBe(404);
  });
});

describe("scouting commons: the layer and the owner's count", () => {
  it("averages a field only with fields that ask the same question (a relabelled id stays apart)", async () => {
    const { fieldGrouper } = await import("./commons");
    const group = fieldGrouper();
    const lb = { id: "weight", label: "Robot weight (lb)", type: "counter" as const, phase: "pit" as const, max: 60 };
    const kg = { ...lb, label: "Robot weight (kg)" };
    const a = group([lb], { weight: 40 });
    const b = group([kg], { weight: 18 });
    const c = group([{ ...lb, label: " robot weight (LB) " }], { weight: 42 });
    expect(a).toEqual({ fields: [lb], data: { weight: 40 } });
    expect(b).toEqual({ fields: [{ ...kg, id: "weight~2" }], data: { "weight~2": 18 } });
    expect(c.data).toEqual({ weight: 42 }); // same question, other spacing and case
  });

  it("a reader who joins a workspace stops seeing its shares as commons within the refresh, no sign-in needed", async () => {
    const { adminA, loner, owner } = await cast();
    await openEvent(owner);
    await optIn(adminA, A);
    const e = entry();
    await push(adminA, A, [e]);
    await share(adminA, A, e.uuid);
    expect((await read(loner)).entries).toHaveLength(1);
    const a = accountFor("cm-loner@example.com");
    a.workspaces = [{ id: A, name: "Pyro Scouts", role: "member" }];
    clearInfoCache(); // Control Point asked again (as it is after a minute)
    expect(await read(loner)).toMatchObject({ entries: [], ownHidden: 1 });
    a.workspaces = [];
    clearInfoCache();
  });

  it("counts for the owner only what a reader would see: a deleted share isn't counted", async () => {
    const { adminA, owner } = await cast();
    await openEvent(owner);
    await optIn(adminA, A);
    const e = entry(), gone = entry();
    await push(adminA, A, [e, gone]);
    await share(adminA, A, e.uuid); await share(adminA, A, gone.uuid);
    await push(adminA, A, [{ ...gone, deleted: true, updatedAt: gone.updatedAt + 1000 }]);
    const list = await owner("GET", "/api/owner/commons/events");
    expect(list.json.events[0]).toMatchObject({ code: EV, shared: 1 });
  });
});

describe("scouting commons: the owner's feature toggle", () => {
  it("off everywhere: no commons read, share or opt-in, whatever the event switch says; on again, everything is back", async () => {
    const { adminA, loner, owner } = await cast();
    await openEvent(owner);
    await optIn(adminA, A);
    const e = entry();
    await push(adminA, A, [e]);
    await share(adminA, A, e.uuid);
    await setFlag("scoutingCommons", false, "test");
    invalidateFlags();
    const off = await loner("GET", `/api/scout/commons?season=${S}&team=18360`);
    expect(off.status).toBe(403);
    expect(off.json).toMatchObject({ error: "feature_disabled", feature: "scoutingCommons" });
    expect((await adminA("GET", `/api/scout/workspaces/${A}/commons`)).json.feature).toBe("scoutingCommons");
    expect((await adminA("PUT", `/api/scout/workspaces/${A}/commons`, { optedIn: false })).status).toBe(403);
    expect((await share(adminA, A, e.uuid, false)).status).toBe(403);
    expect((await loner("POST", "/api/scout/commons/reports", { entryId: "1:x", reason: "wrong" })).status).toBe(403);
    expect((await owner("GET", "/api/owner/commons/events")).status).toBe(200); // the console stays reachable
    await setFlag("scoutingCommons", true, "test");
    invalidateFlags();
    expect((await read(loner)).entries).toHaveLength(1); // nothing was lost
  });

  it("off for one workspace: its shares are hidden and it can't share; others carry on", async () => {
    const { adminA, adminB, loner, owner } = await cast();
    await openEvent(owner);
    await optIn(adminA, A); await optIn(adminB, B);
    const a = entry(), b = entry();
    await push(adminA, A, [a]); await push(adminB, B, [b]);
    await share(adminA, A, a.uuid); await share(adminB, B, b.uuid);
    await setWorkspaceOverride("scoutingCommons", A, false, "test");
    invalidateFlags();
    expect((await read(loner)).entries.map((x) => x.source.name)).toEqual(["Robo Owls"]);
    expect((await share(adminA, A, a.uuid)).status).toBe(403);
    expect((await owner("GET", "/api/owner/commons/events")).json.events[0].shared).toBe(1);
  });
});
