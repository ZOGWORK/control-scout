// Long, conversational queries (./searchLongForm.ts) on a small fixture: each long phrasing answers with the same
// family and intent as its short form (the 260-query list's), its season and place words still scoping it, the card
// keeping its own words with the short form only on the quiet "Showing" line; and a team found with a question search
// can't answer says so plainly, never quoting the query, with questions it does answer built from the team's records.
import { beforeAll, describe, expect, it } from "vitest";
import type { SearchAnswer } from "../../src/shared/api";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON, gameOf } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "./answers/season";
import { longForm } from "./searchLongForm";
import { numberFix } from "./spelling";

// The latest completed season, and the one before it ("last season").
const S = CURRENT_SEASON - 1, L = S - 1;
const ask = (q: string) => searchAnswer(q, { limit: 40, full: true });
/** The header dropdown's search: 15 hits, a stat's blocks not built (it carries the stat's intent only). */
const drop = (q: string) => searchAnswer(q, { limit: 15 });
/** What an answer is, for comparing: its family and intent (a stat), its kind and title (a card), or a Compare. */
const what = (a: SearchAnswer) => (a.stat ? `stat ${a.stat.family}/${a.stat.intent} · ${a.stat.title}` : a.card ? `card ${a.card.kind} · ${a.card.title}`
  : a.hits[0]?.href?.startsWith("/compare") ? `compare ${a.hits[0].href}` : null);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [207, "Critical Mass"], [23268, "Ultraviolet"], [7149, "ENFORCERS"], [33950, "First Street Kids"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    for (const s of [S, L]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
  }
  const ev = (season: number, code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Hillsborough', 'NJ', 'USA', ?, ?, 't')", [season, code, name, type, start, start]);
  await ev(S, "USNJQ1", "New Jersey Qualifier", "Qualifier", `${S + 1}-01-10`);
  await ev(S, "FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "FIRSTChampionship", `${S + 1}-04-16`);
  await ev(L, "USNJQ0", "New Jersey Kickoff Qualifier", "Qualifier", `${L + 1}-01-12`);
  let n = 0;
  const match = (season: number, code: string, red: [number, number], blue: [number, number], rs: number, bs: number) => {
    n++;
    return Promise.all([
      run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, red_auto, red_teleop, red_endgame, blue_auto, blue_teleop, blue_endgame, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 't')",
        [season, code, n, `Q${n}`, `${season + 1}-01-10T${String(8 + (n % 12)).padStart(2, "0")}:00:00Z`, rs, rs, bs, bs, Math.round(rs * 0.3), Math.round(rs * 0.5), Math.round(rs * 0.2), Math.round(bs * 0.3), Math.round(bs * 0.5), Math.round(bs * 0.2)]),
      ...[...red.map((t) => [t, "red"] as const), ...blue.map((t) => [t, "blue"] as const)].map(([t, a]) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [season, code, n, t, a])),
    ]);
  };
  await match(S, "USNJQ1", [4215, 207], [6980, 23268], 120, 60);
  await match(S, "USNJQ1", [4215, 207], [6980, 7149], 130, 70);
  await match(S, "USNJQ1", [4215, 207], [6980, 23268], 80, 150);
  await match(S, "USNJQ1", [4215, 23268], [6980, 7149], 100, 90);
  await match(S, "USNJQ1", [207, 7149], [4215, 23268], 140, 60);
  await match(S, "FTCCMP1EDIS", [4215, 7149], [207, 33950], 200, 100);
  await match(L, "USNJQ0", [4215, 207], [6980, 7149], 90, 80);
  await match(L, "USNJQ0", [4215, 23268], [6980, 207], 70, 95);
  for (const [s, code, teams] of [[S, "USNJQ1", [4215, 6980, 207, 23268, 7149]], [S, "FTCCMP1EDIS", [4215, 7149, 207, 33950]], [L, "USNJQ0", [4215, 6980, 207, 23268, 7149]]] as const) {
    for (const [i, t] of teams.entries()) {
      await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [s, code, t]);
      await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches, wins, losses, ties) VALUES (?, ?, ?, ?, 20, 50, 10, 4, 2, 2, 0)", [s, code, t, 90 - i * 5]);
      await run("INSERT INTO rankings (season, code, team, rank, wins, losses, ties, played) VALUES (?, ?, ?, ?, 2, 2, 0, 4)", [s, code, t, i + 1]).catch(() => {});
    }
  }
  const stats = [[4215, 101.6, 28.3, 73.4, 6.7, 600, 98, 525, 6, 2], [6980, 46.9, 13.2, 40.9, 5.6, 2600, 50.3, 2041, 1, 4], [33950, 42.2, 16.2, 29.5, 6.5, 3100, 39.8, 2900, 0, 2], [207, 114.3, 30, 80, 4.3, 400, 110, 300, 3, 3], [23268, 157.9, 40, 110, 7.9, 146, 150, 100, 2, 2], [7149, 115.3, 33, 77, 5.3, 446, 136.7, 200, 1, 2]] as const;
  for (const [t, opr, au, te, en, rank, rating, rrank, w, l] of stats) for (const [s, k] of [[S, 1], [L, 0.8]] as const) {
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, rank_auto, rank_teleop, rank_endgame, ranked_teams, rating_np, rating_sd, rating_rank, matches, wins, losses, ties) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 8308, ?, 3.2, ?, ?, ?, ?, 0)", [s, t, opr * k, au * k, te * k, en * k, rank, rank, rank, rank, rating * k, rrank, w + l, w, l]);
  }
  for (const [s, code, t, type, placement] of [[S, "USNJQ1", 4215, "Inspire", 1], [S, "USNJQ1", 4215, "Winner", 1], [S, "FTCCMP1EDIS", 4215, "Think", 2], [L, "USNJQ0", 4215, "Connect", 1], [S, "USNJQ1", 6980, "Connect", 1]] as const) {
    await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, ?, ?, ?, ?)", [s, code, type, placement, t]);
  }
  const rel = (team: number, idx: number) => run("INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows, recent_near_zero, no_show_rate, dq_rate, near_zero_rate, swing, penalty_ratio, predictability_ratio, idx, computed_at) VALUES (?, '', ?, 6, 0, 0, 0, 6, 6, 0, 0, 0, 0, 0, 0.3, 1, 1, ?, 'now')", [S, team, idx]);
  await rel(0, 60); await rel(4215, 84); await rel(6980, 71);
  // An earlier Worlds (Franklin, last season: rostered, no matches stored) for 4215 and 207, and a state championship.
  await ev(L, "FTCCMP1FRAN", "FIRST Championship - FIRST Tech Challenge - Franklin Division", "FIRSTChampionship", `${L + 1}-04-17`);
  await ev(S, "USNJCMP", "New Jersey Championship", "Championship", `${S + 1}-03-01`);
  // 207's newest Worlds has no dates stored: it is still its last trip (Greptile on #655).
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'FTCCMP1JEMI', 'FIRST Championship - FIRST Tech Challenge - Jemison Division', 'FIRSTChampionship', 'Houston', 'TX', 'USA', NULL, NULL, 't')", [CURRENT_SEASON]);
  for (const [s, code, t] of [[L, "FTCCMP1FRAN", 4215], [L, "FTCCMP1FRAN", 207], [S, "USNJCMP", 4215], [CURRENT_SEASON, "FTCCMP1JEMI", 207]] as const) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [s, code, t]);
  // 4215's next event, with a stored projection.
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await ev(CURRENT_SEASON, "USNJNEM2", "Northeast League Meet", "LeagueMeet", soon);
  await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'USNJNEM2', 4215)", [CURRENT_SEASON]);
  const teams = JSON.stringify([{ team: 4215, rank: { p10: 1, p50: 3, p90: 7, mean: 3.4 }, pPlayoff: 0.71, pCaptain: 0.5, pPicked: 0.21, pAdvance: 0.33, advance: "odds", pWin: 0.22, pFinalist: 0.18 }]);
  await run("INSERT INTO event_projections (season, code, kind, state_key, seed, runs, target_runs, stage, played, scheduled, through, slots, slots_source, engine_version, ms, computed_at, teams) VALUES (?, 'USNJNEM2', 'current', 'k', 1, 2000, 2000, 'pre', 0, 30, NULL, 2, 'official', 't', 10, 'now', ?)", [CURRENT_SEASON, teams]);
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
});

/** Each long phrasing and the 260 list's short form it asks (OPR, rating, record, scores, awards, events, Worlds,
 *  partners, compare, predictions). */
const PAIRS: [string, string][] = [
  // OPR
  ["what is the opr of team 4215 right now", "4215 opr"],
  ["can you tell me what 4215's auto opr is", "4215 auto opr"],
  // #537: a spoken filler ("like") inside the question.
  ["what is like the opr for 4215", "4215 opr"],
  ["um what was basically 4215's record this season", "4215 record this season"],
  ["what was 4215's opr last season", "4215 opr last season"],
  ["i want to know 4215's opr at worlds", "4215 opr at worlds"],
  ["what is the highest opr 4215 has ever had", "4215 highest opr ever"],
  ["how has 4215's opr changed over the seasons", "4215 opr trend over seasons"],
  // Worlds trips counted, and the division with its rank (failed-search #913/#929, #870/#1001; held out).
  ["the number of times bad wolf has gone to the world championship", "bad wolf worlds appearances"],
  // The verb after a team's number too (Greptile on #1087).
  ["number of times 6980 has been to worlds", "6980 worlds appearances"],
  ["which division was 6980 in at the first championship and how was their record there", "6980 worlds divisions"],
  // A team's own events by when they were, how many and where (failed-search #711/#824/#1036, #832, #823, #831,
  // #732–#734; held out: other teams and words).
  ["what was the most recent competition bad wolf attended and how did they do there", "bad wolf results at their last event"],
  ["what was the first meet 4215 played in 2024-25", "4215 results at their first event in 2024-25"],
  ["what was 6980's last event and what was their rank there", "6980 rank at their last event"],
  ["what was hypnotic robotics' earliest tournament in 2024-25 and how was their record", "hypnotic robotics record at their first event in 2024-25"],
  ["which tournaments did 6980 bad wolf compete in new jersey last season in date order", "6980 bad wolf events in new jersey last season in date order"],
  ["how many meets did 6980 attend this season and which was their best one", "6980 events played this season"],
  ["when is my 6980 next event", "6980 next event"],
  // The team changed between two seasons (failed-search #879, held out): its OPR's change.
  ["how has hypnotic robotics improved since last season", "hypnotic robotics opr change since last season"],
  ["how did 4215 change between 2023-24 and 2024-25", "4215 opr change between 2023-24 and 2024-25"],
  // "From last season" alone runs to this season (Greptile on #1074).
  ["how has bad wolf changed from last season", "bad wolf opr change from last season to this season"],
  ["where does 4215 rank in opr worldwide", "4215 opr rank worldwide"],
  // The stat named stays the stat asked about (Greptile on #655).
  ["can you tell me where does 4215 rank in rating", "4215 rating rank"],
  // Rating
  ["what is team 4215's rating right now", "4215 rating"],
  ["can you show me 4215's rating last season", "4215 rating last season"],
  ["what is the prediction rating of the team 4215", "4215 rating"],
  // Record
  ["what is 4215's record this season", "4215 record this season"],
  ["how did 4215 do last season record wise", "4215 record last season"],
  ["what was 4215's record at worlds", "4215 record at worlds"],
  ["how many matches has 4215 played in total", "4215 total matches played"],
  ["what is the longest win streak 4215 has ever had", "4215 longest win streak ever"],
  // Scores
  ["what was 4215's best score ever", "4215 highest score ever"],
  ["what is the highest score 4215 has ever gotten", "4215 highest score ever"],
  ["what was the lowest score 4215 ever got", "4215 lowest score ever"],
  ["what was 4215's highest score at worlds", "4215 highest score at worlds"],
  ["what is 4215's average score this season", "4215 average score this season"],
  // Awards
  ["did 4215 win any awards last season", "4215 awards last season"],
  ["what awards has 4215 won", "awards 4215 has won"],
  ["has 4215 ever won inspire", "4215 Inspire awards"],
  ["what awards did 4215 win at worlds", "4215 awards at worlds"],
  ["what was the most recent award 4215 won", "4215 most recent award"],
  // Events
  ["which events did 4215 go to this season", "events 4215 went to this season"],
  ["what events did 4215 compete at last season", "events 4215 went to last season"],
  ["what was 4215's best event ever", "4215 best event ever"],
  // Worlds
  ["when was the last time 4215 went worlds", "4215 worlds appearances"],
  ["how many times has 4215 been to worlds", "4215 worlds appearances"],
  ["how many times did 4215 make it to worlds?", "4215 worlds appearances"],
  ["has 4215 ever qualified for worlds", "4215 worlds appearances"],
  ["what divisions has 4215 played in at worlds", "4215 worlds divisions"],
  // Partners and opponents
  ["who did 4215 play with the most this season", "4215 most common alliance partner this season"],
  ["who is 4215's best alliance partner", "4215 best alliance partner"],
  ["who has 4215 played against the most", "4215 most common opponent"],
  ["how many times has 4215 beaten 6980", "4215 wins against 6980"],
  ["what is 4215's record against 6980", "4215 record against 6980"],
  // Compare
  ["is 4215 better than 6980 at auto", "4215 versus 6980 who is better at auto"],
  ["is 4215 better than 6980 at teleop", "4215 versus 6980 who is better at teleop"],
  ["who has won more awards 4215 or 6980", "4215 versus 6980 who has won more awards"],
  // "compare 4215 and 6980" and "is 4215 better than 6980" stay the plain Compare, as "4215 vs 6980" (the paraphrase
  // set's, ./searchLayers.sets.ts).
  ["is 4215 better than 6980 overall", "4215 vs 6980"],
  ["can you compare 4215 and 6980 for me", "4215 vs 6980"],
  // Predictions
  ["how many wins is 4215 predicted to get at their next event", "4215 predicted wins at their next event"],
  ["what are 4215's chances of advancing to worlds", "4215 chance to advance to worlds"],
  ["who should 4215 pick as their alliance partner please", "who should 4215 pick as an alliance partner"],
  ["please show me 4215's reliability", "4215 reliability"],
  // A team's own listing, asked yes or no.
  ["is 4215 a new team or a veteran one", "4215 rookie year"],
  ["is 4215 a first-year team", "4215 rookie year"],
  ["is team 4215 really based in minnesota or not", "where is 4215 from"],
  ["did 4215 list a school", "4215 school"],
  ["does 4215 have a sponsor on record", "4215 sponsors"],
];

describe("long, conversational queries", () => {
  it(`has ${PAIRS.length} phrasings, at least 40`, () => expect(PAIRS.length).toBeGreaterThanOrEqual(40));

  it.each(PAIRS)("%s → the answer to %s", async (long, short) => {
    const s = what(await ask(short));
    expect(s, `the short form "${short}" answers directly`).not.toBeNull();
    const a = await ask(long);
    expect(what(a)).toBe(s);
    // The card's own words: never the cleaned query, never the "isn't answered" fallback.
    expect(a.understood?.label).not.toMatch(/isn't answered directly|read as/);
    expect(a.q).toBe(long.replace(/\?$/, ""));
  });

  it.each(PAIRS)("in the dropdown too: %s → %s", async (long, short) => {
    // What the dropdown reads: the answer's intent (a stat's blocks are built only for /search), else its card or Compare.
    const key = (a: SearchAnswer) => a.intent?.kind ?? (a.card ? `card ${a.card.kind}` : a.hits[0]?.href?.startsWith("/compare") ? "compare" : null);
    const s = key(await drop(short));
    expect(s, `the short form "${short}" answers directly`).not.toBeNull();
    expect(key(await drop(long))).toBe(s);
  });

  it("keeps season and place words: they still scope the answer", async () => {
    expect((await ask("did 4215 win any awards last season")).stat?.title).toMatch(/2024–25|last season/i);
    expect(longForm("what was 4215's record in 2024-25")).toBe("4215 record in 2024-25");
    // A season after a Worlds question: Worlds divisions, which takes one (the appearances card is every season's).
    expect(longForm("when was the last time 4215 went to worlds in 2025-26")).toBe("4215 worlds divisions in 2025-26");
    // A count of trips, the verb before or after the team, never part of its name (Greptile on #1087).
    for (const [q, out] of [["number of times 4215 has gone to worlds", "4215 worlds appearances"], ["number of times 4215 went to worlds", "4215 worlds appearances"],
      ["the number of times bad wolf has gone to worlds", "bad wolf worlds appearances"], ["count of times that hypnotic robotics have been to worlds", "hypnotic robotics worlds appearances"]]) expect(longForm(q), q).toBe(out);
    const label = `${S}-${String(S + 1).slice(2)}`;
    for (const q of [`did 4215 go to worlds in ${label}`, `has 4215 been to worlds in ${label}?`]) {
      const a = await ask(q);
      expect(a.stat, q).toMatchObject({ intent: "worlds-divisions" });
      expect(a.stat?.title, q).toContain(`${S}–${String(S + 1).slice(2)}`);
    }
    expect(longForm("can you show me 4215's opr in new jersey please")).toBe("4215 opr in new jersey");
  });

  it("says the short form only on the quiet Showing line", async () => {
    const a = await ask("who did 4215 play with the most this season");
    expect(a.stat?.intent).toBe("frequent-partner");
    expect(a.understood?.showing).toBe("4215 most common alliance partner this season");
    expect(a.understood?.label).not.toMatch(/most common alliance partner this season/);
    // #630: the trigger is the appearances card with its last trip as the headline; "last" is read, never called unread.
    const w = await ask("when was the last time 4215 went worlds");
    expect(w.card).toMatchObject({ kind: "worlds", headline: expect.stringMatching(/^Last went to Worlds in /) });
    expect(w.understood?.label).not.toMatch(/isn't part of this answer/);
  });

  it("reads a yes-or-no listing question with the team as its number and name, or its name alone (Greptile on #1095)", async () => {
    for (const [long, short, team] of [
      ["is 6980 bad wolf a rookie team or a veteran", "6980 rookie year", 6980],
      ["is critical mass really from new jersey or not", "where is 207 from", 207],
      ["does ultraviolet have any sponsors listed", "23268 sponsors", 23268],
    ] as const) {
      const s = await ask(short), a = await ask(long);
      expect(what(a), long).toBe(what(s));
      expect(a.understood?.label, long).toContain(`(${team})`);
      const d = await drop(long);
      expect(d.card?.kind ?? d.intent?.kind, long).toBe((await drop(short)).card?.kind ?? (await drop(short)).intent?.kind);
      expect(d.understood?.label, long).toContain(`(${team})`);
    }
  });

  it("reads a yes-or-no listing question only when it asks for the listing", () => {
    expect(longForm("is 4215 in the finals")).not.toBe("where is 4215 from");
    expect(longForm("is 4215 a good team or not")).not.toBe("4215 rookie year");
    expect(longForm("does 4215 have any wins at worlds")).toBeNull();
  });

  it("keeps a \"like\" that compares (Greptile on #655)", () => {
    expect(longForm("what is like the opr for 4215")).toBe("4215 opr");
    expect(longForm("what is the opr of teams like 4215") ?? "").not.toMatch(/teams 4215/);
    const looks = "what does 4215's robot look like";
    expect(longForm(looks) ?? looks).toContain("look like");
    expect(longForm("who plays like 4215")).toBeNull();
  });

  it("leaves short queries alone", () => {
    for (const q of ["4215 opr", "4215 worlds appearances", "4215 versus 6980 compare", "hypnotic robotics", "events 4215 went to this season"]) expect(longForm(q)).toBeNull();
  });
});

describe("the first or the last time, by a team's name", () => {
  const label = (s: number) => `${s}–${String(s + 1).slice(2)}`;
  it.each([
    ["when was the first time hypnotic robotics went to worlds", "4215", `First went to Worlds in ${label(L)} · ${gameOf(L)}, Franklin Division`],
    ["when was the last time hypnotic robotics went to worlds", "4215", `Last went to Worlds in ${label(S)} · ${gameOf(S)}, Edison Division`],
    ["when was the first time enforcers went to worlds", "7149", `First went to Worlds in ${label(S)} · ${gameOf(S)}, Edison Division`],
    ["when did critical mass first go to worlds?", "207", `First went to Worlds in ${label(L)} · ${gameOf(L)}, Franklin Division`],
    ["when was the last time critical mass went to worlds", "207", `Last went to Worlds in ${label(CURRENT_SEASON)} · ${gameOf(CURRENT_SEASON)}, Jemison Division`],
    ["when did first street kids first go to worlds", "33950", `First went to Worlds in ${label(S)} · ${gameOf(S)}, Edison Division`],
    ["when was the last time 4215 went to states", "4215", `Last went to states in ${label(S)} · ${gameOf(S)}, New Jersey Championship`],
  ])("%s → team %s, \"%s\"", async (q, team, headline) => {
    const a = await ask(q);
    expect(a.card?.kind, q).toBe(/states/.test(q) ? "states" : "worlds");
    expect(a.card?.team?.number).toBe(Number(team));
    expect(a.card?.headline).toBe(headline);
    expect(a.understood?.label).not.toMatch(/isn't part of this answer|isn't answered/);
  });

  it("reads a typo of worlds after the filler is gone", async () => {
    const a = await ask("when was the first time enforcers went to worldes");
    expect(a.card).toMatchObject({ kind: "worlds", team: { number: 7149 }, headline: `First went to Worlds in ${label(S)} · ${gameOf(S)}, Edison Division` });
    expect(a.didYouMean).toMatch(/worlds$/);
  });

  it("says plainly when there's no trip to name", async () => {
    const a = await ask("when was the last time bad wolf went to worlds");
    expect(a.card).toMatchObject({ kind: "worlds", team: { number: 6980 } });
    expect(a.card?.headline).toBeUndefined();
    expect(a.card?.none).toMatch(/no last trip to name/);
    expect(a.understood?.label).not.toMatch(/isn't part of this answer/);
  });
});

describe("a team number typed wrong (#621)", () => {
  it("offers the real team numbers one key away, never \"No team, event or match matched\"", async () => {
    // "4z15" already reaches 4215 through search's own fuzzy match; a dash or a missing or extra digit doesn't.
    expect((await ask("4z15")).hits[0]).toMatchObject({ kind: "team", ref: "4215" });
    for (const q of ["42-5", "421", "42155"]) {
      const a = await ask(q);
      expect(a.step, q).toBe("did-you-mean");
      expect(a.didYouMean, q).toBe("4215");
      expect(a.hits[0], q).toMatchObject({ kind: "team", ref: "4215" });
      expect(a.understood?.label, q).not.toMatch(/No team, event or match matched/);
    }
    expect((await ask("69-0")).didYouMean).toBe("6980");
  });

  it("offers a registered team with no matches yet, after the teams that played (Greptile on #655)", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (4216, 'Brand New Bots', 'Oradell', 'NJ', 'USA')");
    await rebuildSearch();
    const a = await numberFix("42-6");
    expect(a?.hits.map((h) => h.ref)).toEqual(["4216"]);
    // "421": 4215 has played, 4216 hasn't yet.
    expect((await numberFix("421"))?.hits.map((h) => h.ref)).toEqual(["4215", "4216"]);
  });

  it("leaves real numbers, match codes and names alone", async () => {
    for (const q of ["4215", "q12", "m3", "hypnotic", "2024-25 4215"]) expect(await numberFix(q), q).toBeNull();
  });
});

describe("a team found, its question not answered", () => {
  it("says so plainly, never quoting the query, with questions it answers from the team's records", async () => {
    const a = await ask("what colour is 4215's robot");
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "4215" });
    expect(a.understood?.label).toBe("Hypnotic Robotics (4215) · This isn't answered directly yet");
    expect(a.understood?.label).not.toContain("colour");
    expect(a.suggest).toEqual([`4215 record ${S}–${String(S + 1).slice(2)}`, `4215 opr ${S}–${String(S + 1).slice(2)}`, "4215 worlds appearances"]);
    // Each suggestion is answered directly.
    for (const q of a.suggest!) expect(what(await ask(q)), q).not.toBeNull();
  });

  it("puts what was asked about first, and only what the team has", async () => {
    expect((await ask("4215 worlds robot colour")).suggest?.[0]).toBe("4215 worlds appearances");
    // 6980 never went to Worlds: no Worlds suggestion.
    expect((await ask("6980 robot colour")).suggest?.some((q) => /worlds/.test(q))).toBe(false);
  });
});
