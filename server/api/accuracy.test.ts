// The track record's in-memory cache: built once per data version (and per
// scored live call), shared by concurrent callers, warmed ahead of visitors,
// and rebuilt when the data moves on, with the same numbers a fresh build gives.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, kvSet, migrate, openDb, run, setDb } from "../db";
import { PREDICT_SEASONS } from "../data/seasons";
import { block, isoWeek, replayCoverage, resetTrackRecord, trackRecord, warmTrackRecord } from "./accuracy";
import { LIVE_THRESHOLD, REPLAY_HEADLINE_MIN, brierSkill, ledgerSplit } from "../../src/shared/ledger";

const S = Math.max(...PREDICT_SEASONS);
let builds = 0;
let realExec: any;

async function backtestCall(number: number, p: number, outcome: number) {
  await run(
    `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time, outcome, scored_at)
     VALUES ('backtest', ?, 'USTST', 'qual', 0, ?, '1 2', '3 4', ?, 50, 40, 'confident', 'test', '2025-11-01', '2025-11-01T10:00:00', ?, '2025-11-01')`,
    [S, number, p, outcome],
  );
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  realExec = c.execute.bind(c);
  // Count full builds: each reads every scored prediction once.
  (c as any).execute = (s: any) => { if (String(s?.sql ?? s).startsWith("SELECT kind, season, p_red")) builds++; return realExec(s); };
});
afterAll(() => { (db() as any).execute = realExec; });

beforeEach(async () => {
  resetTrackRecord();
  builds = 0;
  await run("DELETE FROM predictions");
  await kvSet("data:version", "v1");
  for (let i = 1; i <= 4; i++) await backtestCall(i, 0.7, i === 4 ? 0 : 1);
});

const n = (t: Awaited<ReturnType<typeof trackRecord>>) => t.seasons.find((s) => s.season === S)?.backtest?.n;

describe("side by side: served vs shadow model on the same live calls", () => {
  it("scores both models on exactly the same calls, per model pair", async () => {
    const live = (number: number, p: number, ps: number, outcome: number) => run(
      `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time, outcome, scored_at, model_id, p_red_shadow, shadow_model_id)
       VALUES ('live', ?, 'USLIV', 'qual', 0, ?, '1 2', '3 4', ?, 50, 40, 'confident', '2.1.1', '2026-11-01', '2026-11-01T10:00:00', ?, '2026-11-01', 'new', ?, 'old')`,
      [S, number, p, outcome, ps]);
    await live(1, 0.8, 0.6, 1); await live(2, 0.3, 0.55, 0); await live(3, 0.6, 0.4, 0);
    // A live call from before shadows existed: not part of the paired comparison.
    await run(`INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time, outcome, scored_at)
       VALUES ('live', ?, 'USLIV', 'qual', 0, 9, '1 2', '3 4', 0.9, 50, 40, 'confident', '2.0.0', '2026-11-01', '2026-11-01T10:00:00', 1, '2026-11-01')`, [S]);
    await kvSet("data:version", "v-shadow");
    const s = (await trackRecord()).seasons.find((x) => x.season === S)!;
    expect(s.liveShadow).toHaveLength(1);
    const [pair] = s.liveShadow!;
    expect(pair).toMatchObject({ servedModel: "new", shadowModel: "old", n: 3 });
    expect(pair.served.accuracy).toBeCloseTo(2 / 3, 10);
    expect(pair.shadow.accuracy).toBeCloseTo(2 / 3, 10); // 0.6 vs a win, 0.55 vs a loss (wrong), 0.4 vs a loss
    expect(pair.served.brier).toBeCloseTo((0.04 + 0.09 + 0.36) / 3, 10);
    expect(pair.shadow.brier).toBeCloseTo((0.16 + 0.3025 + 0.16) / 3, 10);
  });
});

describe("track record cache", () => {
  it("builds once per data version, shared by concurrent callers", async () => {
    const [a, b] = await Promise.all([trackRecord(), trackRecord()]);
    expect(builds).toBe(1);
    expect(a).toBe(b);
    expect(n(a)).toBe(4);
    expect(await trackRecord()).toBe(a);
    expect(builds).toBe(1);
  });

  it("is warmed ahead of the first visitor", async () => {
    await warmTrackRecord();
    expect(builds).toBe(1);
    await trackRecord();
    await warmTrackRecord(); // nothing moved: no rebuild
    expect(builds).toBe(1);
  });

  it("rebuilds when the data version moves on, keeping the previous one meanwhile", async () => {
    const first = await trackRecord();
    await backtestCall(5, 0.6, 1);
    expect(await trackRecord()).toBe(first); // same data version and no new live call: still cached
    await kvSet("data:version", "v2");
    await warmTrackRecord();
    expect(builds).toBe(2);
    const second = await trackRecord();
    expect(n(second)).toBe(5);
    // Identical to a build from scratch (apart from when it was made).
    resetTrackRecord();
    const fresh = await trackRecord();
    expect({ ...fresh, generatedAt: "" }).toEqual({ ...second, generatedAt: "" });
  });

  it("serves the previous record while a rebuild runs, then the new one", async () => {
    const first = await trackRecord();
    await kvSet("data:version", "v3");
    await backtestCall(6, 0.2, 0);
    expect(await trackRecord()).toBe(first); // a visitor never waits for the rebuild
    await warmTrackRecord(); // joins the rebuild already under way
    expect(builds).toBe(2);
    expect(n(await trackRecord())).toBe(5);
  });

  it("doesn't keep the old replay cached when the stats run rewrites it after bumping the data version", async () => {
    // Regression: a stats run moves data:version first and rewrites the replay later. The 15 s warm-up
    // built the record in between (old replay, new version) and kept it until the next run.
    await kvSet("data:settled", "s1");
    await trackRecord();
    await kvSet("data:version", "v-run"); // the run starts
    await warmTrackRecord(); // warm-up mid-run: still the old replay
    expect(n(await trackRecord())).toBe(4);
    await backtestCall(7, 0.8, 1); // the run rewrites the replay…
    await kvSet("data:settled", "s2"); // …and finishes
    await warmTrackRecord();
    expect(n(await trackRecord())).toBe(5);
  });

  it("rebuilds when a live call is scored", async () => {
    await trackRecord();
    await run(
      `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time, outcome, scored_at)
       VALUES ('live', ?, 'NOPE', 'qual', 0, 1, '1 2', '3 4', 0.6, 50, 40, 'moderate', 'test', '2025-11-01', '2025-11-01T10:00:00', 1, '2025-11-02')`,
      [S],
    );
    await warmTrackRecord();
    expect(builds).toBe(2);
    expect((await trackRecord()).seasons.find((s) => s.season === S)?.live?.n).toBe(1);
  });
});

describe("replay coverage", () => {
  const match = async (code: string, number: number, red: [number, number][], blue: [number, number][], played = 1) => {
    await run(`INSERT INTO matches (season, code, level, series, number, label, played, red_total, blue_total, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, ?, 'test')`,
      [S, code, number, `Q${number}`, played, played ? 20 : null, played ? 10 : null]);
    for (const [alliance, ts] of [["red", red], ["blue", blue]] as const)
      for (const [team, onField] of ts) await run(`INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?)`, [S, code, number, team, alliance, onField]);
  };
  beforeEach(async () => { await run("DELETE FROM matches"); await run("DELETE FROM match_teams"); await run("DELETE FROM events"); });

  it("counts every scored match and says why the replay skipped the rest", async () => {
    // USTST 1–4 have replayed calls (beforeEach); 1–3 full 2-on-2, 4 too.
    for (let i = 1; i <= 4; i++) await match("USTST", i, [[1, 1], [2, 1]], [[3, 1], [4, 1]]);
    await match("USTST", 5, [[1, 1], [2, 0]], [[3, 1], [4, 1]]); // a no-show: one robot on red
    await match("USTST", 6, [[1, 1]], [[3, 1]]); // one-robot alliances
    await match("USTST", 7, [[1, 1], [2, 1]], [[3, 1], [4, 1]]); // 2-on-2, not replayed yet
    await match("USTST", 8, [[1, 1], [2, 1]], [[3, 1], [4, 1]], 0); // not played: not in the denominator
    await run("INSERT INTO events (season, code, name, type, hybrid, source) VALUES (?, 'USHYB', 'Hybrid', 'Qualifier', 1, 'test')", [S]);
    await match("USHYB", 1, [[5, 1], [6, 1]], [[7, 1], [8, 1]]); // a hybrid event: the replay leaves it out
    const c = (await replayCoverage([S])).get(S)!;
    expect(c).toEqual({ scored: 8, replayed: 4, eventSkipped: 1, shortHanded: 2, other: 1 });
    expect(c.replayed + c.eventSkipped + c.shortHanded + c.other).toBe(c.scored);
    // And it reaches the track record, next to a replay of the same size.
    await kvSet("data:version", "v-cov");
    const s = (await trackRecord()).seasons.find((x) => x.season === S)!;
    expect(s.replay).toEqual(c);
    expect(s.backtest!.n).toBe(c.replayed);
  });
});

describe("ledger numbers agree with each other", () => {
  const row = (p: number, y: number, level = "qual", tier: "provisional" | "moderate" | "confident" = "moderate", time: string | null = "2026-10-17T10:00:00") => ({ p, y, level, tier, time });
  const rows = [row(0.8, 1), row(0.7, 0), row(0.3, 0, "playoff", "confident"), row(0.6, 0.5), row(0.5, 1), row(0.9, 1, "qual", "provisional", "2026-10-18T23:30:00")];
  const b = block(rows)!;

  it("correct + missed = decided, upsets = decided − correct, every share in [0, 1]", () => {
    const split = ledgerSplit(b)!;
    expect(split.correct + split.missed).toBe(b.decided);
    expect(b.decided).toBe(4); // the tie and the 50:50 call are neither right nor wrong
    expect(split.correct).toBe(3);
    expect(b.upsets).toBe(b.decided - split.correct);
    expect(b.accuracy).toBeCloseTo(split.correct / b.decided, 12);
    for (const x of [b.accuracy, b.byLevel.qual.accuracy, b.byLevel.playoff.accuracy, ...Object.values(b.byTier).map((t) => t.accuracy)]) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1);
    }
    expect(b.byLevel.qual.n + b.byLevel.playoff.n).toBe(b.n);
    expect(Object.values(b.byTier).reduce((a, t) => a + t.n, 0)).toBe(b.n);
  });

  it("Brier, the coin-flip line and skill are one formula", () => {
    const brier = rows.reduce((a, r) => a + (r.p - r.y) ** 2, 0) / rows.length;
    const coin = rows.reduce((a, r) => a + (0.5 - r.y) ** 2, 0) / rows.length;
    expect(b.brier).toBeCloseTo(brier, 12);
    expect(b.baselineBrier).toBeCloseTo(coin, 12);
    expect(brierSkill(b)).toBeCloseTo(1 - brier / coin, 12);
    expect(brierSkill({ brier: 0.1, baselineBrier: 0 })).toBeNull(); // only ties: no skill to state
  });

  it("buckets a late-evening match by the venue's day, the same for live and replay times", () => {
    // Live calls keep the venue's wall-clock time (no zone); replayed calls store the same clock with a Z.
    expect(isoWeek("2026-10-18T23:30:00")).toBe("2026-10-12");
    expect(isoWeek("2026-10-18T23:30:00.000Z")).toBe("2026-10-12");
    expect(b.weekly).toEqual([{ week: "2026-10-12", n: 6, accuracy: b.accuracy }]);
  });

  it("the headline waits for a real sample of each kind", () => {
    expect(LIVE_THRESHOLD).toBe(300);
    expect(REPLAY_HEADLINE_MIN).toBe(1000);
  });
});
