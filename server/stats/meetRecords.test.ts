// A league meet's Rankings tab read FIRST's league standing (rank and ranking score averaged over every meet so
// far): a 2-0 team at the meet could show RS 1.5 and rank 4th. The meet's records and its event detail now rank
// the meet on its own matches; a one-day event keeps FIRST's ranking as published.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { computeSeasonStats } from "./job";
import { loadSeason } from "./load";
import { computeRecords } from "./records";
import { eventDetail } from "../api/events";

const S = 2026;

async function event(code: string, type: string) {
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, ?, ?, '2026-11-01', '2026-11-01', 0, 0, 'test')", [S, code, code, type]);
  // FIRST's published row: at a league meet, the league's running standing (team 1 looks 4th on 1.5).
  for (const [t, rank, rp] of [[1, 4, 1.5], [2, 3, 1.6], [3, 2, 1.8], [4, 1, 2.0]]) {
    await run("INSERT INTO event_teams (season, code, team, rank, rp, tbp, qual_played) VALUES (?, ?, ?, ?, ?, 9, 2)", [S, code, t, rank, rp]);
  }
  // Two matches: 1 and 2 win both, and their alliance takes a bonus RP in the first.
  const ms: [number[], number[], number, number, string | null][] = [[[1, 2], [3, 4], 60, 30, '{"movement":true,"goal":false,"pattern":false}'], [[1, 2], [3, 4], 50, 40, null]];
  let n = 0;
  for (const [red, blue, rs, bs, bonus] of ms) {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, red_bonus, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, ?, ?, 10, ?, 5, 0, ?, ?, ?, 10, ?, 5, 0, 'test')",
      [S, code, n, `Q${n}`, rs, rs, rs - 15, bonus, bs, bs, bs - 15]);
    for (const [alliance, ts] of [["red", red], ["blue", blue]] as const) for (const t of ts)
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, ?)", [S, code, n, t, alliance]);
  }
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await event("MEET", "LeagueMeet");
  await event("QUAL", "Qualifier");
  await computeSeasonStats(S, await loadSeason(S));
  await computeRecords(S, await loadSeason(S));
});

const recs = (code: string) => all<any>("SELECT team, rank, rp, tb1, wins, losses FROM team_event_records WHERE season = ? AND code = ? ORDER BY team", [S, code]);

describe("league meet rankings", () => {
  it("the meet's records rank it on its own matches (RS = average RP here, TBP = average non-foul points)", async () => {
    const r = await recs("MEET");
    // 1 and 2 level on everything: team number decides (FIRST draws at random).
    expect(r.map((x) => [x.team, x.rank, x.rp])).toEqual([[1, 1, 3.5], [2, 2, 3.5], [3, 3, 0], [4, 4, 0]]);
    expect(r[0].tb1).toBe(55);
  });

  it("a one-day event keeps FIRST's ranking as published", async () => {
    expect((await recs("QUAL")).map((x) => [x.team, x.rank, x.rp])).toEqual([[1, 4, 1.5], [2, 3, 1.6], [3, 2, 1.8], [4, 1, 2]]);
  });

  it("the meet's detail carries its own standing beside FIRST's league one, which stays as published", async () => {
    const d = (await eventDetail(S, "MEET"))!;
    const one = d.field.find((f) => f.team === 1)!;
    expect(one).toMatchObject({ rank: 4, rp: 1.5 });
    expect(one.meet).toMatchObject({ rank: 1, rs: 3.5, wins: 2, losses: 0, played: 2 });
    expect((await eventDetail(S, "QUAL"))!.field.every((f) => !("meet" in f))).toBe(true);
  });
});
