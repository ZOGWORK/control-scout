// The match report's flag cutoffs (server/api/matchReport.ts seasonCutoffs): built once, reused for
// CUTOFF_TTL_MS, then rebuilt in the background while the previous set answers.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { CUTOFF_TTL_MS, clearCutoffCache, seasonCutoffs } from "./matchReport";
import { MIN_CUTOFF_TEAMS } from "../../src/shared/matchReport";

const S = 2024;
/** Every team's penalty OPR set to `pen` (enough teams for a cutoff). */
async function penalties(pen: number) {
  await run("DELETE FROM team_season_stats WHERE season = ?", [S]);
  for (let t = 1; t <= MIN_CUTOFF_TEAMS + 5; t++) await run("INSERT INTO team_season_stats (season, team, matches, opr_pen) VALUES (?, ?, 10, ?)", [S, t, pen]);
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
});
beforeEach(() => { clearCutoffCache(); vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("seasonCutoffs", () => {
  it("the first build is waited for; within the TTL the same set answers", async () => {
    await penalties(5);
    expect((await seasonCutoffs(S)).penalties).toBe(5);
    await penalties(9);
    vi.advanceTimersByTime(CUTOFF_TTL_MS - 1000);
    expect((await seasonCutoffs(S)).penalties).toBe(5);
  });

  it("once expired, the previous set answers at once while the new one builds, then the new one", async () => {
    await penalties(5);
    await seasonCutoffs(S);
    await penalties(9);
    vi.advanceTimersByTime(CUTOFF_TTL_MS + 1);
    expect((await seasonCutoffs(S)).penalties).toBe(5); // no wait for the rebuild
    await vi.waitFor(async () => expect((await seasonCutoffs(S)).penalties).toBe(9));
  });
});
