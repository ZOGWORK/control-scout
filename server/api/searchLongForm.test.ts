// Long, conversational queries (./searchLongForm.ts) on a small fixture: each long phrasing answers with the same
// family and intent as its short form (the 260-query list's), its season and place words still scoping it, the card
// keeping its own words with the short form only on the quiet "Showing" line; and a team found with a question search
// can't answer says so plainly, never quoting the query, with questions it does answer built from the team's records.
import { beforeAll, describe, expect, it } from "vitest";
import type { SearchAnswer } from "../../src/shared/api";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { refreshSearchSeason, resetSearchSeason } from "./answers/season";
import { longForm } from "./searchLongForm";

// The latest completed season, and the one before it ("last season").
const S = CURRENT_SEASON - 1, L = S - 1;
const ask = (q: string) => searchAnswer(q, { limit: 40, full: true });
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
  ["what was 4215's opr last season", "4215 opr last season"],
  ["i want to know 4215's opr at worlds", "4215 opr at worlds"],
  ["what is the highest opr 4215 has ever had", "4215 highest opr ever"],
  ["how has 4215's opr changed over the seasons", "4215 opr trend over seasons"],
  ["where does 4215 rank in opr worldwide", "4215 opr rank worldwide"],
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

  it("keeps season and place words: they still scope the answer", async () => {
    expect((await ask("did 4215 win any awards last season")).stat?.title).toMatch(/2024–25|last season/i);
    expect(longForm("what was 4215's record in 2024-25")).toBe("4215 record in 2024-25");
    expect(longForm("when was the last time 4215 went to worlds in 2025-26")).toBe("4215 worlds appearances in 2025-26");
    expect(longForm("can you show me 4215's opr in new jersey please")).toBe("4215 opr in new jersey");
  });

  it("says the short form only on the quiet Showing line", async () => {
    const a = await ask("when was the last time 4215 went worlds");
    expect(a.card?.kind).toBe("worlds");
    expect(a.understood?.showing).toBe("4215 worlds appearances");
    // "last" is what the rule read (the appearances, newest first): never called unread.
    expect(a.understood?.label).not.toMatch(/isn't part of this answer/);
  });

  it("leaves short queries alone", () => {
    for (const q of ["4215 opr", "4215 worlds appearances", "4215 versus 6980 compare", "hypnotic robotics", "events 4215 went to this season"]) expect(longForm(q)).toBeNull();
  });
});

describe("a team found, its question not answered", () => {
  it("says so plainly, never quoting the query, with questions it answers from the team's records", async () => {
    const a = await ask("what colour is 4215's robot");
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "4215" });
    expect(a.understood?.label).toBe("Hypnotic Robotics (4215) · That question isn't answered directly yet: their page has the rest");
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
