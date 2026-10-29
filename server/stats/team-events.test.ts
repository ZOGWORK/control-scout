// Team trends had gaps that weren't real:
//  - hybrid events (ordinary 2v2 matches, some teams remote) got no stats at all;
//  - league rosters list every league team at every meet, so meets a team never
//    played showed up as empty events.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { computeSeasonStats } from "./job";
import { loadSeason } from "./load";
import { teamEvents } from "../api/teams";

const S = 2025;
const TEAMS = [101, 102, 103, 104, 105, 106];

async function event(code: string, start: string, hybrid: number, roster: number[], played: number[]) {
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, ?, 'LeagueMeet', ?, ?, 0, ?, 'test')", [S, code, code, start, start, hybrid]);
  for (const t of roster) await run("INSERT INTO event_teams (season, code, team, qual_played) VALUES (?, ?, ?, 16)", [S, code, t]);
  // Every pairing of the playing teams, so OPR is solvable.
  let n = 0;
  for (let i = 0; i < played.length; i++) for (let j = 0; j < played.length; j++) {
    if (i === j) continue;
    const red = [played[i], played[(i + 1) % played.length]], blue = [played[j], played[(j + 2) % played.length]];
    if (new Set([...red, ...blue]).size < 4) continue;
    n++;
    const rs = 40 + red[0] - 100 + red[1] - 100, bs = 40 + blue[0] - 100 + blue[1] - 100;
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, ?, ?, 10, ?, 5, 2, ?, ?, 10, ?, 5, 2, 'test')",
      [S, code, n, `Q${n}`, rs + 2, rs, rs - 15, bs + 2, bs, bs - 15]);
    for (const [alliance, ts] of [["red", red], ["blue", blue]] as const) for (const t of ts)
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, ?)", [S, code, n, t, alliance]);
  }
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await event("MEET1", "2025-11-01", 0, TEAMS, [101, 102, 103, 104, 105]); // 106 on the roster, didn't play
  await event("HYB", "2025-11-15", 1, TEAMS, TEAMS); // hybrid, ordinary 2v2 matches
  // NOSHOW: 106 was scheduled into a match but never took the field.
  await event("NOSHOW", "2025-11-22", 0, TEAMS, [101, 102, 103, 104, 105]);
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'NOSHOW', 'qual', 0, 1, 106, 'red', 0)", [S]);
  await computeSeasonStats(S, await loadSeason(S));
});

describe("per-event team stats", () => {
  it("computes stats for hybrid events", async () => {
    const rows = await all<{ opr_np: number | null }>("SELECT opr_np FROM team_event_stats WHERE season = ? AND code = 'HYB'", [S]);
    expect(rows.length).toBe(TEAMS.length);
    expect(rows.every((r) => r.opr_np != null)).toBe(true);
  });
  it("lists only events the team played once results exist", async () => {
    // Roster-only MEET1 hidden. NOSHOW stays: a qualification no-show is on the team's record, as FIRST counts it.
    const evs = await teamEvents(S, 106);
    expect(evs.map((e) => e.code)).toEqual(["HYB", "NOSHOW"]);
    expect(evs[1]).toMatchObject({ played: 1, onField: false });
    expect((await teamEvents(S, 101)).map((e) => e.code)).toEqual(["MEET1", "HYB", "NOSHOW"]);
  });
  it("keeps upcoming events the team is registered for", async () => {
    await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'NEXT', 'NEXT', 'Qualifier', '2099-12-01', '2099-12-01', 'test')", [S]);
    await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'NEXT', 106)", [S]);
    expect((await teamEvents(S, 106)).map((e) => e.code)).toEqual(["HYB", "NOSHOW", "NEXT"]);
  });
});
