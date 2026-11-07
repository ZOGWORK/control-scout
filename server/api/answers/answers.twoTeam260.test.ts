// The 260-query completion list's two-team, partner and prediction queries (2026-11-04) on a small fixture: each reads
// as its own question and answers from the stored rows (season numbers, matches, awards, reliability, the stored event
// projection), with both teams named as data (stat.teams) so no TEAMS card repeats them.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { setFlag } from "../../flags";
import { searchAnswer } from "../searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "./season";
import { readStatQuestion, readTeamSet, readTwoTeam } from "./read";
import { compareAnswer, partnerListAnswer } from "./families/twoTeam";
import { teamMatches } from "./matchSet";

// The latest completed season: the fixture's Championship below has finished.
const S = CURRENT_SEASON - 1;
const ask = (q: string) => searchAnswer(q, { limit: 40 });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [33950, "First Street Kids"], [207, "Critical Mass"], [23268, "Ultraviolet"], [7149, "ENFORCERS"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  const ev = (season: number, code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Hillsborough', 'NJ', 'USA', ?, ?, 't')", [season, code, name, type, start, start]);
  await ev(S, "USNJQ1", "New Jersey Qualifier", "Qualifier", `${S + 1}-01-10`);
  await ev(S, "FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "FIRSTChampionship", `${S + 1}-04-16`);
  let n = 0;
  const match = (code: string, red: [number, number], blue: [number, number], rs: number, bs: number) => {
    n++;
    return Promise.all([
      run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [S, code, n, `Q${n}`, `${S + 1}-01-10T${String(8 + n).padStart(2, "0")}:00:00Z`, rs, rs, bs, bs]),
      ...[...red.map((t) => [t, "red"] as const), ...blue.map((t) => [t, "blue"] as const)].map(([t, a]) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [S, code, n, t, a])),
    ]);
  };
  // 4215 beats 6980 three times and loses to it once; 207 and 23268 are each its partner three times (2-1).
  await match("USNJQ1", [4215, 207], [6980, 23268], 120, 60);
  await match("USNJQ1", [4215, 207], [6980, 7149], 130, 70);
  await match("USNJQ1", [4215, 207], [6980, 23268], 80, 150);
  await match("USNJQ1", [4215, 23268], [6980, 7149], 100, 90);
  await match("USNJQ1", [207, 7149], [4215, 23268], 140, 60);
  await match("USNJQ1", [4215, 23268], [207, 33950], 110, 50);
  // Worlds: one match, 6980 not in it.
  await match("FTCCMP1EDIS", [4215, 7149], [207, 33950], 200, 100);
  const stats = [[4215, 101.6, 28.3, 73.4, 6.7, 600, 98, 525, 6, 2], [6980, 46.9, 13.2, 40.9, 5.6, 2600, 50.3, 2041, 1, 4], [33950, 42.2, 16.2, 29.5, 6.5, 3100, 39.8, 2900, 0, 2], [207, 114.3, 30, 80, 4.3, 400, 110, 300, 3, 3], [23268, 157.9, 40, 110, 7.9, 146, 150, 100, 2, 2], [7149, 115.3, 33, 77, 5.3, 446, 136.7, 200, 1, 2]] as const;
  for (const [t, opr, au, te, en, rank, rating, rrank, w, l] of stats) {
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, rank_auto, rank_teleop, rank_endgame, ranked_teams, rating_np, rating_sd, rating_rank, matches, wins, losses, ties) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 8308, ?, 3.2, ?, ?, ?, ?, 0)", [S, t, opr, au, te, en, rank, rank, rank, rank, rating, rrank, w + l, w, l]);
  }
  for (const [t, type, placement] of [[4215, "Inspire", 1], [4215, "Winner", 1], [4215, "Think", 2], [6980, "Connect", 1]] as const) {
    await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, 'USNJQ1', ?, ?, ?)", [S, type, placement, t]);
  }
  const rel = (team: number, idx: number) => run("INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows, recent_near_zero, no_show_rate, dq_rate, near_zero_rate, swing, penalty_ratio, predictability_ratio, idx, computed_at) VALUES (?, '', ?, 6, 0, 0, 0, 6, 6, 0, 0, 0, 0, 0, 0.3, 1, 1, ?, 'now')", [S, team, idx]);
  await rel(0, 60); await rel(4215, 84); await rel(6980, 71);
  // Next events: 4215's has a stored projection, 33950's doesn't; 6980 has none published.
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await ev(CURRENT_SEASON, "USNJNEM2", "Northeast League Meet", "LeagueMeet", soon);
  await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'USNJNEM2', 4215), (?, 'USNJNEM2', 33950)", [CURRENT_SEASON, CURRENT_SEASON]);
  const teams = JSON.stringify([{ team: 4215, rank: { p10: 1, p50: 3, p90: 7, mean: 3.4 }, pPlayoff: 0.71, pCaptain: 0.5, pPicked: 0.21, pAdvance: 0.33, advance: "odds", pWin: 0.22, pFinalist: 0.18 }]);
  await run("INSERT INTO event_projections (season, code, kind, state_key, seed, runs, target_runs, stage, played, scheduled, through, slots, slots_source, engine_version, ms, computed_at, teams) VALUES (?, 'USNJNEM2', 'current', 'k', 1, 2000, 2000, 'pre', 0, 30, NULL, 2, 'official', 't', 10, 'now', ?)", [CURRENT_SEASON, teams]);
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
});

describe("reading the 260 list's two-team questions", () => {
  it("reads each wording as its own question", () => {
    expect(readTwoTeam("4215 versus 6980 prediction")).toMatchObject({ id: "predict", a: "4215", b: "6980" });
    expect(readTwoTeam("6980 versus 4215 who wins")).toMatchObject({ id: "predict", a: "6980", b: "4215" });
    expect(readTwoTeam("4215 predicted score against 6980")).toMatchObject({ id: "predict" });
    expect(readTwoTeam("4215 expected margin against 6980")).toMatchObject({ id: "predict" });
    expect(readTwoTeam("4215 wins against 6980")).toMatchObject({ id: "h2h-wins" });
    expect(readTwoTeam("4215 versus 6980 matches together")).toMatchObject({ id: "shared-matches" });
    expect(readTwoTeam("4215 versus 6980 match together")).toMatchObject({ id: "shared-matches" });
    expect(readTwoTeam("4215 match against 6980 at worlds")).toMatchObject({ id: "head-to-head", scope: { championship: true } });
    expect(readTwoTeam("4215 versus 6980 compare")).toMatchObject({ id: "compare" });
    for (const [w, phase] of [["auto", "auto"], ["teleop", "teleop"], ["endgame", "endgame"]] as const) expect(readTwoTeam(`4215 versus 6980 who is better at ${w}`)).toMatchObject({ id: "phase-vs", a: "4215", b: "6980", phase });
    expect(readTwoTeam("4215 versus 6980 who has higher reliability")).toMatchObject({ id: "reliability-vs" });
    expect(readTwoTeam("4215 versus 6980 who has won more awards")).toMatchObject({ id: "awards-vs" });
    // "total awards" for two teams stays the boolean side-by-side's.
    expect(readTwoTeam("4215 vs 6980 total awards")).toBeNull();
    expect(readTeamSet("4215 6980 33950 compare")).toEqual({ teams: [4215, 6980, 33950], season: null });
    expect(readTeamSet("4215 6980 33950")).toBeNull();
  });
  it("reads the partner, opponent and next-event questions", () => {
    const id = (q: string) => readStatQuestion(q)?.id;
    expect(id("4215 worst alliance partner")).toBe("worst-partner");
    expect(id("4215 alliance partners at worlds")).toBe("partners");
    expect(id("4215 opponents this season")).toBe("opponents");
    expect(id("4215 teams they beat most often")).toBe("beat-most");
    expect(id("4215 teams they lost to most often")).toBe("lost-to-most");
    expect(id("4215 partner with the highest combined opr")).toBe("partner-top-opr");
    expect(id("4215 opponent with the highest opr they faced")).toBe("opponent-top-opr");
    expect(id("4215 alliance partner win rate")).toBe("partner-win-rate");
    expect(id("4215 opponent win rate against them")).toBe("opponent-win-rate");
    expect(readStatQuestion("who should 4215 pick as an alliance partner")).toMatchObject({ id: "pick-partner", core: "4215" });
    expect(id("4215 predicted wins at their next event")).toBe("next-event-wins");
    expect(id("4215 chance to win an event")).toBe("event-win-chance");
    // The next event's forecast, said as a noun: the stored projection, led by the chance to win it.
    for (const q of ["6980 next meet forecast", "23268 next competition projections", "7149 forecast for their next tournament"]) expect(id(q), q).toBe("event-win-chance");
    expect(id("4215 chance to advance to worlds")).toBe("advance-chance");
    expect(id("4215 advancement chances")).toBe("advance-chance");
    expect(id("4215 predicted to make playoffs at their next event")).toBe("playoff-chance");
    // The superlatives keep their own readings.
    expect(id("4215 best alliance partner")).toBe("best-partner");
    expect(id("4215 most frequent partners")).toBe("frequent-partner");
    expect(id("4215 win rate")).toBe("win-percent");
  });
});

describe("the answers", () => {
  it("predictions name both teams and state the ratings (no ratings built in a test: no made-up score)", async () => {
    for (const q of ["4215 versus 6980 prediction", "6980 versus 4215 who wins", "4215 predicted score against 6980", "4215 expected margin against 6980", "4215 win probability against 6980"]) {
      const a = await ask(q);
      expect(a.stat!.teams!.map((t) => t.number).sort(), q).toEqual([4215, 6980]);
      expect(a.stat!.headline, q).toMatchObject({ value: "4215 rated higher", label: "by 47.7 points per match" });
      expect(a.stat!.blocks[0], q).toMatchObject({ kind: "kpis", items: [{ value: expect.stringMatching(/^(98\.0|50\.3) ±3$/) }, { value: expect.stringMatching(/^(98\.0|50\.3) ±3$/) }] });
    }
  });
  it("a supposed meeting, now or on a day to come, is the same call on today's ratings, said so", async () => {
    for (const q of ["what if 6980 faced 4215", "suppose 4215 played 6980 next week", "imagine 6980 against 4215 tomorrow"]) {
      const a = await ask(q);
      expect(a.stat, q).toMatchObject({ intent: "predict", headline: { value: "4215 rated higher", label: "by 47.7 points per match" } });
      expect(a.understood!.label, q).not.toMatch(/isn't part of this answer/);
    }
    expect((await ask("imagine 6980 against 4215 tomorrow")).understood!.label).toContain("tomorrow: an upcoming match, called on today's ratings");
    // A day gone by isn't to come: never this call.
    expect((await ask("suppose 4215 played 6980 last week")).stat?.intent).not.toBe("predict");
  });
  it("81: wins in the meetings only", async () => {
    const a = await ask("4215 wins against 6980");
    expect(a.stat!.headline).toMatchObject({ value: "3 wins", label: "for 4215 in 4 meetings with 6980 (3-1-0)" });
    expect(a.stat!.teams!.map((t) => t.number)).toEqual([4215, 6980]);
  });
  it("187 and 198: one shared-match list", async () => {
    const x = await ask("4215 versus 6980 matches together"), y = await ask("4215 and 6980 shared matches");
    expect(x.stat!.intent).toBe("boolean-and");
    expect(x.stat!.headline).toEqual(y.stat!.headline);
    expect(x.stat!.teams!.map((t) => t.number)).toEqual([4215, 6980]);
  });
  it("243: no worlds meeting, said so", async () => {
    expect((await ask("4215 match against 6980 at worlds")).stat!.none).toMatch(/have never played each other at Worlds\. Bad Wolf \(6980\) has no matches at Worlds on record\.$/);
  });
  it("236 and 237: one card with OPR, rank, phases, rating and record, the season stated", async () => {
    const a = await ask("4215 versus 6980 compare");
    expect(a.stat!.title).toContain(`4215 vs 6980, ${S}–`);
    // One comparison, five rows at most: OPR and its phases, then the rating; the ranks and records in the context.
    expect(a.stat!.blocks.find((b) => b.kind === "bars")).toBeUndefined();
    expect(a.stat!.headline).toMatchObject({ value: "4215 leads 101.6 – 46.9", sub: expect.stringMatching(/^#600 of [\d,]+ \(6-2-0\) · .* \(1-4-0\)/) });
    const t = a.stat!.blocks.find((b) => b.kind === "compare");
    expect(t).toMatchObject({ teams: [{ label: "4215" }, { label: "6980" }] });
    const row = (l: string) => t && t.kind === "compare" ? t.rows.find((r) => r.label === l || r.label.startsWith(l)) : undefined;
    expect(row("OPR")).toMatchObject({ values: ["101.6", "46.9"], best: 0 });
    expect(row("Rank of")).toBeUndefined();
    expect(row("Rating")).toMatchObject({ values: ["98.0", expect.any(String)] });
    expect(t && t.kind === "compare" ? t.rows.length : 0).toBeLessThanOrEqual(5);
    const b = await ask("4215 6980 33950 compare");
    expect(b.stat!.teams!.map((x) => x.number)).toEqual([4215, 6980, 33950]);
    expect(b.hits[0]).toMatchObject({ kind: "compare", ref: "4215,6980,33950" });
  });
  it("256–260: phase, reliability and awards, the winner named", async () => {
    expect((await ask("4215 versus 6980 who is better at auto")).stat!.headline).toMatchObject({ value: "4215 leads 28.3 – 13.2", label: "+15.1" });
    const e = await ask("4215 versus 6980 who is better at endgame");
    expect(e.stat!.blocks[0]).toMatchObject({ kind: "compare", rows: [{ label: "Endgame", values: ["6.7", "5.6"] }] });
    expect((await ask("4215 versus 6980 who has higher reliability")).stat!.headline).toMatchObject({ value: "4215 leads 84 – 71", label: "+13" });
    expect((await ask("4215 versus 6980 who has won more awards")).stat!.headline).toMatchObject({ value: "4215 leads 3 – 1", label: "+2" });
  });
  it("partners and opponents, in the latest completed season unless Worlds or a season is named", async () => {
    // 207 and 23268 are both 2-1-0 in 3 matches: the tie goes to more matches, then the newer.
    expect((await ask("4215 worst alliance partner")).stat!.headline).toMatchObject({ value: expect.stringMatching(/^23268 /), label: "2-1-0 together in 3 matches" });
    expect((await ask("6980 worst alliance partner")).stat!.none).toMatch(/^No partner played with 3 or more times/);
    const w = await ask("4215 alliance partners at worlds");
    expect(w.stat!.headline).toMatchObject({ value: "1" });
    expect(w.stat!.blocks[0]).toMatchObject({ kind: "table", rows: [{ cells: { team: expect.stringMatching(/^7149/), events: expect.stringMatching(/Edison/) } }] });
    expect((await ask("4215 opponents this season")).stat!.title).toBe(`Opponents in ${S}–${String((S + 1) % 100).padStart(2, "0")}`);
    expect((await ask("4215 teams they beat most often")).stat!.headline).toMatchObject({ value: expect.stringMatching(/^6980 /), label: "beaten 3 times in 4 meetings" });
    expect((await ask("4215 teams they lost to most often")).stat!.headline!.label).toMatch(/^beat 4215 1 time in/);
    expect((await ask("4215 partner with the highest combined opr")).stat!.headline).toMatchObject({ value: expect.stringMatching(/^23268 /), label: expect.stringMatching(/^combined OPR 259\.5 \(101\.6 \+ 157\.9\)/) });
    expect((await ask("4215 opponent with the highest opr they faced")).stat!.headline).toMatchObject({ value: expect.stringMatching(/^23268 /) });
    expect((await ask("4215 alliance partner win rate")).stat!.headline).toMatchObject({ value: "71%", label: expect.stringMatching(/^4215 won 5 of 7 matches with a partner/) });
    expect((await ask("4215 opponent win rate against them")).stat!.headline).toMatchObject({ value: "29%", label: expect.stringMatching(/^opponents won 2 of 7 matches against 4215/) });
    // 23268 and 207 are both 2-1-0 together: the higher season OPR (157.9 against 114.3) goes first.
    const p = await ask("who should 4215 pick as an alliance partner");
    expect(p.stat!.headline).toMatchObject({ value: expect.stringMatching(/^23268 /), sub: expect.stringMatching(/^Why: the best record together.*; next 207 Critical Mass, 2-1-0$/) });
  });
  it("a combined OPR needs both OPRs: none counted as zero", async () => {
    await run("UPDATE team_season_stats SET opr_np = NULL WHERE season = ? AND team = 4215", [S]);
    const a = await ask("4215 partner with the highest combined opr");
    expect(a.stat!.headline!.label).toMatch(/^combined OPR – \(– \+ 157\.9\)/);
    expect((a.stat!.blocks[0] as { rows: { cells: Record<string, unknown> }[] }).rows[0].cells.sum).toBe("–");
    await run("UPDATE team_season_stats SET opr_np = 101.6 WHERE season = ? AND team = 4215", [S]);
  });
  it("next-event chances from the stored projection, or the event named and nothing guessed", async () => {
    const win = await ask("4215 chance to win an event");
    expect(win.stat!.headline).toMatchObject({ value: "22%", label: "to win Northeast League Meet" });
    // The next event is its own season: no default-season note or heading season from a past one.
    expect(win.understood!.label).toBe("Hypnotic Robotics (4215) · Chance to win their next event");
    expect(win.stat!.definition).not.toMatch(/The season is/);
    expect((await ask("4215 predicted to make playoffs at their next event")).stat!.headline).toMatchObject({ value: "71%" });
    expect((await ask("4215 advancement chances")).stat!.headline).toMatchObject({ value: "33%", label: "to advance from Northeast League Meet (2 slots)" });
    expect((await ask("4215 predicted wins at their next event")).stat!.headline).toMatchObject({ value: "#3" });
    const none = await ask("33950 chance to win an event");
    expect(none.stat!.headline).toMatchObject({ value: "Not published yet" });
    expect(none.stat!.none).toMatch(/hasn't published a projection for Northeast League Meet yet/);
    expect((await ask("6980 chance to advance to worlds")).stat!.none).toMatch(/^No upcoming event is published for Bad Wolf \(6980\)/);
    // The forecast said as a noun ("next meet forecast"): the same card, end to end, any team.
    const noun = await ask("4215 next meet forecast");
    expect(noun.stat).toMatchObject({ intent: "event-win-chance", team: { number: 4215 }, headline: { value: "22%", label: "to win Northeast League Meet" } });
    expect((await ask("33950 projection for their next competition")).stat!.headline).toMatchObject({ value: "Not published yet" });
    expect((await ask("6980 next tournament odds")).stat!.none).toMatch(/^No upcoming event is published for Bad Wolf \(6980\)/);
    // "Will <team> win <event>": the forecast at that event, before it starts (the stored chance) or after (before and after).
    const will = await ask("will hypnotic robotics win the northeast league meet");
    expect(will.stat).toMatchObject({ intent: "pipeline-team-predict-event", team: { number: 4215 }, headline: { value: "22%", label: "to win Northeast League Meet" } });
    const past = await ask("will 6980 win new jersey qualifier");
    expect(past.stat).toMatchObject({ intent: "pipeline-team-predict-event", team: { number: 6980 }, title: "Prediction vs result at New Jersey Qualifier" });
    // The forecast's switch off: the event page shows no odds, and nor does search.
    await setFlag("advancementOdds", false, "test");
    const off = await ask("4215 chance to win an event");
    expect(off.stat!.headline).toMatchObject({ value: "Switched off" });
    expect(JSON.stringify(off.stat)).not.toContain("22%");
    await setFlag("advancementOdds", true, "test");
  });
  it("review fixes: a forecast for the event named, Compare opening on the card's season", async () => {
    // The event asked about, not the team's next one.
    const at = await ask("4215 advancement chances at Northeast League Meet");
    expect(at.stat!.headline).toMatchObject({ value: "33%" });
    expect(at.stat!.scope).toContain("Northeast League Meet");
    // An event named and "this season", either order: the current season's event.
    for (const q of ["4215 advancement chances this season at Northeast League Meet", "4215 advancement chances at Northeast League Meet this season"]) {
      expect((await ask(q)).stat?.headline).toMatchObject({ value: "33%" });
    }
    // A place's events aren't one event: no forecast, never the next event's in its place.
    const q1 = await ask("4215 chance to win an event at New Jersey Qualifier");
    expect(JSON.stringify(q1.stat ?? {})).not.toContain("Northeast League Meet");
    // A season named is the only one looked in: none upcoming in a finished season, said so.
    const past = await ask(`4215 advancement chances in ${S}-${String((S + 1) % 100).padStart(2, "0")}`);
    expect(JSON.stringify(past.stat ?? {})).not.toContain("33%");
    expect(past.stat?.none ?? "").toMatch(/No upcoming event/);
    // "This season" is the current one, where the upcoming event is (4215 has no matches in it yet).
    const now = await ask("4215 advancement chances this season");
    expect(now.stat!.headline).toMatchObject({ value: "33%" });
    // Its heading and links name the current season, not the team's last played one.
    expect(JSON.stringify(now.stat)).not.toContain(`${S}–${String((S + 1) % 100).padStart(2, "0")}`);
    // A season OPR at a named event (its scope holds the event, not a season) reads that event's season.
    const team = { number: 4215, name: "Hypnotic Robotics" };
    const ev = await partnerListAnswer("partner-top-opr", team, await teamMatches(4215), { season: null, event: { season: S, code: "USNJQ1", name: "New Jersey Qualifier" } });
    expect(ev.none).toBeUndefined();
    expect(ev.headline).toMatchObject({ value: "23268 Ultraviolet" });
    // No OPR for any compared team: the table, and no leader named.
    for (const t of [4215, 6980, 33950]) await run("UPDATE team_season_stats SET opr_np = NULL WHERE season = ? AND team = ?", [S, t]);
    const none = await compareAnswer([4215, 6980, 33950].map((n) => ({ number: n, name: null })), { season: S });
    expect(none.headline).toMatchObject({ value: "No OPR" });
    expect(JSON.stringify(none.blocks)).not.toContain('"strong":true');
    for (const [t, v] of [[4215, 101.6], [6980, 46.9], [33950, 42.2]]) await run("UPDATE team_season_stats SET opr_np = ? WHERE season = ? AND team = ?", [v, S, t]);
    // Compare's hit opens on the season the card reads.
    const c = await ask("4215 6980 33950 compare");
    expect(c.hits[0]).toMatchObject({ kind: "compare" });
    expect(c.hits[0].href).toContain(`season=${S}`);
    expect((await ask(`4215 6980 33950 compare in ${S - 1}`)).hits[0].href).toContain(`season=${S - 1}`);
  });
  it("review fixes: an awards season named, Compare's four-team limit, the full lists", async () => {
    // Awards in a season with none for either side: counted for that season, not every season.
    expect((await ask(`4215 awards vs 6980 ${S - 1}-${String(S % 100).padStart(2, "0")}`)).stat!.headline).toMatchObject({ value: "Even", label: "0 awards each" });
    expect(readTeamSet("4215 6980 33950 207 compare")).toEqual({ teams: [4215, 6980, 33950, 207], season: null });
    expect(readTeamSet("4215 6980 33950 207 23268 compare")).toBeNull();
    // A bare year in the list is a team; a season is written as one.
    expect(readTeamSet("4215 6980 2024 compare")).toEqual({ teams: [4215, 6980, 2024], season: null });
    expect(readTeamSet("4215 6980 33950 compare 2024-25")).toEqual({ teams: [4215, 6980, 33950], season: 2024 });
    expect(readTeamSet("4215 6980 33950 compare in 2024")).toEqual({ teams: [4215, 6980, 33950], season: 2024 });
    // Every opponent listed (six here), never cut short.
    const o = await ask("4215 opponents this season");
    expect(o.stat!.blocks[0]).toMatchObject({ kind: "table" });
    expect((o.stat!.blocks[0] as { rows: unknown[] }).rows).toHaveLength(Number(o.stat!.headline!.value));
  });
});
