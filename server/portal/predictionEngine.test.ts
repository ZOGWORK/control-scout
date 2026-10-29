// The owner console's Predictions & ledger: the engine in production (champion and served model), live against
// replay per season (never blended), each engine version's live calls, the shadow model on the same live calls
// (read-only), the simulation settings as values, and calibration by the confidence tier calls show publicly.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { get, kvSet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { sha256 } from "../auth/session";
import { PREDICT_SEASONS } from "../data/seasons";
import { resetTrackRecord } from "../api/accuracy";
import { ownerRouter } from "./routes";
import { tierCalibration } from "./predictionHealth";
import { PROJECTION_RUNS } from "../../src/shared/projections";
import type { OwnerPredictionEngine } from "../../src/shared/ownerPredictions";
import type { PredictionHealth } from "../../src/shared/owner";

const S = Math.max(...PREDICT_SEASONS);
let server: Server;
let base = "";
let cookie = "";
const saved = process.env.OWNER_EMAILS;

async function call(kind: "live" | "backtest", n: number, p: number, outcome: number, tier: string, more: { engine?: string; model?: string; ps?: number; shadow?: string; at?: string } = {}) {
  await run(
    `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time, outcome, scored_at, model_id, p_red_shadow, shadow_model_id)
     VALUES (?, ?, 'USTST', 'qual', 0, ?, '1 2', '3 4', ?, 50, 40, ?, ?, ?, '2026-11-01T10:00:00', ?, '2026-11-01', ?, ?, ?)`,
    [kind, S, n, p, tier, more.engine ?? ENGINE_VERSION, more.at ?? "2026-11-01T09:00:00Z", outcome, more.model ?? null, more.ps ?? null, more.shadow ?? null],
  );
}

beforeAll(async () => {
  process.env.OWNER_EMAILS = "owner@example.com";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES ('owner@example.com', ?) RETURNING id", [new Date().toISOString()]);
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256("tok"), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  cookie = "cs_session=tok";
  // Live: two engine versions; the newer one served by "ctx-2" with "ctx-1" in the shadow.
  await call("live", 1, 0.8, 1, "confident", { engine: "0.0.1", model: "legacy", at: "2026-10-01T09:00:00Z" });
  await call("live", 2, 0.7, 1, "confident", { model: "ctx-2", ps: 0.6, shadow: "ctx-1", at: "2026-11-01T09:00:00Z" });
  await call("live", 3, 0.4, 1, "moderate", { model: "ctx-2", ps: 0.45, shadow: "ctx-1", at: "2026-11-01T09:01:00Z" });
  await call("live", 4, 0.55, 0, "provisional", { model: "ctx-2", ps: 0.5, shadow: "ctx-1", at: "2026-11-02T09:00:00Z" });
  // Replay: its own calls, never added to the live ones.
  for (let i = 10; i < 20; i++) await call("backtest", i, 0.75, i < 17 ? 1 : 0, "confident");
  await kvSet("data:version", "v1");
  resetTrackRecord();
});
afterAll(() => {
  server?.close();
  if (saved === undefined) delete process.env.OWNER_EMAILS; else process.env.OWNER_EMAILS = saved;
});

const getJson = async <T,>(path: string, c = cookie) => {
  const r = await fetch(`${base}${path}`, { headers: c ? { Cookie: c } : {} });
  return { status: r.status, json: await r.json() as T };
};

describe("the engine in production", () => {
  it("is owner-only, like every console route", async () => {
    expect((await getJson("/api/owner/predictions/engine", "")).status).toBe(403);
    const routes = (ownerRouter().stack as any[]).filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
    expect(routes).toContain("get /predictions/engine");
  });

  it("names the champion and its served and shadow models, live and replay apart, per engine, and the simulation values", async () => {
    const { status, json: e } = await getJson<OwnerPredictionEngine>("/api/owner/predictions/engine");
    expect(status).toBe(200);
    expect(e).toMatchObject({ engineVersion: ENGINE_VERSION, servedModel: "ctx-2", shadowModel: "ctx-1", lastLiveCall: "2026-11-02T09:00:00Z" });
    const s = e.seasons.find((x) => x.season === S)!;
    expect(s.live).toMatchObject({ n: 4 });
    expect(s.replay).toMatchObject({ n: 10, accuracy: 0.7 });
    expect(Object.keys(s.live!).sort()).toEqual(["accuracy", "baselineBrier", "brier", "logLoss", "n"]);
    expect(s.liveByEngine.map((x) => [x.engine, x.n])).toEqual([["0.0.1", 1], [ENGINE_VERSION, 3]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect(s.shadow).toEqual([expect.objectContaining({ servedModel: "ctx-2", shadowModel: "ctx-1", n: 3 })]);
    // Values to read, from the code that uses them.
    expect(e.simulation.find((x) => x.id === "projectionRuns")).toMatchObject({ value: PROJECTION_RUNS, unit: "simulations" });
    expect(e.simulation.every((x) => typeof x.value === "number" && x.value > 0 && x.label && x.note)).toBe(true);
  });
});

describe("calibration by confidence tier", () => {
  it("groups calls by the tier they showed: how sure the favourite was, how often it won", () => {
    const t = tierCalibration([
      { p: 0.9, y: 1, tier: "confident", level: "qual", time: null },
      { p: 0.2, y: 1, tier: "confident", level: "qual", time: null }, // favourite (blue, 80%) lost
      { p: 0.55, y: 0, tier: "provisional", level: "qual", time: null },
    ]);
    expect(t.map((x) => x.tier)).toEqual(["provisional", "confident"]); // least sure first, empty tiers left out
    expect(t[1]).toMatchObject({ n: 2, actual: 0.5 });
    expect(t[1].predicted).toBeCloseTo(0.85, 10);
    expect(t[1].brier).toBeCloseTo((0.01 + 0.64) / 2, 10);
    expect(t[0]).toMatchObject({ n: 1, actual: 0 });
  });

  it("comes with the ledger, for live calls and the replay separately", async () => {
    const live = (await getJson<PredictionHealth>(`/api/owner/predictions?kind=live&season=${S}`)).json;
    expect(live.byTier.map((x) => [x.tier, x.n])).toEqual([["provisional", 1], ["moderate", 1], ["confident", 2]]);
    const replay = (await getJson<PredictionHealth>(`/api/owner/predictions?kind=backtest&season=${S}`)).json;
    expect(replay.byTier).toEqual([expect.objectContaining({ tier: "confident", n: 10, predicted: 0.75, actual: 0.7 })]);
  });
});
