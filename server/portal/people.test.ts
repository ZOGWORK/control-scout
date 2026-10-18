// The owner console's Users and Workspaces (/api/owner/users, /users/:id, /workspaces) on an in-memory
// database: owner only, what each account keeps (sign-ins, sessions, saved data, entries, workspaces via its
// Control Point account) and each Scout space's members, entries and orphaned state. Read-only.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import type { OwnerUser, OwnerUserDetail, OwnerWorkspace } from "../../src/shared/owner";

let server: Server, base = "", ownerCookie = "", otherCookie = "", scoutId = 0;
const saved = process.env.OWNER_EMAILS;

async function account(email: string, name: string | null, lastSeen: string | null) {
  const u = await get<{ id: number }>("INSERT INTO users (email, display_name, created_at, last_seen) VALUES (?, ?, '2026-10-01T00:00:00Z', ?) RETURNING id", [email, name, lastSeen]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, '2026-10-17T00:00:00Z', ?, 'Mozilla/5.0 Test')", [sha256(t), u!.id, new Date(Date.now() + 864e5).toISOString()]);
  return { id: u!.id, cookie: `cs_session=${t}` };
}
const call = async <T>(path: string, cookie = ownerCookie) => { const r = await fetch(`${base}${path}`, { headers: { Cookie: cookie } }); return { status: r.status, json: (await r.json()) as T }; };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  process.env.OWNER_EMAILS = "owner@example.com";
  ownerCookie = (await account("owner@example.com", "Owner", "2026-10-10T00:00:00Z")).cookie;
  const scout = await account("priya@example.com", "Priya", "2026-10-18T00:00:00Z");
  scoutId = scout.id; otherCookie = scout.cookie;
  await run("INSERT INTO identities (provider, subject, user_id) VALUES ('email', 'priya@example.com', ?), ('control-point', '9001', ?)", [scoutId, scoutId]);
  await run("INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, 'bookmarks', '[16]', 5), (?, 'teamColors', '{}', 7)", [scoutId, scoutId]);
  for (const [uuid, deleted] of [["a", 0], ["b", 0], ["c", 1]] as const)
    await run("INSERT INTO scout_entries (uuid, user_id, season, team, kind, data, updated_at, deleted) VALUES (?, ?, 2026, 16, 'match', '{}', 100, ?)", [uuid, scoutId, deleted]);
  const ws = await get<{ id: number }>("INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES ('cp1', 'Hypnotic Robotics', '2026-10-02', '2026-10-02') RETURNING id");
  const gone = await get<{ id: number }>("INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at, orphaned_at, orphan_reason) VALUES ('cp2', 'Gone Team', '2026-10-03', '2026-10-03', '2026-10-15', 'deleted') RETURNING id");
  // Deleted in Control Point: Priya (9001) keeps reading it as a former member; 9002 is former of a still-live space (cp1) too, counted once.
  await run("INSERT INTO workspace_former_members (workspace_id, account_id, role) VALUES (?, 9001, 'member'), (?, 9002, 'member')", [gone!.id, ws!.id]);
  await run("INSERT INTO workspace_members (account_id, cp_workspace_id, workspace_name, role, updated_at) VALUES (9001, 'cp1', 'Hypnotic Robotics', 'admin', 1), (9002, 'cp1', 'Hypnotic Robotics', 'member', 1)");
  for (const [uuid, author, deleted, seq] of [["w1", 9001, 0, 1], ["w2", 9002, 0, 2], ["w3", 9001, 1, 3]] as const)
    await run("INSERT INTO workspace_scout_entries (workspace_id, uuid, season, team, kind, data, updated_at, deleted, author_account_id, editor_account_id, seq) VALUES (?, ?, 2026, 16, 'match', '{}', ?, ?, ?, ?, ?)", [ws!.id, uuid, 1000 + author, deleted, author, author, seq]);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); if (saved === undefined) delete process.env.OWNER_EMAILS; else process.env.OWNER_EMAILS = saved; });

describe("owner users and workspaces", () => {
  it("are the owner's only (404 for anyone else)", async () => {
    for (const p of ["/api/owner/users", `/api/owner/users/${scoutId}`, "/api/owner/workspaces"]) expect((await call(p, otherCookie)).status).toBe(404);
  });

  it("lists accounts, most recently seen first, with sign-ins, entries and workspaces", async () => {
    const { json } = await call<{ users: OwnerUser[]; total: number }>("/api/owner/users");
    expect(json.total).toBe(2);
    // (The owner's own requests just refreshed their last-seen, so they're first.)
    expect(json.users.map((u) => u.email)).toEqual(["owner@example.com", "priya@example.com"]);
    expect(json.users[1]).toEqual({ id: scoutId, email: "priya@example.com", displayName: "Priya", createdAt: "2026-10-01T00:00:00Z", lastSeen: expect.any(String), providers: ["control-point", "email"], personalEntries: 2, workspaces: 2 });
  });

  it("searches by email or name", async () => {
    expect((await call<{ users: OwnerUser[] }>("/api/owner/users?q=PRI")).json.users.map((u) => u.email)).toEqual(["priya@example.com"]);
    expect((await call<{ users: OwnerUser[]; total: number }>("/api/owner/users?q=nobody")).json).toEqual({ users: [], total: 0 });
  });

  it("opens one account in full", async () => {
    const { status, json } = await call<OwnerUserDetail>(`/api/owner/users/${scoutId}`);
    expect(status).toBe(200);
    expect(json.signIns).toEqual(["control-point", "email"]);
    expect(json.controlPointAccount).toBe(9001);
    expect(json.sessions).toEqual([{ createdAt: "2026-10-17T00:00:00Z", expiresAt: expect.any(String), device: "Mozilla/5.0 Test" }]);
    expect(json.saved).toEqual([{ key: "bookmarks", updatedAt: 5 }, { key: "teamColors", updatedAt: 7 }]);
    expect(json.personalEntries).toEqual({ count: 2, lastUpdated: 100 });
    // A workspace deleted in Control Point stays on the account while it can still read it.
    expect(json.workspaces).toEqual([
      { id: "cp2", name: "Gone Team", role: "member", orphaned: true, authoredEntries: 0 },
      { id: "cp1", name: "Hypnotic Robotics", role: "admin", orphaned: false, authoredEntries: 1 },
    ]);
    expect((await call(`/api/owner/users/99999`)).status).toBe(404);
    expect((await call(`/api/owner/users/abc`)).status).toBe(404);
  });

  it("lists Scout spaces with members, live entries, last activity and orphaned state", async () => {
    const { json } = await call<{ workspaces: OwnerWorkspace[] }>("/api/owner/workspaces");
    expect(json.workspaces).toEqual([
      { id: "cp1", name: "Hypnotic Robotics", createdAt: "2026-10-02", members: 2, entries: 2, lastEntryAt: 10002, orphaned: null },
      // Its former members still count (they can read it); 9002's former row for live cp1 isn't counted twice.
      { id: "cp2", name: "Gone Team", createdAt: "2026-10-03", members: 1, entries: 0, lastEntryAt: null, orphaned: { at: "2026-10-15", reason: "deleted" } },
    ]);
  });
});
