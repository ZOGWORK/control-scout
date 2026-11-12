// Failed searches #1381, #1389–#1392 and #1394, each a board with a filter or a measure of its own: the teams at Worlds
// by OPR there (in the search box too), the OPR board without teams that ever won an award, a name's part on the OPR
// board, the prediction rating gained from the first event to the last, a place's events by average match score, and
// the teams unbeaten at a championship-level event. The queries are the logged ones; the numbers are the fixture's.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import type { StatAnswer } from "../../../src/shared/searchStat";

const page = (q: string) => searchAnswer(q, { limit: 25, full: true });
const box = (q: string) => searchAnswer(q, { limit: 12 });
const ask = async (q: string) => (await page(q)).stat as StatAnswer;
const rows = (s: StatAnswer) => {
  const b = s.blocks.find((x) => x.kind === "leaderboard" || x.kind === "table");
  return b?.kind === "leaderboard" ? b.rows.map((r) => r.team.label) : b?.kind === "table" ? b.rows.map((r) => String(r.cells.team ?? r.cells.event)) : [];
};

beforeAll(async () => {
  // The current season is 2026–27, with nothing played yet: "this season" falls back to 2025–26, as on the site.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, state, country, OPR, rating, wins, losses
  const teams: [number, string, string, string, number, number, number, number][] = [
    [14270, "Quantum Robotics", "B", "Romania", 238, 256, 17, 2], [15993, "infO(1)Robotics", "PH", "Romania", 217, 250, 7, 5],
    [4215, "Hypnotic Robotics", "NJ", "USA", 150, 140, 20, 4], [7149, "ENFORCERS", "NJ", "USA", 120, 110, 10, 3],
    [23268, "Ultraviolet", "NJ", "USA", 100, 90, 8, 8], [6980, "Bad Wolf", "NJ", "USA", 50, 60, 5, 10],
  ];
  for (const [n, name, state, country, opr, rating, w, l] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, ?)", [n, name, state, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rating_np, rating_matches, matches, events, wins, losses, ties) VALUES (2025, ?, ?, 30, ?, 10, ?, 12, 12, 2, ?, ?, 0)", [n, opr, opr - 40, rating, w, l]);
  }
  // Awards: 14270 a winning alliance a season earlier, 4215 an Inspire; the other four have none.
  await run("INSERT INTO awards (season, code, type, placement, team) VALUES (2024, 'ROCMP', 'Winner', 1, 14270), (2025, 'USNJCMP', 'Inspire', 1, 4215)");
  const ev = (code: string, name: string, type: string, start: string, state: string, country: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (2025, ?, ?, ?, ?, 'Town', ?, ?, ?, ?, 't')", [code, name, type, division, state, country, start, start]);
  await ev("FTCCMP1", "FIRST Championship", "FIRSTChampionship", "2026-04-29", "TX", "USA");
  await ev("FTCCMP1ROSS", "FIRST Championship - Ross Division", "FIRSTChampionship", "2026-04-29", "TX", "USA", "FTCCMP1");
  await ev("ROQ1", "Bucharest Qualifier", "Qualifier", "2026-01-10", "B", "Romania");
  await ev("ROCMP", "Romania Championship", "Championship", "2026-03-14", "B", "Romania");
  await ev("ROSCRIM", "Romania Scrimmage", "Scrimmage", "2025-12-06", "B", "Romania");
  await ev("USNJNOLT", "Northern League Tournament", "LeagueTournament", "2026-02-21", "NJ", "USA");
  await ev("USNJCMP", "New Jersey Championship", "Championship", "2026-03-15", "NJ", "USA");
  let n = 0;
  const match = async (code: string, red: number, blue: number, reds: number[], blues: number[]) => {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, 'qual', 0, ?, ?, '2026-02-01T10:00:00Z', 1, ?, ?, ?, ?, 't')", [code, n, `Q${n}`, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, ?, 'qual', 0, ?, ?, ?, 1)", [code, n, t, a]);
    }
  };
  // Romania: the championship averages 200 a side, the qualifier 100, the scrimmage 300 (not an official event).
  for (let i = 0; i < 10; i++) await match("ROCMP", 220, 180, [14270], [15993]);
  for (let i = 0; i < 10; i++) await match("ROQ1", 120, 80, [15993], [14270]);
  for (let i = 0; i < 10; i++) await match("ROSCRIM", 300, 300, [14270], [15993]);
  // New Jersey: 4215 unbeaten at the state championship (6980 lost there), 7149 unbeaten at the league tournament.
  for (let i = 0; i < 3; i++) await match("USNJCMP", 150, 100, [4215], [6980]);
  await match("USNJCMP", 150, 150, [4215], [23268]);
  for (let i = 0; i < 2; i++) await match("USNJNOLT", 140, 90, [7149], [23268]);
  // Worlds: 14270 at the top by OPR there, 7149 under it.
  for (const [t, opr] of [[14270, 230], [7149, 125]] as const) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'FTCCMP1ROSS', ?, 1)", [t]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (2025, 'FTCCMP1ROSS', ?, ?, 30, ?, 10, 8)", [t, opr, opr - 40]);
  }
  // Each Romanian team's first event (the qualifier) and last (the championship); its rating the Monday after the first.
  for (const [t, after] of [[14270, 86], [15993, 19]] as const) {
    for (const code of ["ROQ1", "ROCMP"]) await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, ?, ?, 100, 10)", [code, t]);
    await run("INSERT INTO ranking_snapshots (season, week, team, rank, rating) VALUES (2025, '2026-01-12', ?, 1, ?)", [t, after]);
  }
  await rebuildSearch();
});
afterAll(() => { vi.useRealTimers(); });

describe("boards from failed searches", () => {
  it("#1381: the teams at Worlds by OPR there, on the page and in the search box", async () => {
    const s = await ask("top teams opr at worlds decode");
    expect(s.intent).toBe("event-best");
    expect(rows(s)[0]).toBe("14270 Quantum Robotics");
    expect((await ask("top teams by teleop opr at worlds decode")).title).toMatch(/TeleOp OPR there/);
    // The box gets its link to the page, never no match.
    const b = await box("top teams opr at worlds decode");
    expect(b.step).toBe("deterministic");
    expect(b.pages[0]?.href).toBe(`/search?q=${encodeURIComponent("top teams opr at worlds decode")}`);
  });

  it("#1389: the OPR board leaves out every team with an award on record", async () => {
    const s = await ask("highest OPR team that has never won an award");
    expect(s.title).toMatch(/no award ever won/);
    expect(s.headline?.value).toBe("15993 infO(1)Robotics");
    expect(rows(s)).not.toContain("14270 Quantum Robotics");
    expect(rows(s)).not.toContain("4215 Hypnotic Robotics");
    expect((await box("highest OPR team that has never won an award")).step).toBe("deterministic");
  });

  it("#1394: the OPR board of the teams whose name includes the word, never a team read from it", async () => {
    const s = await ask("show me teams with a name that includes Robot, sorted by OPR");
    expect(s.title).toMatch(/name includes “Robot”/);
    expect(rows(s)).toEqual(["14270 Quantum Robotics", "15993 infO(1)Robotics", "4215 Hypnotic Robotics"]);
  });

  it("#1392: the prediction rating gained from the first event to the last", async () => {
    const s = await ask("whats the fastest growing team in the world in 2025-26, by rating gain across the season");
    expect(s.intent).toBe("rating-gain");
    // 15993: 19 → 250 (+231); 14270: 86 → 256 (+170).
    expect(rows(s)).toEqual(["15993 infO(1)Robotics", "14270 Quantum Robotics"]);
    expect(s.headline?.label).toMatch(/^\+231\.0 rating: 19\.0 → 250\.0/);
  });

  it("#1390: a place's official events by average match score, the season before when this one has none", async () => {
    const s = await ask("which event had the highest average match score in Romania this season");
    expect(s.intent).toBe("event-average-board");
    expect(s.title).toMatch(/Romania.*2025–26/);
    expect(rows(s)).toEqual(["Romania Championship", "Bucharest Qualifier"]);
    expect(s.headline?.label).toMatch(/^200\.0 points per alliance/);
    expect(s.scope.join(" ")).toMatch(/No 2026–27 .*showing 2025–26/);
  });

  it("#1391: the teams unbeaten at a championship-level event, each with its record there", async () => {
    const s = await ask("teams with a perfect 8-0 record at any championship event this season");
    expect(s.intent).toBe("unbeaten-at");
    const t = s.blocks.find((x) => x.kind === "table");
    const got = t?.kind === "table" ? t.rows.map((r) => `${r.cells.team} ${r.cells.event} ${r.cells.record}`) : [];
    // 14270 at the Romania Championship, 4215 at the state championship (a tie, no loss), 7149 at the league
    // tournament; never 6980 (lost), 23268 (a tie and no win), nor 15993's qualifier, which isn't a championship.
    expect(got).toEqual(["14270 Quantum Robotics Romania Championship 10-0-0", "4215 Hypnotic Robotics New Jersey Championship 3-0-1", "7149 ENFORCERS Northern League Tournament 2-0-0"]);
    expect(s.definition).toMatch(/“8-0” read as no losses/);
    expect(s.scope.join(" ")).toMatch(/No 2026–27 teams unbeaten at championship events yet; showing 2025–26/);
  });
});
