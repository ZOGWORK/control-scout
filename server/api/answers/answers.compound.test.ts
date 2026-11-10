// The complex-queries file's compound and multi-filter questions (2026-11-04) on a small fixture: each is read clause
// by clause (subject teams, filters, outputs), every filter read is applied, and the numbers are the stored ones.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
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
    expect(readCompound("team from Oradell with opr over 100")).toMatchObject({ kind: "list", city: "oradell", thresholds: [{ stat: "opr", op: "gt", value: 100 }] });
    expect(readCompound("4215 match where they lost by less than 10 points")).toMatchObject({ kind: "margin", core: "4215", result: "L", margin: { op: "lt", value: 10 } });
    expect(readCompound("4215 awards and record in 2025-26 combined")).toMatchObject({ kind: "combined", core: "4215", parts: ["awards", "record"], when: { season: 2025 } });
    expect(readCompound("4215 partners at NJ championship who had opr over 80")).toMatchObject({ kind: "side-threshold", side: "partners", at: "nj championship", threshold: { op: "gt", value: 80 } });
    expect(readCompound("did 4215 ever beat a team ranked top 10 worldwide")).toMatchObject({ kind: "beat-top", n: 10, by: "rating", when: { ever: true } });
    expect(readCompound("4215's best event by rank and worst event by opr in same season")).toMatchObject({ kind: "event-picks", picks: [{ pick: "best", by: "rank" }, { pick: "worst", by: "opr" }] });
    expect(readCompound("team in NJ that went to worlds in 2025 and their opr")).toMatchObject({ kind: "list", region: { state: "NJ" }, worlds: true, season: 2024, outputs: ["opr"] });
    // "How many" before the teams asks for the same list, which leads with its count (failed-search #1062).
    for (const q of ["how many NJ team went to worlds in 2025", "how many team in NJ went to worlds in 2025"]) expect(readCompound(q), q).toMatchObject({ kind: "list", region: { state: "NJ" }, worlds: true, season: 2024 });
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
  it("10: the same asked by the verb (launch audit A4): who partnered, teamed up with, played against", async () => {
    for (const q of ["who partnered 4215 at NJ championship with opr over 80", "who teamed up with 4215 at nj championship with an opr above 80", "which teams partnered with 4215 at NJ championship that had opr over 80"]) {
      const a = await ask(q);
      expect([a.stat?.intent, a.stat?.headline?.value], q).toEqual(["partners-opr-threshold", "1 of 2"]);
    }
    for (const q of ["who played with 4215 at NJ championship with opr over 80", "who played alongside 4215 at NJ championship with opr over 80"]) expect((await ask(q)).stat?.intent, q).toBe("partners-opr-threshold");
    for (const q of ["who played against 4215 at NJ championship with opr over 80", "who faced 4215 at NJ championship with opr over 80", "who played 4215 at NJ championship with opr over 80"]) expect((await ask(q)).stat?.intent, q).toBe("opponents-opr-threshold");
  });
  it("10: the championship takes in the finals, a division named doesn't; a match off the field meets no one", async () => {
    // A finals match with 1111 (OPR 130) and a division match 4215 sat out with 23268 (OPR 157.9).
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'USNJCMP', 'qual', 0, 900, 'F1', NULL, 1, 150, 150, 100, 100, 't'), (?, 'USNJCMPP', 'qual', 0, 901, 'Q901', NULL, 1, 150, 150, 100, 100, 't')", [S, S]);
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'USNJCMP', 'qual', 0, 900, 4215, 'red', 1), (?, 'USNJCMP', 'qual', 0, 900, 1111, 'red', 1), (?, 'USNJCMP', 'qual', 0, 900, 7776, 'blue', 1), (?, 'USNJCMPP', 'qual', 0, 901, 4215, 'red', 0), (?, 'USNJCMPP', 'qual', 0, 901, 23268, 'red', 1), (?, 'USNJCMPP', 'qual', 0, 901, 7776, 'blue', 1)", [S, S, S, S, S, S]);
    await run("INSERT OR IGNORE INTO event_teams (season, code, team) VALUES (?, 'USNJCMP', 4215)", [S]);
    clearAllCaches();
    try {
      const all = await ask("4215 partners at NJ championship who had opr over 80");
      // 207, 6980 and 1111 (in the finals, no OPR row there); never 23268, met only in a match 4215 sat out.
      expect(all.stat?.headline).toMatchObject({ value: "1 of 3" });
      expect(cells(all, /^Partners with OPR there over 80/).map((r: any) => r.team)).not.toContain("23268 Ultraviolet");
      const div = await ask("4215 partners at New Jersey Championship - Parkway Division who had opr over 80");
      expect(div.stat?.headline).toMatchObject({ value: "1 of 2" });
    } finally {
      await run("DELETE FROM match_teams WHERE season = ? AND number IN (900, 901)", [S]);
      await run("DELETE FROM matches WHERE season = ? AND number IN (900, 901)", [S]);
      await run("DELETE FROM event_teams WHERE season = ? AND code = 'USNJCMP'", [S]);
      clearAllCaches();
    }
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
    expect(a.stat?.headline).toMatchObject({ value: expect.stringMatching(/^4215 leads 84 – /), label: expect.stringMatching(/^\+\d+$/) });
    expect(a.stat?.blocks.find((b) => b.kind === "compare")).toMatchObject({ rows: [{ label: "Reliability", max: 100, best: 0 }, {}, {}, {}, {}] });
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

// Failed searches #868 #892 #1032 #1062, in their own words: a list counted, in one season or two side by side.
describe("how many teams a list holds", () => {
  it("reads a count, and a count in two years", () => {
    expect(readCompound("how many NJ teams went to worlds in 2024")).toMatchObject({ kind: "list", region: { state: "NJ" }, worlds: true, season: 2023 });
    const pair = readCompound("how many NJ teams went to worlds in 2024, versus 2025");
    expect(pair).toMatchObject({ kind: "list-pair", lists: [{ region: { state: "NJ" }, worlds: true, season: 2023 }, { region: { state: "NJ" }, worlds: true, season: 2024 }] });
    // The same season twice, or a year that names no list, is no pair.
    expect(readCompound("how many NJ teams went to worlds in 2024 versus 2024")).toBeNull();
    expect(readCompound("how many teams in 2024 versus 2025")).toBeNull();
  });
  it("counts each season's list, side by side", async () => {
    const a = await ask(`how many NJ teams went to worlds in ${S}, versus ${S + 1}`);
    expect(a.stat).toMatchObject({ intent: "filtered-list-pair", title: `How many teams in New Jersey: Worlds ${S} (${S - 1}–${String(S).slice(2)}) against Worlds ${S + 1} (${S}–${String(S + 1).slice(2)})`,
      headline: { value: "4 vs 4", sub: "The same number both seasons" } });
    const k = a.stat!.blocks[0] as any;
    expect(k.items.map((i: any) => i.value)).toEqual(["4 teams", "4 teams"]);
    // Each season's own list under it.
    expect(a.stat!.blocks.filter((b) => b.kind === "leaderboard").map((b: any) => b.rows.map((r: any) => r.team.label.split(" ")[0]))).toEqual([["23268", "7149", "207", "6980"], ["23268", "7149", "4215", "33950"]]);
    const one = await ask(`how many NJ teams went to worlds in ${S + 1}`);
    expect(one.stat?.headline?.value).toBe("4 teams");
    // Greptile on #1094: a "top N" said with a count counts every team; a stat asked beside the list stays, each season's.
    expect(readCompound("how many top 2 NJ teams went to worlds in 2024 versus 2025")).toMatchObject({ kind: "list-pair", lists: [{ n: null }, { n: null }] });
    const top = await ask(`how many top 2 NJ teams went to worlds in ${S} versus ${S + 1}`);
    expect(top.stat?.headline?.value).toBe("4 vs 4");
    const rel = await ask(`how many NJ teams and their reliability went to worlds in ${S} versus ${S + 1}`);
    expect(rel.stat!.blocks.map((b: any) => b.title).filter((t: string) => /Reliability/.test(t))).toEqual([expect.stringMatching(new RegExp(`^Worlds ${S + 1} \\(`))]);
    // Greptile on #1094: a list of teams that missed Worlds names each championship beside its count, not one on a chip.
    const miss = await ask(`how many nj teams did not make worlds in ${S} versus ${S + 1}`);
    expect(miss.stat?.intent).toBe("filtered-list-pair");
    expect(miss.stat!.scope.filter((c) => /Worlds/.test(c))).toEqual(["Didn't go to Worlds"]);
    expect((miss.stat!.blocks[0] as any).items.map((i: any) => i.label)).toEqual([`Worlds ${S} (${S - 1}–${String(S).slice(2)})`, `Worlds ${S + 1} (${S}–${String(S + 1).slice(2)})`]);
  });
  it("a town's pair is previewed as the town's, in the search box", async () => {
    const a = await searchAnswer(`how many teams from Oradell with opr over 100 in ${S} versus ${S + 1}`, { limit: 8 });
    expect(a.pages[0]?.title).toMatch(/^How many: Teams from Oradell /);
  });
});

// Failed search #974, in its own words and the other way round: the best teams at one event, Worlds or a state's
// championship, by each team's OPR there.
describe("the best teams at an event", () => {
  const rows = (a: Awaited<ReturnType<typeof ask>>) => (a.stat?.blocks.find((b) => b.kind === "leaderboard") as any)?.rows.map((r: any) => [r.team.label.split(" ")[0], r.display]) ?? [];
  it("ranks an event's teams (its divisions' too) by their OPR there", async () => {
    for (const q of ["new jersey championship best teams", "top teams at the new jersey championship"]) {
      const a = await ask(q);
      expect(a.stat, q).toMatchObject({ intent: "event-best", title: `Best teams at New Jersey Championship by OPR there · ${S}–${String(S + 1).slice(2)}` });
      // The page's heading is the card's title less its season, so the page says it once.
      expect(a.understood?.label, q).toBe("Best teams at New Jersey Championship by OPR there");
      // 207, 4215 and 6980 have an OPR in its Parkway division; the rest played there with none, so aren't ranked.
      expect(rows(a), q).toEqual([["207", "114.0"], ["4215", "101.0"], ["6980", "46.0"]]);
      // Records there by the official rule: every match played at the event.
      const recs = (a.stat?.blocks.find((b) => b.kind === "leaderboard") as any).rows.map((r: any) => r.record);
      expect(recs, q).toEqual(["2-0-0", "1-1-0", "0-2-0"]);
    }
  });
  it("ranks one division named alone, linked to it", async () => {
    // The fixture's Worlds has a division only: its board is that division's, never its parent's.
    const a = await ask("top teams at the edison division");
    expect(a.stat?.title).toMatch(/^Best teams at .*Edison.* by OPR there/);
    expect(rows(a)).toEqual([["4215", "60.0"]]);
    const more = (a.stat?.blocks.find((b) => b.kind === "leaderboard") as any).more;
    expect(more.href).toContain("FTCCMP1EDIS");
  });
  it("leaves the lowest first, undefeated teams and OPR said not to go by to search", async () => {
    for (const q of ["lowest opr teams at the new jersey championship", "undefeated teams at the new jersey championship", "best teams at the new jersey championship not by opr"]) {
      expect((await ask(q)).stat?.intent, q).not.toBe("event-best");
    }
  });
  it("lists an event's rookie teams, those in their first season (failed-search #995)", async () => {
    await run("UPDATE teams SET rookie_year = ? WHERE number = 6980", [S]);
    await run("UPDATE teams SET rookie_year = 2010 WHERE number IN (207, 4215)");
    try {
      for (const q of ["rookie teams at the new jersey championship", "top rookie teams at nj states", "first year teams at the new jersey championship"]) {
        const a = await ask(q);
        expect(a.stat?.title, q).toMatch(/^Rookie teams at New Jersey Championship by OPR there/);
        expect(rows(a), q).toEqual([["6980", "46.0"]]);
      }
      // Rookies anywhere but an event aren't this board, never a board with the word dropped.
      expect((await ask("top rookie teams by auto opr in texas")).stat?.intent).not.toBe("top-teams");
    } finally {
      await run("UPDATE teams SET rookie_year = NULL WHERE number IN (207, 4215, 6980)");
    }
  });
  it("reads Worlds and a state's championship as their events", async () => {
    expect(rows(await ask(`best teams at worlds ${S + 1}`))).toEqual([["4215", "60.0"]]);
    expect((await ask("best teams at nj states")).stat?.title).toMatch(/^Best teams at New Jersey Championship by OPR there/);
  });
  it("reads a state with a championship word as its championship, and the ones worth watching as the best", async () => {
    // Teams to scout are the ones worth watching, and an aside saying "the good ones" again is read past (#900, #921).
    for (const q of ["teams worth watching at the nj championship", "which teams should we watch at new jersey champs", "who should we watch at the new jersey championship", "who to watch at nj states",
      "what team should i watch at nj champs, like actually good ones", "whats a good team to scout for alliance selection at nj championship", "which teams should i scout at nj states"]) {
      expect((await ask(q)).stat?.title, q).toMatch(/^Best teams at New Jersey Championship by OPR there/);
    }
  });
  it("lists only the teams from a place said with Worlds", async () => {
    await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'FTCCMP1EDIS', 1111)", [S]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'FTCCMP1EDIS', 1111, 300, 2)", [S]);
    try {
      expect(rows(await ask(`best teams at worlds ${S + 1}`))).toEqual([["1111", "300.0"], ["4215", "60.0"]]);
      const nj = await ask(`new jersey teams at worlds ${S + 1}`);
      expect(nj.stat?.title).toMatch(/^New Jersey teams at Worlds \d+ by OPR there/);
      expect(nj.understood?.label).toBe(nj.stat?.title.replace(/ · [^·]+$/, ""));
      expect(rows(nj)).toEqual([["4215", "60.0"]]);
      expect(rows(await ask(`texas teams at worlds ${S + 1}`))).toEqual([["1111", "300.0"]]);
      // Played: a place whose teams have no OPR there is ranked by the event's own numbers, so none is ranked.
      await run("DELETE FROM team_event_stats WHERE code = 'FTCCMP1EDIS' AND team = 1111");
      const tx = await ask(`texas teams at worlds ${S + 1}`);
      expect(tx.stat?.title).toMatch(/^Texas teams at Worlds \d+ by OPR there/);
      expect(rows(tx)).toEqual([]);
    } finally {
      await run("DELETE FROM team_event_stats WHERE code = 'FTCCMP1EDIS' AND team = 1111"); await run("DELETE FROM event_teams WHERE code = 'FTCCMP1EDIS' AND team = 1111");
    }
  });
});

// Failed searches (#745 #747 #748 #767 #858 #866 #885 #927 #933 #1033), in their own words: a list's filters said any
// way, each applied.
describe("a team list's filters, however they're said", () => {
  const rows = (a: Awaited<ReturnType<typeof ask>>) => (a.stat?.blocks.find((b) => b.kind === "leaderboard") as any)?.rows.map((r: any) => r.team.label) ?? [];
  it("reads a threshold with no 'with', a bare number as at least it, and several at once", () => {
    expect(readCompound("Oradell teams, OPR over 100")).toMatchObject({ kind: "list", city: "oradell", thresholds: [{ stat: "opr", op: "gt", value: 100 }] });
    for (const q of ["Houston teams, OPR 90", "Houston teams, OPR 90+"]) expect(readCompound(q), q).toMatchObject({ kind: "list", city: "houston", thresholds: [{ stat: "opr", op: "ge", value: 90 }] });
    // "Or above" after the number, the number said before the stat or after it (failed-search #1198).
    for (const q of ["teams with 44 or above opr", "teams with opr 44 or above", "Houston teams with 90 or more opr"]) {
      expect(readCompound(q)?.kind, q).toBe("list");
      expect((readCompound(q) as { thresholds: unknown[] }).thresholds, q).toEqual([{ stat: "opr", op: "ge", value: /90/.test(q) ? 90 : 44 }]);
    }
    // A year after a stat is still the season's words, never a floor.
    expect(readCompound("Houston teams by opr 2025")).toBeNull();
    expect(readCompound("teams in Romania with at least 30 matches and a win rate over 70 percent")).toMatchObject({ kind: "list", country: { code: "RO" }, city: null,
      thresholds: [{ stat: "win-rate", op: "gt", value: 70 }, { stat: "matches", op: "ge", value: 30 }] });
    expect(readCompound("leaderboard for teams that played at least 20 matches, by win rate, worldwide")).toMatchObject({ kind: "list", stat: "win-rate", region: null, country: null, city: null,
      thresholds: [{ stat: "matches", op: "ge", value: 20 }] });
    expect(readCompound("a leaderboard for teams that played at least 20 matches, by win rate, worldwide")).toMatchObject({ kind: "list", stat: "win-rate", city: null, thresholds: [{ stat: "matches", op: "ge", value: 20 }] });
    // Greptile on #1075: a list still shows what's asked beside it, wherever the threshold is said, and a year after a
    // stat is the season.
    expect(readCompound("teams from Oradell and their rating with opr over 100")).toMatchObject({ kind: "list", city: "oradell", outputs: ["rating"], thresholds: [{ stat: "opr", op: "gt", value: 100 }] });
    expect(readCompound("teams from Oradell with opr over 100 by opr 2025")).toMatchObject({ kind: "list", city: "oradell", stat: "opr", season: 2025, thresholds: [{ stat: "opr", op: "gt", value: 100 }] });
    // A year is never a threshold, nor a count with no comparison or verb.
    expect(readCompound("top 10 teams by opr 2025")).toBeNull();
    expect(readCompound("10 teams in nj")).toBeNull();
    // Rookies alone stay the rookie leaderboard's.
    expect(readCompound("Best rookie team in New Jersey")).toBeNull();
  });
  it("reads Worlds gone to or not, rookies and an award named before the teams", () => {
    expect(readCompound("teams with OPR over 120 who did NOT make worlds")).toMatchObject({ kind: "list", worlds: false, noWorlds: true, thresholds: [{ stat: "opr", op: "gt", value: 120 }] });
    expect(readCompound("which NJ teams made worlds in 2025-26, list them all")).toMatchObject({ kind: "list", region: { state: "NJ" }, worlds: true, season: 2025, thresholds: [] });
    expect(readCompound("show me a team that started as a rookie this year and already made worlds")).toMatchObject({ kind: "list", rookie: true, worlds: true, region: null, city: null });
    expect(readCompound("Top 3 Texas Inspire teams")).toMatchObject({ kind: "list", n: 3, region: { state: "TX" }, award: { type: "Inspire" } });
  });
  it("answers each filter, applied", async () => {
    expect(rows(await ask("Oradell teams, OPR over 100"))).toEqual(["207 Critical Mass", "4215 Hypnotic Robotics"]);
    // 23268 has the highest OPR but went to Worlds.
    const nw = await ask("teams with OPR over 120 who did NOT make worlds");
    expect(rows(nw)).toEqual(["1111 Lone Star"]);
    expect(nw.stat?.scope).toEqual(expect.arrayContaining([`Didn't go to Worlds (FIRST Championship ${S + 1})`, "OPR over 120"]));
    expect(rows(await ask(`which NJ teams made worlds in ${S}-${String(S + 1).slice(2)}, list them all`))).toEqual(["23268 Ultraviolet", "7149 ENFORCERS", "4215 Hypnotic Robotics", "33950 First Street Kids"]);
    const two = await ask("teams in New Jersey with at least 7 matches and a win rate over 50 percent");
    expect(new Set(rows(two))).toEqual(new Set(["4215 Hypnotic Robotics", "7149 ENFORCERS", "23268 Ultraviolet"]));
    expect(two.stat?.title).toBe(`Teams in New Jersey with win rate over 50% and at least 7 matches played, by win rate · ${S}–${String(S + 1).slice(2)}`);
    expect(rows(await ask("Top 3 Texas Inspire teams"))).toEqual(["1111 Lone Star"]);
  });
  it("lists rookies only", async () => {
    await run("UPDATE teams SET rookie_year = ? WHERE number = 33950", [S]);
    try {
      const a = await ask("show me a team that started as a rookie this year and already made worlds");
      expect(rows(a)).toEqual(["33950 First Street Kids"]);
      expect(a.stat?.headline?.value).toBe("1 rookie team");
    } finally { await run("UPDATE teams SET rookie_year = NULL WHERE number = 33950"); clearAllCaches(); }
  });
});
