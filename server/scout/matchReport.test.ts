// v1.6 Task 2: the pre-match scouting report, end to end against a stub Control Point. The public report
// (OPR, ranks, trend and data flags for every team in one request) works for anyone, with no entries at all;
// played matches carry the result; a short-handed (1v1) lineup is handled; bad addresses are 400 / 404. The
// workspace half gives members the consensus, the pick list and their assignments for the lineup, and never
// anything to a non-member or a signed-out visitor.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { closeAllStreams } from "./stream";
import { clearConsensusCache } from "./consensus";
import { clearCutoffCache } from "../api/matchReport";
import type { MatchReport, MatchReportWorkspace } from "../../src/shared/matchReport";

const KEY = "k".repeat(40);
const S = 2025;
const EV = "RPTQ1";
let scout: Server, cp: Server;
let base = "", cpBase = "";
const codes = new Map<string, string>();

type Ws = { id: string; name: string; role: "admin" | "member" };
const accounts = new Map<string, { id: number; email: string; displayName: string | null; createdAt: string; controlPoint: { member: boolean; teams: never[] }; workspaces?: Ws[] }>();
const accountFor = (email: string) => {
  let a = accounts.get(email);
  if (!a) { a = { id: 9500 + accounts.size, email, displayName: null, createdAt: new Date().toISOString(), controlPoint: { member: false, teams: [] } }; accounts.set(email, a); }
  return a;
};

async function seedFtc() {
  await run("INSERT INTO teams (number, name) VALUES (11, 'Penalty Box'), (12, 'Swingers'), (13, 'Climbers'), (14, 'Steady')");
  await run("INSERT INTO events (season, code, name, type, region, start, end, remote, hybrid, source) VALUES (?, ?, 'Report Qualifier', 'Qualifier', 'USTX', '2025-11-01', '2025-11-01', 0, 0, 'test')", [S, EV]);
  await run("INSERT INTO events (season, code, name, type, region, start, end, remote, hybrid, source) VALUES (?, 'EARLY1', 'Early Meet', 'Qualifier', 'USTX', '2025-10-01', '2025-10-01', 0, 0, 'test')", [S]);
  for (const t of [11, 12, 13, 14]) await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties, qual_played) VALUES (?, ?, ?, ?, 3, 1, 0, 4)", [S, EV, t, t - 10]);
  const match = async (n: number, red: number[], blue: number[], played: boolean) => {
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
      blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, ?, ?, 20, 50, 20, 0, ?, ?, 10, 40, 10, 0, 'test')`,
      [S, EV, n, `Q${n}`, `2025-11-01T10:0${n}:00`, played ? 1 : 0, played ? 90 : null, played ? 90 : null, played ? 60 : null, played ? 60 : null]);
    for (const [alliance, ts] of [["red", red], ["blue", blue]] as const)
      for (const [i, team] of ts.entries())
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station, surrogate, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, 0, 1)", [S, EV, n, team, alliance, i + 1]);
  };
  await match(1, [11, 12], [13, 14], true);
  await match(2, [11, 13], [12, 14], false);
  await match(3, [11], [13], false); // short-handed: one robot each
  // The season: 30 ordinary teams (penalties 0..2.9, spread 0.2..0.49) and our four.
  for (let i = 0; i < 30; i++) {
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_pen, matches, wins, losses, ties) VALUES (?, ?, 40, ?, 10, 5, 5, 0)", [S, 1000 + i, i / 10]);
    await run("INSERT INTO team_season_records (season, team, played, np_avg, np_dev) VALUES (?, ?, 10, 100, ?)", [S, 1000 + i, 20 + i]);
    // Rises of 0..2.9 OPR from the first event to the latest.
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'EARLY1', ?, 40, 5), (?, ?, ?, ?, 5)", [S, 1000 + i, S, EV, 1000 + i, 40 + i / 10]);
  }
  const stat = (team: number, pen: number) => run(
    "INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, opr_pen, rank_np, ranked_teams, matches, wins, losses, ties) VALUES (?, ?, 55, 12, 30, 13, ?, 7, 34, 10, 7, 3, 0)", [S, team, pen]);
  await stat(11, 9); await stat(12, 1); await stat(13, 1); await stat(14, 1);
  const rec = (team: number, dev: number) => run("INSERT INTO team_season_records (season, team, played, np_avg, np_dev) VALUES (?, ?, 10, 100, ?)", [S, team, dev]);
  await rec(11, 25); await rec(12, 80); await rec(13, 25); await rec(14, 25);
  // 13 went from 30 to 52 OPR; 14 stayed level.
  const tes = (code: string, team: number, opr: number, parts: [number, number, number] | [null, null, null] = [null, null, null]) =>
    run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (?, ?, ?, ?, ?, ?, ?, 5)", [S, code, team, opr, ...parts]);
  // The season's per-part bests (12 / 30 / 13 above) came from different events; 13's split shown is the one
  // from the event that gives its season OPR (52 is the closest to 55).
  await tes("EARLY1", 13, 30, [20, 5, 5]); await tes(EV, 13, 52, [10, 30, 12]); await tes("EARLY1", 14, 50); await tes(EV, 14, 51);
}

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
  await seedFtc();
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
  clearCutoffCache();
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
    return { status: r.status, json: text ? JSON.parse(text) : null, headers: r.headers };
  };
}
type Call = ReturnType<typeof client>;
async function signIn(email: string, displayName: string): Promise<Call> {
  const call = client();
  await call("POST", "/api/auth/email/start", { email });
  expect((await call("POST", "/api/auth/email/verify", { email, code: codes.get(email) })).status).toBe(200);
  await call("PATCH", "/api/me", { displayName });
  return call;
}

const report = async (key: string) => {
  const r = await client()("GET", `/api/events/${S}/${EV}/matches/${key}/report`);
  return r as { status: number; json: MatchReport; headers: Headers };
};
const flagsOf = (r: MatchReport, team: number) => r.teams.find((t) => t.team === team)!.flags.map((f) => f.kind);

describe("the public report", () => {
  it("an unplayed match with no scouting at all: every team's OPR, split, rank, trend and data flags in one request", async () => {
    const r = await report("qual:0:2");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/public/);
    const d = r.json;
    expect(d.match.label).toBe("Q2");
    expect(d.match.played).toBe(false);
    expect(d.teams.map((t) => t.team)).toEqual([11, 13, 12, 14]); // red, then blue
    const t13 = d.teams.find((t) => t.team === 13)!;
    expect(t13.season).toMatchObject({ opr: { np: 55, auto: 10, teleop: 30, endgame: 12, pen: 1 }, rank: 7, of: 34, matches: 10, wins: 7 });
    // No event stats at all: no split rather than parts from different events.
    expect(d.teams.find((t) => t.team === 11)!.season!.opr).toEqual({ np: 55, auto: null, teleop: null, endgame: null, pen: 9 });
    expect(t13.event).toMatchObject({ rank: 3, wins: 3, losses: 1, qualPlayed: 4 });
    expect(t13.trend.map((x) => [x.code, x.opr])).toEqual([["EARLY1", 30], [EV, 52]]);
    expect(t13.name).toBe("Climbers");
    // The flags, each from its own rule.
    expect(flagsOf(d, 11)).toEqual(["penalties"]);
    expect(flagsOf(d, 12)).toEqual(["inconsistent"]);
    expect(flagsOf(d, 13)).toEqual(["rising"]);
    expect(flagsOf(d, 14)).toEqual([]);
    // Nothing from any workspace in the public answer.
    expect(JSON.stringify(d)).not.toMatch(/consensus|picklist|entries/);
  });

  it("a played match carries the result", async () => {
    const d = (await report("qual:0:1")).json;
    expect(d.match.played).toBe(true);
    expect(d.match.red.score?.total).toBe(90);
    expect(d.match.blue.score?.total).toBe(60);
    expect(d.next?.label).toBe("Q2");
  });

  it("a short-handed match: the robots that are there, no invented partner", async () => {
    const d = (await report("qual:0:3")).json;
    expect(d.match.red.teams.map((t) => t.number)).toEqual([11]);
    expect(d.match.blue.teams.map((t) => t.number)).toEqual([13]);
    expect(d.teams.map((t) => t.team)).toEqual([11, 13]);
  });

  it("bad and unknown addresses", async () => {
    expect((await report("qual:0:99")).status).toBe(404);
    expect((await report("final:1")).status).toBe(400);
    expect((await client()("GET", `/api/events/${S}/NOPE1/matches/qual:0:1/report`)).status).toBe(404);
  });
});

describe("the workspace half", () => {
  const WS = "3101", OTHER = "3901";
  let coach: Call, priya: Call, olly: Call;
  beforeAll(async () => {
    const join = (email: string, id: string, role: "admin" | "member") => { const a = accountFor(email); a.workspaces = [...(a.workspaces ?? []), { id, name: `Space ${id}`, role }]; };
    join("rp-coach@example.com", WS, "admin"); join("rp-priya@example.com", WS, "member"); join("rp-olly@example.com", OTHER, "admin");
    coach = await signIn("rp-coach@example.com", "Coach");
    priya = await signIn("rp-priya@example.com", "Priya");
    olly = await signIn("rp-olly@example.com", "Olly");
  });
  const path = (ws: string, teams = "11,13,12,14") => `/api/scout/workspaces/${ws}/match-report?season=${S}&event=${EV}&teams=${teams}`;

  it("members: consensus for all four teams (empty ones too), the pick list and their own assignments", async () => {
    const sync = await priya("POST", "/api/me/scout/sync", { workspaceId: WS, entries: [
      { uuid: "report000001", season: S, team: 11, eventCode: EV, matchLabel: "Q1", kind: "match", data: { driver: 5, consistency: 1 }, notes: "", updatedAt: 1_700_000_000_000 },
      { uuid: "report000002", season: S, team: 12, eventCode: EV, matchLabel: "Q1", kind: "match", data: { driver: 2 }, notes: "", updatedAt: 1_700_000_001_000 },
    ] });
    expect(sync.status).toBe(200);
    expect((await coach("POST", `/api/scout/workspaces/${WS}/picklist`, { season: S, op: "add", team: 13 })).status).toBe(200);
    const assign = await coach("POST", `/api/scout/workspaces/${WS}/assignments`, { season: S, eventCode: EV, teams: [14], assigneeAccountIds: [accountFor("rp-priya@example.com").id] });
    expect(assign.status).toBe(201);

    const r = await priya("GET", path(WS));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    const d = r.json as MatchReportWorkspace;
    expect(d.teams.map((t) => [t.team, t.entries])).toEqual([[11, 1], [13, 0], [12, 1], [14, 0]]);
    expect(d.teams[0].strengths).toEqual([{ label: "Driver skill", count: 1 }]);
    expect(d.teams[0].weaknesses).toEqual([{ label: "Consistency", count: 1 }]);
    expect(d.picklist).toEqual([13]);
    expect(d.assignedToMe).toEqual([14]);
    // The coach sees the same consensus, but 14 isn't assigned to them.
    const c = (await coach("GET", path(WS))).json as MatchReportWorkspace;
    expect(c.teams).toEqual(d.teams);
    expect(c.assignedToMe).toEqual([]);
  });

  it("never for a non-member, a signed-out visitor, or a bad request", async () => {
    const r = await olly("GET", path(WS));
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.json)).not.toMatch(/teams|picklist|Driver/);
    expect((await client()("GET", path(WS))).status).toBe(401);
    // Olly's own workspace has nothing on these teams.
    const own = (await olly("GET", path(OTHER))).json as MatchReportWorkspace;
    expect(own.teams.every((t) => t.entries === 0)).toBe(true);
    expect(own.picklist).toEqual([]);
    expect((await priya("GET", `/api/scout/workspaces/${WS}/match-report?season=${S}&event=${EV}`)).status).toBe(400);
    expect((await priya("GET", path(WS, "1,2,3,4,5,6,7,8,9"))).status).toBe(400);
    expect((await priya("GET", `/api/scout/workspaces/${WS}/match-report?season=${S}&event=bad%20code&teams=11`)).status).toBe(400);
  });
});
