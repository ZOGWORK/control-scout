// One team's stored facts (server/api/answers/families/facts.ts) on a small fixture database: season OPR and each
// phase's with its world rank, the prediction rating, events in a season or a place, OPR against a place's, the
// world's or an event's (its division's) average, reliability, league standing, the next match, and registration.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { readTwoTeam } from "./read";
import { readTeamFact } from "./families/facts";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run(`INSERT INTO teams (number, name, school, sponsors, city, state, country, rookie_year) VALUES
    (4215, 'Hypnotic Robotics', 'River Dell Regional High School', '["Acme","Globex"]', 'Oradell', 'NJ', 'USA', 2010),
    (6980, 'Bad Wolf', NULL, '[]', 'Oradell', 'NJ', 'USA', 2013),
    (19564, 'The Marvels', NULL, '[]', 'Richardson', 'TX', 'USA', 2021)`);
  for (const [t, opr, rank, rated] of [[4215, 101.6, 616, 2], [6980, 46.9, 2700, 3], [19564, 200, 2, 1]] as const) {
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, rank_auto, rank_teleop, rank_endgame, ranked_teams, matches, wins, losses, ties,
      rating_np, rating_sd, rating_auto, rating_teleop, rating_endgame, rating_pen, rating_matches, rating_rank) VALUES (2025, ?, ?, 28.3, 73.4, 6.7, ?, 900, 500, 1200, 8375, 32, 20, 12, 0, 94.6, 3.2, 25, 60, 9.6, 4.1, 30, ?)`, [t, opr, rank, rated]);
  }
  const ev = (code: string, name: string, type: string, start: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (2025, ?, ?, ?, ?, 'Town', 'NJ', 'USA', ?, ?, 't')", [code, name, type, division, start, start]);
  await ev("USNJCMP", "New Jersey Championship", "Championship", "2026-03-15");
  await ev("USNJCMPPKWY", "New Jersey Championship - Parkway Division", "Championship", "2026-03-15", "USNJCMP");
  await ev("USNJBCLM3", "NJ Bergen League Meet 3", "LeagueMeet", "2026-01-10");
  for (const [t, code, rank] of [[4215, "USNJCMPPKWY", 2], [6980, "USNJCMPPKWY", 9], [4215, "USNJBCLM3", 2], [6980, "USNJBCLM3", 1]] as const) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, ?, ?, ?)", [code, t, rank]);
  }
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'USNJCMPPKWY', 4215, 110, 8), (2025, 'USNJCMPPKWY', 6980, 50, 8)");
  await run(`INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows, recent_near_zero,
    no_show_rate, dq_rate, near_zero_rate, swing, penalty_ratio, predictability_ratio, idx, computed_at) VALUES
    (2025, '', 4215, 30, 1, 0, 2, 30, 10, 0, 1, 0.03, 0, 0.07, 0.4, 0.8, 1.1, 88, 'now'), (2025, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 71, 'now')`);
  await rebuildSearch();
});

describe("team facts", () => {
  it("what's read; a team against a field's average isn't two teams", () => {
    expect(readTeamFact("4215 auto opr")).toMatchObject({ id: "auto-opr", core: "4215" });
    expect(readTeamFact("4215 opr")).toMatchObject({ id: "opr", core: "4215" });
    expect(readTeamFact("4215 event in 2025-26")).toMatchObject({ id: "events-season", season: 2025 });
    expect(readTeamFact("4215 events in new jersey")).toMatchObject({ id: "events-place", region: { state: "NJ" } });
    expect(readTeamFact("4215 opr vs world average")).toMatchObject({ id: "opr-vs-average", world: true });
    expect(readTeamFact("4215 opr vs new jersey championship average")).toMatchObject({ id: "opr-vs-average", event: "new jersey championship" });
    expect(readTwoTeam("4215 OPR vs New Jersey average")).toBeNull();
    // "4215 events" alone is the count, another answer's; Worlds or a match type can't apply to a fact.
    expect(readTeamFact("4215 events")).toBeNull();
    expect(readTeamFact("4215 opr at worlds")).toBeNull();
  });
  it("OPR and its phases, with the world rank; the prediction rating", async () => {
    const o = (await searchAnswer("4215 OPR", { limit: 25 })).stat!;
    expect(o).toMatchObject({ title: "OPR in 2025–26", headline: { value: "101.6", label: "#616 of 8,375 worldwide · top 8%" } });
    const a = (await searchAnswer("4215 auto OPR", { limit: 25 })).stat!;
    expect(a.headline).toMatchObject({ value: "28.3", label: "#900 of 8,375 worldwide · top 11%" });
    const r = (await searchAnswer("4215 prediction rating", { limit: 25 })).stat!;
    expect(r.headline).toMatchObject({ value: "94.6 ± 3.2", label: "#2 of 3 worldwide · top 67%", sub: "30 matches rated" });
  });
  it("events in a season and in a place", async () => {
    expect((await searchAnswer("4215 events in 2025-26", { limit: 25 })).stat!.headline).toMatchObject({ value: "1 event" });
    expect((await searchAnswer("4215 events in New Jersey", { limit: 25 })).stat!.headline).toMatchObject({ value: "2 events", label: "in New Jersey, 1 season" });
  });
  it("OPR against the world's, a state's and an event's division's average", async () => {
    expect((await searchAnswer("4215 OPR vs world average", { limit: 25 })).stat!.headline).toMatchObject({ value: "−14.6", sub: "#2 of 3 by OPR · top 67%" });
    expect((await searchAnswer("4215 OPR vs New Jersey average", { limit: 25 })).stat!.headline).toMatchObject({ value: "+27.3" });
    const e = (await searchAnswer("4215 OPR vs New Jersey Championship average", { limit: 25 })).stat!;
    expect(e.headline).toMatchObject({ value: "+30.0", label: "above the average: 110.0 vs 80.0" });
  });
  it("reliability, league standing, the next match, registration", async () => {
    expect((await searchAnswer("4215 reliability", { limit: 25 })).stat!.headline).toMatchObject({ value: "88", label: "out of 100 · field average 71" });
    expect((await searchAnswer("4215 league rank", { limit: 25 })).stat!.headline).toMatchObject({ value: "#2 of 2", label: "League after NJ Bergen League Meet 3" });
    expect((await searchAnswer("4215 predicted score next match", { limit: 25 })).stat!.none).toContain("no upcoming match");
    expect((await searchAnswer("4215 sponsors", { limit: 25 })).stat!.headline).toMatchObject({ value: "2 sponsors", label: "Acme, Globex" });
    expect((await searchAnswer("4215 rookie year", { limit: 25 })).stat!.headline).toMatchObject({ value: "2010" });
    expect((await searchAnswer("4215 location", { limit: 25 })).stat!.headline).toMatchObject({ value: "Oradell, NJ, USA" });
    expect((await searchAnswer("4215 school", { limit: 25 })).stat!.headline).toMatchObject({ value: "River Dell Regional High School" });
  });
});
