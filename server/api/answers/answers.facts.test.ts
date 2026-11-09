// One team's stored facts (server/api/answers/families/facts.ts) on a small fixture database: season OPR and each
// phase's with its world rank, the prediction rating, events in a season or a place, OPR against a place's, the
// world's or an event's (its division's) average, reliability, league standing and the next match.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { readTwoTeam } from "./read";
import { readTeamFact } from "./families/facts";
import { longForm } from "../searchLongForm";
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
  // An earlier meet of the same league with teams that skipped meet 3: the league's standing counts them too.
  await ev("USNJBCLM2", "NJ Bergen League Meet 2", "LeagueMeet", "2025-12-10");
  await run("UPDATE events SET league = 'BCL' WHERE code IN ('USNJBCLM2', 'USNJBCLM3')");
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJBCLM2', 31997, 1), (2025, 'USNJBCLM2', 31998, 3)");
  // A later meet 4215 skipped, with a team new to the league: not in the standing 4215's meet 3 rank comes from.
  await ev("USNJBCLM4", "NJ Bergen League Meet 4", "LeagueMeet", "2026-02-10");
  await run("UPDATE events SET league = 'BCL' WHERE code = 'USNJBCLM4'");
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJBCLM4', 31996, 1)");
  // Another region's league with the same code, earlier: its teams aren't in New Jersey's BCL standing.
  await ev("USCABCLM1", "California League Meet 1", "LeagueMeet", "2025-11-10");
  await run("UPDATE events SET region = CASE WHEN code = 'USCABCLM1' THEN 'USCA' ELSE 'USNJ' END WHERE code LIKE 'US%BCLM%'");
  await run("UPDATE events SET league = 'BCL' WHERE code = 'USCABCLM1'");
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USCABCLM1', 31995, 1), (2025, 'USCABCLM1', 31994, 2)");
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
  // A played match there, and an upcoming event the team is already listed for (Greptile on #1084).
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'ROCMP', 'qual', 0, 1, 'Q1', '2026-03-01T10:00:00Z', 1, 80, 80, 60, 60, 't')");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'ROCMP', 'qual', 0, 1, 19564, 'red', 1)");
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'ROFUT', 'Cluj Invitational', 'Qualifier', 'Cluj', 'CJ', 'Romania', '2099-02-01', '2099-02-01', 't')");
  await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'ROFUT', 19564)");
  // Played too, with no win-loss record: an event it played only as a surrogate, and a remote one (FIRST's match count).
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'MDSUR', 'Chisinau Qualifier', 'Qualifier', 'Chisinau', 'C', 'Moldova', '2026-01-10', '2026-01-10', 't')");
  await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'MDSUR', 19564)");
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'MDSUR', 'qual', 0, 1, 'Q1', '2026-01-10T10:00:00Z', 1, 70, 70, 50, 50, 't')");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field, surrogate) VALUES (2025, 'MDSUR', 'qual', 0, 1, 19564, 'red', 1, 1)");
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, remote, source) VALUES (2025, 'MDREM', 'Moldova Remote Qualifier', 'Qualifier', 'Chisinau', 'C', 'Moldova', '2026-01-20', '2026-01-20', 1, 't')");
  await run("INSERT INTO event_teams (season, code, team, rank, qual_played) VALUES (2025, 'MDREM', 19564, 3, 5)");
  await rebuildSearch();
});

describe("team facts", () => {
  it("what's read; a team against a field's average isn't two teams", () => {
    expect(readTeamFact("4215 auto opr")).toMatchObject({ id: "auto-opr", core: "4215" });
    expect(readTeamFact("4215 opr")).toMatchObject({ id: "opr", core: "4215" });
    // OPR is already a per-match average (failed basic search): "average OPR" is the same number, the team left alone.
    for (const q of ["4215 average opr", "4215 avg opr"]) expect(readTeamFact(q), q).toMatchObject({ id: "opr", core: "4215" });
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
    const rows = async (q: string) => {
      const s = (await searchAnswer(q, { limit: 25 })).stat;
      expect(s, q).toMatchObject({ headline: { value: expect.stringMatching(/^\d+ events?$/) } });
      const t = s!.blocks.find((b) => b.kind === "table");
      return t && t.kind === "table" ? t.rows.map((r) => r.cells.event) : null;
    };
    // Newest first, unless the order asked is the date's (Greptile on #1084: it's kept, never dropped).
    expect(await rows("19564 events in Romania")).toEqual(["Cluj Invitational", "Romania National Championship"]);
    expect(await rows("which events did the marvels compete in romania this season, in date order")).toEqual(["Romania National Championship", "Cluj Invitational"]);
    // Its events at home aren't a country's.
    expect((await searchAnswer("4215 events in romania", { limit: 25 })).stat).toMatchObject({ none: expect.stringContaining("no events in Romania") });
    // A bare year is the team's number there too, and keeps the country (Greptile on #1084: it threw).
    expect(readTeamFact("2024 events in romania")).toMatchObject({ id: "events-place", core: "2024", country: { code: "RO" } });
  });
  it("events played: never the season's upcoming ones (Greptile on #1084)", async () => {
    expect((await searchAnswer("19564 events in 2025-26", { limit: 25 })).stat!.headline).toMatchObject({ value: "4 events" });
    const s = (await searchAnswer("how many events did the marvels play in 2025-26 and which was their best by rank", { limit: 25 })).stat!;
    // Its record's event, a surrogate-only one and a remote one count; the upcoming one doesn't (Greptile on #1084).
    expect(s).toMatchObject({ title: "Events played in 2025–26", headline: { value: "3 events" } });
    const names = s.blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => String(r.cells.event)) : []));
    expect(names).not.toContain("Cluj Invitational");
  });
  it("a season's events in one month, and the best finish named (failed-search #1079, #829, #1091)", async () => {
    const stat = async (q: string) => (await searchAnswer(q, { limit: 25 })).stat!;
    const rows = (s: Awaited<ReturnType<typeof stat>>) => s.blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => String(r.cells.event)) : []));
    // January 2026 is 2025–26's: the surrogate-only qualifier and the remote one.
    const jan = await stat("19564 events during january 2026");
    expect(jan).toMatchObject({ title: "Events in January 2026 (2025–26)", headline: { value: "2 events" } });
    expect(rows(jan).sort()).toEqual(["Chisinau Qualifier", "Moldova Remote Qualifier"]);
    expect((await stat("did the marvels play at any event in january 2026")).headline).toMatchObject({ value: "2 events" });
    expect((await stat("what events did the marvels play in march 2026")).headline).toMatchObject({ value: "1 event", sub: "Best finish #4 at Romania National Championship" });
    expect((await stat("19564 events in may 2026")).none).toContain("no events in May 2026 (2025–26)");
    // The best finish of the season's events: the remote qualifier's #3, ahead of the championship's #4.
    expect((await stat("19564 events and best finish in 2025-26")).headline).toMatchObject({ value: "4 events", sub: "Best finish #3 at Moldova Remote Qualifier" });
    // A month is the events list's filter only: any other answer would drop it.
    expect(readTeamFact("19564 opr in march 2026")).toBeNull();
    expect(readTeamFact("19564 events in march 2026")).toMatchObject({ id: "events-season", season: 2025, month: 2 });
    // A team number that reads as a year keeps the month's own year (Greptile on #1084).
    expect(readTeamFact("2023 events in march 2025")).toMatchObject({ id: "events-season", core: "2023", season: 2024, month: 2 });
    expect(readTeamFact("2023 events in october 2025")).toMatchObject({ core: "2023", season: 2025, month: 9 });
    expect(readTeamFact("2024 events in march 2024")).toMatchObject({ id: "events-season", core: "2024", season: 2023, month: 2 });
    // A team number that isn't a year reads the same month and year.
    expect(readTeamFact("4215 events in march 2024")).toMatchObject({ id: "events-season", core: "4215", season: 2023, month: 2 });
    // The month with the season said apart keeps the month (Greptile on #1084).
    expect((await stat("19564 events in march in 2025-26")).headline).toMatchObject({ value: "1 event" });
    expect(readTeamFact("19564 events in march in 2025-26")).toMatchObject({ season: 2025, month: 2 });
    // "Did … play at any event in <place>" isn't read as a played list: the place's list holds upcoming events too.
    expect(longForm("did 19564 play at any event in romania") ?? "").not.toMatch(/events played/);
    expect(longForm("did 19564 play at any event in june 2026")).toBe("19564 events played in june 2026");
    // Every month form the fact reader reads (Greptile on #1084).
    expect(longForm("did 19564 play at any event in the month of june")).toBe("19564 events played in the month of june");
    expect(longForm("did 19564 play at any event in june last season")).toBe("19564 events played in june last season");
    expect((await stat("did the marvels play at any event in the month of january in 2025-26")).headline).toMatchObject({ value: "2 events" });
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
    expect((await searchAnswer("4215 league rank", { limit: 25 })).stat!.headline).toMatchObject({ value: "#2 of 4", label: "BCL league after NJ Bergen League Meet 3" });
    // An old event's match left unplayed is never "next"; a rookie's posted schedule is, with no season played.
    expect((await searchAnswer("4215 predicted score next match", { limit: 25 })).stat!.none).toContain("no upcoming match");
    expect((await searchAnswer("31000 predicted score next match", { limit: 25 })).stat!.headline).toMatchObject({ value: "Q3", label: expect.stringContaining("Future Qualifier") });
    // "Predicted matches" (failed-search #1147) is the same question.
    expect((await searchAnswer("31000 predicted matches", { limit: 25 })).stat).toMatchObject({ intent: "next-match", headline: { value: "Q3" } });
    expect((await searchAnswer("4215 predicted matches", { limit: 25 })).stat!.none).toContain("no upcoming match");
    expect((await searchAnswer("31000 match predictions", { limit: 25 })).stat).toMatchObject({ intent: "next-match", headline: { value: "Q3" } });
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
