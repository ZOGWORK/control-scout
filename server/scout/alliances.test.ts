// Scouting alliances (docs/alliances.md), against a stub Control Point. Every new cross-workspace read and write
// is checked both ways: starting and joining are each workspace's admin only; the shared reads (entries,
// assignments, coverage, consensus, another member's pick list) need membership of a workspace in the alliance and
// only see its event; nothing lets another member (admin or not) write into a workspace; an ended alliance, or one
// a workspace left, reads nothing; copies go only between workspaces that both agreed. Three and more members:
// joining, leaving (the rest carry on while two are left), removal by the creator, and two-team links carrying over.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { setFlag, setWorkspaceOverride } from "../flags";
import { closeAllStreams } from "./stream";
import { clearConsensusCache } from "./consensus";
import { answersOf, copyUuid, coverageOf, setAllianceClock, settleAlliances } from "./alliances";
import { builtinTemplate } from "../../src/shared/scoutDefaults";
import { workspaceTemplateId } from "../../src/shared/scoutTemplate";
import { allianceEndsAt, MAX_ALLIANCE_MEMBERS, normalInviteCode } from "../../src/shared/alliances";

const KEY = "k".repeat(40);
const S = 2025;
const EV = "USALQ1";
const OTHER_EV = "USALQ2";
const ENDS = "2025-11-08";
let scout: Server, cp: Server;
let base = "", cpBase = "";
const codes = new Map<string, string>();

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
  await run("INSERT INTO teams (number, name) VALUES (101, 'Alpha'), (102, 'Beta'), (103, 'Gamma'), (18360, 'Pyro')");
  await run(`INSERT INTO events (season, code, name, start, end, source) VALUES (?, ?, 'Alabama Qualifier', '2025-11-08', ?, 'first'),
    (?, ?, 'Alabama Qualifier 2', '2025-12-06', '2025-12-06', 'first'), (?, 'NODATES', 'Dateless', NULL, NULL, 'first')`, [S, EV, ENDS, S, OTHER_EV, S]);
  await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, 101), (?, ?, 102), (?, ?, 103)", [S, EV, S, EV, S, EV]);
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
  // Each test starts with the event not yet over.
  setAllianceClock(() => Date.parse("2025-11-01T12:00:00Z"));
  // And with nothing scouted, assigned or picked yet.
  for (const t of ["scout_alliances", "scout_alliance_copy_queue", "scout_alliance_copies", "workspace_template_versions", "workspace_scout_entries", "workspace_entry_versions", "workspace_assignments", "workspace_picklist", "workspace_picklist_versions"]) await run(`DELETE FROM ${t}`);
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});
afterEach(() => { setAllianceClock(null); });

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

// Workspace A ("Gearheads"): Ada admin, Abe member. Workspace B ("Pyro"): Bea admin, Ben member. Workspace C: Cal admin.
const A = "alA", B = "alB", C = "alC";
let people: { ada: Call; abe: Call; bea: Call; ben: Call; cal: Call; anon: Call } | null = null;
async function cast() {
  if (people) return people;
  const join = (email: string, id: string, name: string, role: "admin" | "member") => { const a = accountFor(email); a.workspaces = [...(a.workspaces ?? []), { id, name, role }]; };
  join("al-ada@example.com", A, "Gearheads", "admin"); join("al-abe@example.com", A, "Gearheads", "member");
  join("al-bea@example.com", B, "Pyro", "admin"); join("al-ben@example.com", B, "Pyro", "member");
  join("al-cal@example.com", C, "Outsiders", "admin");
  people = {
    ada: await signIn("al-ada@example.com", "Ada"), abe: await signIn("al-abe@example.com", "Abe"),
    bea: await signIn("al-bea@example.com", "Bea"), ben: await signIn("al-ben@example.com", "Ben"),
    cal: await signIn("al-cal@example.com", "Cal"), anon: client(),
  };
  return people;
}

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({
  uuid: `alliance${String(++n).padStart(6, "0")}`, season: S, team: 101, eventCode: EV, matchLabel: `Q${n}`, kind: "match",
  data: {}, notes: "", updatedAt: Date.parse("2025-10-01T00:00:00Z") + n * 1000, ...over,
});
const push = (call: Call, ws: string, entries: unknown[]) => call("POST", "/api/me/scout/sync", { workspaceId: ws, entries });
const pushOk = async (call: Call, ws: string, entries: unknown[]) => {
  const r = await push(call, ws, entries);
  expect(r.status).toBe(200);
  expect(r.json.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
};
const list = (call: Call, ws: string) => call("GET", `/api/scout/workspaces/${ws}/alliances`);
const invite = (call: Call, ws: string, body: Record<string, unknown> = {}) => call("POST", `/api/scout/workspaces/${ws}/alliances`, { season: S, eventCode: EV, keepCopies: true, ...body });
const accept = (call: Call, ws: string, code: string, keepCopies = true) => call("POST", `/api/scout/workspaces/${ws}/alliances/accept`, { code, keepCopies });
const sharedOf = (call: Call, ws: string, id: number) => call("GET", `/api/scout/workspaces/${ws}/alliances/${id}/shared`);
const consensusOf = (call: Call, ws: string, id: number, teams = "101") => call("GET", `/api/scout/workspaces/${ws}/alliances/${id}/consensus?teams=${teams}`);
const picklistOf = (call: Call, ws: string, id: number) => call("GET", `/api/scout/workspaces/${ws}/alliances/${id}/picklist`);
const end = (call: Call, ws: string, id: number) => call("POST", `/api/scout/workspaces/${ws}/alliances/${id}/end`, {});
const leave = (call: Call, ws: string, id: number) => call("POST", `/api/scout/workspaces/${ws}/alliances/${id}/leave`, {});
const remove = (call: Call, ws: string, id: number, member: string) => call("POST", `/api/scout/workspaces/${ws}/alliances/${id}/members/${member}/remove`, {});
const newCode = (call: Call, ws: string, id: number) => call("POST", `/api/scout/workspaces/${ws}/alliances/${id}/invite`, {});
/** "you" or "partner", for the reader's workspace `you`. */
const sideOf = (you: string, ws: string) => (ws === you ? "you" : "partner");

/** A links with B for EV (A's Ada invites, B's Bea accepts); each side's consent to copies as given. */
async function link(aKeeps = true, bKeeps = true): Promise<number> {
  const p = await cast();
  const i = await invite(p.ada, A, { keepCopies: aKeeps });
  expect(i.status).toBe(201);
  const a = await accept(p.bea, B, i.json.code, bKeeps);
  expect(a.status).toBe(200);
  return a.json.alliance.id;
}

describe("invite and accept: both sides' admins consent", () => {
  it("only an admin invites, once per event, for an event that has dates and isn't over", async () => {
    const p = await cast();
    expect((await invite(p.anon, A)).status).toBe(401);
    expect((await invite(p.abe, A)).status).toBe(403); // a member
    expect((await invite(p.cal, A)).status).toBe(403); // not in A at all
    expect((await invite(p.ada, A, { eventCode: "NOPE" })).status).toBe(404);
    expect((await invite(p.ada, A, { eventCode: "NODATES" })).status).toBe(400);
    expect((await invite(p.ada, A, { keepCopies: "yes" })).status).toBe(400);
    const i = await invite(p.ada, A);
    expect(i.status).toBe(201);
    expect(normalInviteCode(i.json.code)).toBe(i.json.code);
    expect(i.json.alliance).toMatchObject({ status: "pending", eventCode: EV, eventName: "Alabama Qualifier", you: { workspaceId: A, creator: true }, members: [{ workspaceId: A }] });
    expect((await invite(p.ada, A)).status).toBe(409); // one live link per workspace per event
    // Only the hash is stored.
    expect(JSON.stringify(await all("SELECT * FROM scout_alliances"))).not.toContain(i.json.code);
    setAllianceClock(() => allianceEndsAt(ENDS) + 1);
    expect((await invite(p.ada, A, { eventCode: EV })).status).toBe(400); // over
  });

  it("the partner's admin accepts with the code; a member, the inviter's own workspace, or a used code can't", async () => {
    const p = await cast();
    const i = await invite(p.ada, A, { keepCopies: false });
    expect((await accept(p.ben, B, i.json.code)).status).toBe(403); // B's member
    expect((await accept(p.ada, A, i.json.code)).status).toBe(400); // A can't accept its own
    expect((await accept(p.bea, B, "not a code")).status).toBe(400);
    expect((await accept(p.bea, B, "AAAAA-AAAAA")).status).toBe(404);
    const a = await accept(p.bea, B, i.json.code.toLowerCase().replace(/(.{5})/, "$1 "));
    expect(a.status).toBe(200);
    expect(a.json.alliance).toMatchObject({ status: "active", you: { workspaceId: B, name: "Pyro", keepsCopies: true, creator: false },
      members: [{ workspaceId: A, name: "Gearheads", keepsCopies: false, creator: true }, { workspaceId: B }] });
    // Both sides' members see it; an outsider's list doesn't.
    expect((await list(p.abe, A)).json.alliances.map((x: any) => x.status)).toEqual(["active"]);
    expect((await list(p.ben, B)).json).toMatchObject({ canManage: false, alliances: [{ members: [{ name: "Gearheads" }, { name: "Pyro" }] }] });
    expect((await list(p.cal, C)).json.alliances).toEqual([]);
    expect((await list(p.cal, A)).status).toBe(403);
  });

  it("a workspace already linked at the event can't accept another invite for it", async () => {
    const p = await cast();
    await link();
    const c = await invite(p.cal, C);
    expect((await accept(p.bea, B, c.json.code)).status).toBe(409);
  });

  it("an unaccepted invite expires with its event, and its code stops working", async () => {
    const p = await cast();
    const i = await invite(p.ada, A);
    setAllianceClock(() => allianceEndsAt(ENDS));
    expect((await accept(p.bea, B, i.json.code)).status).toBe(404);
    expect((await list(p.ada, A)).json.alliances[0]).toMatchObject({ status: "ended", endedReason: "expired" });
  });
});

describe("linked for the event: the shared reads", () => {
  it("both sides read the union of entries and assignments at the event, nothing from other events", async () => {
    const p = await cast();
    const id = await link();
    await pushOk(p.abe, A, [entry({ team: 101, notes: "A at the event" }), entry({ team: 102, eventCode: OTHER_EV, notes: "A elsewhere" })]);
    await pushOk(p.ben, B, [entry({ team: 101, notes: "B at the event" }), entry({ team: 103, eventCode: OTHER_EV, notes: "B elsewhere" })]);
    for (const [call, ws, mine, theirs] of [[p.abe, A, "A at the event", "B at the event"], [p.ben, B, "B at the event", "A at the event"]] as const) {
      const r = await sharedOf(call, ws, id);
      expect(r.status).toBe(200);
      const notes = r.json.entries.map((e: any) => `${sideOf(ws, e.workspaceId)}:${e.notes}`).sort();
      expect(notes).toEqual([`partner:${theirs}`, `you:${mine}`]);
    }
  });

  it("refuses everyone who isn't a member of a linked workspace", async () => {
    const p = await cast();
    const id = await link();
    expect((await sharedOf(p.anon, A, id)).status).toBe(401);
    expect((await sharedOf(p.cal, A, id)).status).toBe(403); // not a member of A
    expect((await sharedOf(p.cal, B, id)).status).toBe(403);
    expect((await sharedOf(p.cal, C, id)).status).toBe(404); // a member of C, but C isn't in this link
    for (const path of ["consensus?teams=101", "picklist"]) {
      expect((await p.cal("GET", `/api/scout/workspaces/${C}/alliances/${id}/${path}`)).status).toBe(404);
      expect((await p.cal("GET", `/api/scout/workspaces/${A}/alliances/${id}/${path}`)).status).toBe(403);
    }
  });

  it("a pending invite shares nothing yet", async () => {
    const p = await cast();
    const i = await invite(p.ada, A);
    expect((await sharedOf(p.ada, A, i.json.alliance.id)).status).toBe(410);
  });

  it("one consensus over both sides' entries at the event; each workspace's own consensus stays its own", async () => {
    const p = await cast();
    const id = await link();
    await pushOk(p.abe, A, [entry({ team: 101 }), entry({ team: 101, eventCode: OTHER_EV })]);
    await pushOk(p.ben, B, [entry({ team: 101 }), entry({ team: 101 }), entry({ team: 101, eventCode: OTHER_EV })]);
    const fromA = await consensusOf(p.abe, A, id);
    const fromB = await consensusOf(p.ben, B, id);
    expect(fromA.status).toBe(200);
    expect(fromA.json.teams[0].entries).toBe(3); // A's 1 + B's 2 at the event; neither side's other event
    expect(fromB.json.teams).toEqual(fromA.json.teams);
    expect((await p.abe("GET", `/api/scout/workspaces/${A}/consensus?season=${S}&teams=101`)).json.teams[0].entries).toBe(2);
    // A new partner entry shows at once (the union's cache drops on either side's write).
    await pushOk(p.ben, B, [entry({ team: 101 })]);
    expect((await consensusOf(p.abe, A, id)).json.teams[0].entries).toBe(4);
    expect((await consensusOf(p.abe, A, id, "abc")).status).toBe(400);
  });

  it("one field id asking different questions on each side is never averaged together", async () => {
    const p = await cast();
    const id = await link();
    // Both admins use the id "speed", for different questions on different scales.
    expect((await p.ada("PUT", `/api/scout/workspaces/${A}/template`, { season: S, match: [{ id: "speed", label: "Cycle speed", type: "rating", phase: "overall", max: 5 }] })).status).toBe(200);
    expect((await p.bea("PUT", `/api/scout/workspaces/${B}/template`, { season: S, match: [{ id: "speed", label: "Drive speed", type: "rating", phase: "overall", max: 9 }] })).status).toBe(200);
    await pushOk(p.abe, A, [entry({ team: 101, templateId: workspaceTemplateId(A, S, "match"), templateVersion: 1, data: { speed: 5 } })]);
    await pushOk(p.ben, B, [entry({ team: 101, templateId: workspaceTemplateId(B, S, "match"), templateVersion: 1, data: { speed: 1 } })]);
    const t = (await consensusOf(p.abe, A, id)).json.teams[0];
    const speeds = t.ratings.filter((r: any) => r.id.startsWith("speed")).map((r: any) => [r.label, r.avg, r.max, r.n]).sort();
    expect(speeds).toEqual([["Cycle speed", 5, 5, 1], ["Drive speed", 1, 9, 1]]);
    // Same answer from B's side.
    expect((await consensusOf(p.ben, B, id)).json.teams[0].ratings.length).toBe(t.ratings.length);
  });

  it("each side's assignments at the event, tagged with its side", async () => {
    const p = await cast();
    const id = await link();
    // Members are assignable once they've read the workspace.
    await list(p.abe, A); await list(p.ben, B);
    const ids = { abe: accountFor("al-abe@example.com").id, ben: accountFor("al-ben@example.com").id };
    expect((await p.ada("POST", `/api/scout/workspaces/${A}/assignments`, { season: S, eventCode: EV, teams: [101], assigneeAccountIds: [ids.abe] })).status).toBe(201);
    expect((await p.bea("POST", `/api/scout/workspaces/${B}/assignments`, { season: S, eventCode: EV, teams: [102], assigneeAccountIds: [ids.ben] })).status).toBe(201);
    const r = await sharedOf(p.abe, A, id);
    expect(r.json.assignments.map((x: any) => `${sideOf(A, x.workspaceId)}:${x.team}`).sort()).toEqual(["partner:102", "you:101"]);
  });

  it("the partner's pick list reads (the event's teams only) but can't be written by the other side", async () => {
    const p = await cast();
    const id = await link();
    for (const team of [102, 18360]) expect((await p.bea("POST", `/api/scout/workspaces/${B}/picklist`, { season: S, op: "add", team })).status).toBe(200);
    const r = await picklistOf(p.abe, A, id);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ workspaceId: B, name: "Pyro" });
    expect(r.json.list.picks.map((x: any) => x.team)).toEqual([102]); // 18360 isn't at the event
    // Writes stay members-only: A's admin can't touch B's list.
    expect((await p.ada("POST", `/api/scout/workspaces/${B}/picklist`, { season: S, op: "add", team: 101 })).status).toBe(403);
    expect((await p.ada("GET", `/api/scout/workspaces/${B}/picklist?season=${S}`)).status).toBe(403);
  });

  it("each entry's answers read under the questions of its own template", async () => {
    const p = await cast();
    const id = await link();
    const [f1, f2] = builtinTemplate(S, "match").fields;
    await pushOk(p.ben, B, [entry({ team: 101, data: { [f1.id]: f1.type === "toggle" ? true : 2, [f2.id]: f2.type === "toggle" ? false : 3 } })]);
    const e = (await sharedOf(p.abe, A, id)).json.entries[0];
    expect(e.answers.map((x: any) => x.label)).toEqual([f1.label, f2.label]);
    expect(e).not.toHaveProperty("data");
    expect(answersOf([{ id: "r", label: "Driving", type: "rating", phase: "overall", max: 5 }, { id: "t", label: "Parked", type: "toggle", phase: "endgame" }, { id: "x", label: "Unanswered", type: "text", phase: "overall" }],
      { r: 4, t: true })).toEqual([{ label: "Driving", text: "4 / 5" }, { label: "Parked", text: "Yes" }]);
  });

  it("an event with no team list yet shares none of the partner's picks", async () => {
    const p = await cast();
    const i = await invite(p.ada, A, { eventCode: OTHER_EV });
    const id = (await accept(p.bea, B, i.json.code)).json.alliance.id;
    expect((await p.bea("POST", `/api/scout/workspaces/${B}/picklist`, { season: S, op: "add", team: 102 })).status).toBe(200);
    const r = await picklistOf(p.abe, A, id);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ teamsKnown: false, list: { picks: [] } });
  });

  it("partner admins get no edit rights: B's entries stay B's, and pushing to B is refused", async () => {
    const p = await cast();
    await link();
    const theirs = entry({ team: 101, notes: "Ben's" });
    await pushOk(p.ben, B, [theirs]);
    // Straight at B: not a member.
    expect((await push(p.ada, B, [{ ...theirs, notes: "Ada edits", updatedAt: theirs.updatedAt + 5 }])).status).toBe(403);
    expect((await push(p.ada, B, [{ ...theirs, deleted: true, updatedAt: theirs.updatedAt + 6 }])).status).toBe(403);
    // B's entry is untouched, and B's own sync never shows A's.
    const pulled = (await p.ben("GET", `/api/scout/sync?workspaceId=${B}`)).json.entries;
    expect(pulled.map((e: any) => e.notes)).toEqual(["Ben's"]);
    expect((await p.ada("GET", `/api/scout/sync?workspaceId=${B}`)).status).toBe(403);
    // Raw entry reads of the other workspace stay closed to the partner.
    expect((await p.ada("GET", `/api/scout/workspaces/${B}/consensus?season=${S}&teams=101`)).status).toBe(403);
  });

  it("the partner switching its scouting off hides what it shares", async () => {
    const p = await cast();
    const id = await link();
    await setWorkspaceOverride("workspaceScouting", B, false, "owner@test");
    try {
      const r = await sharedOf(p.abe, A, id);
      expect(r.status).toBe(403);
      expect(r.json.error).toBe("feature_disabled");
    } finally { await setWorkspaceOverride("workspaceScouting", B, null, "owner@test"); }
  });
});

describe("coverage: each side's contribution, shown not policed", () => {
  it("counts each side, including a side that adds nothing, and lists every team at the event", async () => {
    const p = await cast();
    const id = await link();
    await pushOk(p.abe, A, [entry({ team: 101, matchLabel: "Q1" }), entry({ team: 102, matchLabel: "Q1" }), entry({ team: 101, kind: "pit", matchLabel: null })]);
    const r = await sharedOf(p.ben, B, id);
    const [a, b] = r.json.coverage.members;
    expect(b).toMatchObject({ workspaceId: B, entries: 0, teams: 0, matches: 0, scouts: 0 });
    expect(a).toMatchObject({ workspaceId: A, name: "Gearheads", entries: 3, matchEntries: 2, pitEntries: 1, teams: 2, matches: 1, scouts: 1 });
    expect(r.json.coverage.teams.map((t: any) => [t.team, t.total, t.byMember[A] ?? 0, t.byMember[B] ?? 0])).toEqual([[101, 2, 2, 0], [102, 1, 1, 0], [103, 0, 0, 0]]);
  });

  it("coverageOf: a team scouted that isn't on the list still shows", () => {
    const c = coverageOf([{ workspaceId: "x", name: "X" }, { workspaceId: "y", name: "Y" }],
      [{ uuid: "u1", workspaceId: "x", team: 9, kind: "match", matchLabel: "q1", notes: "", answers: [], updatedAt: 1, authorAccountId: 1, authorDisplayName: "" }], []);
    expect(c.teams).toEqual([{ team: 9, name: null, total: 1, byMember: { x: 1 } }]);
    expect(c.members[0].matches).toBe(1);
    expect(c.members[1].entries).toBe(0);
  });
});

describe("ending: the link expires, copies only when both agreed", () => {
  it("after the event both sides keep their own and, both having agreed, a copy of the other's", async () => {
    const p = await cast();
    const id = await link(true, true);
    await pushOk(p.abe, A, [entry({ team: 101, notes: "from A" })]);
    const fromB = entry({ team: 102, notes: "from B" });
    await pushOk(p.ben, B, [fromB, entry({ team: 103, eventCode: OTHER_EV, notes: "B elsewhere" })]);
    setAllianceClock(() => allianceEndsAt(ENDS) + 1);
    expect((await sharedOf(p.abe, A, id)).status).toBe(410);
    expect((await consensusOf(p.abe, A, id)).status).toBe(410);
    expect((await picklistOf(p.abe, A, id)).status).toBe(410);
    const a = (await p.abe("GET", `/api/scout/sync?workspaceId=${A}`)).json.entries;
    expect(a.map((e: any) => e.notes).sort()).toEqual(["from A", "from B"]);
    const copy = a.find((e: any) => e.notes === "from B");
    expect(copy).toMatchObject({ uuid: copyUuid(B, fromB.uuid), authorDisplayName: "Ben", team: 102, eventCode: EV });
    const b = (await p.ben("GET", `/api/scout/sync?workspaceId=${B}`)).json.entries;
    expect(b.map((e: any) => e.notes).sort()).toEqual(["B elsewhere", "from A", "from B"]);
    expect((await list(p.ada, A)).json.alliances[0]).toMatchObject({ status: "ended", endedReason: "event_over", copiesKept: true });
    // The copy is A's now: A's members edit it as any entry of A's; B's own entry is untouched by that.
    await pushOk(p.abe, A, [{ ...copy, notes: "A's note on the copy", updatedAt: copy.updatedAt + 10 }]);
    expect((await p.ben("GET", `/api/scout/sync?workspaceId=${B}`)).json.entries.find((e: any) => e.uuid === fromB.uuid).notes).toBe("from B");
  });

  it("an edit synced after the deadline ends the link first: the copy is the entry as it was at the end", async () => {
    const p = await cast();
    await link(true, true);
    const b1 = entry({ team: 102, notes: "B at the deadline" });
    await pushOk(p.ben, B, [b1]);
    setAllianceClock(() => allianceEndsAt(ENDS) + 1);
    // Nothing has settled the link yet; Ben's later edit arrives first.
    await pushOk(p.ben, B, [{ ...b1, notes: "B after the deadline", updatedAt: b1.updatedAt + 10 }]);
    const a = (await p.abe("GET", `/api/scout/sync?workspaceId=${A}`)).json.entries;
    expect(a.map((e: any) => e.notes)).toEqual(["B at the deadline"]);
  });

  it("no copies when either side said no", async () => {
    const p = await cast();
    await link(true, false);
    await pushOk(p.ben, B, [entry({ team: 102, notes: "only B" })]);
    setAllianceClock(() => allianceEndsAt(ENDS) + 1);
    expect((await list(p.ada, A)).json.alliances[0]).toMatchObject({ status: "ended", copiesKept: false });
    expect((await p.abe("GET", `/api/scout/sync?workspaceId=${A}`)).json.entries.filter((e: any) => e.notes === "only B")).toEqual([]);
  });

  it("the creator can end it early, the other side can leave (ending a two-team link); members can't; ending twice is a 409", async () => {
    const p = await cast();
    const id = await link(true, true);
    await pushOk(p.ben, B, [entry({ team: 102, notes: "B early" })]);
    expect((await end(p.abe, A, id)).status).toBe(403);
    expect((await end(p.cal, C, id)).status).toBe(404);
    expect((await end(p.bea, B, id)).status).toBe(403); // not the creator: B leaves instead
    expect((await leave(p.ben, B, id)).status).toBe(403);
    const r = await leave(p.bea, B, id);
    expect(r.status).toBe(200);
    expect(r.json.alliance).toMatchObject({ status: "ended", endedReason: "left" });
    expect((await list(p.ada, A)).json.alliances[0]).toMatchObject({ status: "ended", endedReason: "unlinked" });
    expect((await end(p.ada, A, id)).status).toBe(409);
    expect((await sharedOf(p.abe, A, id)).status).toBe(410);
    // Copies were made once, even though settling runs again.
    await list(p.ada, A);
    expect((await p.abe("GET", `/api/scout/sync?workspaceId=${A}`)).json.entries.filter((e: any) => e.notes === "B early")).toHaveLength(1);
    // The workspace can link again at the event.
    expect((await invite(p.ada, A)).status).toBe(201);
  });

  it("linking again at the same event: each observation counts once, and nothing is copied twice or copied back", async () => {
    const p = await cast();
    const first = await link(true, true);
    const a1 = entry({ team: 101, notes: "A1" }), b1 = entry({ team: 101, notes: "B1" });
    await pushOk(p.abe, A, [a1]);
    await pushOk(p.ben, B, [b1]);
    await end(p.ada, A, first); // copies: A gets B1, B gets A1
    const second = await link(true, true);
    const shared = (await sharedOf(p.abe, A, second)).json;
    expect(shared.entries.map((e: any) => `${sideOf(A, e.workspaceId)}:${e.notes}`).sort()).toEqual(["partner:B1", "you:A1"]);
    expect(shared.coverage.members[0].entries).toBe(1);
    expect((await consensusOf(p.abe, A, second)).json.teams[0].entries).toBe(2);
    await leave(p.bea, B, second);
    const notes = async (call: Call, ws: string) => (await call("GET", `/api/scout/sync?workspaceId=${ws}`)).json.entries.filter((e: any) => !e.deleted).map((e: any) => e.notes).sort();
    expect(await notes(p.abe, A)).toEqual(["A1", "B1"]);
    expect(await notes(p.ben, B)).toEqual(["A1", "B1"]);
  });

  it("a kept copy whose original was deleted since still counts when the two link again", async () => {
    const p = await cast();
    const first = await link(true, true);
    const a1 = entry({ team: 101, notes: "A1 gone later" });
    await pushOk(p.abe, A, [a1]);
    await end(p.ada, A, first); // B keeps a copy of A1
    await pushOk(p.ada, A, [{ ...a1, deleted: true, updatedAt: a1.updatedAt + 10 }]);
    const second = await link(true, true);
    const shared = (await sharedOf(p.ben, B, second)).json;
    expect(shared.entries.map((e: any) => `${sideOf(B, e.workspaceId)}:${e.notes}`)).toEqual(["you:A1 gone later"]);
    expect((await consensusOf(p.ben, B, second)).json.teams[0].entries).toBe(1);
  });

  it("copies wait while the owner has paused either side's workspace scouting", async () => {
    const p = await cast();
    const id = await link(true, true);
    await pushOk(p.ben, B, [entry({ team: 102, notes: "B while paused" })]);
    await setWorkspaceOverride("workspaceScouting", B, false, "owner@test");
    try {
      await end(p.ada, A, id);
      await settleAlliances();
      expect((await p.abe("GET", `/api/scout/sync?workspaceId=${A}`)).json.entries).toEqual([]);
    } finally { await setWorkspaceOverride("workspaceScouting", B, null, "owner@test"); }
    await settleAlliances();
    expect((await p.abe("GET", `/api/scout/sync?workspaceId=${A}`)).json.entries.map((e: any) => e.notes)).toEqual(["B while paused"]);
  });

  it("two kept copies of a third workspace's entry count once when their holders link", async () => {
    const p = await cast();
    // B links with A, then with C, keeping copies both times: A and C each hold a copy of B1.
    const ab = await link(true, true);
    const b1 = entry({ team: 101, notes: "B1 everywhere" });
    await pushOk(p.ben, B, [b1]);
    await end(p.ada, A, ab);
    const bc = (await accept(p.cal, C, (await invite(p.bea, B)).json.code)).json.alliance.id;
    await leave(p.cal, C, bc);
    // A and C link: B isn't in it, so neither copy has its original here; one of them is read.
    const ac = (await accept(p.cal, C, (await invite(p.ada, A)).json.code)).json.alliance.id;
    const shared = (await sharedOf(p.abe, A, ac)).json;
    expect(shared.entries.map((e: any) => e.notes)).toEqual(["B1 everywhere"]);
    expect(shared.coverage.members.reduce((n: number, m: any) => n + m.entries, 0)).toBe(1);
    expect((await consensusOf(p.abe, A, ac)).json.teams[0].entries).toBe(1);
  });

  it("the inviter can cancel a pending invite, and its code stops working", async () => {
    const p = await cast();
    const i = await invite(p.ada, A);
    expect((await end(p.ada, A, i.json.alliance.id)).json.alliance).toMatchObject({ status: "ended", endedReason: "cancelled" });
    expect((await accept(p.bea, B, i.json.code)).status).toBe(404);
  });
});

describe("the owner's switch: scoutingAlliances off", () => {
  const gone = (r: { status: number; json: any }) => { expect(r.status).toBe(403); expect(r.json).toMatchObject({ error: "feature_disabled", feature: "scoutingAlliances" }); };

  it("off everywhere: no new links, no list, and no cross-workspace read through a live link", async () => {
    const p = await cast();
    const id = await link();
    await pushOk(p.ben, B, [entry({ team: 101, notes: "B's" })]);
    await setFlag("scoutingAlliances", false, "owner@test");
    try {
      gone(await list(p.abe, A));
      gone(await invite(p.ada, A));
      gone(await accept(p.bea, B, "AAAAA-AAAAA"));
      gone(await end(p.ada, A, id));
      for (const [call, ws] of [[p.abe, A], [p.ben, B]] as const) {
        gone(await sharedOf(call, ws, id));
        gone(await consensusOf(call, ws, id));
        gone(await picklistOf(call, ws, id));
      }
      // Each workspace still sees its own scouting.
      expect((await p.abe("GET", `/api/scout/workspaces/${A}/consensus?season=${S}&teams=101`)).json.teams[0].entries).toBe(0);
      expect((await p.ben("GET", `/api/scout/workspaces/${B}/consensus?season=${S}&teams=101`)).json.teams[0].entries).toBe(1);
    } finally { await setFlag("scoutingAlliances", true, "owner@test"); }
    // Back on: the link was kept.
    expect((await sharedOf(p.abe, A, id)).status).toBe(200);
  });

  it("off for the partner only: the other side can't read across either, nor accept its invite", async () => {
    const p = await cast();
    const id = await link();
    await setWorkspaceOverride("scoutingAlliances", B, false, "owner@test");
    try {
      gone(await sharedOf(p.abe, A, id));
      gone(await consensusOf(p.abe, A, id));
      gone(await picklistOf(p.abe, A, id));
      expect((await list(p.abe, A)).status).toBe(200); // A's own list of links still reads
    } finally { await setWorkspaceOverride("scoutingAlliances", B, null, "owner@test"); }
    await end(p.ada, A, id);
    await setWorkspaceOverride("scoutingAlliances", A, false, "owner@test");
    try {
      // C can't accept an invite from A while A is off (A can't even make one).
      gone(await invite(p.ada, A));
      const c = await invite(p.cal, C);
      expect(c.status).toBe(201);
      gone(await accept(p.ada, A, c.json.code));
    } finally { await setWorkspaceOverride("scoutingAlliances", A, null, "owner@test"); }
  });

  it("copies wait while it's off, and are made once it's back on: only what was shared when the link ended", async () => {
    const p = await cast();
    const id = await link(true, true);
    const fromB = entry({ team: 102, notes: "B copy later" });
    await pushOk(p.ben, B, [fromB]);
    await setFlag("scoutingAlliances", false, "owner@test");
    try {
      setAllianceClock(() => allianceEndsAt(ENDS) + 1);
      await settleAlliances();
      expect((await p.abe("GET", `/api/scout/sync?workspaceId=${A}`)).json.entries.map((e: any) => e.notes)).toEqual([]);
      // Scouted after the link ended: never shared, whenever the copies are made.
      await pushOk(p.ben, B, [entry({ team: 103, notes: "B after the end" })]);
    } finally { await setFlag("scoutingAlliances", true, "owner@test"); }
    await settleAlliances();
    const a = (await p.abe("GET", `/api/scout/sync?workspaceId=${A}`)).json.entries;
    expect(a.map((e: any) => e.uuid)).toEqual([copyUuid(B, fromB.uuid)]);
  });
});

describe("more than two teams", () => {
  /** A starts, B and C join with the same code. */
  async function three(keeps: { a?: boolean; b?: boolean; c?: boolean } = {}): Promise<{ id: number; code: string }> {
    const p = await cast();
    const i = await invite(p.ada, A, { keepCopies: keeps.a ?? true });
    expect((await accept(p.bea, B, i.json.code, keeps.b ?? true)).status).toBe(200);
    const c = await accept(p.cal, C, i.json.code, keeps.c ?? true);
    expect(c.status).toBe(200);
    expect(c.json.alliance.members.map((m: any) => m.workspaceId)).toEqual([A, B, C]);
    return { id: c.json.alliance.id, code: i.json.code };
  }
  const notesIn = async (call: Call, ws: string) => (await call("GET", `/api/scout/sync?workspaceId=${ws}`)).json.entries.filter((e: any) => !e.deleted).map((e: any) => e.notes).sort();

  it("one code lets several teams join; every member reads all of them, with one coverage card each and one consensus", async () => {
    const p = await cast();
    const { id } = await three();
    await pushOk(p.abe, A, [entry({ team: 101, notes: "A" })]);
    await pushOk(p.ben, B, [entry({ team: 101, notes: "B" })]);
    await pushOk(p.cal, C, [entry({ team: 102, notes: "C" }), entry({ team: 101, notes: "C2" })]);
    for (const [call, ws] of [[p.abe, A], [p.ben, B], [p.cal, C]] as const) {
      const r = await sharedOf(call, ws, id);
      expect(r.status).toBe(200);
      expect(r.json.entries.map((e: any) => e.notes).sort()).toEqual(["A", "B", "C", "C2"]);
      expect(r.json.coverage.members.map((m: any) => [m.workspaceId, m.entries])).toEqual([[A, 1], [B, 1], [C, 2]]);
      expect(r.json.coverage.teams[0]).toMatchObject({ team: 101, total: 3, byMember: { [A]: 1, [B]: 1, [C]: 1 } });
      expect((await consensusOf(call, ws, id)).json.teams[0].entries).toBe(3);
    }
    // Each other member's pick list, by name.
    expect((await p.bea("POST", `/api/scout/workspaces/${B}/picklist`, { season: S, op: "add", team: 102 })).status).toBe(200);
    expect((await p.cal("POST", `/api/scout/workspaces/${C}/picklist`, { season: S, op: "add", team: 103 })).status).toBe(200);
    expect((await p.abe("GET", `/api/scout/workspaces/${A}/alliances/${id}/picklist?workspace=${B}`)).json.list.picks.map((x: any) => x.team)).toEqual([102]);
    expect((await p.abe("GET", `/api/scout/workspaces/${A}/alliances/${id}/picklist?workspace=${C}`)).json).toMatchObject({ name: "Outsiders", list: { picks: [{ team: 103 }] } });
    expect((await p.abe("GET", `/api/scout/workspaces/${A}/alliances/${id}/picklist?workspace=nope`)).status).toBe(404);
  });

  it("a member leaves: the other two carry on, it reads nothing any more, and copies go both ways with those that agreed", async () => {
    const p = await cast();
    const { id } = await three({ b: false });
    await pushOk(p.abe, A, [entry({ team: 101, notes: "from A" })]);
    await pushOk(p.ben, B, [entry({ team: 101, notes: "from B" })]);
    await pushOk(p.cal, C, [entry({ team: 101, notes: "from C" })]);
    expect((await leave(p.cal, C, id)).json.alliance).toMatchObject({ status: "ended", endedReason: "left" });
    expect((await sharedOf(p.cal, C, id)).status).toBe(410);
    const ab = await sharedOf(p.abe, A, id);
    expect(ab.status).toBe(200);
    expect(ab.json.alliance).toMatchObject({ status: "active", members: [{ workspaceId: A }, { workspaceId: B }] });
    // C's entry stays only as A's own copy (C is out, so its original isn't read).
    expect(ab.json.entries.map((e: any) => `${e.workspaceId}:${e.notes}`).sort()).toEqual([`${A}:from A`, `${A}:from C`, `${B}:from B`]);
    // C and A both agreed: each keeps the other's. B said no: nothing to or from B.
    expect(await notesIn(p.cal, C)).toEqual(["from A", "from C"]);
    expect(await notesIn(p.abe, A)).toEqual(["from A", "from C"]);
    expect(await notesIn(p.ben, B)).toEqual(["from B"]);
    // C's list shows it left; it can come back with the code.
    expect((await list(p.cal, C)).json.alliances[0]).toMatchObject({ id, status: "ended", endedReason: "left" });
  });

  it("the creator removes a member: it reads nothing, keeps no copies, the others keep its entries, and it can't join again", async () => {
    const p = await cast();
    const { id, code } = await three();
    await pushOk(p.abe, A, [entry({ team: 101, notes: "from A" })]);
    await pushOk(p.cal, C, [entry({ team: 101, notes: "from C" })]);
    expect((await remove(p.bea, B, id, C)).status).toBe(403); // not the creator
    expect((await remove(p.ada, A, id, A)).status).toBe(400); // itself: leave instead
    const r = await remove(p.ada, A, id, C);
    expect(r.status).toBe(200);
    expect(r.json.alliance.members.map((m: any) => m.workspaceId)).toEqual([A, B]);
    expect((await sharedOf(p.cal, C, id)).status).toBe(410);
    expect((await list(p.cal, C)).json.alliances[0]).toMatchObject({ endedReason: "removed" });
    expect(await notesIn(p.cal, C)).toEqual(["from C"]);
    expect(await notesIn(p.abe, A)).toEqual(["from A", "from C"]);
    expect((await accept(p.cal, C, code)).status).toBe(403);
    expect((await remove(p.ada, A, id, C)).status).toBe(404);
  });

  it("only the creator makes codes or ends it; a new code replaces the old; the creator leaving passes it on", async () => {
    const p = await cast();
    const i = await invite(p.ada, A);
    const id = i.json.alliance.id;
    expect((await accept(p.bea, B, i.json.code)).status).toBe(200);
    expect((await newCode(p.bea, B, id)).status).toBe(403);
    expect((await newCode(p.abe, A, id)).status).toBe(403); // a member, not an admin
    const fresh = await newCode(p.ada, A, id);
    expect(fresh.status).toBe(200);
    expect(fresh.json.alliance.inviteExpiresAt).toBeGreaterThan(0);
    expect((await accept(p.cal, C, i.json.code)).status).toBe(404); // the old code
    expect((await accept(p.cal, C, fresh.json.code)).status).toBe(200);
    // A leaves: B joined next, so B is the creator now; the code A handed out stops working.
    expect((await leave(p.ada, A, id)).status).toBe(200);
    const fromB = (await list(p.bea, B)).json.alliances[0];
    expect(fromB).toMatchObject({ status: "active", you: { creator: true }, members: [{ workspaceId: B, creator: true }, { workspaceId: C, creator: false }] });
    expect((await end(p.cal, C, id)).status).toBe(403);
    expect((await end(p.bea, B, id)).json.alliance).toMatchObject({ status: "ended", endedReason: "unlinked" });
  });

  it("the creator leaving and removing at once: the removal runs after the hand-over and is refused", async () => {
    const p = await cast();
    const { id } = await three();
    const [left, removed] = await Promise.all([leave(p.ada, A, id), remove(p.ada, A, id, B)]);
    expect(left.status).toBe(200);
    expect(removed.status).toBe(409);
    expect((await list(p.bea, B)).json.alliances[0]).toMatchObject({ status: "active", you: { creator: true }, members: [{ workspaceId: B }, { workspaceId: C }] });
  });

  it("ending while a team is being removed never copies anything to the removed team", async () => {
    const p = await cast();
    const { id } = await three();
    await pushOk(p.abe, A, [entry({ team: 101, notes: "from A" })]);
    await pushOk(p.ben, B, [entry({ team: 101, notes: "from B" })]);
    await Promise.all([remove(p.ada, A, id, C), end(p.ada, A, id)]);
    expect(await notesIn(p.cal, C)).toEqual([]);
    expect((await list(p.cal, C)).json.alliances[0]).toMatchObject({ status: "ended" });
  });

  it("a team removed while copies wait for it (its scouting off) never gets them", async () => {
    const p = await cast();
    const { id } = await three();
    await pushOk(p.ben, B, [entry({ team: 101, notes: "from B" })]);
    await setWorkspaceOverride("workspaceScouting", C, false, "owner@test");
    try {
      expect((await leave(p.bea, B, id)).status).toBe(200); // queues B's entry for C, which waits
      expect((await remove(p.ada, A, id, C)).status).toBe(200);
    } finally { await setWorkspaceOverride("workspaceScouting", C, null, "owner@test"); }
    await settleAlliances();
    expect(await notesIn(p.cal, C)).toEqual([]);
    expect(await notesIn(p.abe, A)).toEqual(["from B"]);
  });

  it("leaving that ends a two-team alliance records its copies as kept", async () => {
    const p = await cast();
    const id = await link(true, true);
    await pushOk(p.ben, B, [entry({ team: 101, notes: "from B" })]);
    expect((await leave(p.bea, B, id)).status).toBe(200);
    expect((await list(p.ada, A)).json.alliances[0]).toMatchObject({ status: "ended", endedReason: "unlinked", copiesKept: true });
  });

  it("an old copy never stands in for its live, edited original when the group's copies are made", async () => {
    const p = await cast();
    // A keeps a copy of B's entry, then B edits the original.
    const ab = await link(true, true);
    const b1 = entry({ team: 101, notes: "B first" });
    await pushOk(p.ben, B, [b1]);
    await end(p.ada, A, ab);
    await pushOk(p.ben, B, [{ ...b1, notes: "B edited", updatedAt: b1.updatedAt + 10 }]);
    // A, B and C link (A first) and end: C gets B's latest answers.
    const { id } = await three();
    await end(p.ada, A, id);
    expect(await notesIn(p.cal, C)).toEqual(["B edited"]);
  });

  it("is full at MAX_ALLIANCE_MEMBERS", async () => {
    const p = await cast();
    const i = await invite(p.ada, A);
    const id = i.json.alliance.id;
    expect((await accept(p.bea, B, i.json.code)).status).toBe(200);
    for (let k = 0; k < MAX_ALLIANCE_MEMBERS - 2; k++) {
      await run("INSERT INTO scout_alliance_members (alliance_id, ws, name, keeps, joined_by_account_id, joined_at) VALUES (?, ?, ?, 0, 0, 1)", [id, `full${k}`, `Full ${k}`]);
    }
    expect((await accept(p.cal, C, i.json.code)).status).toBe(409);
    expect((await newCode(p.ada, A, id)).status).toBe(409);
  });

  it("a member with its scouting switched off is left out; the rest still read each other", async () => {
    const p = await cast();
    const { id } = await three();
    await pushOk(p.ben, B, [entry({ team: 101, notes: "from B" })]);
    await pushOk(p.cal, C, [entry({ team: 101, notes: "from C" })]);
    await setWorkspaceOverride("workspaceScouting", C, false, "owner@test");
    try {
      const r = await sharedOf(p.abe, A, id);
      expect(r.status).toBe(200);
      expect(r.json.entries.map((e: any) => e.notes)).toEqual(["from B"]);
      expect(r.json.coverage.members.map((m: any) => m.workspaceId)).toEqual([A, B]);
      expect((await consensusOf(p.abe, A, id)).json.teams[0].entries).toBe(1);
    } finally { await setWorkspaceOverride("workspaceScouting", C, null, "owner@test"); }
  });

  it("ending after the event copies between every two members that agreed", async () => {
    const p = await cast();
    await three({ c: false });
    await pushOk(p.abe, A, [entry({ team: 101, notes: "from A" })]);
    await pushOk(p.ben, B, [entry({ team: 101, notes: "from B" })]);
    await pushOk(p.cal, C, [entry({ team: 101, notes: "from C" })]);
    setAllianceClock(() => allianceEndsAt(ENDS) + 1);
    await settleAlliances();
    expect(await notesIn(p.abe, A)).toEqual(["from A", "from B"]);
    expect(await notesIn(p.ben, B)).toEqual(["from A", "from B"]);
    expect(await notesIn(p.cal, C)).toEqual(["from C"]);
    expect((await list(p.ada, A)).json.alliances[0]).toMatchObject({ status: "ended", endedReason: "event_over", copiesKept: true });
  });
});

describe("migration 68: two-team links carry over", () => {
  it("each link's inviter and invitee become its members, and an ended link that kept copies says so", async () => {
    const c = openDb(":memory:");
    await migrate(c, 67);
    const ins = `INSERT INTO scout_alliances (season, event_code, ends_on, inviter_ws, inviter_name, inviter_keeps, invited_by_account_id,
      invitee_ws, invitee_name, invitee_keeps, accepted_by_account_id, status, ended_reason, created_at, accepted_at, ended_at, copies_made) VALUES `;
    await c.execute(`${ins} (2025, 'X1', '2025-11-08', 'w1', 'One', 1, 11, 'w2', 'Two', 0, 22, 'active', NULL, 100, 200, NULL, 0)`);
    await c.execute(`${ins} (2025, 'X2', '2025-11-08', 'w1', 'One', 1, 11, 'w3', 'Three', 1, 33, 'ended', 'unlinked', 100, 200, 300, 1)`);
    await c.execute(`${ins} (2025, 'X3', '2025-11-08', 'w4', 'Four', 1, 44, NULL, NULL, NULL, NULL, 'pending', NULL, 100, NULL, NULL, 0)`);
    expect(await migrate(c)).toContain(68);
    const members = (await c.execute("SELECT alliance_id, ws, name, keeps, joined_by_account_id, joined_at, left_at FROM scout_alliance_members ORDER BY alliance_id, joined_at")).rows.map((r) => ({ ...r }));
    expect(members).toEqual([
      { alliance_id: 1, ws: "w1", name: "One", keeps: 1, joined_by_account_id: 11, joined_at: 100, left_at: null },
      { alliance_id: 1, ws: "w2", name: "Two", keeps: 0, joined_by_account_id: 22, joined_at: 200, left_at: null },
      { alliance_id: 2, ws: "w1", name: "One", keeps: 1, joined_by_account_id: 11, joined_at: 100, left_at: null },
      { alliance_id: 2, ws: "w3", name: "Three", keeps: 1, joined_by_account_id: 33, joined_at: 200, left_at: null },
      { alliance_id: 3, ws: "w4", name: "Four", keeps: 1, joined_by_account_id: 44, joined_at: 100, left_at: null },
    ]);
    expect((await c.execute("SELECT id, copies_wanted FROM scout_alliances ORDER BY id")).rows.map((r) => Number(r.copies_wanted))).toEqual([0, 1, 0]);
    c.close();
  });
});
