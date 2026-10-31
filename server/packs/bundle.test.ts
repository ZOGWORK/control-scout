// Event-day bundles (docs/event-bundle.md), end to end against a stub Control Point: the manifest says what the
// one download holds and its size; the file matches the manifest's SHA-256; the same data gives the same version
// (no needless updates); your team's matches come as frozen static HTML with no scripts; the workspace pick list
// is in it for members only, never for a signed-out visitor or another workspace's member; the rules reference
// plugs in.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { setMailer } from "../auth/email";
import { clearInfoCache } from "../auth/controlPoint";
import { closeAllStreams } from "../scout/stream";
import { clearConsensusCache } from "../scout/consensus";
import { clearCutoffCache } from "../api/matchReport";
import { clearBundleCache, setRulesProvider } from "./bundle";
import type { BundleManifest, EventBundle } from "../../src/shared/eventBundle";

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
  clearBundleCache();
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

const manifest = async (call: Call, q = "") => (await call("GET", `/api/bundles/${S}/${EV}/manifest${q}`)) as { status: number; json: BundleManifest; headers: Headers };
/** A public bundle's file, checked and decoded. */
async function file(m: BundleManifest): Promise<{ bytes: Buffer; body: EventBundle }> {
  const r = await fetch(base + m.url);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toMatch(/gzip/);
  const bytes = Buffer.from(await r.arrayBuffer());
  return { bytes, body: JSON.parse(gunzipSync(bytes).toString("utf8")) as EventBundle };
}

describe("a public bundle", () => {
  const anon = client();
  it("the manifest lists every section with its version and size; the file matches it", async () => {
    const r = await manifest(anon, "?team=13");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/private/);
    const m = r.json;
    expect(m).toMatchObject({ format: 1, season: S, code: EV, name: "Report Qualifier", team: 13, workspace: null });
    expect(m.sections.map((s) => s.id)).toEqual(["event", "ratings", "reports", "picklist", "rules", "venue"]);
    expect(m.sections.find((s) => s.id === "reports")!.items).toBe(3); // 13 plays Q1, Q2 and Q3
    expect(m.sections.find((s) => s.id === "picklist")!.note).toMatch(/workspace/);
    expect(m.field.map(([t]) => t).sort()).toEqual([11, 12, 13, 14]);
    const { bytes, body } = await file(m);
    expect(bytes.length).toBe(m.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(m.sha256);
    expect(body.event.event.code).toBe(EV);
    expect(body.event.matches.length).toBe(3);
    expect(body.venue.name).toBe("Report Qualifier");
    expect(body.picklist).toBeNull();
    expect(body.rules).toBeNull();
  });

  it("frozen reports are static HTML: the snapshot time inside, no scripts, nothing to fetch", async () => {
    const { body } = await file((await manifest(anon, "?team=13")).json);
    expect(body.reports.map((x) => x.label)).toEqual(["Q1", "Q2", "Q3"]);
    for (const x of body.reports) {
      expect(x.html).toMatch(/^<!doctype html>/);
      expect(x.html).toMatch(/Snapshot from .* may be stale/);
      expect(x.html).not.toMatch(/<script|<link|src=|https?:\/\//i);
      expect(x.html).toContain("default-src 'none'");
    }
    expect(body.reports[0].html).toContain("Climbers");
  });

  it("the same data gives the same version, so an update means something changed", async () => {
    const a = (await manifest(anon, "?team=13")).json;
    const b = (await manifest(anon, "?team=13")).json;
    expect(b.sections.filter((x, i) => x.version !== a.sections[i].version).map((x) => x.id)).toEqual([]);
    expect(b.version).toBe(a.version);
    await run("UPDATE event_teams SET rank = 9 WHERE season = ? AND code = ? AND team = 13", [S, EV]);
    await kvSet("data:version", `t${Date.now()}`); // what a sync does: the event detail is built again
    clearBundleCache();
    const c = (await manifest(anon, "?team=13")).json;
    await run("UPDATE event_teams SET rank = 3 WHERE season = ? AND code = ? AND team = 13", [S, EV]);
    expect(c.version).not.toBe(a.version);
    expect(c.sections.find((s) => s.id === "event")!.version).not.toBe(a.sections.find((s) => s.id === "event")!.version);
    expect(c.sections.find((s) => s.id === "venue")!.version).toBe(a.sections.find((s) => s.id === "venue")!.version);
  });

  it("a newer data time with nothing changed keeps the version (the printed snapshot time isn't hashed)", async () => {
    await kvSet("sync:last", { at: "2026-10-30T07:00:00.000Z" });
    clearBundleCache();
    const a = (await manifest(anon, "?team=13")).json;
    await kvSet("sync:last", { at: "2026-10-30T09:30:00.000Z" });
    clearBundleCache();
    const b = (await manifest(anon, "?team=13")).json;
    expect(b.dataAsOf).not.toBe(a.dataAsOf);
    expect(b.version).toBe(a.version);
  });

  it("no team: event data only, and it says how to add your matches", async () => {
    const m = (await manifest(anon)).json;
    expect(m.sections.find((s) => s.id === "reports")).toMatchObject({ items: 0, note: expect.stringMatching(/your team/i) });
  });

  it("bad addresses", async () => {
    expect((await anon("GET", `/api/bundles/${S}/NOPE1/manifest`)).status).toBe(404);
    expect((await anon("GET", `/api/bundles/1999/${EV}/manifest`)).status).toBe(404);
    expect((await anon("GET", `/api/bundles/${S}/${EV}/manifest?team=abc`)).status).toBe(400);
  });

  it("the rules reference plugs in", async () => {
    setRulesProvider(async (season) => ({ title: `Rules ${season}`, version: "r1", html: "<!doctype html><p>Q&amp;A</p>" }));
    try {
      const m = (await manifest(anon)).json;
      expect(m.sections.find((s) => s.id === "rules")).toMatchObject({ items: 1, note: null });
      expect((await file(m)).body.rules?.title).toBe(`Rules ${S}`);
    } finally { setRulesProvider(async () => null); }
  });
});

describe("the workspace parts", () => {
  const WS = "3101", OTHER = "3901";
  const anon = client();
  let coach: Call, olly: Call;
  beforeAll(async () => {
    const join = (email: string, id: string, role: "admin" | "member") => { const a = accountFor(email); a.workspaces = [...(a.workspaces ?? []), { id, name: `Space ${id}`, role }]; };
    join("eb-coach@example.com", WS, "admin"); join("eb-olly@example.com", OTHER, "admin");
    coach = await signIn("eb-coach@example.com", "Coach");
    olly = await signIn("eb-olly@example.com", "Olly");
  });

  it("a member's bundle holds the pick list, frozen, and nobody else's does", async () => {
    expect((await coach("POST", `/api/scout/workspaces/${WS}/picklist`, { season: S, op: "add", team: 13 })).status).toBe(200);
    expect((await coach("POST", `/api/scout/workspaces/${WS}/picklist`, { season: S, op: "add", team: 12 })).status).toBe(200);
    const r = await manifest(coach, `?team=13&workspace=${WS}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/private/);
    expect(r.json.workspace).toEqual({ id: WS, name: `Space ${WS}` });
    expect(r.json.sections.find((s) => s.id === "picklist")!.items).toBe(2);
    // Signed out: 401; another workspace's member: 403; the file the same.
    expect((await manifest(anon, `?workspace=${WS}`)).status).toBe(401);
    expect((await manifest(olly, `?workspace=${WS}`)).status).toBe(403);
    expect((await fetch(`${base}/api/bundles/${S}/${EV}/file?workspace=${WS}`)).status).toBe(401);
  });
});
