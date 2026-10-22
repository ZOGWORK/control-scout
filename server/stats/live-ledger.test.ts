// The live ledger end to end, on an in-memory database with the clock pinned:
// a real upcoming match (event-local time + IANA zone, as FIRST gives it) is
// logged once, before it plays, and never revised; once it's played the
// result is attached and the call itself stays exactly as logged.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { CURRENT_SEASON, SEASON_NUMBERS } from "../data/seasons";
import { localToUtcMs } from "../data/time";
import { resetForecasters } from "../predict/engine";
import { FITTED_MODEL } from "@control-scout/predict-engine";
import { matchViews } from "../api/matches";
import { backtest, liveLoggable, runStats, logLivePredictions, scoreLivePredictions, unloggedLiveMatches } from "./job";

const S = CURRENT_SEASON;
const TEAMS = [201, 202, 203, 204, 205, 206];
const CHICAGO = "America/Chicago"; // CST (UTC−6) on 2026-11-07: DST ended 2026-11-01
const SYDNEY = "Australia/Sydney"; // AEDT (UTC+11)
const NOW = Date.parse("2026-11-07T15:00:00Z"); // 09:00 in Chicago

async function event(code: string, start: string, timezone: string, type = "Qualifier") {
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'test')", [S, code, code, type, start, start, timezone]);
  for (const t of TEAMS) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, code, t]);
}

async function match(code: string, level: "qual" | "playoff", number: number, time: string | null, red: number[], blue: number[], score?: [number, number]) {
  await run(
    `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
       blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 10, ?, 5, 0, ?, ?, 10, ?, 5, 0, 'test')`,
    [S, code, level, number, `Q${number}`, time, score ? 1 : 0, score?.[0] ?? null, score?.[0] ?? null, score ? score[0] - 15 : null, score?.[1] ?? null, score?.[1] ?? null, score ? score[1] - 15 : null],
  );
  for (const [alliance, ts] of [["red", red], ["blue", blue]] as const) for (const t of ts)
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, ?, 0, ?, ?, ?)", [S, code, level, number, t, alliance]);
}

const ledger = () => all<any>("SELECT * FROM predictions WHERE season = ? ORDER BY code, number", [S]);

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); });

// Every test starts from the same fresh database and clock, so each one runs on its own.
beforeEach(async () => {
  vi.setSystemTime(NOW);
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  resetForecasters();

  // Two weeks earlier: a played event, so the forecaster has ratings for these teams.
  await event("PRIOR", "2026-10-24", CHICAGO);
  let n = 0;
  for (let i = 0; i < TEAMS.length; i++) for (let j = 0; j < TEAMS.length; j++) {
    const red = [TEAMS[i], TEAMS[(i + 1) % 6]], blue = [TEAMS[j], TEAMS[(j + 2) % 6]];
    if (i === j || new Set([...red, ...blue]).size < 4) continue;
    n++;
    const strength = (ts: number[]) => 40 + ts.reduce((s, t) => s + (t - 200) * 4, 0);
    await match("PRIOR", "qual", n, `2026-10-24T${String(9 + Math.floor(n / 8)).padStart(2, "0")}:${String((n % 8) * 7).padStart(2, "0")}:00`, red, blue, [strength(red), strength(blue)]);
  }

  // Today, in Chicago. Times are event-local with no zone, exactly as FIRST sends them.
  await event("LIVE", "2026-11-07", CHICAGO);
  await match("LIVE", "qual", 1, "2026-11-07T10:30:00", [201, 202], [203, 204]); // 16:30Z: 90 min away → logged
  await match("LIVE", "qual", 2, "2026-11-07T09:00:30", [205, 206], [201, 203]); // 15:00:30Z: 30 s away → too close
  await match("LIVE", "qual", 3, "2026-11-07T08:30:00", [202, 204], [205, 206]); // 14:30Z: already started, unplayed → never
  await match("LIVE", "qual", 4, null, [201, 204], [202, 205]); // no scheduled time → can't prove pre-match
  await match("LIVE", "qual", 5, "2026-11-07T11:00:00", [201, 202], [203]); // incomplete lineup
  await match("LIVE", "playoff", 1, "2026-11-07T15:00:00", [201, 202, 203], [204, 205, 206]); // 3-team alliances
  // Sydney: 01:30 local on the 8th is 14:30Z on the 7th — past. Read as UTC it would look 10 h away.
  await event("SYD", "2026-11-08", SYDNEY);
  await match("SYD", "qual", 1, "2026-11-08T01:30:00", [201, 202], [203, 204]);
});

afterAll(() => { vi.useRealTimers(); });

/** Step 1 at NOW, with every check on the logged call; returns the row as logged. */
async function logAndCheck(): Promise<any> {
  expect(await logLivePredictions()).toBe(1);
  const rows = await ledger();
  expect(rows).toHaveLength(1);
  const logged = rows[0];
  expect(logged).toMatchObject({ kind: "live", season: S, code: "LIVE", level: "qual", series: 0, number: 1, red: "[201,202]", blue: "[203,204]", match_time: "2026-11-07T10:30:00" });
  expect(logged.predicted_at).toBe(new Date(NOW).toISOString());
  expect(Date.parse(logged.predicted_at)).toBeLessThan(localToUtcMs(logged.match_time, CHICAGO)!);
  expect(localToUtcMs(logged.match_time, CHICAGO)).toBe(Date.parse("2026-11-07T16:30:00Z"));
  expect(logged.p_red).toBeGreaterThan(0);
  expect(logged.p_red).toBeLessThan(1);
  expect(logged.tier).toBeTruthy();
  expect(JSON.parse(logged.factors)).toBeTruthy();
  expect(logged.outcome).toBeNull();
  expect(logged.red_score).toBeNull();
  expect(logged.scored_at).toBeNull();
  return logged;
}

describe("live prediction ledger", () => {
  it("logs exactly one call for the match that is safely in the future, before it starts", async () => {
    await logAndCheck();
  });

  it("logs the served and the shadow (previous) model side by side, with what the call was made from", async () => {
    await logLivePredictions();
    const [row] = (await ledger()).filter((r) => r.kind === "live");
    expect(row.model_id).toBe(FITTED_MODEL.contextual!.id);
    expect(row.shadow_model_id).toBe(FITTED_MODEL.contextual!.fallback!.id);
    expect(row.p_red_shadow).toBeGreaterThan(0);
    expect(row.p_red_shadow).toBeLessThan(1);
    expect(row.p_red_shadow).not.toBe(row.p_red);
  });

  it("logs the partnership line with the call, and a logged call keeps it (the odds are the call's own)", async () => {
    await logLivePredictions();
    const [row] = (await ledger()).filter((r) => r.kind === "live");
    const history = JSON.parse(row.history); // 201 + 202 played together at PRIOR
    expect(history.kind).toBe("together");
    expect(history.teams).toEqual([201, 202]);
    expect(history.label).toMatch(/^201 and 202 have played \d+ matches together/);
    const views = await matchViews({ season: S, code: "LIVE" });
    const q1 = views.find((m) => m.key === "qual:0:1")!;
    expect(q1.prediction?.kind).toBe("live");
    expect(q1.prediction?.pRed).toBe(row.p_red);
    expect(q1.prediction?.history).toEqual(history);
  });

  it("skips matches that started, are under a minute away, or have no provable start", async () => {
    await logLivePredictions();
    const left = await unloggedLiveMatches(S);
    const key = (c: { code: string; level: string; number: number }) => `${c.code} ${c.level} ${c.number}`;
    expect(left.map(key).sort()).toEqual(["LIVE playoff 1", "LIVE qual 2", "LIVE qual 3", "LIVE qual 4", "LIVE qual 5", "SYD qual 1"]);
    expect(left.filter((c) => liveLoggable(c, NOW))).toEqual([]);
    // Sydney is resolved in its own zone: it started 30 minutes ago.
    expect(left.find((c) => c.code === "SYD")!.start).toBe(Date.parse("2026-11-07T14:30:00Z"));
  });

  it("never duplicates or revises a logged call", async () => {
    const logged = await logAndCheck();
    vi.setSystemTime(NOW + 10 * 60_000);
    resetForecasters(); // even with fresh ratings
    await run("UPDATE matches SET red_total = 999 WHERE season = ? AND code = 'PRIOR' AND number = 1", [S]);
    expect(await logLivePredictions()).toBe(0);
    expect(await ledger()).toEqual([logged]);
    expect(await scoreLivePredictions()).toBe(0); // not played yet: nothing to attach
    expect(await ledger()).toEqual([logged]);
  });

  it("attaches the outcome after the match plays, leaving the call unchanged", async () => {
    const logged = await logAndCheck();
    const scoredAt = Date.parse("2026-11-07T16:50:00Z");
    vi.setSystemTime(scoredAt);
    // Played, with FIRST's actual start (a few minutes late) replacing the scheduled time.
    await run("UPDATE matches SET played = 1, time = '2026-11-07T10:33:12.250', red_total = 80, red_np = 80, blue_total = 61, blue_np = 61 WHERE season = ? AND code = 'LIVE' AND level = 'qual' AND number = 1", [S]);
    expect(await scoreLivePredictions()).toBe(1);
    const [row] = await ledger();
    expect(row).toEqual({ ...logged, red_score: 80, blue_score: 61, outcome: 1, scored_at: new Date(scoredAt).toISOString() });
    // Scoring again (or logging again) changes nothing.
    vi.setSystemTime(scoredAt + 3600_000);
    expect(await scoreLivePredictions()).toBe(0);
    expect(await logLivePredictions()).toBe(0);
    expect(await ledger()).toEqual([row]);
  });

  it("moves a call logged after the actual start out of the live record", async () => {
    await run(
      `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time)
       VALUES ('live', ?, 'LIVE', 'qual', 0, 2, '[205,206]', '[201,203]', 0.5, 50, 50, 'low', 'test', '2026-11-07T15:05:00.000Z', '2026-11-07T09:00:30')`,
      [S],
    );
    await run("UPDATE matches SET played = 1, time = '2026-11-07T09:02:00', red_total = 50, red_np = 50, blue_total = 70, blue_np = 70 WHERE season = ? AND code = 'LIVE' AND level = 'qual' AND number = 2", [S]);
    await scoreLivePredictions();
    const late = (await ledger()).find((r) => r.number === 2);
    expect(late.kind).toBe("late");
    expect(late.outcome).toBeNull();
  });
});

describe("live calls remember their scoring basis", () => {
  it("a call made after rated matches this season has a scoring basis", async () => {
    await logLivePredictions();
    expect((await ledger())[0].no_score_basis).toBe(0);
  });
  it("a call made when the season's only results are scrimmages (unrated) is flagged, and keeps the flag", async () => {
    await run("UPDATE events SET type = 'Scrimmage' WHERE season = ? AND code = 'PRIOR'", [S]);
    resetForecasters();
    await logLivePredictions();
    expect((await ledger())[0].no_score_basis).toBe(1);
    const { matchViews } = await import("../api/matches");
    const v = (await matchViews({ season: S, code: "LIVE" })).find((m) => m.key === "qual:0:1");
    expect(v?.prediction?.kind).toBe("live");
    expect(v?.prediction?.noScoreBasis).toBe(true);
  });
});

describe("replayed calls for the current season", () => {
  it("played scrimmage matches get one (odds only before any rated match); scrimmages never move the ratings", async () => {
    // A scrimmage before the rated PRIOR event: predicted, flagged no-score-basis, not learned from.
    await event("SCRIM", "2026-10-10", CHICAGO, "Scrimmage");
    await match("SCRIM", "qual", 1, "2026-10-10T10:00:00", [201, 202], [203, 204], [300, 5]);
    await match("SCRIM", "qual", 2, "2026-10-10T10:10:00", [205, 206], [201, 203], [40, 41]);
    await backtest(SEASON_NUMBERS, () => {}, { write: [S] });
    const rows = await all<any>("SELECT code, number, no_score_basis, p_red FROM predictions WHERE kind = 'backtest' AND season = ? ORDER BY match_time", [S]);
    const scrim = rows.filter((r) => r.code === "SCRIM");
    expect(scrim).toHaveLength(2);
    expect(scrim.every((r) => r.no_score_basis === 1)).toBe(true);
    // The 300–5 blowout taught the book nothing: SCRIM Q2 starts from the same ratings as Q1.
    // Once rated matches exist, calls carry predicted scores again.
    expect(rows.filter((r) => r.code === "PRIOR").at(-1)!.no_score_basis).toBe(0);
    // Stated score ranges (engine 2.2) go with every call that has a score basis, and with none of the others.
    const ranged = await all<any>("SELECT no_score_basis, red_mean, red_lo, red_hi, blue_lo, blue_hi, range_level FROM predictions WHERE kind = 'backtest'");
    for (const r of ranged) {
      if (r.no_score_basis) expect([r.red_lo, r.red_hi, r.blue_lo, r.blue_hi, r.range_level]).toEqual([null, null, null, null, null]);
      else { expect(r.range_level).toBe(0.8); expect(r.red_lo).toBeLessThanOrEqual(Math.round(r.red_mean)); expect(r.red_hi).toBeGreaterThanOrEqual(Math.round(r.red_mean)); expect(r.blue_hi).toBeGreaterThan(r.blue_lo); }
    }
    const again = await all<any>("SELECT p_red FROM predictions WHERE kind = 'backtest' AND code = 'PRIOR' ORDER BY match_time");
    await run("DELETE FROM matches WHERE code = 'SCRIM'");
    await backtest(SEASON_NUMBERS, () => {}, { write: [S] });
    const without = await all<any>("SELECT p_red FROM predictions WHERE kind = 'backtest' AND code = 'PRIOR' ORDER BY match_time");
    expect(without).toEqual(again);
  });

  it("runStats refreshes the current season's replayed calls on every run, leaving earlier seasons alone", async () => {
    await backtest(SEASON_NUMBERS); // the ledger already exists
    const earlier = Math.min(...SEASON_NUMBERS);
    await run(`INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, match_time)
               VALUES ('backtest', ?, 'OLD', 'qual', 0, 1, '[1,2]', '[3,4]', 0.5, 50, 50, 'moderate', 'x', '2020-01-01', '2020-01-01')`, [earlier]);
    // A match played since the ledger was built.
    await event("NEW", "2026-11-01", CHICAGO);
    await match("NEW", "qual", 1, "2026-11-01T10:00:00", [201, 202], [203, 204], [90, 60]);
    await runStats({ seasons: [S] });
    expect(await all("SELECT 1 FROM predictions WHERE kind = 'backtest' AND code = 'NEW'")).toHaveLength(1);
    expect(await all("SELECT 1 FROM predictions WHERE kind = 'backtest' AND code = 'OLD' AND season = ?", [earlier])).toHaveLength(1);
  });

  it("runStats rebuilds a past season's report cards when it gains a scored live call, and skips it while unchanged", async () => {
    const past = S - 1;
    let id = 0;
    const scoredLive = () => run(`INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at, red_score, blue_score, outcome, scored_at)
      VALUES ('live', ?, 'PAST', 'qual', 0, ?, '[201,202]', '[203,204]', 0.6, 80, 70, 'moderate', 'x', '2025-12-01T00:00:00Z', 90, 60, 1, ?)`, [past, ++id, `2025-12-01T01:00:0${id}Z`]);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, 'PAST', 'Past', 'Qualifier', '2025-12-01', '2025-12-01', 'UTC', 0, 0, 'test')", [past]);
    await scoredLive();
    const cycle = async () => { const lines: string[] = []; await runStats({ seasons: [S], log: (m) => lines.push(m) }); return lines.filter((l) => l.startsWith(`${past}: report cards`)); };
    expect(await cycle()).toHaveLength(1); // first sight: built though the run covered the current season only
    expect(await cycle()).toHaveLength(0); // unchanged: skipped
    await scoredLive();
    expect(await cycle()).toEqual([`${past}: report cards for 4 teams from 2 live calls`]);
  });
});
