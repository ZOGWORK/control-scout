// Failed searches filed from the site (3.1.4), each asked of three teams or more: an event named with no "at" ("what
// rank did 4215 get in the east bergen conference"), a team number typed against the next word ("4215matches"),
// typos the spelling layer missed ("winnng", "appreacne", a query cut off mid-word), bare numbers with no team,
// leaderboard sorts in plain words ("teleop ranked", "sorted lowest to highest"), a rating change with no team, and the
// card for an event a team didn't play: its reason and its real events.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer, unglue } from "../searchAnswer";
import { bestFix, buildVocab, correctWord } from "../spelling";
import { readLeaderboard, readStatQuestion } from "./read";
import type { StatAnswer } from "../../../src/shared/searchStat";

const full = (q: string) => searchAnswer(q, { limit: 25, full: true });
const ask = async (q: string) => (await full(q)).stat as StatAnswer;

const NJ_TEAMS = [[4215, "Hypnotic Robotics", 1], [6980, "Bad Wolf", 2], [23268, "Ultraviolet", 3]] as const;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string, string][] = [
    [4215, "Hypnotic Robotics", "NJ", "USA"], [6980, "Bad Wolf", "NJ", "USA"], [23268, "Ultraviolet", "NJ", "USA"], [7149, "ENFORCERS", "NJ", "USA"],
    [33950, "First Street Kids", "NJ", "USA"], [20205, "Chaotic Pioneers", "NJ", "USA"], [10809, "Crow Force", "CA", "USA"], [30030, "Exodus", "TX", "USA"],
    [20265, "Heart of RoBots", "BZ", "Romania"], [1, "Team Unlimited", "MA", "USA"], [7, "Tactical Sheep", "CA", "USA"], [49, "NerdHerd", "CA", "USA"], [38702, "Mech-dranos", "TX", "USA"],
  ];
  for (const [n, name, state, country] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, ?)", [n, name, state, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (season: number, code: string, name: string, type: string, start: string, division: string | null = null, state = "NJ", country = "USA") =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, 'Town', ?, ?, ?, ?, 't')", [season, code, name, type, division, state, country, start, start]);
  await ev(2025, "FTCCMP1", "FIRST Championship", "FIRSTChampionship", "2026-04-29", null, "TX");
  await ev(2025, "FTCCMP1ROSS", "FIRST Championship - FIRST Tech Challenge - Ross Division", "FIRSTChampionship", "2026-04-29", "FTCCMP1", "TX");
  await ev(2025, "USNJCMP", "New Jersey Championship", "Championship", "2026-03-15");
  await ev(2025, "USNJCMPPKWY", "New Jersey Championship - Parkway Division", "Championship", "2026-03-15", "USNJCMP");
  await ev(2025, "USNJNOM1", "P1-2 Northern League Meet", "LeagueMeet", "2025-11-01");
  await ev(2025, "USNJNOLT2", "East Bergen Conference Northern League Tournament", "LeagueTournament", "2026-02-21");
  await ev(2025, "USNJNEELT2", "Essex Conference Northeast Edge", "LeagueTournament", "2026-02-22");
  await ev(2025, "USCALAQ1", "Los Angeles Qualifier", "Qualifier", "2026-01-10", null, "CA");
  await ev(2025, "USTXQ1", "Austin Qualifier", "Qualifier", "2026-01-11", null, "TX");
  await ev(2025, "ROQ1", "Bucharest Qualifier", "Qualifier", "2026-01-12", null, "B", "Romania");
  await ev(2024, "USNJSOLT", "Deep South Conference Southern League Tournament", "LeagueTournament", "2025-02-22");
  // The tournament's other seasons, as the data has them: its words are the data's own, never corrected.
  await ev(2024, "USNJNOLT", "NJ 2/23/2025 East Bergen Conference Northern League Tournament", "LeagueTournament", "2025-02-23");
  await ev(2023, "USNJNOLT", "NJ 2/24/2024 East Bergen Conference Northern League Tournament", "LeagueTournament", "2024-02-24");
  let n = 0;
  const match = async (season: number, code: string, level: string, red: number, blue: number, reds: number[], blues: number[]) => {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [season, code, level, n, `Q${n}`, `${season + 1}-02-01T10:00:00Z`, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, ?, 0, ?, ?, ?, 1)", [season, code, level, n, t, a]);
    }
  };
  const at = async (season: number, code: string, team: number, rank: number, opr: number) => {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, ?, ?, ?)", [season, code, team, rank]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (?, ?, ?, ?, 20, 50, 10, 2)", [season, code, team, opr]);
  };
  // The conference tournament: 4215 first, 6980 second, 23268 third; all three at the league meet before it.
  for (const [t, , rank] of NJ_TEAMS) {
    await at(2025, "USNJNOLT2", t, rank, 120 - rank * 10);
    await at(2025, "USNJNOM1", t, rank, 100 - rank * 10);
  }
  await match(2025, "USNJNOLT2", "qual", 150, 120, [4215], [6980]);
  await match(2025, "USNJNOLT2", "qual", 140, 100, [6980], [23268]);
  await match(2025, "USNJNOM1", "qual", 130, 90, [4215], [23268]);
  await match(2025, "USNJNOM1", "qual", 110, 100, [6980], [23268]);
  // The state championship: 4215, 23268 and 7149 (not 6980, nor 33950, which played the Essex Conference only).
  for (const [t, rank] of [[4215, 1], [23268, 2], [7149, 3]] as const) await at(2025, "USNJCMPPKWY", t, rank, 110);
  await match(2025, "USNJCMPPKWY", "qual", 160, 150, [4215, 23268], [7149]);
  await at(2025, "USNJNEELT2", 33950, 1, 60);
  await match(2025, "USNJNEELT2", "qual", 80, 70, [33950], [7149]);
  // 7149 at Worlds; the out-of-state teams at home.
  await at(2025, "FTCCMP1ROSS", 7149, 5, 130);
  await match(2025, "FTCCMP1ROSS", "qual", 170, 160, [7149], [10809]);
  for (const [t, code] of [[10809, "USCALAQ1"], [30030, "USTXQ1"], [20265, "ROQ1"], [7, "USCALAQ1"], [49, "USCALAQ1"], [1, "USCALAQ1"], [38702, "USTXQ1"]] as const) {
    await at(2025, code, t, 1, 150);
    await match(2025, code, "qual", 150, 100, [t], [t === 7 ? 1 : 7]);
  }
  // 2023–24 Worlds (CENTERSTAGE): 4215, 23268 and 7149 in the Edison Division.
  await ev(2023, "FTCCMP1", "FIRST Championship", "FIRSTChampionship", "2024-04-17", null, "TX");
  await ev(2023, "FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "FIRSTChampionship", "2024-04-17", "FTCCMP1", "TX");
  for (const [t, rank] of [[4215, 3], [23268, 7], [7149, 12]] as const) await at(2023, "FTCCMP1EDIS", t, rank, 140);
  await match(2023, "FTCCMP1EDIS", "qual", 200, 150, [4215, 23268], [7149]);
  // 20205's last season with events is 2024–25.
  await at(2024, "USNJSOLT", 20205, 4, 70);
  await match(2024, "USNJSOLT", "qual", 90, 80, [20205], [4215]);
  // Season numbers for the leaderboards: Auto, TeleOp and Endgame OPR, and the prediction rating.
  const stats: [number, number, number, number, number][] = [[4215, 30, 60, 20, 90], [6980, 25, 70, 10, 85], [23268, 40, 40, 30, 80], [7149, 10, 80, 5, 70], [10809, 50, 30, 15, 95], [30030, 5, 20, 40, 60], [20265, 45, 50, 35, 99]];
  for (const [t, auto, tele, end, rating] of stats) {
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rating_np, rating_matches, matches, wins, losses, ties) VALUES (2025, ?, ?, ?, ?, ?, ?, 10, 10, 5, 5, 0)", [t, auto + tele + end, auto, tele, end, rating]);
  }
  for (const t of [1, 7, 49, 38702]) await run("INSERT INTO team_season_stats (season, team, opr_np, matches) VALUES (2025, ?, 50, 1)", [t]);
  await run("INSERT INTO team_season_stats (season, team, opr_np, matches) VALUES (2024, 20205, 70, 1)");
  await rebuildSearch();
});

describe("an event named beside the team, with no \"at\"", () => {
  it("the rank at the team's own conference event, however the event is said (4215, 6980, 23268)", async () => {
    for (const [t, name, rank] of NJ_TEAMS) {
      for (const q of [`what rank did ${t} get on conference`, `what rank did ${t} conference`, `what rank did ${t} get in the east bergen conference`, `${name.toLowerCase()} rank in the east bergen conference`]) {
        const r = await ask(q);
        expect(r?.title, q).toBe("Rank at East Bergen Conference Northern League Tournament");
        expect(r.headline?.value, q).toBe(`#${rank} of 3`);
      }
      expect((await ask(`${t} opr east bergen conference`))?.title).toBe("OPR at East Bergen Conference Northern League Tournament");
    }
  });
  it("a forecast for the event named (4215, 6980, 23268)", async () => {
    for (const [t] of NJ_TEAMS) {
      // The search pipeline's before-and-after card (server/api/query/forecast.ts) at that event.
      const a = await full(`predicted chances of ${t} east bergen conference`);
      expect(a.intent?.kind).toBe("stat-pipeline-team-predict-event");
      expect(a.stat?.title).toMatch(/at East Bergen Conference Northern League Tournament$/);
      expect(a.stat?.scope).toContain("East Bergen Conference Northern League Tournament");
    }
  });
  it("an event the team didn't play: never another event's rank, the card says so (10809, 30030, 20265)", async () => {
    for (const t of [10809, 30030, 20265]) {
      const a = await full(`what rank did ${t} get in the east bergen conference`);
      expect(a.stat?.headline, String(t)).toBeUndefined();
      expect(a.stat?.none ?? "", String(t)).toMatch(/didn't play at East Bergen Conference Northern League Tournament/);
    }
    // Nothing beside the team at all: unchanged.
    expect(readStatQuestion("4215 rank")).toBeNull();
    expect((await full("4215 rank")).intent?.kind ?? "").not.toBe("stat-event-rank");
  });
});

describe("a team number typed against the next word", () => {
  it("is read as two words (23268, 4215, 7149)", async () => {
    for (const t of [23268, 4215, 7149]) {
      const a = await full(`${t}matches at nj championship`);
      expect(a.intent?.kind, String(t)).toBe("stat-results");
      expect(a.stat?.title).toMatch(/^Results at New Jersey Championship/);
      expect(a.q).toBe(`${t}matches at nj championship`);
    }
  });
  it("leaves ordinals and match codes as typed", () => {
    expect(unglue("4215matches at nj")).toBe("4215 matches at nj");
    expect(unglue("2nd place 10th q12 5v5")).toBe("2nd place 10th q12 5v5");
    expect(unglue("2025worlds")).toBe("2025 worlds");
  });
});

describe("typos the spelling layer missed", () => {
  it("a letter dropped: \"winnng\" is \"winning\", an event's winning alliance", async () => {
    for (const q of ["east bergen conference winnng", "east bergen conference winning", "east bergen conference winner"]) {
      const a = await full(q);
      expect(a.intent?.kind, q).toBe("stat-winning-alliance");
      expect(a.intent?.understood[0], q).toBe("East Bergen Conference Northern League Tournament · Winning alliance");
      expect(a.understood?.unread ?? [], q).toEqual([]);
    }
    expect((await full("east bergen conference winnng")).didYouMean).toBe("east bergen conference winning");
    // A winner word beside a team's name is never an event's ("bad wolf winner").
    expect((await full("bad wolf winner")).intent?.kind ?? "").not.toBe("stat-winning-alliance");
  });
  it("letters jumbled: \"appreacne\" is \"appearance\" (7149, 4215, 23268)", async () => {
    for (const [t, name] of [[7149, "enforcers"], [4215, "hypnotic robotics"], [23268, "ultraviolet"]] as const) {
      const a = await full(`${name} worlds appreacne`);
      expect(a.didYouMean).toBe(`${name} worlds appearance`);
      expect(a.card).toMatchObject({ kind: "worlds", title: "Worlds appearances", team: { number: t } });
    }
    const v = buildVocab([{ name: "Appear Robotics", city: null, state: null }], []);
    expect(correctWord("appreacne", v)?.word).toBe("appearance");
    // A name's word is never reached by a jumble, only search's own words.
    expect(correctWord("robotisc", buildVocab([{ name: "Robotisc Robots", city: null, state: null }], []))).toBeNull();
  });
  it("a query cut off mid-word is read without it, a trip question as the Worlds one (7149, 4215, 23268)", async () => {
    for (const [t, name] of [[7149, "enforcers"], [4215, "hypnotic robotics"], [23268, "ultraviolet"]] as const) {
      const a = await full(`when was the first time ${name} whe`);
      expect(a.step).toBe("did-you-mean");
      expect(a.didYouMean).toBe(`when was the first time ${name} went to worlds`);
      expect(a.card).toMatchObject({ title: "Worlds appearances", team: { number: t } });
    }
  });
  it("a stray last word of four letters no word search knows is read without it (failed-search #1162; held out)", async () => {
    for (const [t, name] of [[7149, "enforcers"], [23268, "ultraviolet"]] as const) {
      const a = await full(`when did ${name} go to worlds pqzt`);
      expect(a.step).toBe("did-you-mean");
      expect(a.didYouMean).toBe(`when did ${name} go to worlds`);
      expect(a.card).toMatchObject({ title: "Worlds appearances", team: { number: t } });
    }
  });
});

describe("a Worlds trip names its season's game", () => {
  it("the first and last trip's headline: years, game and division (4215, 23268, 7149)", async () => {
    const cases: [string, string, number][] = [
      ["when was the last time 4215 went worlds", "Last went to Worlds in 2023–24 · CENTERSTAGE, Edison Division", 2023],
      ["when was the first time 23268 went to worlds", "First went to Worlds in 2023–24 · CENTERSTAGE, Edison Division", 2023],
      ["when was the first time 7149 went to worlds", "First went to Worlds in 2023–24 · CENTERSTAGE, Edison Division", 2023],
      ["when was the last time 7149 went worlds", "Last went to Worlds in 2025–26 · DECODE, Ross Division", 2025],
    ];
    for (const [q, headline, season] of cases) {
      const a = await full(q);
      expect(a.card?.headline, q).toBe(headline);
      expect(a.card?.trip?.season, q).toBe(season);
    }
    // Each trip's line carries its game, for the card's season line.
    const lines = (await full("enforcers worlds appearances")).card!.lines;
    expect(lines.map((l) => l.game)).toEqual(["CENTERSTAGE", "DECODE"]);
  });
});

describe("a bare number with no team", () => {
  it("is a no-match card with the closest real team numbers, never an empty page", async () => {
    for (const q of ["4", "6", "8", "9", "676767"]) {
      const a = await full(q);
      expect(a.step, q).toBe("did-you-mean");
      expect(a.hits.length, q).toBeGreaterThan(0);
      expect(a.understood?.label, q).toMatch(new RegExp(`^No team ${q}: the closest team numbers?$`));
      expect(a.didYouMean, q).toBe(a.hits[0].ref);
    }
    // One key away first; with none, the nearest numbers of teams that have played.
    expect((await full("8")).hits.map((h) => h.ref)).toContain("7");
    expect((await full("676767")).hits[0].ref).toBe("38702");
  });
  it("with what was asked of it: the closest team numbers, the question offered with the closest one", async () => {
    const a = await full("676767 auto");
    // Offered, not run: the list is the closest teams, not that question's answer.
    expect(a.step).toBe("deterministic");
    expect(a.understood?.label).toMatch(/^No team 676767: the closest team numbers?$/);
    expect(a.hits[0].ref).toBe("38702");
    expect(a.didYouMean).toBe("38702 auto");
  });
});

describe("leaderboard sorts in plain words", () => {
  it("reads the sort, the phase and the direction", () => {
    expect(readLeaderboard("what is the best team sorted by auto")).toMatchObject({ kind: "top", stat: "auto", n: 10 });
    expect(readLeaderboard("best auto sorted lowest to highest")).toMatchObject({ stat: "auto", asc: true });
    expect(readLeaderboard("teleop ranked")).toMatchObject({ stat: "teleop" });
    expect(readLeaderboard("endgame ranked high to low")?.asc).toBeUndefined();
    expect(readLeaderboard("best auto right and endgame")).toMatchObject({ stat: "auto+endgame" });
    // Directions that start like a place ("in ascending order", "from the bottom") stay directions, with or without a place.
    expect(readLeaderboard("auto in ascending order")).toMatchObject({ stat: "auto", asc: true });
    expect(readLeaderboard("teleop from the bottom")).toMatchObject({ stat: "teleop", asc: true });
    expect(readLeaderboard("auto lowest to highest in nj")).toMatchObject({ stat: "auto", asc: true, region: { key: "USA:NJ" } });
    expect(readLeaderboard("teleop ranked in new jersey in ascending order")).toMatchObject({ stat: "teleop", asc: true, region: { key: "USA:NJ" } });
    expect(readLeaderboard("teleop ranked in nowhereville")).toBeNull();
    // A plain "best auto" stays the asks' own; a team's rank is a team's.
    expect(readLeaderboard("best auto")).toBeNull();
    expect(readLeaderboard("4215 ranked")).toBeNull();
  });
  it("the phase-OPR boards, ascending when asked", async () => {
    const top = await ask("what is the best team sorted by auto");
    expect(top.title).toBe("Top 10 teams by Auto OPR worldwide · 2025–26");
    const rows = (b: StatAnswer) => (b.blocks.find((x) => x.kind === "leaderboard") as { rows: { team: { label: string }; value: number; rank: number }[] }).rows;
    expect(rows(top).slice(0, 3).map((r) => r.team.label)).toEqual(["10809 Crow Force", "20265 Heart of RoBots", "23268 Ultraviolet"]);
    const low = await ask("best auto sorted lowest to highest");
    expect(low.title).toBe("Lowest 10 teams by Auto OPR worldwide · 2025–26");
    expect(rows(low).map((r) => r.value).slice(0, 3)).toEqual([5, 10, 25]);
    expect(rows(low)[0].rank).toBe(7);
    expect((low.blocks.find((x) => x.kind === "leaderboard") as { more?: { href: string } }).more?.href).toMatch(/&dir=asc(&|$)/);
    expect(rows(await ask("teleop ranked"))[0].team.label).toBe("7149 ENFORCERS");
    expect(rows(await ask("endgame ranked"))[0].team.label).toBe("30030 Exodus");
  });
  it("two phases joined are their OPRs added", async () => {
    const a = await full("best auto right and endgame");
    expect(a.stat?.title).toBe("Top 10 teams by Auto + Endgame OPR worldwide · 2025–26");
    expect(a.understood?.unread ?? []).toEqual([]);
    const board = a.stat!.blocks.find((x) => x.kind === "leaderboard") as { rows: { team: { label: string }; value: number }[] };
    expect(board.rows.slice(0, 3).map((r) => [r.team.label, r.value])).toEqual([["20265 Heart of RoBots", 80], ["23268 Ultraviolet", 70], ["10809 Crow Force", 65]]);
  });
  it("\"what is the bet\", \"what is the best time\": did you mean the best team", async () => {
    expect(bestFix("what is the bet")).toBe("what is the best team");
    expect(bestFix("what is the best time")).toBe("what is the best team");
    expect(bestFix("who is the bets")).toBe("who is the best team");
    expect(bestFix("what is the best")).toBeNull();
    expect(bestFix("what is the best team")).toBeNull();
    for (const q of ["what is the bet", "what is the best time", "who is the bets"]) expect((await full(q)).didYouMean, q).toMatch(/is the best team$/);
    const shown = await full("what is the best time");
    expect(shown.step).toBe("did-you-mean");
    expect(shown.stat?.family ?? shown.card?.kind).toBe("leaderboard");
  });
});

describe("a rating change with no team", () => {
  it("asks for the team, with the season's top-rated teams' own questions", async () => {
    for (const q of ["predicted changes", "prediction rating change", "rating change"]) {
      const a = await full(q);
      expect(a.card?.title, q).toBe("A prediction rating change is one team's: name the team");
      expect(a.card?.lines.slice(0, 3).map((l) => l.text), q).toEqual(["20265 Heart of RoBots: rating change", "10809 Crow Force: rating change", "4215 Hypnotic Robotics: rating change"]);
    }
  });
  it("with a team, \"predicted change\" is its rating change (4215, 6980, 23268)", async () => {
    for (const [t] of NJ_TEAMS) expect((await full(`${t} predicted change`)).intent?.kind).toBe("stat-rating-change");
  });
});

describe("an event the team didn't play: the reason, and its real events", () => {
  it("no state championship: the events it did play, by kind, linked (6980, 33950)", async () => {
    const r = await ask("6980 matches at states");
    expect(r.none).toBe("Bad Wolf (6980) has no state championships on record, so it has no matches, rank or awards there. Its 2025–26 events, below, were 1 league meet and 1 league tournament.");
    expect(r.blocks[0]).toMatchObject({ kind: "links", title: "Its events in 2025–26", items: [{ label: "P1-2 Northern League Meet", href: "/events/2025/USNJNOM1?team=6980" }, { label: "East Bergen Conference Northern League Tournament" }] });
    expect((await ask("33950 matches at states")).none).toMatch(/Its 2025–26 events, below, were 1 league tournament\.$/);
  });
  it("a team from elsewhere: said so (10809, 30030, 20265)", async () => {
    for (const [t, who, from] of [[10809, "Crow Force", "California"], [30030, "Exodus", "Texas"], [20265, "Heart of RoBots", "Romania"]] as const) {
      const r = await ask(`${t} opr at the new jersey championship`);
      expect(r.none).toBe(`${who} (${t}) didn't play at New Jersey Championship in 2025–26, so it has no matches, rank or awards there. It's a team from ${from}, and New Jersey Championship is New Jersey's. Its 2025–26 events are below.`);
      expect(r.blocks[0]).toMatchObject({ kind: "links", items: [{ href: expect.stringMatching(new RegExp(`\\?team=${t}$`)) }] });
    }
  });
  it("a team with no events that season: its latest season's, linked (20205)", async () => {
    const r = await ask("20205 opr at the new jersey championship");
    expect(r.none).toBe("Chaotic Pioneers (20205) didn't play at New Jersey Championship in 2025–26, so it has no matches, rank or awards there. It has no official events on record in 2025–26. Its 2024–25 events, its latest season with any, are below.");
    expect(r.blocks).toEqual([expect.objectContaining({ kind: "links", title: "Its events in 2024–25", items: [expect.objectContaining({ label: "Deep South Conference Southern League Tournament" })] })]);
  });
});
