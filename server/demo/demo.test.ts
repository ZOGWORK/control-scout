// The demo account end to end over HTTP, on an in-memory database with one finished event: opening it, what it
// shows (personal data, the sample workspace with its scouts, pick list and inbox), that it refuses every change,
// that a re-seed replaces rather than piles up, and that it never touches anyone else's data.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { DEMO_ACCOUNT_ID, DEMO_WORKSPACE_ID, demoAccount, isDemoAccount, resetDemoCache, seedDemo } from "./demo";
import { DEMO_READ_ONLY_STATUS, demoRefuses } from "../../src/shared/demo";

let server: Server;
let base = "";
const SEASON = 2026, CODE = "USDEMOQ1";
const TEAMS = [101, 102, 103, 104, 105, 106, 107, 108];

beforeAll(async () => {
  resetDemoCache();
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO events (season, code, name, start, \"end\", region, source) VALUES (?, ?, 'Demo Qualifier', '2026-11-01', '2026-11-01', 'USNJ', 'first')", [SEASON, CODE]);
  for (const [i, t] of TEAMS.entries()) {
    await run("INSERT INTO teams (number, name) VALUES (?, ?)", [t, `Team ${t}`]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, matches, wins, losses, ties) VALUES (?, ?, ?, ?, ?, 5, ?, ?, 0)", [SEASON, CODE, t, 100 - i * 8, 20 - i, 5 - (i % 5), i % 5]);
  }
  for (let n = 1; n <= 10; n++) {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, 'first')", [SEASON, CODE, n, `Q${n}`]);
    const four = [0, 1, 2, 3].map((k) => TEAMS[(n + k * 2) % TEAMS.length]);
    for (const [k, t] of four.entries()) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?)", [SEASON, CODE, n, t, k < 2 ? "red" : "blue", (k % 2) + 1]);
  }
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

let lastCookie = "";
function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) { cookie = set.split(";")[0]; lastCookie = cookie; }
    return { status: res.status, json: await res.json().catch(() => null) as any };
  };
}

describe("demo account", () => {
  const api = client();

  it("opens without an email and says it's the demo", async () => {
    expect((await api("POST", "/api/auth/demo", {})).status).toBe(200);
    const me = (await api("GET", "/api/auth/me")).json.user;
    expect(me.demo).toBe(true);
    expect(me.email).toBeNull();
    expect(me.controlPoint.accountId).toBe(DEMO_ACCOUNT_ID);
    expect(me.controlPoint.workspaces).toEqual([expect.objectContaining({ id: DEMO_WORKSPACE_ID, role: "admin" })]);
    expect(me.controlPoint.teams[0].teamNumber).toBe(101);
    const summary = (await api("GET", "/api/auth/demo")).json.demo;
    expect(summary).toMatchObject({ season: SEASON, eventCode: CODE, myTeam: 101, workspaceId: DEMO_WORKSPACE_ID });
  });

  it("shows real teams from the event in every personal list", async () => {
    const state = (await api("GET", "/api/me/state")).json.state;
    expect(state.myTeam.value).toBe(101);
    expect(state.bookmarks.value).toEqual([102, 103, 104, 105, 106, 107, 108]);
    expect(Object.keys(state.shortlistNotes.value)).toContain("102");
    expect(state.tracked.value.events).toContain(`${SEASON}:${CODE}`);
    const scout = (await api("GET", "/api/me/scout")).json.entries;
    expect(scout.some((e: any) => e.kind === "pit") && scout.some((e: any) => e.kind === "match")).toBe(true);
  });

  it("reads the sample workspace without Control Point: entries by several scouts, members, pick list, inbox", async () => {
    const sync = (await api("GET", `/api/scout/sync?workspaceId=${DEMO_WORKSPACE_ID}`));
    expect(sync.status).toBe(200);
    const authors = new Set(sync.json.entries.map((e: any) => e.authorDisplayName));
    expect(authors.size).toBeGreaterThanOrEqual(4);
    const members = (await api("GET", `/api/scout/workspaces/${DEMO_WORKSPACE_ID}/members`)).json.members;
    expect(members).toHaveLength(5);
    const picks = (await api("GET", `/api/scout/workspaces/${DEMO_WORKSPACE_ID}/picklist?season=${SEASON}`)).json.list.picks;
    expect(picks.map((p: any) => p.team).slice(0, 3)).toEqual([102, 103, 104]);
    expect((await api("GET", "/api/inbox/unread-count")).json.unread).toBeGreaterThan(0);
  });

  it("refuses every change with 405, and keeps the data as it was", async () => {
    const tries: [string, string, unknown][] = [
      ["PUT", "/api/me/state/myTeam", { value: 999, updatedAt: Date.now() + 1000 }],
      ["POST", "/api/me/migrate", { state: {}, scout: [] }],
      ["DELETE", "/api/me", {}],
      ["PUT", "/api/me/username", { username: "Taken" }],
      ["POST", `/api/scout/workspaces/${DEMO_WORKSPACE_ID}/picklist`, { season: SEASON, ops: [] }],
      ["POST", "/api/me/scout/sync", { workspaceId: DEMO_WORKSPACE_ID, entries: [] }],
      ["POST", "/api/videos/notes", { key: "c:abc", body: "x" }],
    ];
    for (const [m, p, b] of tries) {
      const r = await api(m, p, b);
      expect(r.status, `${m} ${p}`).toBe(DEMO_READ_ONLY_STATUS);
      expect(r.json.code).toBe("demo_read_only");
    }
    expect((await api("GET", "/api/me/state")).json.state.myTeam.value).toBe(101);
  });

  it("refuses a change however the cookie is spaced (read as the session code reads it)", async () => {
    const token = lastCookie.split("=").slice(1).join("=");
    for (const cookie of [`cs_session =${token}`, `cs_session	=${token}`, `x=1;   cs_session = ${token}`]) {
      const r = await fetch(`${base}/api/me/state/myTeam`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: base, Cookie: cookie }, body: JSON.stringify({ value: 999, updatedAt: Date.now() + 1000 }) });
      expect(r.status, cookie).toBe(DEMO_READ_ONLY_STATUS);
    }
  });

  it("a re-seed numbers on from the last seed's entries, and one it drops comes back deleted", async () => {
    const ws = await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", [DEMO_WORKSPACE_ID]);
    const top = async () => Number((await get<{ s: number }>("SELECT MAX(seq) s FROM workspace_scout_entries WHERE workspace_id = ?", [ws!.id]))!.s);
    await run("INSERT INTO workspace_scout_entries (workspace_id, uuid, season, team, event_code, match_label, kind, data, notes, updated_at, deleted, author_account_id, author_name, editor_account_id, editor_name, seq, template_version) VALUES (?, 'demo-ws-old-entry', ?, 101, ?, 'Q99', 'match', '{}', '', 1, 0, ?, 'Avery', ?, 'Avery', ?, 0)", [ws!.id, SEASON, CODE, DEMO_ACCOUNT_ID + 1, DEMO_ACCOUNT_ID + 1, (await top()) + 1]);
    const before = await top();
    await seedDemo((await demoAccount()).id, Date.now() + 2);
    const least = Number((await get<{ s: number }>("SELECT MIN(seq) s FROM workspace_scout_entries WHERE workspace_id = ?", [ws!.id]))!.s);
    expect(least).toBeGreaterThan(before); // a device at the old cursor pulls the whole new seed
    const gone = await get<{ deleted: number; seq: number }>("SELECT deleted, seq FROM workspace_scout_entries WHERE uuid = 'demo-ws-old-entry'");
    expect(gone).toMatchObject({ deleted: 1 });
    expect(Number(gone!.seq)).toBeGreaterThan(before);
    await run("DELETE FROM workspace_scout_entries WHERE uuid = 'demo-ws-old-entry'"); // the next test counts rows
  });

  it("a re-seed with no finished event left still tells devices the old entries are gone", async () => {
    const ws = await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", [DEMO_WORKSPACE_ID]);
    const live = async () => Number((await get<{ n: number }>("SELECT COUNT(*) n FROM workspace_scout_entries WHERE workspace_id = ? AND deleted = 0", [ws!.id]))!.n);
    expect(await live()).toBeGreaterThan(0);
    await run("UPDATE matches SET played = 0 WHERE season = ? AND code = ?", [SEASON, CODE]); // no event to seed from
    try {
      expect((await api("GET", "/api/auth/me")).json.user.controlPoint.teams).toHaveLength(1); // My team cached
      await seedDemo((await demoAccount()).id, Date.now() + 3);
      expect(await live()).toBe(0);
      expect((await api("GET", "/api/auth/me")).json.user.controlPoint.teams).toEqual([]); // and let go once the seed committed
      expect(Number((await get<{ n: number }>("SELECT COUNT(*) n FROM workspace_scout_entries WHERE workspace_id = ? AND deleted = 1", [ws!.id]))!.n)).toBeGreaterThan(0);
    } finally {
      await run("UPDATE matches SET played = 1 WHERE season = ? AND code = ?", [SEASON, CODE]);
      await seedDemo((await demoAccount()).id, Date.now() + 4);
    }
  });

  it("re-seeds in place: the same number of rows, never a second copy", async () => {
    const count = async () => Number((await get<{ n: number }>("SELECT COUNT(*) n FROM workspace_scout_entries"))!.n);
    const before = await count();
    const id = (await demoAccount()).id;
    await seedDemo(id, Date.now() + 1);
    expect(await count()).toBe(before);
    expect((await all("SELECT 1 FROM users WHERE display_name = 'Demo Scout'")).length).toBe(1);
  });

  it("signs out, and a real account still writes as usual", async () => {
    expect((await api("POST", "/api/auth/logout", {})).status).toBe(200);
    expect((await api("GET", "/api/auth/me")).json.user).toBeNull();
    // A real account's session isn't touched by the guard (anonymous writes get the usual 401).
    expect((await api("PUT", "/api/me/state/myTeam", { value: 1, updatedAt: 1 })).status).toBe(401);
  });
});

describe("demo rules", () => {
  it("lets the demo sign out, sign in for real and send reports, and refuses everything else", () => {
    expect(demoRefuses("POST", "/auth/logout")).toBe(false);
    expect(demoRefuses("POST", "/api/auth/email/start")).toBe(false);
    expect(demoRefuses("POST", "/api/collect/vitals")).toBe(false);
    expect(demoRefuses("GET", "/api/me/state")).toBe(false);
    expect(demoRefuses("PUT", "/api/me/state/myTeam")).toBe(true);
    expect(demoRefuses("POST", "/api/auth/logoutx")).toBe(true);
    expect(demoRefuses("DELETE", "/api/me")).toBe(true);
  });
  it("keeps its sample accounts apart from Control Point's", () => {
    expect(isDemoAccount(DEMO_ACCOUNT_ID)).toBe(true);
    expect(isDemoAccount(DEMO_ACCOUNT_ID + 4)).toBe(true);
    expect(isDemoAccount(12345)).toBe(false);
  });
});
