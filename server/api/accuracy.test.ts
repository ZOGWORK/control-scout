// The track record's in-memory cache: built once per data version (and per
// scored live call), shared by concurrent callers, warmed ahead of visitors,
// and rebuilt when the data moves on, with the same numbers a fresh build gives.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, kvSet, migrate, openDb, run, setDb } from "../db";
import { PREDICT_SEASONS } from "../data/seasons";
import { resetTrackRecord, trackRecord, warmTrackRecord } from "./accuracy";

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
