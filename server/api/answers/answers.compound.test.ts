// The complex-queries file's compound and multi-filter questions (2026-11-04) on a small fixture: each is read clause
// by clause (subject teams, filters, outputs), every filter read is applied, and the numbers are the stored ones.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { searchAnswer } from "../searchAnswer";
import { namedTeam } from "../searchCompare";
import { readCompound } from "./compound";
import { refreshSearchSeason, resetSearchSeason } from "./season";

// The latest completed season: the fixture's Worlds below has finished.
const S = CURRENT_SEASON - 1;
const ask = (q: string) => searchAnswer(q, { limit: 40, full: true });
const cells = (a: Awaited<ReturnType<typeof ask>>, title: RegExp) => (a.stat?.blocks.find((b) => b.kind === "table" && title.test(b.title)) as any)?.rows.map((r: any) => r.cells) ?? [];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string, string][] = [[4215, "Hypnotic Robotics", "Oradell", "NJ"], [6980, "Bad Wolf", "Oradell", "NJ"], [207, "Critical Mass", "Oradell", "NJ"], [33950, "First Street Kids", "Ridgewood", "NJ"],
    [23268, "Ultraviolet", "Hackettstown", "NJ"], [7149, "ENFORCERS", "Egg Harbor Township", "NJ"], [1111, "Lone Star", "Austin", "TX"], [7776, "The Loose Screws", "Austin", "TX"]];
  for (const [n, name, city, state] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, 'USA')", [n, name, city, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?), (?, ?)", [S, n, S - 1, n]);
  }
  const ev = (season: number, code: string, name: string, type: string, start: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, division_code, source) VALUES (?, ?, ?, ?, 'Hillsborough', 'NJ', 'USA', ?, ?, ?, 't')", [season, code, name, type, start, start, division]);
  await ev(S, "USNJM1", "Northern League Meet 1", "LeagueMeet", `${S}-11-01`);
  await ev(S, "USNJQ1", "New Jersey Qualifier", "Qualifier", `${S + 1}-01-10`);
  await ev(S, "USNJCMP", "New Jersey Championship", "Championship", `${S + 1}-03-15`);
  await ev(S, "USNJCMPP", "New Jersey Championship - Parkway Division", "Championship", `${S + 1}-03-15`, "USNJCMP");
  await ev(S, "FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "FIRSTChampionship", `${S + 1}-04-16`, "FTCCMP1");
  await ev(S - 1, "USNJQ0", "New Jersey Kickoff Qualifier", "Qualifier", `${S}-01-12`);
  await ev(S - 1, "FTCCMP1FRAN", "FIRST Championship - FIRST Tech Challenge - Franklin Division", "FIRSTChampionship", `${S}-04-17`, "FTCCMP1");
  let n = 0;
  const match = async (season: number, code: string, red: [number, number], blue: [number, number], rs: number, bs: number) => {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, NULL, 1, ?, ?, ?, ?, 't')", [season, code, n, `Q${n}`, rs, rs, bs, bs]);
    for (const [t, a] of [...red.map((t) => [t, "red"] as const), ...blue.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [season, code, n, t, a]);
      await run("INSERT OR IGNORE INTO event_teams (season, code, team) VALUES (?, ?, ?)", [season, code, t]);
    }
  };
  // 4215 in season S: 4-3-0, losses by 5, 30 and 8.
  await match(S, "USNJM1", [4215, 207], [6980, 33950], 120, 60);
  await match(S, "USNJM1", [4215, 6980], [207, 33950], 100, 105);
  await match(S, "USNJQ1", [4215, 33950], [6980, 7149], 130, 70);
  await match(S, "USNJQ1", [4215, 7149], [207, 23268], 90, 120);
  await match(S, "USNJCMPP", [4215, 207], [6980, 33950], 150, 100);
  await match(S, "USNJCMPP", [4215, 6980], [207, 7149], 110, 118);
  // Worlds: 4215 beats 23268, ranked #5 in the world by rating.
  await match(S, "FTCCMP1EDIS", [4215, 7149], [23268, 33950], 200, 190);
  await match(S - 1, "USNJQ0", [4215, 207], [6980, 33950], 80, 40);
  await match(S - 1, "FTCCMP1FRAN", [23268, 7149], [207, 6980], 300, 200);
  await run("UPDATE event_teams SET rank = 1 WHERE season = ? AND code = 'USNJQ1' AND team = 4215", [S]);
  await run("UPDATE event_teams SET rank = 6 WHERE season = ? AND code = 'USNJCMPP' AND team = 4215", [S]);
  const evStat = (season: number, code: string, team: number, opr: number) => run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (?, ?, ?, ?, ?, ?, ?, 2)", [season, code, team, opr, opr * 0.3, opr * 0.6, opr * 0.1]);
  await evStat(S, "USNJM1", 4215, 50); await evStat(S, "USNJQ1", 4215, 90); await evStat(S, "USNJCMPP", 4215, 101); await evStat(S, "FTCCMP1EDIS", 4215, 60);
  await evStat(S, "USNJCMPP", 207, 114); await evStat(S, "USNJCMPP", 6980, 46);
  await evStat(S - 1, "USNJQ0", 4215, 30);
  // Season numbers: [team, season, opr, auto, rating rank, wins, losses].
  const ss: [number, number, number, number, number, number, number][] = [[4215, S, 101.6, 28.3, 525, 4, 3], [6980, S, 46.9, 13.2, 2041, 2, 5], [207, S, 114.3, 30, 300, 3, 4], [33950, S, 42.2, 16.2, 2900, 1, 6],
    [23268, S, 157.9, 40, 5, 4, 3], [7149, S, 115.3, 33, 200, 4, 3], [1111, S, 130, 45, 50, 5, 1], [7776, S, 20, 5, 4000, 1, 4],
    [4215, S - 1, 80, 20, 700, 1, 0], [23268, S - 1, 237.4, 56.8, 3, 1, 0], [7149, S - 1, 175.3, 45.6, 9, 1, 0], [207, S - 1, 90, 25, 400, 1, 1], [6980, S - 1, 40, 10, 2500, 0, 2]];
  for (const [t, season, opr, au, rr, w, l] of ss) {
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, rating_sd, rating_rank, matches, rating_matches, wins, losses, ties) VALUES (?, ?, ?, ?, ?, ?, ?, 8308, ?, 3.2, ?, ?, ?, ?, ?, 0)",
      [season, t, opr, au, opr - au - 5, 5, rr, opr, rr, Math.max(3, w + l), Math.max(3, w + l), w, l]);
  }
  for (const [season, code, type, placement, team] of [[S, "USNJQ1", "Inspire", 1, 4215], [S, "USNJM1", "Inspire", 1, 207], [S, "USNJQ1", "Inspire", 2, 6980], [S, "USNJQ1", "Winner", 1, 4215]] as const) {
    await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, ?, ?, ?, ?)", [season, code, type, placement, team]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USTXQ1', 'Texas Qualifier', 'Qualifier', 'Austin', 'TX', 'USA', ?, ?, 't')", [S, `${S + 1}-01-10`, `${S + 1}-01-10`]);
  await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, 'USTXQ1', 'Inspire', 1, 1111)", [S]);
  const rel = (team: number, idx: number) => run("INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows, recent_near_zero, no_show_rate, dq_rate, near_zero_rate, swing, penalty_ratio, predictability_ratio, idx, computed_at) VALUES (?, '', ?, 6, 0, 0, 0, 6, 6, 0, 0, 0, 0, 0, 0.3, 1, 1, ?, 'now')", [S, team, idx]);
  await rel(0, 60); await rel(4215, 84); await rel(6980, 71); await rel(33950, 79);
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
});

describe("reading compound questions", () => {
  it("reads each of the file's wordings into its clauses", () => {
    expect(readCompound("top 5 NJ team by auto opr who also won inspire")).toMatchObject({ kind: "list", n: 5, stat: "auto", region: { state: "NJ" }, award: { type: "Inspire" } });
    expect(readCompound("what was 4215's opr at their first event this season compared to last season")).toMatchObject({ kind: "event-pair", core: "4215", which: "first", seasons: [S, S - 1] });
    expect(readCompound("team from Oradell with opr over 100")).toMatchObject({ kind: "list", city: "oradell", threshold: { stat: "opr", op: "gt", value: 100 } });
    expect(readCompound("4215 match where they lost by less than 10 points")).toMatchObject({ kind: "margin", core: "4215", result: "L", margin: { op: "lt", value: 10 } });
    expect(readCompound("4215 awards and record in 2025-26 combined")).toMatchObject({ kind: "combined", core: "4215", parts: ["awards", "record"], when: { season: 2025 } });
    expect(readCompound("4215 partners at NJ championship who had opr over 80")).toMatchObject({ kind: "side-threshold", side: "partners", at: "nj championship", threshold: { op: "gt", value: 80 } });
    expect(readCompound("did 4215 ever beat a team ranked top 10 worldwide")).toMatchObject({ kind: "beat-top", n: 10, by: "rating", when: { ever: true } });
    expect(readCompound("4215's best event by rank and worst event by opr in same season")).toMatchObject({ kind: "event-picks", picks: [{ pick: "best", by: "rank" }, { pick: "worst", by: "opr" }] });
    expect(readCompound("team in NJ that went to worlds in 2025 and their opr")).toMatchObject({ kind: "list", region: { state: "NJ" }, worlds: true, season: 2024, outputs: ["opr"] });
    expect(readCompound("4215 vs 6980 vs 33950 which has highest reliability")).toMatchObject({ kind: "set-best", teams: [4215, 6980, 33950], stat: "reliability" });
    expect(readCompound("what is 4215's average score when they win versus when they lose")).toMatchObject({ kind: "win-loss-average", core: "4215" });
    expect(readCompound("4215 opr if you exclude their worst event")).toMatchObject({ kind: "opr-excluding", core: "4215", drop: "worst" });
  });
  it("leaves single questions to their own readers", () => {
    for (const q of ["4215 record", "4215 and 6980 opr", "top 10 team in nj", "team in oradell", "4215 vs 6980 vs 33950", "4215 match at nj championship", "4215 awards", "best team in new jersey by opr", "4215 average score"]) expect(readCompound(q), q).toBeNull();
  });
});

describe("compound answers", () => {
  it("3: a region, an award won and a phase OPR, top N (every filter applied)", async () => {
    const a = await ask("top 5 NJ teams by auto opr who also won inspire");
    const board = a.stat?.blocks.find((b) => b.kind === "leaderboard") as any;
    // 1111 won Inspire in Texas; 6980 was Inspire 2nd place: neither is listed.
    expect(board.rows.map((r: any) => r.team.label)).toEqual(["207 Critical Mass", "4215 Hypnotic Robotics"]);
    expect(board.rows.map((r: any) => r.display)).toEqual(["30.0", "28.3"]);
    expect(a.stat?.scope).toEqual(expect.arrayContaining(["New Jersey", "Won the Inspire Award", "Sorted by Auto OPR", "Top 5"]));
    expect(a.hits).toEqual([]);
  });
  it("6: a home city and an OPR threshold", async () => {
    const a = await ask("teams from Oradell with opr over 100");
    expect((a.stat?.blocks[0] as any).rows.map((r: any) => r.team.label)).toEqual(["207 Critical Mass", "4215 Hypnotic Robotics"]);
    const none = await ask("teams from Oradell with opr over 200");
    expect(none.stat?.none).toMatch(/No team from Oradell with OPR over 200.*highest OPR among them is 114\.3 \(207 Critical Mass\)/);
  });
  it("keeps a season said with the event, and never reads 'ever' as one season", () => {
    expect(readCompound("4215 partners at NJ championship in 2024-25 who had opr over 80")).toMatchObject({ at: "nj championship", when: { season: 2024 } });
    expect(readCompound("4215 vs 6980 vs 33950 which has highest reliability ever")).toBeNull();
    expect(readCompound("4215 partners who had opr over 80 ever")).toBeNull();
  });
  it("shows every stat asked beside a list", async () => {
    const a = await ask("teams from Oradell with opr over 100 and their rating");
    expect(cells(a, /^Prediction rating/).map((c: any) => c.team)).toEqual(["207 Critical Mass", "4215 Hypnotic Robotics"]);
  });
  it("a capitalised side of common words is no team either", async () => {
    expect(await namedTeam("When They Lose", new Set())).toBeNull();
  });
  it("a country is a place too, never a city", () => {
    expect(readCompound("team in romania that went to worlds in 2026 and their opr")).toMatchObject({ kind: "list", country: { code: "RO" }, city: null, season: 2025 });
  });
  it("10: an event the team never played is said so, with its own events", async () => {
    const a = await ask("1111 partners at NJ championship who had opr over 80");
    expect(a.intent?.kind).toBe("stat-compound-no-event");
    expect(a.stat?.none).toMatch(/no matches at an event matching "nj championship"/);
  });
  it("16: a region and a Worlds season, with OPR from that season", async () => {
    const a = await ask(`teams in NJ that went to worlds in ${S} and their opr`);
    expect((a.stat?.blocks[0] as any).rows.map((r: any) => [r.team.label, r.display])).toEqual([["23268 Ultraviolet", "237.4"], ["7149 ENFORCERS", "175.3"], ["207 Critical Mass", "90.0"], ["6980 Bad Wolf", "40.0"]]);
    expect(a.understood?.label).not.toMatch(/isn't part of this answer/);
  });
  it("5: OPR at the first event of two seasons", async () => {
    const a = await ask("what was 4215's opr at their first event this season compared to last season");
    expect(a.stat?.headline).toMatchObject({ value: "50.0 vs 30.0" });
    expect(cells(a, /^First events/).map((c: any) => c.event)).toEqual(["Northern League Meet 1", "New Jersey Kickoff Qualifier"]);
  });
  it("7: losses by a margin", async () => {
    const a = await ask("4215 matches where they lost by less than 10 points");
    const ms = a.stat?.blocks.find((b) => b.kind === "matches") as any;
    expect(ms.rows.map((r: any) => [r.own, r.opp])).toEqual([[110, 118], [100, 105]]);
    expect(a.stat?.headline).toMatchObject({ value: "2", sub: expect.stringMatching(/of 3 losses · record 4-3-0/) });
  });
  it("8: awards and record on one card", async () => {
    const a = await ask(`4215 awards and record in ${S}-${String(S + 1).slice(2)} combined`);
    expect(a.stat?.title).toMatch(/^Awards and record in /);
    const kpis = a.stat?.blocks[0] as any;
    expect(kpis.items.map((i: any) => [i.label, i.value])).toEqual([["Awards", "2 awards"], ["Record", "4-3-0"]]);
  });
  it("10: partners at an event, by their OPR there", async () => {
    const a = await ask("4215 partners at NJ championship who had opr over 80");
    expect(a.stat?.headline).toMatchObject({ value: "1 of 2" });
    expect(cells(a, /^Partners with OPR there over 80/)).toEqual([expect.objectContaining({ team: "207 Critical Mass", opr: "114.0" })]);
  });
  it("11: a win over a world top-10 team, with the match", async () => {
    const a = await ask("did 4215 ever beat a team ranked top 10 worldwide");
    expect(a.stat?.headline).toMatchObject({ value: "Yes" });
    expect((a.stat?.blocks.find((b) => b.kind === "matches") as any).rows).toHaveLength(1);
    const no = await ask("did 6980 ever beat a team ranked top 10 worldwide");
    expect(no.stat?.headline?.value).toBe("No");
  });
  it("12: best event by rank and worst event by OPR in one season", async () => {
    const a = await ask("4215's best event by rank and worst event by opr in same season");
    const k = (a.stat?.blocks[0] as any).items.map((i: any) => [i.label, i.value, i.sub.split(" · ")[0]]);
    expect(k).toEqual([["Best event by rank", "#1 of 1", "New Jersey Qualifier"], ["Worst event by OPR", "OPR 50.0", "Northern League Meet 1"]]);
  });
  it("14: a team by name, where it's from and its record", async () => {
    const a = await ask("where is bad wolf from and what is their record");
    expect(a.card?.team?.number).toBe(6980);
    expect(a.card?.facts?.map((f) => f.label)).toEqual(["Where they're from", `Record, ${S}–${String(S + 1).slice(2)}`]);
    expect(a.card?.support?.some((f) => /^Record/.test(f.label))).toBe(false);
  });
  it("17: three teams' reliability, the highest named", async () => {
    const a = await ask("4215 vs 6980 vs 33950 which has highest reliability");
    expect(a.stat?.headline).toMatchObject({ value: "Hypnotic Robotics (4215)", label: "Highest reliability: 84 out of 100" });
  });
  it("18: average score in wins against losses, never a team called 'Loose'", async () => {
    const a = await ask("what is 4215's average score when they win versus when they lose");
    expect(a.stat?.headline).toMatchObject({ value: "150.0 vs 100.0" });
    expect(a.hits.map((h) => h.ref)).toEqual(["4215"]);
    expect(await namedTeam("when they lose", new Set())).toBeNull();
    // A name typed is still read as one.
    expect(await namedTeam("bad wolf", new Set())).toMatchObject({ team: 6980 });
  });
  it("21: the stored event OPRs averaged without the worst event, both values stated", async () => {
    const a = await ask("4215 opr if you exclude their worst event");
    expect(a.stat?.headline).toMatchObject({ value: "83.7", sub: expect.stringMatching(/^75\.3 with all 4 events · worst event Northern League Meet 1 \(50\.0\)/) });
    expect((a.stat?.blocks[0] as any).items.find((i: any) => /Season OPR/.test(i.label))?.value).toBe("101.6");
  });
});
