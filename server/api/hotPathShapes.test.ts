// The hot-path API responses (event list and page, match and its report, team page and its sections,
// summaries, rankings, home) pinned byte for byte against a fixture where every column of every table they
// read holds a value. Queries name their columns instead of SELECT *: this proves the responses came out
// the same, and that none grew. A column dropped from a query a response still needs changes the JSON here.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { createApp } from "../app";
import { CURRENT_SEASON } from "../data/seasons";

const S = CURRENT_SEASON;
const SNAPSHOT = fileURLToPath(new URL("./__snapshots__/hotPathShapes.json", import.meta.url));
const TEAMS = [101, 102, 103, 104];

const PATHS = [
  `/api/events?season=${S}`,
  `/api/events/${S}/DONE`,
  `/api/events/${S}/NEXT`,
  `/api/events/${S}/DONE/matches/qual:0:1`,
  `/api/events/${S}/DONE/matches/qual:0:1/report`,
  `/api/events/${S}/NEXT/matches/qual:0:1/report`,
  `/api/teams/101?season=${S}`,
  `/api/teams/101/report-card?season=${S}`,
  `/api/teams/101/matches?season=${S}`,
  `/api/teams-summary?season=${S}&teams=101,102,103,104`,
  `/api/compare?season=${S}&teams=101,102`,
  `/api/rankings?season=${S}`,
  `/api/home/overview?season=${S}`,
];

async function seed() {
  for (const t of TEAMS) {
    await run(
      `INSERT INTO teams (number, name, full_name, school, sponsors, city, state, country, rookie_year, website, home_region, updated_at)
       VALUES (?, ?, ?, ?, '["Acme","Globex"]', 'Trenton', 'NJ', 'USA', 2015, 'https://example.org', 'USNJ', '2025-09-01T00:00:00Z')`,
      [t, `Team ${t}`, `Full Team ${t}`, `School ${t}`],
    );
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, t]);
  }
  for (const [code, start, played] of [["DONE", "2025-11-08", 1], ["NEXT", "2026-01-10", 0]] as const) {
    await run(
      `INSERT INTO events (season, code, name, type, division_code, region, league, venue, city, state, country, start, end, timezone, remote, hybrid,
         website, livestream, source, upstream_updated, synced_at, detail_synced_at, live_checked_at, address)
       VALUES (?, ?, ?, 'Qualifier', NULL, 'USNJ', 'NJL', 'Gym', 'Trenton', 'NJ', 'USA', ?, ?, 'America/New_York', 0, 0,
         'https://example.org/e', 'https://youtube.com/watch?v=abc', 'first', '2025-10-01T00:00:00Z', '2025-10-01T00:00:00Z', '2025-10-01T00:00:00Z', '2025-10-01T00:00:00Z', '1 Main St')`,
      [S, code, `Event ${code}`, start, start],
    );
    for (const [i, t] of TEAMS.entries()) {
      await run("INSERT INTO event_teams (season, code, team, rank, rp, tbp, wins, losses, ties, qual_played, dq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
        [S, code, t, played ? i + 1 : null, played ? 4 - i : null, played ? 20 + i : null, played ? 2 - Math.min(i, 2) : null, played ? Math.min(i, 2) : null, 0, played ? 2 : 0]);
      if (played) {
        await run(`INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, opr_pen, avg_score, avg_np, avg_pen, matches, wins, losses, ties)
          VALUES (?, ?, ?, ?, 10.5, 20.25, 5.5, 1.5, 70.5, 60.25, 3.5, 2, 1, 1, 0)`, [S, code, t, 40 - i]);
      }
    }
    for (const n of [1, 2]) {
      const p = played;
      await run(
        `INSERT INTO matches (season, code, level, series, number, label, description, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, red_bonus,
           blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, blue_bonus, video, source, red_tips, blue_tips, field, breakdown, red_detail, blue_detail)
         VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'first', ?, ?, 1, ?, ?, ?)`,
        [S, code, n, `Q${n}`, `Qualification ${n}`, `${start}T10:0${n}:00`, p,
          p ? 120 : null, p ? 110 : null, p ? 30 : null, p ? 60 : null, p ? 20 : null, p ? 10 : null, p ? '{"movement":true}' : null,
          p ? 90 : null, p ? 85 : null, p ? 25 : null, p ? 45 : null, p ? 15 : null, p ? 5 : null, p ? '{"movement":false}' : null,
          p ? "https://youtube.com/watch?v=m" + n : null, p ? 3 : null, p ? 2 : null,
          p ? '{"big":"breakdown blob"}' : null, p ? '{"autoLeave":true,"artifacts":12}' : null, p ? '{"autoLeave":false,"artifacts":9}' : null],
      );
      for (const [i, t] of TEAMS.entries()) {
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station, surrogate, dq, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, 0, 0, 1)",
          [S, code, n, t, i < 2 ? "red" : "blue", (i % 2) + 1]);
      }
      for (const kind of p ? ["live", "backtest"] : ["live"]) {
        await run(
          `INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, factors, engine_version, predicted_at, match_time,
             red_score, blue_score, outcome, scored_at, no_score_basis, model_id, data_version, ratings_through, p_red_shadow, shadow_model_id,
             red_lo, red_hi, blue_lo, blue_hi, range_level, bonus_red, bonus_blue, bonus_tier, bonus_model, history, factor_sheet)
           VALUES (?, ?, ?, 'qual', 0, ?, '[101,102]', '[103,104]', 0.62, 101.5, 92.5, 'moderate', '[{"label":"Stronger auto","side":"red"}]', '3.3.0', ?, ?,
             ?, ?, ?, ?, 0, 'm1', 'v1', '2025-11-01', 0.6, 'm0', 80, 120, 70, 110, 0.8, '{"movement":0.7}', '{"movement":0.5}', 'moderate', 'b1',
             '{"pairs":[]}', '{"rows":["a very long factor sheet that the match list never needs"]}')`,
          [kind, S, code, n, `${start}T09:00:00Z`, `${start}T10:0${n}:00`, p ? 120 : null, p ? 90 : null, p ? "red" : null, p ? `${start}T11:00:00Z` : null],
        );
      }
    }
  }
  await run("INSERT INTO alliances (season, code, number, name, captain, pick1, pick2, backup) VALUES (?, 'DONE', 1, 'Alliance 1', 101, 102, NULL, 103)", [S]);
  await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, 'DONE', 'Inspire', 1, 101, 'Inspire Award'), (?, 'DONE', 'Winner', 1, 102, 'Winning Alliance')", [S, S]);
  await run(`INSERT INTO advancement (season, code, slots, advances_to, rows) VALUES (?, 'DONE', 2, 'NJ State', '[{"team":101,"advances":true}]')`, [S]);
  for (const [i, t] of [0, ...TEAMS].entries()) {
    await run(
      `INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows, recent_near_zero,
         no_show_rate, dq_rate, near_zero_rate, swing, penalty_ratio, predictability_ratio, idx, computed_at)
       VALUES (?, '', ?, 10, ?, 0, 1, 8, 10, ?, 1, 0.1, 0, 0.1, 12.5, 0.2, 0.9, ?, '2025-11-09T00:00:00Z')`,
      [S, t, i % 2, i % 2, 50 + i],
    );
  }
  for (const [i, t] of TEAMS.entries()) {
    await run(
      `INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, opr_pen, rank_np, rank_auto, rank_teleop, rank_endgame, ranked_teams,
         rating_np, rating_auto, rating_teleop, rating_endgame, rating_pen, rating_sd, rating_matches, rating_rank, events, matches, wins, losses, ties, avg_np, avg_score, avg_pen)
       VALUES (?, ?, ?, 10, 20, 5, 1, ?, ?, ?, ?, 4, ?, 11, 21, 6, 2, 4.5, 2, ?, 1, 2, 1, 1, 0, 60, 70, 3)`,
      [S, t, 40 - i, i + 1, i + 1, i + 1, i + 1, 45 - i, i + 1],
    );
    for (const code of ["", "DONE"]) {
      await run(
        `INSERT INTO team_report_cards (season, code, team, final, calls, decided, hits, scored, err_mean, err_abs, err_var, hit_shrunk, err_mean_shrunk, err_abs_shrunk, err_var_shrunk, computed_at)
         VALUES (?, ?, ?, 1, 2, 2, 1, 2, 1.5, 8.5, 20, 0.55, 1.2, 8, 18, '2025-11-09T00:00:00Z')`,
        [S, code, t],
      );
    }
  }
  await kvSet("data:version", "v1");
}

let server: Server;
let base = "";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2025-12-01T15:00:00Z"));
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await seed();
  clearAllCaches();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); vi.useRealTimers(); });

describe("hot-path API responses", () => {
  it("come out byte for byte as before, none larger", async () => {
    const now: Record<string, { status: number; bytes: number; body: unknown }> = {};
    for (const p of PATHS) {
      const r = await fetch(base + p);
      const text = await r.text();
      now[p] = { status: r.status, bytes: Buffer.byteLength(text), body: JSON.parse(text) };
    }
    // UPDATE_HOT_PATH_SHAPES=1 records the snapshot (only from code whose responses are known good).
    if (process.env.UPDATE_HOT_PATH_SHAPES === "1") writeFileSync(SNAPSHOT, JSON.stringify(now, null, 1) + "\n");
    expect(existsSync(SNAPSHOT), "no snapshot: record one with UPDATE_HOT_PATH_SHAPES=1").toBe(true);
    const before = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as typeof now;
    expect(Object.keys(now)).toEqual(Object.keys(before));
    for (const p of PATHS) {
      expect(now[p].status, p).toBe(200);
      expect(now[p].bytes, p).toBeLessThanOrEqual(before[p].bytes);
      expect(now[p].body, p).toEqual(before[p].body);
    }
  });
});
