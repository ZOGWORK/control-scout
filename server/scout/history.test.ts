// Task 16: version history of workspace entries, against a stub Control Point. Every accepted write
// records a version (who wrote it, when, the text); refused and no-op writes don't; 20 are kept; the
// history API is for members; a restore is an ordinary write, attributed to whoever restores, checked
// by the same permission rule (it can't bring back someone else's deleted entry for a member), and
// logged as entry.version_restored. Personal entries have no history.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { HISTORY_LIMIT } from "../../src/shared/entryHistory";

const KEY = "k".repeat(40);
let scout: Server, cp: Server;
let base = "", cpBase = "";
const inbox = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
let accountReads = 0;
let cpDown = false;
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 5000 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};

beforeAll(async () => {
  const stub = express();
  stub.use(express.json());
  stub.use("/internal", (req, res, next) => {
    if (cpDown) { res.status(500).json({ error: "down" }); return; }
    if (req.get("X-Internal-Key") !== KEY) { res.status(401).json({ error: "bad key" }); return; }
    next();
  });
  stub.post("/internal/accounts/resolve", (req, res) => { res.json({ account: accountFor(String(req.body.email).toLowerCase()) }); });
  stub.get("/internal/accounts/:id", (req, res) => {
    accountReads++;
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
  cpDown = false;
  clearInfoCache();
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});

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
  expect((await call("POST", "/api/auth/email/verify", { email, code: inbox.get(email) })).status).toBe(200);
  if (displayName) await call("PATCH", "/api/me", { displayName });
  return call;
}

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({ uuid: `e${String(++n).padStart(10, "0")}`, season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: { auto: 3 }, notes: "fast", updatedAt: 1000, ...over });
const push = (call: Call, workspaceId: string | null, entries: unknown[]) => call("POST", "/api/me/scout/sync", { workspaceId, entries });

type Team = { a: Call; b: Call; admin: Call; ids: { a: number; b: number; admin: number } };
// Three accounts signed in once (sign-in is rate limited per IP), joining a fresh workspace per test.
let people: Team | null = null;
const EMAILS = { a: "priya@example.com", b: "marcus@example.com", admin: "coach@example.com" } as const;
/** Workspace `ws`: A (Priya) and B (Marcus) are members, Coach is its admin. */
async function team(ws: string): Promise<Team> {
  const join = (email: string, role: "admin" | "member") => { const acct = accountFor(email); acct.workspaces = [...(acct.workspaces ?? []), { id: ws, name: "Gearheads", role }]; };
  join(EMAILS.a, "member"); join(EMAILS.b, "member"); join(EMAILS.admin, "admin");
  people ??= {
    a: await signIn(EMAILS.a, "Priya"), b: await signIn(EMAILS.b, "Marcus"), admin: await signIn(EMAILS.admin, "Coach"),
    ids: { a: accountFor(EMAILS.a).id, b: accountFor(EMAILS.b).id, admin: accountFor(EMAILS.admin).id },
  };
  return people;
}
const tomb = (e: ReturnType<typeof entry>, updatedAt: number) => ({ ...e, updatedAt, deleted: true, data: {}, notes: "" });
const history = (call: Call, ws: string, uuid: string) => call("GET", `/api/scout/workspaces/${ws}/entries/${uuid}/history`);
const versions = async (ws: string, uuid: string) => (await all<any>(
  `SELECT v.* FROM workspace_entry_versions v JOIN workspaces s ON s.id = v.workspace_id WHERE s.cp_workspace_id = ? AND v.uuid = ? ORDER BY v.version_no`, [ws, uuid]));
const activity = async (ws: string, uuid: string) => (await all<any>(
  `SELECT a.* FROM workspace_activity a JOIN workspaces s ON s.id = a.workspace_id WHERE s.cp_workspace_id = ? AND a.subject = ? ORDER BY a.id`, [ws, `entry:${uuid}`]));

describe("entry version history", () => {
  it("every accepted write records a version with who wrote it; refused, beaten and no-op writes record none", async () => {
    const { a, b, ids } = await team("1601");
    const e = entry({ updatedAt: 1000, notes: "first" });
    await push(a, "1601", [e]);
    await push(b, "1601", [{ ...e, updatedAt: 2000, notes: "B's edit", data: { auto: 5 } }]);
    // Refused: B (a member) deletes A's entry.
    expect((await push(b, "1601", [tomb(e, 3000)])).json.results[0]).toMatchObject({ ok: false, error: "forbidden" });
    // Beaten: an older version arrives late.
    await push(a, "1601", [{ ...e, updatedAt: 1500, notes: "late" }]);
    // No-op: the same version again, and a newer stamp with nothing changed.
    await push(b, "1601", [{ ...e, updatedAt: 2000, notes: "B's edit", data: { auto: 5 } }]);
    await push(b, "1601", [{ ...e, updatedAt: 2500, notes: "B's edit", data: { auto: 5 } }]);
    const rows = await versions("1601", e.uuid);
    expect(rows.map((r) => [Number(r.version_no), Number(r.updated_at), Number(r.written_by_account_id), r.written_by_name, r.notes])).toEqual([
      [1, 1000, ids.a, "Priya", "first"],
      [2, 2000, ids.b, "Marcus", "B's edit"],
    ]);
    expect(JSON.parse(rows[1].data)).toEqual({ auto: 5 });
    // A's delete (allowed: A wrote it) is a version too.
    await push(a, "1601", [tomb(e, 4000)]);
    expect((await versions("1601", e.uuid)).map((r) => [Number(r.version_no), Number(r.deleted)])).toEqual([[1, 0], [2, 0], [3, 1]]);
  });

  it(`keeps the last ${HISTORY_LIMIT} versions of an entry`, async () => {
    const { a } = await team("1602");
    const e = entry({ updatedAt: 1000 });
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) await push(a, "1602", [{ ...e, updatedAt: 1000 + i, notes: `v${i + 1}` }]);
    const rows = await versions("1602", e.uuid);
    expect(rows).toHaveLength(HISTORY_LIMIT);
    expect(Number(rows[0].version_no)).toBe(6);
    expect(Number(rows.at(-1).version_no)).toBe(HISTORY_LIMIT + 5);
    expect(rows.at(-1).notes).toBe(`v${HISTORY_LIMIT + 5}`);
  });

  it("the history API: members read it newest first; others 403, signed out 401, unknown entry 404", async () => {
    const { a, b, ids } = await team("1603");
    const e = entry({ updatedAt: 1000, notes: "first" });
    await push(a, "1603", [e]);
    await push(b, "1603", [{ ...e, updatedAt: 2000, notes: "second" }]);
    const r = await history(b, "1603", e.uuid);
    expect(r.status).toBe(200);
    expect(r.json.limit).toBe(HISTORY_LIMIT);
    expect(r.json.versions.map((v: any) => [v.versionNo, v.writtenBy, v.notes, v.restored])).toEqual([
      [2, { accountId: ids.b, name: "Marcus" }, "second", false],
      [1, { accountId: ids.a, name: "Priya" }, "first", false],
    ]);
    expect(r.json.versions[0]).toMatchObject({ team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", deleted: false, data: { auto: 3 } });
    expect((await history(a, "1699", e.uuid)).status).toBe(403); // not a member of that workspace
    const outsider = await signIn("stranger@example.com");
    expect((await history(outsider, "1603", e.uuid)).status).toBe(403);
    expect((await fetch(`${base}/api/scout/workspaces/1603/entries/${e.uuid}/history`)).status).toBe(401);
    expect((await history(a, "1603", "nosuchentry1")).status).toBe(404);
  });

  it("a restore is a new version attributed to whoever restores, marked with what it brought back, and logged in the activity feed", async () => {
    const { a, b, ids } = await team("1604");
    const e = entry({ updatedAt: 1000, notes: "A's notes", data: { auto: 2 } });
    await push(a, "1604", [e]);
    await push(b, "1604", [{ ...e, updatedAt: 2000, notes: "B overwrote", data: { auto: 9 }, baseUpdatedAt: 1000 }]);
    // A restores version 1 (written by A) with a fresh updatedAt.
    const r = await push(a, "1604", [{ ...e, updatedAt: 3000, baseUpdatedAt: 2000, restoredFrom: 1000 }]);
    expect(r.json.results[0]).toMatchObject({ ok: true, entry: { notes: "A's notes", editorAccountId: ids.a, updatedAt: 3000, baseUpdatedAt: 2000 } });
    expect(r.json.results[0].entry.restoredFrom).toBeUndefined();
    const rows = await versions("1604", e.uuid);
    expect(rows.map((v) => [Number(v.version_no), Number(v.written_by_account_id), Number(v.restored), v.restored_from_version == null ? null : Number(v.restored_from_version)]))
      .toEqual([[1, ids.a, 0, null], [2, ids.b, 0, null], [3, ids.a, 1, 1]]);
    const log = await activity("1604", e.uuid);
    expect(log.at(-1)).toMatchObject({ type: "entry.version_restored", actor_name: "Priya" });
    expect(Number(log.at(-1).actor_account_id)).toBe(ids.a);
    expect(JSON.parse(log.at(-1).details)).toMatchObject({ uuid: e.uuid, team: 18360, fromAt: 1000, fromVersion: 1, fromName: "Priya", changed: expect.arrayContaining(["notes", "auto"]) });
    // An edit that never reached the server (kept on the loser's device): restored, no version to point at.
    await push(b, "1604", [{ ...e, updatedAt: 4000, notes: "B's offline edit", restoredFrom: 1800 }]);
    expect((await versions("1604", e.uuid)).at(-1)).toMatchObject({ notes: "B's offline edit", restored_from_version: null });
    expect(Number((await versions("1604", e.uuid)).at(-1).restored)).toBe(1);
    expect(JSON.parse((await activity("1604", e.uuid)).at(-1).details)).toMatchObject({ fromVersion: null, fromAt: 1800 });
  });

  it("a member can't use a restore to bring back someone else's deleted entry (the same rule as any write)", async () => {
    const { a, b, admin, ids } = await team("1605");
    const e = entry({ updatedAt: 1000, notes: "A's" });
    await push(a, "1605", [e]);
    await push(b, "1605", [{ ...e, updatedAt: 2000, notes: "B's" }]);
    await push(admin, "1605", [tomb(e, 3000)]); // the admin deletes A's entry
    const before = (await versions("1605", e.uuid)).length;
    const logged = (await activity("1605", e.uuid)).length;
    // B restores B's own version 2 onto the deleted entry: refused, nothing recorded or logged.
    const r = await push(b, "1605", [{ ...e, updatedAt: 4000, notes: "B's", restoredFrom: 2000 }]);
    expect(r.json.results[0]).toMatchObject({ ok: false, error: "forbidden", entry: { deleted: true } });
    expect((await versions("1605", e.uuid)).length).toBe(before);
    expect((await activity("1605", e.uuid)).length).toBe(logged);
    // The author may: a restore that also undeletes, logged as such.
    const back = await push(a, "1605", [{ ...e, updatedAt: 5000, notes: "B's", restoredFrom: 2000 }]);
    expect(back.json.results[0]).toMatchObject({ ok: true, entry: { deleted: false, editorAccountId: ids.a } });
    expect(JSON.parse((await activity("1605", e.uuid)).at(-1).details)).toMatchObject({ fromVersion: 2, undeleted: true });
  });

  it("a restore marker on a delete is just the delete; personal entries have no history", async () => {
    const { a } = await team("1606");
    const e = entry({ updatedAt: 1000 });
    await push(a, "1606", [e]);
    await push(a, "1606", [{ ...tomb(e, 2000), restoredFrom: 1000 }]);
    expect((await activity("1606", e.uuid)).at(-1).type).toBe("entry.deleted");
    const last = (await versions("1606", e.uuid)).at(-1);
    expect([Number(last.deleted), Number(last.restored)]).toEqual([1, 0]);
    const p = entry({ updatedAt: 1000 });
    expect((await push(a, null, [p])).json.results[0]).toMatchObject({ ok: true });
    expect(Number((await all<any>("SELECT COUNT(*) n FROM workspace_entry_versions WHERE uuid = ?", [p.uuid]))[0].n)).toBe(0);
  });
});
