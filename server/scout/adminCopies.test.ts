// An admin of several workspaces scouts once (adminCopies.ts), against a stub Control Point: what they save in one
// admin workspace is saved in each of their other admin workspaces, never through a membership that isn't admin,
// never from Personal; retries never double a copy; an edit of any one of the family updates the rest (by that
// admin only); deletes stay where they're made; answers are mapped onto each workspace's own template.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { setWorkspaceOverride } from "../flags";
import { closeAllStreams } from "./stream";
import { clearConsensusCache } from "./consensus";
import { copyUuid } from "./alliances";
import { fits, mapAnswers } from "./adminCopies";
import { workspaceTemplateId, type ScoutField } from "../../src/shared/scoutTemplate";

const KEY = "k".repeat(40);
const S = 2025;
const EV = "USALQ1";
let scout: Server, cp: Server;
let base = "", cpBase = "";
const codes = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 9800 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
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
  await run("INSERT INTO teams (number, name) VALUES (101, 'Alpha'), (102, 'Beta')");
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
beforeEach(async () => {
  clearInfoCache();
  clearConsensusCache();
  for (const t of ["scout_alliance_copies", "workspace_scout_entries", "workspace_entry_versions", "workspace_activity", "scout_entries"]) await run(`DELETE FROM ${t}`);
  await run("UPDATE workspaces SET settings = NULL");
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});

function client() {
  let cookie = "";
  return async (method: string, path: string, json?: unknown) => {
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
}
type Call = ReturnType<typeof client>;
async function signIn(email: string, displayName?: string): Promise<Call> {
  const call = client();
  await call("POST", "/api/auth/email/start", { email });
  expect((await call("POST", "/api/auth/email/verify", { email, code: codes.get(email) })).status).toBe(200);
  if (displayName) await call("PATCH", "/api/me", { displayName });
  return call;
}

// Sam: admin of Hypnotic Robotics (H), First Street Kids (F) and Bad Wolf (W); a member (not admin) of Visitors (V).
// Mia: a member of H and admin of F (an admin elsewhere, not where she scouts). Fay: a member of F.
const H = "foH", F = "foF", W = "foW", V = "foV";
let people: { sam: Call; mia: Call; fay: Call } | null = null;
async function cast() {
  if (people) return people;
  const join = (email: string, id: string, name: string, role: "admin" | "member") => { const a = accountFor(email); a.workspaces = [...(a.workspaces ?? []), { id, name, role }]; };
  join("fo-sam@example.com", H, "Hypnotic Robotics", "admin"); join("fo-sam@example.com", F, "First Street Kids", "admin");
  join("fo-sam@example.com", W, "Bad Wolf", "admin"); join("fo-sam@example.com", V, "Visitors", "member");
  join("fo-mia@example.com", H, "Hypnotic Robotics", "member"); join("fo-mia@example.com", F, "First Street Kids", "admin");
  join("fo-fay@example.com", F, "First Street Kids", "member");
  people = { sam: await signIn("fo-sam@example.com", "Sam"), mia: await signIn("fo-mia@example.com", "Mia"), fay: await signIn("fo-fay@example.com", "Fay") };
  return people;
}

let n = 0;
const T0 = Date.parse("2025-10-01T00:00:00Z");
const entry = (over: Record<string, unknown> = {}) => ({
  uuid: `fanout${String(++n).padStart(6, "0")}`, season: S, team: 101, eventCode: EV, matchLabel: `Q${n}`, kind: "match",
  data: { autoLeave: true, artifacts: 12 }, notes: "fast cycles", updatedAt: T0 + n * 1000, ...over,
});
const push = (call: Call, ws: string | null, entries: unknown[]) => call("POST", "/api/me/scout/sync", { workspaceId: ws, entries });
async function pushOk(call: Call, ws: string, entries: unknown[]) {
  const r = await push(call, ws, entries);
  expect(r.status).toBe(200);
  expect(r.json.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
  return r.json.results as { uuid: string; ok: boolean; copiedTo?: { workspaceId: string; name: string }[] }[];
}
const pull = async (call: Call, ws: string) => {
  const r = await call("GET", `/api/scout/sync?workspaceId=${ws}`);
  expect(r.status).toBe(200);
  return r.json.entries as { uuid: string; data: Record<string, unknown>; notes: string; deleted: boolean; authorDisplayName: string; editorDisplayName: string; templateId?: string; templateVersion?: number; updatedAt: number }[];
};
const rowsIn = async (ws: string) => all<{ uuid: string; seq: number }>("SELECT w.uuid, w.seq FROM workspace_scout_entries w JOIN workspaces s ON s.id = w.workspace_id WHERE s.cp_workspace_id = ?", [ws]);

describe("an admin of several workspaces", () => {
  it("saves into every workspace they're an admin of, attributed to them, and says where", async () => {
    const { sam } = await cast();
    const e = entry();
    const [res] = await pushOk(sam, H, [e]);
    expect(res.copiedTo?.map((c) => c.name).sort()).toEqual(["Bad Wolf", "First Street Kids"]);
    for (const ws of [F, W]) {
      const got = await pull(sam, ws);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ uuid: copyUuid(H, e.uuid), data: e.data, notes: e.notes, updatedAt: e.updatedAt, deleted: false, authorDisplayName: "Sam" });
    }
    // Not where Sam is only a member, and the original is where it was saved.
    expect(await rowsIn(V)).toHaveLength(0);
    expect((await pull(sam, H)).map((x) => x.uuid)).toEqual([e.uuid]);
    // Each copy is that workspace's own: in its history and its activity feed.
    const versions = await all<{ n: number }>("SELECT COUNT(*) n FROM workspace_entry_versions v JOIN workspaces s ON s.id = v.workspace_id WHERE s.cp_workspace_id = ?", [F]);
    expect(Number(versions[0].n)).toBe(1);
    const feed = await all<{ verb: string }>("SELECT a.type verb FROM workspace_activity a JOIN workspaces s ON s.id = a.workspace_id WHERE s.cp_workspace_id = ?", [W]);
    expect(feed.length).toBeGreaterThan(0);
  });

  it("copies nothing from a workspace where they're only a member, nor from Personal", async () => {
    const { sam, mia } = await cast();
    // Sam, a member of Visitors: saved there only.
    const [r1] = await pushOk(sam, V, [entry()]);
    expect(r1.copiedTo).toBeUndefined();
    expect(await rowsIn(H)).toHaveLength(0);
    // Mia is an admin of First Street Kids, but scouts in Hypnotic Robotics as a member: nothing goes to F.
    const [r2] = await pushOk(mia, H, [entry()]);
    expect(r2.copiedTo).toBeUndefined();
    expect(await rowsIn(F)).toHaveLength(0);
    // Personal stays personal.
    const p = await push(sam, null, [entry()]);
    expect(p.status).toBe(200);
    expect(await rowsIn(H)).toHaveLength(1); // Mia's
    expect(await rowsIn(F)).toHaveLength(0);
    expect(await rowsIn(W)).toHaveLength(0);
  });

  it("a retry or an unchanged resend never doubles a copy, and makes a missing one", async () => {
    const { sam } = await cast();
    const e = entry();
    await pushOk(sam, H, [e]);
    const before = await rowsIn(F);
    await pushOk(sam, H, [e]);
    await pushOk(sam, H, [e]);
    expect(await rowsIn(F)).toEqual(before); // same row, same seq: nothing written
    // A copy lost (say the server stopped between the two writes) comes back on the next resend.
    await run("DELETE FROM workspace_scout_entries WHERE uuid = ?", [copyUuid(H, e.uuid)]);
    expect(await rowsIn(F)).toHaveLength(0);
    const [r] = await pushOk(sam, H, [e]);
    expect(r.copiedTo?.map((c) => c.workspaceId).sort()).toEqual([F, W].sort());
    expect(await rowsIn(F)).toHaveLength(1);
    expect(await rowsIn(W)).toHaveLength(1);
  });

  it("an edit of the original updates the copies; an edit of a copy by the admin updates the rest; a member's edit stays put", async () => {
    const { sam, fay } = await cast();
    const e = entry();
    await pushOk(sam, H, [e]);
    await pushOk(sam, H, [{ ...e, notes: "second look", updatedAt: e.updatedAt + 10 }]);
    for (const ws of [F, W]) expect((await pull(sam, ws))[0]).toMatchObject({ notes: "second look", updatedAt: e.updatedAt + 10 });
    // Sam edits the copy in First Street Kids: the original and the Bad Wolf copy follow, no new rows anywhere.
    const copy = copyUuid(H, e.uuid);
    await pushOk(sam, F, [{ ...e, uuid: copy, notes: "third look", updatedAt: e.updatedAt + 20 }]);
    expect((await pull(sam, H))).toMatchObject([{ uuid: e.uuid, notes: "third look" }]);
    expect((await pull(sam, W))).toMatchObject([{ uuid: copy, notes: "third look" }]);
    // Fay, a member of First Street Kids, edits the copy: it's First Street Kids' entry; the others keep theirs.
    const [r] = await pushOk(fay, F, [{ ...e, uuid: copy, notes: "fay's take", updatedAt: e.updatedAt + 30 }]);
    expect(r.copiedTo).toBeUndefined();
    expect((await pull(sam, F))[0]).toMatchObject({ notes: "fay's take", editorDisplayName: "Fay", authorDisplayName: "Sam" });
    expect((await pull(sam, H))[0].notes).toBe("third look");
  });

  it("only their own entries: an admin fixing a teammate's entry fixes it where it is", async () => {
    const { sam, mia } = await cast();
    const e = entry();
    await pushOk(mia, H, [e]);
    const [r] = await pushOk(sam, H, [{ ...e, notes: "fixed", updatedAt: e.updatedAt + 5 }]);
    expect(r.copiedTo).toBeUndefined();
    expect(await rowsIn(F)).toHaveLength(0);
  });

  it("deleting the original leaves the copies; a copy deleted in its workspace stays deleted", async () => {
    const { sam } = await cast();
    const e = entry();
    await pushOk(sam, H, [e]);
    await pushOk(sam, H, [{ ...e, deleted: true, updatedAt: e.updatedAt + 5 }]);
    expect((await pull(sam, F))[0]).toMatchObject({ deleted: false });
    expect((await pull(sam, W))[0]).toMatchObject({ deleted: false });
    // Another entry: its copy in Bad Wolf is deleted there; edits of the original never bring it back.
    const g = entry();
    await pushOk(sam, H, [g]);
    await pushOk(sam, W, [{ ...g, uuid: copyUuid(H, g.uuid), deleted: true, updatedAt: g.updatedAt + 5 }]);
    expect((await pull(sam, H)).find((x) => x.uuid === g.uuid)).toMatchObject({ deleted: false }); // a delete isn't copied back either
    const [r] = await pushOk(sam, H, [{ ...g, notes: "later", updatedAt: g.updatedAt + 10 }]);
    expect(r.copiedTo?.map((c) => c.workspaceId)).toEqual([F]);
    expect((await pull(sam, W)).find((x) => x.uuid === copyUuid(H, g.uuid))).toMatchObject({ deleted: true });
  });

  it("not into a workspace whose scouting is paused, or once they're no longer its admin", async () => {
    const { sam } = await cast();
    await setWorkspaceOverride("workspaceScouting", W, false, "test");
    try {
      const [r] = await pushOk(sam, H, [entry()]);
      expect(r.copiedTo?.map((c) => c.workspaceId)).toEqual([F]);
      expect(await rowsIn(W)).toHaveLength(0);
    } finally { await setWorkspaceOverride("workspaceScouting", W, null, "test"); }
    const a = accountFor("fo-sam@example.com");
    const saved = a.workspaces!;
    a.workspaces = saved.map((w) => (w.id === F ? { ...w, role: "member" as const } : w));
    clearInfoCache();
    try {
      const e = entry();
      const [r] = await pushOk(sam, H, [e]);
      expect(r.copiedTo?.map((c) => c.workspaceId)).toEqual([W]);
      expect((await rowsIn(F)).some((x) => x.uuid === copyUuid(H, e.uuid))).toBe(false);
    } finally { a.workspaces = saved; clearInfoCache(); await run("UPDATE workspace_members SET updated_at = 0"); }
  });

  it("maps answers by field onto each workspace's own template, dropping what doesn't fit there", async () => {
    const { sam } = await cast();
    // First Street Kids asks fewer questions, one of them differently.
    const fFields = [
      { id: "autoLeave", label: "Left launch line", type: "toggle", phase: "auto" },
      { id: "artifacts", label: "Artifacts", type: "counter", phase: "teleop", max: 10 },
      { id: "base", label: "Base", type: "choice", phase: "endgame", options: ["None", "Full"] },
      { id: "pitCrew", label: "Pit crew", type: "text", phase: "overall" },
    ];
    const put = await sam("PUT", `/api/scout/workspaces/${F}/template`, { season: S, match: fFields });
    expect(put.json).toMatchObject({ template: { version: 1 } });
    const e = entry({ data: { autoLeave: true, artifacts: 12, overflow: 3, base: "Partial" } });
    await pushOk(sam, H, [e]);
    const [copy] = await pull(sam, F);
    // artifacts 12 is past F's max of 10, "Partial" isn't one of F's choices, overflow isn't asked in F.
    expect(copy.data).toEqual({ autoLeave: true });
    expect(copy).toMatchObject({ templateId: workspaceTemplateId(F, S, "match"), templateVersion: 1 });
    // Bad Wolf, on the built-in fields, gets everything.
    expect((await pull(sam, W))[0].data).toEqual(e.data);
    // First Street Kids' own answer on the copy (a field H doesn't ask) survives the next edit of the original.
    await pushOk(sam, F, [{ ...e, uuid: copyUuid(H, e.uuid), data: { autoLeave: true, pitCrew: "steady" }, templateId: workspaceTemplateId(F, S, "match"), templateVersion: 1, updatedAt: e.updatedAt + 5 }]);
    await pushOk(sam, H, [{ ...e, data: { autoLeave: false, artifacts: 4 }, updatedAt: e.updatedAt + 10 }]);
    expect((await pull(sam, F))[0].data).toEqual({ autoLeave: false, artifacts: 4, pitCrew: "steady" });
  });
});

describe("mapAnswers", () => {
  const f = (over: Partial<ScoutField>): ScoutField => ({ id: "x", label: "X", type: "counter", phase: "teleop", ...over });
  it("keeps only answers whose field the receiving template has and that fit it", () => {
    expect(fits(f({ type: "counter", max: 5 }), 6)).toBe(false);
    expect(fits(f({ type: "counter" }), 1.5)).toBe(false);
    expect(fits(f({ type: "rating", max: 5 }), 4)).toBe(true);
    expect(fits(f({ type: "toggle" }), "yes")).toBe(false);
    expect(fits(f({ type: "choice", options: ["A"] }), "A")).toBe(true);
    expect(fits(f({ type: "text" }), 3)).toBe(false);
    const from = [f({ id: "a" }), f({ id: "b" })];
    const to = [f({ id: "a" }), f({ id: "c", type: "text" })];
    expect(mapAnswers({ a: 2, b: 3 }, from, to, { a: 9, c: "kept", b: 1 })).toEqual({ a: 2, c: "kept" });
    // A field the sender asks, cleared there, is cleared in the copy too.
    expect(mapAnswers({}, from, to, { a: 9 })).toEqual({});
  });
});
