// What Bruno knows about the events a Discord message names (server/api/brunoEvents.ts), on a database: the audit's
// Q68 (two events compared), Q74 (NJ teams at Worlds 2025 vs 2026), Q76/Q85/Q87 (NJ States' teams by their numbers
// there), Q88 (the next NJ meet) and Q92 (NJ States' teams never at Worlds) had nothing to answer from.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run } from "../db";
import { setDb } from "../db";
import { CURRENT_SEASON } from "../data/seasons";
import { eventDossier, namedEvents } from "./brunoEvents";

const NOW_S = CURRENT_SEASON, LAST = CURRENT_SEASON - 1, BEFORE = CURRENT_SEASON - 2;
const NOW = Date.parse(`${NOW_S}-11-24T12:00:00Z`);
const key = (e: { season: number; code: string }) => `${e.season}:${e.code}`;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run(`INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES
    (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA', 2010), (6980, 'Bad Wolf', 'Oradell', 'NJ', 'USA', 2013),
    (7149, 'Enforcers', 'Edison', 'NJ', 'USA', 2009), (24033, 'Alphatronic', 'Edison', 'NJ', 'USA', 2023),
    (16000, 'Far Away', 'Bucharest', NULL, 'Romania', 2019)`);
  const ev = (season: number, code: string, name: string, type: string, start: string, division: string | null = null, league: string | null = null, state = "NJ") =>
    run("INSERT INTO events (season, code, name, type, division_code, league, region, city, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, ?, 'USNJ', 'Hillsborough', ?, 'USA', ?, ?, 'first')", [season, code, name, type, division, league, state, start, start]);
  await ev(LAST, "USNJCMP", "New Jersey Championship", "Championship", `${NOW_S}-03-15`);
  await ev(LAST, "USNJCMPPKWY", "New Jersey Championship - Parkway Division", "Championship", `${NOW_S}-03-15`, "USNJCMP");
  await ev(LAST, "USNJCMPTRPK", "New Jersey Championship - Turnpike Division", "Championship", `${NOW_S}-03-15`, "USNJCMP");
  await ev(NOW_S, "USNJCMP", "New Jersey Championship", "Championship", `${NOW_S + 1}-03-14`);
  await ev(NOW_S, "USNJNOM2", "P1-7 Northern League Meet", "LeagueMeet", `${NOW_S}-11-28`, null, "NO");
  await ev(NOW_S, "USNJNOM1", "P1-4 Northern League Meet", "LeagueMeet", `${NOW_S}-11-07`, null, "NO");
  await ev(NOW_S, "USOHLEM1", "Lake Erie League Meet", "LeagueMeet", `${NOW_S}-11-08`, null, "LE", "OH");
  await ev(BEFORE, "FTCCMP1", "FIRST Championship - FIRST Tech Challenge", "FIRSTChampionship", `${NOW_S - 1}-04-15`);
  await ev(BEFORE, "FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "FIRSTChampionship", `${NOW_S - 1}-04-15`, "FTCCMP1");
  await ev(LAST, "FTCCMP1", "FIRST Championship - FIRST Tech Challenge", "FIRSTChampionship", `${NOW_S}-04-29`);
  await ev(LAST, "FTCCMP1ROSS", "FIRST Championship - FIRST Tech Challenge - Ross Division", "FIRSTChampionship", `${NOW_S}-04-29`, "FTCCMP1");
  await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties) VALUES (?, 'USNJCMPPKWY', 4215, 3, 4, 1, 0), (?, 'USNJCMPPKWY', 6980, 9, 2, 3, 0), (?, 'USNJCMPTRPK', 7149, 1, 5, 0, 0), (?, 'USNJCMPTRPK', 24033, 12, 1, 4, 0)", [LAST, LAST, LAST, LAST]);
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches, wins, losses, ties) VALUES (?, 'USNJCMPPKWY', 4215, 101.64, 28.28, 73.37, 5.55, 5, 4, 1, 0), (?, 'USNJCMPPKWY', 6980, 60.15, 30.05, 30.1, 4.0, 5, 2, 3, 0), (?, 'USNJCMPTRPK', 7149, 90.8, 29.8, 61.0, 4.4, 5, 5, 0, 0), (?, 'USNJCMPTRPK', 24033, 40.0, 10.0, 30.0, 2.0, 5, 1, 4, 0)", [LAST, LAST, LAST, LAST]);
  await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, blue_total, source) VALUES (?, 'USNJCMPPKWY', 'qual', 0, 1, 'Q1', 1, 150, 120, 'first'), (?, 'USNJCMPTRPK', 'qual', 0, 1, 'Q1', 1, 324, 100, 'first')", [LAST, LAST]);
  // Worlds: 7149 in both seasons, 4215 once; 16000 is from Romania.
  await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'FTCCMP1EDIS', 7149), (?, 'FTCCMP1EDIS', 4215), (?, 'FTCCMP1EDIS', 16000), (?, 'FTCCMP1ROSS', 7149)", [BEFORE, BEFORE, BEFORE, LAST]);
  await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, blue_total, source) VALUES (?, 'FTCCMP1EDIS', 'qual', 0, 1, 'Q1', 1, 400, 300, 'first'), (?, 'FTCCMP1ROSS', 'qual', 0, 1, 'Q1', 1, 500, 410, 'first')", [BEFORE, LAST]);
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches, wins, losses, ties) VALUES (?, 'FTCCMP1EDIS', 7149, 150, 40, 100, 10, 10, 8, 2, 0)", [BEFORE]);
  // The northern league has played one meet this season; the next has nobody entered yet.
  await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'USNJNOM1', 4215), (?, 'USNJNOM1', 6980)", [NOW_S, NOW_S]);
  await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches, wins, losses, ties, events) VALUES (?, 4215, 16.02, 1.35, 14.68, 5.55, 5, 2, 3, 0, 1), (?, 6980, 11.26, 0.15, 11.11, 4.89, 6, 2, 4, 0, 1)", [NOW_S, NOW_S]);
});

describe("which events a message names", () => {
  it("reads NJ States as the latest played New Jersey Championship, and the one still ahead", async () => {
    for (const q of ["who should 24033 pick at nj states", "what if 4215 allied with 6980 at nj states, who wins", "rank the teams at NJ States by auto OPR in a table"]) {
      expect((await namedEvents(q, NOW)).map(key)).toEqual([`${LAST}:USNJCMP`, `${NOW_S}:USNJCMP`]);
    }
  });

  it("keeps Worlds out of 'NJ States teams never at Worlds', and reads 'Worlds 2025' by the year it was played", async () => {
    expect((await namedEvents("which teams at nj states have never been to worlds", NOW)).map(key)).toEqual([`${LAST}:USNJCMP`, `${NOW_S}:USNJCMP`]);
    expect((await namedEvents("how many teams in new jersey: worlds 2025 against worlds 2026", NOW)).map(key).sort()).toEqual([`${BEFORE}:FTCCMP1`, `${LAST}:FTCCMP1`].sort());
    expect((await namedEvents("how did hypno do at worlds", NOW)).map(key)).toEqual([`${LAST}:FTCCMP1`]);
  });

  it("finds the next NJ meet, an event by its own name, and nothing in a plain team question", async () => {
    expect((await namedEvents("who should i watch at the next nj meet and why", NOW)).map(key)).toEqual([`${NOW_S}:USNJNOM2`]);
    expect((await namedEvents("compare the lake erie league meet v the new jersey championship", NOW)).map(key)).toContain(`${NOW_S}:USOHLEM1`);
    expect(await namedEvents("what is 4215's opr", NOW)).toEqual([]);
    expect(await namedEvents("is ohio good at robotics", NOW)).toEqual([]);
  });
});

describe("an event's block", () => {
  it("lists every team there, divisions read whole, with the site's rounding, the season said, and who's been to Worlds", async () => {
    const [nj] = await namedEvents("nj states", NOW);
    const d = (await eventDossier(nj)).join("\n");
    expect(d).toContain(`New Jersey Championship, ${seasonLabel(LAST)} (last season): a championship`);
    expect(d).toContain("4 teams in 2 divisions (Parkway Division, Turnpike Division)");
    expect(d).toContain("highest alliance score 324");
    // In order of event OPR, phases half up (6980's auto 30.05 is 30.1; 4215's endgame 5.55 is 5.6), each team's division.
    expect(d).toMatch(/4215 Hypnotic Robotics 101\.6 \(A 28\.3, T 73\.4, E 5\.6\), rank 3 in Parkway Division, 4-1-0; 7149 Enforcers 90\.8 .*; 6980 Bad Wolf 60\.2 \(A 30\.1/);
    expect(d).toContain("To weigh a what-if alliance at New Jersey Championship, add its teams' event OPRs");
    expect(d).toContain(`who have played at Worlds (the FIRST Championship), with the seasons: 4215 (${seasonLabel(BEFORE)}); 7149 (${seasonLabel(BEFORE)}, ${seasonLabel(LAST)})`);
    expect(d).toContain("who have never played at Worlds: 6980; 24033.");
  });

  it("counts Worlds' teams by US state or country, first", async () => {
    const [w] = (await namedEvents("worlds 2025", NOW)).filter((e) => e.season === BEFORE);
    const d = await eventDossier(w);
    expect(d[1]).toContain("by home: US state, or country outside the USA: New Jersey 2; Romania 1.");
  });

  it("an unentered league meet is read by its league's teams and their season so far", async () => {
    const [m] = await namedEvents("next nj meet", NOW);
    const d = (await eventDossier(m)).join("\n");
    expect(d).toContain("Not played yet.");
    expect(d).toContain(`No teams are entered in P1-7 Northern League Meet, ${seasonLabel(NOW_S)} (this season) yet; its league's teams, by their ${seasonLabel(NOW_S)} (this season) season OPR so far`);
    expect(d).toContain("4215 Hypnotic Robotics 16.0 (A 1.4, T 14.7, E 5.6); 6980 Bad Wolf 11.3 (A 0.2,");
  });
});

function seasonLabel(s: number) { return `${s}–${String((s + 1) % 100).padStart(2, "0")}`; }
