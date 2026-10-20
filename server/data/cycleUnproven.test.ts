// PUB3-F05 follow-through: a past season whose records carry no build time reads "Statistics catching
// up" (api/readiness.ts), so the data cycle rebuilds it (which stamps it): one per cycle, newest first,
// in the quiet hours only. The stats job is stubbed; only which seasons it's asked for is checked.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { CURRENT_SEASON } from "./seasons";

const asked: (number[] | undefined)[] = [];
vi.mock("../stats/job.js", () => ({
  runStats: async (o: { seasons?: number[] }) => { asked.push(o.seasons); },
  statsRulesStale: async () => false,
}));
const { runCycle } = await import("./cycle");

const QUIET = Date.parse("2026-10-20T07:00:00Z");
const BUSY = Date.parse("2026-10-20T18:00:00Z");

/** A season with a played qualification match and built records, its records stamped or not. */
async function season(s: number, stamped: boolean) {
  await run("INSERT INTO seasons (season, name, last_sync, frozen) VALUES (?, ?, '2026-10-15T00:00:00.000Z', 1)", [s, String(s)]);
  await run("INSERT INTO events (season, code, name, type, remote, hybrid, source, start, end) VALUES (?, 'Q1', 'Q1', 'Qualifier', 0, 0, 'test', '2025-11-01', '2025-11-01')", [s]);
  await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'Q1', 'qual', 0, 1, 'Q1', 1, 50, 50, 40, 40, 'test')", [s]);
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, 'Q1', 'qual', 0, 1, 1, 'red')", [s]);
  await run("INSERT INTO team_season_records (season, team, team_name) VALUES (?, 1, 'Team 1')", [s]);
  if (stamped) await kvSet(`records:at:${s}`, { at: "2026-10-16T00:00:00.000Z" });
}

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); process.env.CS_PACKS = "off"; });
afterAll(() => { vi.useRealTimers(); delete process.env.CS_PACKS; });
beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  asked.length = 0;
  await season(CURRENT_SEASON, true);
  await season(CURRENT_SEASON - 3, false);
  await season(CURRENT_SEASON - 1, false);
  await season(CURRENT_SEASON - 2, true);
});

describe("data cycle and unproven records (PUB3-F05)", () => {
  it("rebuilds the newest past season whose records have no build time, one per quiet-hours cycle", async () => {
    vi.setSystemTime(QUIET);
    await runCycle(() => {});
    expect(asked).toEqual([[CURRENT_SEASON, CURRENT_SEASON - 1]]);
  });

  it("leaves them for the quiet hours (a past season's stats hold the writer lease a while)", async () => {
    vi.setSystemTime(BUSY);
    await runCycle(() => {});
    expect(asked).toEqual([[CURRENT_SEASON]]);
  });

  it("asks for nothing extra once every season's records are stamped", async () => {
    await kvSet(`records:at:${CURRENT_SEASON - 1}`, { at: "2026-10-16T00:00:00.000Z" });
    await kvSet(`records:at:${CURRENT_SEASON - 3}`, { at: "2026-10-16T00:00:00.000Z" });
    vi.setSystemTime(QUIET);
    await runCycle(() => {});
    expect(asked).toEqual([[CURRENT_SEASON]]);
  });
});
