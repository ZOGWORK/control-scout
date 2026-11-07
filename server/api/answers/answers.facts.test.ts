// One team's stored facts (server/api/answers/families/facts.ts) on a small fixture database: season OPR and each
// phase's with its world rank, the prediction rating, events in a season or a place, OPR against a place's, the
// world's or an event's (its division's) average, reliability, league standing and the next match.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { readTwoTeam } from "./read";
import { readTeamFact } from "./families/facts";
import { seasonStats } from "../teams";
import { num } from "../../../src/shared/format";
import type { StatBlock } from "../../../src/shared/searchStat";

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
  // A rookie with a posted schedule and no played match; an old event's match left unplayed; a team under 3 matches.
  await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (31000, 'New Bots', 'Edison', 'NJ', 'USA', 2026), (9999, 'Two Matches', 'Trenton', 'NJ', 'USA', 2020)");
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, 'USNJFUT', 'Future Qualifier', 'Qualifier', 'Edison', 'NJ', 'USA', '2099-01-10', '2099-01-10', 't'), (2025, 'USNJOLD', 'Old Qualifier', 'Qualifier', 'Edison', 'NJ', 'USA', '2025-10-01', '2025-10-01', 't')");
  for (const [code, season, t] of [["USNJFUT", 2026, 31000], ["USNJOLD", 2025, 4215]] as const) {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, ?, 'qual', 0, 3, 'Q3', 0, 't')", [season, code]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, 3, ?, 'red', 1)", [season, code, t]);
  }
  await run("INSERT INTO team_season_stats (season, team, opr_np, matches, wins, losses, ties) VALUES (2025, 9999, 300, 2, 2, 0, 0)");
  // An event abroad, in a country stored by FIRST's own label and a county's code (failed-search #823).
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'ROCMP', 'Romania National Championship', 'Championship', 'Bucharest', 'B', 'Romania', '2026-03-01', '2026-03-01', 't')");
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'ROCMP', 19564, 4)");
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
    // A bare year naming nothing else is the team's number.
    expect(readTeamFact("2024 reliability")).toMatchObject({ id: "reliability", core: "2024", season: null });
  });
  it("OPR and its phases, with the world rank; the prediction rating", async () => {
    const o = (await searchAnswer("4215 OPR", { limit: 25 })).stat!;
    expect(o).toMatchObject({ title: "OPR in 2025–26", headline: { value: "101.6", label: "#616 of 8,375 worldwide · top 8%" } });
    // Every number on the card is the team page's (seasonStats, the reader /teams/4215 uses), formatted as it formats them.
    const page = (await seasonStats(2025, 4215))!;
    const kp = o.blocks.find((b) => b.kind === "kpis") as Extract<StatBlock, { kind: "kpis" }>;
    expect(kp.items.map((i) => [i.phase, i.value, i.rank, i.of])).toEqual((["np", "auto", "teleop", "endgame"] as const).map((k) => [k, num(page.opr[k].value), page.opr[k].rank, page.opr[k].of]));
    const a = (await searchAnswer("4215 auto OPR", { limit: 25 })).stat!;
    expect(a.headline).toMatchObject({ value: "28.3", label: "#900 of 8,375 worldwide · top 11%" });
    const r = (await searchAnswer("4215 prediction rating", { limit: 25 })).stat!;
    // The rating, its ± and its world rank first, as the team page's rating tile (num: "94.6 ± 3.2", "98 ± 3.2").
    expect(r.headline).toMatchObject({ value: "94.6 ± 3.2", label: "#2 worldwide of 3 rated · top 67%", sub: "30 matches rated · 2025–26" });
    const rk = r.blocks.find((b) => b.kind === "kpis") as Extract<StatBlock, { kind: "kpis" }>;
    expect(rk.items[0]).toMatchObject({ label: "Prediction rating", value: `${num(page.rating!.np)} ± ${num(page.rating!.sd)}`, sub: "#2 worldwide of 3" });
  });
  it("a name ending in s owns with an apostrophe alone; a rate is \"per match\" (audit v2.8.9)", async () => {
    const o = (await searchAnswer("4215 OPR", { limit: 25 })).stat!;
    expect(o.source).toBe("From 4215 Hypnotic Robotics' 2025–26 season numbers");
    const r = (await searchAnswer("4215 prediction rating", { limit: 25 })).stat!;
    expect(r.source).toBe("From 4215 Hypnotic Robotics' 2025–26 rating");
    const kpis = r.blocks.find((b) => b.kind === "kpis");
    expect(kpis && kpis.kind === "kpis" && kpis.items.find((k) => k.label === "Penalty points given away")).toMatchObject({ value: "4.1", sub: "per match" });
    expect(r.definition).toContain("hand the other alliance per match");
    for (const s of [o, r]) expect(JSON.stringify(s)).not.toMatch(/Robotics's|\ba match"/);
  });
  it("events in a season and in a place", async () => {
    expect((await searchAnswer("4215 events in 2025-26", { limit: 25 })).stat!.headline).toMatchObject({ value: "2 events" });
    expect((await searchAnswer("4215 events in New Jersey", { limit: 25 })).stat!.headline).toMatchObject({ value: "2 events", label: "in New Jersey, 1 season" });
    // A season named keeps to it.
    const n = (await searchAnswer("4215 events in New Jersey 2024-25", { limit: 25 })).stat!;
    expect(n).toMatchObject({ title: "Events in New Jersey in 2024–25", none: expect.stringContaining("no events in New Jersey in 2024–25") });
  });
  // Failed-search #823, held out: another team, other words. A whole country is every state or province of it.
  it("events in a country, asked as a question", async () => {
    expect(readTeamFact("19564 events in romania")).toMatchObject({ id: "events-place", region: null, country: { code: "RO" } });
    for (const q of ["19564 events in Romania", "which events did the marvels compete in romania this season, in date order"]) {
      const s = (await searchAnswer(q, { limit: 25 })).stat;
      expect(s, q).toMatchObject({ intent: "events-place", headline: { value: "1 event" } });
      const t = s!.blocks.find((b) => b.kind === "table");
      expect(t && t.kind === "table" && t.rows.map((r) => r.cells.event), q).toEqual(["Romania National Championship"]);
    }
    // Its events at home aren't a country's.
    expect((await searchAnswer("4215 events in romania", { limit: 25 })).stat).toMatchObject({ none: expect.stringContaining("no events in Romania") });
  });
  it("OPR against the world's, a state's and an event's division's average", async () => {
    // Worldwide: the team page's own world rank, and the average over the teams that rank counts, stated.
    expect((await searchAnswer("4215 OPR vs world average", { limit: 25 })).stat!.headline).toMatchObject({ value: "−14.6", sub: expect.stringMatching(/^#616 of 3 by OPR · .* · world average 116\.2 across 3 teams$/) });
    expect((await searchAnswer("4215 OPR vs New Jersey average", { limit: 25 })).stat!.headline).toMatchObject({ value: "+27.3" });
    const e = (await searchAnswer("4215 OPR vs New Jersey Championship average", { limit: 25 })).stat!;
    expect(e.headline).toMatchObject({ value: "+30.0", label: "above the average: 110.0 vs 80.0" });
    // A team under 3 matches isn't in the counted group: no rank among them.
    expect((await searchAnswer("9999 OPR vs New Jersey average", { limit: 25 })).stat!.headline).toMatchObject({ sub: "Not ranked among them: under 3 matches" });
  });
  it("reliability, league standing, the next match; a question about the next match is the asks' own", async () => {
    expect((await searchAnswer("4215 reliability", { limit: 25 })).stat!.headline).toMatchObject({ value: "88", label: "out of 100 · field average 71" });
    expect((await searchAnswer("4215 league rank", { limit: 25 })).stat!.headline).toMatchObject({ value: "#2 of 2", label: "League after NJ Bergen League Meet 3" });
    // An old event's match left unplayed is never "next"; a rookie's posted schedule is, with no season played.
    expect((await searchAnswer("4215 predicted score next match", { limit: 25 })).stat!.none).toContain("no upcoming match");
    expect((await searchAnswer("31000 predicted score next match", { limit: 25 })).stat!.headline).toMatchObject({ value: "Q3", label: expect.stringContaining("Future Qualifier") });
    for (const q of ["will 4215 win its next match", "when is 4215 next match", "when is 4215 next event", "what events did 4215 win in 2025"]) expect(readTeamFact(q), q).toBeNull();
  });
});

describe("reliability asked what it means (260-query list, 11-04)", () => {
  it("reads the team, not the question's words", () => {
    expect(readTeamFact("what does 4215's reliability score mean")).toMatchObject({ id: "reliability", core: "4215" });
    expect(readTeamFact("4215 reliability rating")).toMatchObject({ id: "reliability", core: "4215" });
    expect(readTeamFact("4215 rating")).toMatchObject({ id: "rating", core: "4215" });
  });
});
