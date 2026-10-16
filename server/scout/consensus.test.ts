// v1.6 Task 1: scout consensus, against a stub Control Point. Two members' entries on one team make one
// consensus with the right averages (across template versions too); tags are counted; deleted entries stay
// out; non-members (and members of another workspace) get 403 and nothing leaks across workspaces; a write
// refreshes the cached answer at once, anything else within 60 s; teams are batched.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { setFlag } from "../flags";
import { closeAllStreams } from "./stream";
import { CACHE_TTL_MS, clearConsensusCache, consensusFor, setConsensusClock } from "./consensus";
import { workspaceTemplateId } from "../../src/shared/scoutTemplate";
import type { TeamConsensus } from "../../src/shared/consensus";

const KEY = "k".repeat(40);
const S = 2025;
let scout: Server, cp: Server;
let base = "", cpBase = "";
const codes = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 9300 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
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
  await run("INSERT INTO teams (number, name) VALUES (101, 'Alpha'), (102, 'Beta'), (18360, 'Pyro')");
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
  clearConsensusCache();
  Object.assign(process.env, { CONTROL_POINT_INTERNAL_URL: cpBase, CONTROL_POINT_PUBLIC_URL: "https://cp.test", CONTROL_POINT_INTERNAL_KEY: KEY, APP_URL: "http://127.0.0.1" });
});
afterEach(() => { setConsensusClock(null); });

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
    return { status: r.status, json: text ? JSON.parse(text) : null, headers: r.headers };
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

let people: { coach: Call; priya: Call; marcus: Call; olly: Call } | null = null;
/** Workspace `ws`: Coach its admin, Priya and Marcus members; Olly in workspace `other` only. */
async function team(ws: string, other: string) {
  const join = (email: string, id: string, role: "admin" | "member") => { const a = accountFor(email); a.workspaces = [...(a.workspaces ?? []), { id, name: `Space ${id}`, role }]; };
  join("cs-coach@example.com", ws, "admin"); join("cs-priya@example.com", ws, "member"); join("cs-marcus@example.com", ws, "member");
  join("cs-olly@example.com", other, "admin");
  people ??= { coach: await signIn("cs-coach@example.com", "Coach"), priya: await signIn("cs-priya@example.com", "Priya"), marcus: await signIn("cs-marcus@example.com", "Marcus"), olly: await signIn("cs-olly@example.com", "Olly") };
  return people;
}

let n = 0;
const entry = (over: Record<string, unknown> = {}) => ({
  uuid: `consensus${String(++n).padStart(6, "0")}`, season: S, team: 18360, eventCode: "USCAQ1", matchLabel: `Q${n}`, kind: "match",
  data: {}, notes: "", updatedAt: 1_700_000_000_000 + n * 1000, ...over,
});
const push = async (call: Call, ws: string, entries: unknown[]) => {
  const r = await call("POST", "/api/me/scout/sync", { workspaceId: ws, entries });
  expect(r.status).toBe(200);
  expect(r.json.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
};
const consensus = (call: Call, ws: string, teams = "18360", season = S) => call("GET", `/api/scout/workspaces/${ws}/consensus?season=${season}&teams=${teams}`);
const one = async (call: Call, ws: string): Promise<TeamConsensus> => {
  const r = await consensus(call, ws);
  expect(r.status).toBe(200);
  return r.json.teams[0];
};
const num = (c: TeamConsensus, id: string) => [...c.ratings, ...c.counters].find((x) => x.id === id);

describe("scout consensus", () => {
  it("two members' entries on one team: one consensus with the right averages, scouts and last-updated", async () => {
    const { priya, marcus } = await team("2101", "2901");
    const a = entry({ data: { driver: 4, consistency: 5, artifacts: 20, autoArtifacts: 3 } });
    const b = entry({ data: { driver: 2, consistency: 3, artifacts: 30, autoArtifacts: 0 } });
    await push(priya, "2101", [a]);
    await push(marcus, "2101", [b]);
    const c = await one(priya, "2101");
    expect(c).toMatchObject({ team: 18360, entries: 2, matchEntries: 2, pitEntries: 0, scouts: 2, lastUpdated: b.updatedAt });
    expect(num(c, "driver")).toEqual({ kind: "match", id: "driver", label: "Driver skill", type: "rating", avg: 3, max: 5, n: 2 });
    expect(num(c, "consistency")).toMatchObject({ avg: 4, n: 2 });
    expect(num(c, "artifacts")).toEqual({ kind: "match", id: "artifacts", label: "Artifacts classified (TeleOp)", type: "counter", avg: 25, n: 2 });
    expect(num(c, "autoArtifacts")).toMatchObject({ avg: 1.5, n: 2 });
    // Unanswered fields aren't averaged as zeros.
    expect(num(c, "fouls")).toBeUndefined();
    // Both members read the same answer.
    expect(await one(marcus, "2101")).toEqual(c);
  });

  it("averages across template versions by field id, each answer on its own scale; labels from the newest", async () => {
    const { coach, priya, marcus } = await team("2102", "2902");
    // Version 0 (built-in): driver on 1..5.
    await push(priya, "2102", [entry({ data: { driver: 5, artifacts: 10 } })]);
    // Version 1: driver on 1..9 with a new label; artifacts kept.
    const put = await coach("PUT", "/api/scout/workspaces/2102/template", {
      season: S, match: [
        { id: "driver", label: "Driving", type: "rating", phase: "overall", max: 9 },
        { id: "artifacts", label: "Artifacts", type: "counter", phase: "teleop", max: 60 },
      ],
    });
    expect(put.status).toBe(200);
    const tid = workspaceTemplateId("2102", S, "match");
    await push(marcus, "2102", [entry({ templateId: tid, templateVersion: 1, data: { driver: 1, artifacts: 30 } })]);
    const c = await one(priya, "2102");
    // 5 of 1..5 is the top (1.0), 1 of 1..9 the bottom (0.0): halfway, on the newest scale 1..9 = 5.
    expect(num(c, "driver")).toEqual({ kind: "match", id: "driver", label: "Driving", type: "rating", avg: 5, max: 9, n: 2 });
    expect(num(c, "artifacts")).toMatchObject({ label: "Artifacts", avg: 20, n: 2 });
    expect(c.strengths).toEqual([{ label: "Driving", count: 1 }]);
    expect(c.weaknesses).toEqual([{ label: "Driving", count: 1 }]);
  });

  it("tags: choice answers and yes answers counted per entry, most common first; strengths and weaknesses from ratings", async () => {
    const { priya, marcus } = await team("2103", "2903");
    await push(priya, "2103", [
      entry({ data: { base: "Full", defense: true, driver: 5, consistency: 1 } }),
      entry({ data: { base: "Full", defense: true, broke: false, driver: 4, consistency: 2 } }),
    ]);
    await push(marcus, "2103", [
      entry({ data: { base: "Partial", broke: true, driver: 3, consistency: 1, notAField: "x" } }),
      entry({ kind: "pit", data: { drivetrain: "Mecanum", canDefend: true } }),
    ]);
    const c = await one(marcus, "2103");
    expect(c).toMatchObject({ entries: 4, matchEntries: 3, pitEntries: 1 });
    expect(c.tags).toEqual([
      { label: "Returned to base: Full", count: 2 },
      { label: "Played defense", count: 2 },
      // One each, in the order first seen newest-first: Marcus's pit entry is the newest.
      { label: "Drivetrain: Mecanum", count: 1 },
      { label: "Willing to play defense", count: 1 },
      { label: "Returned to base: Partial", count: 1 },
    ]);
    expect(c.strengths).toEqual([{ label: "Driver skill", count: 2 }]);
    expect(c.weaknesses).toEqual([{ label: "Consistency", count: 3 }]);
  });

  it("deleted entries are left out, and the delete shows at once (no waiting for the cache)", async () => {
    const { priya, marcus } = await team("2104", "2904");
    const a = entry({ data: { driver: 5 } }), b = entry({ data: { driver: 1 } });
    await push(priya, "2104", [a]);
    await push(marcus, "2104", [b]);
    expect(num(await one(priya, "2104"), "driver")).toMatchObject({ avg: 3, n: 2 });
    await push(marcus, "2104", [{ ...b, deleted: true, updatedAt: b.updatedAt + 1 }]);
    const c = await one(priya, "2104");
    expect(c).toMatchObject({ entries: 1, scouts: 1, lastUpdated: a.updatedAt });
    expect(num(c, "driver")).toMatchObject({ avg: 5, n: 1 });
    // Every entry deleted: an empty consensus (the page shows "No scouting yet").
    await push(priya, "2104", [{ ...a, deleted: true, updatedAt: a.updatedAt + 1 }]);
    expect(await one(priya, "2104")).toEqual({ team: 18360, entries: 0, matchEntries: 0, pitEntries: 0, scouts: 0, lastUpdated: null, ratings: [], counters: [], strengths: [], weaknesses: [], tags: [] });
  });

  it("only members: signed out 401, a non-member 403, and another workspace's entries never mix in", async () => {
    const { priya, olly } = await team("2105", "2905");
    await push(priya, "2105", [entry({ data: { driver: 5 } })]);
    await push(olly, "2905", [entry({ data: { driver: 1 } }), entry({ data: { driver: 1 } })]);
    const out = await olly("GET", `/api/scout/workspaces/2105/consensus?season=${S}&teams=18360`);
    expect(out.status).toBe(403);
    expect(JSON.stringify(out.json)).not.toContain("driver");
    expect((await client()("GET", `/api/scout/workspaces/2105/consensus?season=${S}&teams=18360`)).status).toBe(401);
    // Each workspace sees only its own.
    expect(await one(priya, "2105")).toMatchObject({ entries: 1, ratings: [{ id: "driver", avg: 5, n: 1 }] });
    expect(await one(olly, "2905")).toMatchObject({ entries: 2, ratings: [{ id: "driver", avg: 1, n: 2 }] });
    // And Priya can't read Olly's.
    expect((await consensus(priya, "2905")).status).toBe(403);
    // Never kept by a shared cache.
    expect((await consensus(priya, "2105")).headers.get("cache-control")).toBe("private, no-store");
  });

  it("a workspace template id naming another workspace is read as the built-in, never with that workspace's fields", async () => {
    const { priya, olly } = await team("2106", "2906");
    const put = await olly("PUT", "/api/scout/workspaces/2906/template", { season: S, match: [{ id: "secret", label: "Secret field", type: "rating", phase: "overall", max: 5 }] });
    expect(put.status).toBe(200);
    await push(priya, "2106", [entry({ templateId: workspaceTemplateId("2906", S, "match"), templateVersion: 1, data: { secret: 5, driver: 4 } })]);
    const c = await one(priya, "2106");
    expect(JSON.stringify(c)).not.toContain("Secret");
    expect(num(c, "driver")).toMatchObject({ avg: 4, n: 1 });
  });

  it("cache: a write drops it at once; a change nothing announced shows within 60 s", async () => {
    const { priya, marcus } = await team("2107", "2907");
    let t = 1_000_000;
    setConsensusClock(() => t);
    const a = entry({ data: { driver: 5 } });
    await push(priya, "2107", [a]);
    expect(num(await one(priya, "2107"), "driver")).toMatchObject({ avg: 5 });
    // An edit through the app: fresh at once.
    await push(marcus, "2107", [{ ...a, data: { driver: 3 }, updatedAt: a.updatedAt + 1 }]);
    expect(num(await one(priya, "2107"), "driver")).toMatchObject({ avg: 3 });
    // A change behind the bus's back (e.g. a hand fix in the database): cached until the TTL runs out.
    await run("UPDATE workspace_scout_entries SET data = ? WHERE uuid = ?", [JSON.stringify({ driver: 1 }), a.uuid]);
    t += CACHE_TTL_MS - 1;
    expect(num(await one(priya, "2107"), "driver")).toMatchObject({ avg: 3 });
    t += 1;
    expect(num(await one(priya, "2107"), "driver")).toMatchObject({ avg: 1 });
  });

  it("batches teams: one answer per team asked, in that order (repeats too), empty ones included; bad lists are 400", async () => {
    const { priya } = await team("2108", "2908");
    await push(priya, "2108", [entry({ team: 101, data: { driver: 2 } }), entry({ team: 102, data: { driver: 4 } }), entry({ team: 101, season: 2024, data: {} })]);
    const r = await consensus(priya, "2108", "102,18360,101,102");
    expect(r.status).toBe(200);
    expect(r.json.workspaceId).toBe("2108");
    expect(r.json.season).toBe(S);
    expect((r.json.teams as TeamConsensus[]).map((x) => [x.team, x.entries])).toEqual([[102, 1], [18360, 0], [101, 1], [102, 1]]);
    // The same through the server function the pre-match report uses.
    expect((await consensusFor("2108", S, [101, 102])).map((x) => x.ratings[0].avg)).toEqual([2, 4]);
    // Season by season: 2024's entry is its own.
    expect((await consensus(priya, "2108", "101", 2024)).json.teams[0].entries).toBe(1);
    for (const bad of ["", "abc", "1,,x", "0", "1e3", Array.from({ length: 25 }, (_, i) => i + 1).join(",")]) {
      expect((await priya("GET", `/api/scout/workspaces/2108/consensus?season=${S}&teams=${bad}`)).status).toBe(400);
    }
    expect((await priya("GET", "/api/scout/workspaces/2108/consensus?teams=101")).status).toBe(400);
  });

  it("paused workspace scouting answers 503 and reads nothing", async () => {
    const { priya } = await team("2109", "2909");
    await setFlag("workspaceScouting", false, "owner@test");
    try {
      const r = await consensus(priya, "2109");
      expect(r.status).toBe(503);
      expect(r.json.paused).toBe(true);
    } finally { await setFlag("workspaceScouting", true, "owner@test"); }
  });
});
