// The 260-query list asked of other teams than 4215 and 6980 (server/api/answers/): an event phrase that names several
// events reads the ones the team played. "NJ championship" is a team's own division (and the finals, when it played
// them), never 4215's Parkway Division; an AM and a PM meet of one name are read together; a team that played none
// of them is told so, the event checked named. A team number never fuzzy-matches a year.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { wordScore } from "../../../src/shared/fuzzy";
import { eventFit } from "./index";
import { clearAllCaches } from "../../caches";
import type { StatAnswer } from "../../../src/shared/searchStat";

const ask = async (q: string) => (await searchAnswer(q, { limit: 25, full: true })).stat as StatAnswer;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name, state] of [[4215, "Hypnotic Robotics", "NJ"], [23268, "Ultraviolet", "NJ"], [7149, "ENFORCERS", "NJ"], [207, "Critical Mass", "NJ"], [10809, "Crow Force", "CA"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (code: string, name: string, type: string, start: string, division: string | null = null, state = "NJ") =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (2025, ?, ?, ?, ?, 'Town', ?, 'USA', ?, ?, 't')", [code, name, type, division, state, start, start]);
  await ev("USNJCMP", "New Jersey Championship", "Championship", "2026-03-15");
  await ev("USNJCMPPKWY", "New Jersey Championship - Parkway Division", "Championship", "2026-03-15", "USNJCMP");
  await ev("USNJCMPTRPK", "New Jersey Championship - Turnpike Division", "Championship", "2026-03-15", "USNJCMP");
  await ev("USNJNOM2", "P1-4 AM Northern League Meet", "LeagueMeet", "2025-11-08");
  await ev("USNJNOM3", "P1-4 PM Northern League Meet", "LeagueMeet", "2025-11-08");
  await ev("USCALAQ1", "Los Angeles Qualifier", "Qualifier", "2026-01-10", null, "CA");
  // FIRST's 2025–26 Worlds is over: 2025–26 is the season a question with none named reads.
  await ev("FTCCMP1", "FIRST Championship", "FIRSTChampionship", "2026-04-29");
  let n = 0;
  const match = async (code: string, level: string, label: string, red: number, blue: number, reds: number[], blues: number[]) => {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, ?, 0, ?, ?, '2026-03-15T10:00:00Z', 1, ?, ?, ?, ?, 't')", [code, level, n, label, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, ?, ?, 0, ?, ?, ?, 1)", [code, level, n, t, a]);
    }
  };
  // Parkway: 4215 (rank 2). Turnpike: 23268 (rank 1) and 7149, who then play the finals.
  for (const [code, t, rank, opr] of [["USNJCMPPKWY", 4215, 2, 101.6], ["USNJCMPPKWY", 207, 1, 90], ["USNJCMPTRPK", 23268, 1, 146.5], ["USNJCMPTRPK", 7149, 2, 120], ["USNJCMP", 23268, null, null], ["USNJCMP", 7149, null, null]] as const) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, ?, ?, ?)", [code, t, rank]);
    if (opr != null) await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (2025, ?, ?, ?, 30, 60, 10, 2)", [code, t, opr]);
  }
  await match("USNJCMPPKWY", "qual", "Q1", 150, 90, [4215], [207]);
  await match("USNJCMPPKWY", "qual", "Q2", 80, 120, [4215], [207]);
  await match("USNJCMPTRPK", "qual", "Q1", 200, 100, [23268], [7149]);
  await match("USNJCMPTRPK", "qual", "Q2", 210, 110, [23268], [7149]);
  await match("USNJCMP", "playoff", "F1", 250, 240, [23268, 7149], [4215, 207]);
  // 4215 played both meets of one name, a match 1 at each.
  for (const code of ["USNJNOM2", "USNJNOM3"]) {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, ?, 4215, 3)", [code]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, ?, 4215, 50, 1)", [code]);
  }
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJNOM2', 'qual', 0, 1, 'Q1', '2025-11-08T10:00:00Z', 1, 60, 60, 40, 40, 't'), (2025, 'USNJNOM3', 'qual', 0, 1, 'Q1', '2025-11-08T15:00:00Z', 1, 30, 30, 70, 70, 't')");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJNOM2', 'qual', 0, 1, 4215, 'red', 1), (2025, 'USNJNOM3', 'qual', 0, 1, 4215, 'red', 1)");
  // A playoff M1 at each meet too.
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USNJNOM2', 'playoff', 1, 1, 'M1', '2025-11-08T12:00:00Z', 1, 90, 90, 80, 80, 't'), (2025, 'USNJNOM3', 'playoff', 1, 1, 'M1', '2025-11-08T17:00:00Z', 1, 70, 70, 75, 75, 't')");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJNOM2', 'playoff', 1, 1, 4215, 'red', 1), (2025, 'USNJNOM3', 'playoff', 1, 1, 4215, 'red', 1)");
  // A remote event 7149 was ranked at: left out of a team's event list, never "didn't play".
  await run("INSERT INTO events (season, code, name, type, remote, city, state, country, start, end, source) VALUES (2025, 'USNJRQ', 'Garden State Remote Qualifier', 'Qualifier', 1, 'Town', 'NJ', 'USA', '2026-01-20', '2026-01-20', 't')");
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJRQ', 7149, 1)");
  // Crow Force played in California only.
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USCALAQ1', 10809, 1)");
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'USCALAQ1', 10809, 180, 1)");
  await match("USCALAQ1", "qual", "Q1", 190, 100, [10809], [207]);
  // Any season, any event: [season, code, name, type, start, division].
  const evAt = (season: number, code: string, name: string, type: string, start: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, 'Town', 'NJ', 'USA', ?, ?, 't')", [season, code, name, type, division, start, start]);
  const playAt = async (season: number, code: string, level: string, number: number, label: string, red: number, blue: number, reds: number[], blues: number[]) => {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [season, code, level, number, label, `${season + 1}-03-01T10:00:00Z`, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, ?, 0, ?, ?, ?, 1)", [season, code, level, number, t, a]);
    }
  };
  // 4215's 2024–25 state championship: the Turnpike Division, rank 7.
  await evAt(2024, "USNJCMP", "New Jersey Championship", "Championship", "2025-03-16");
  await evAt(2024, "USNJCMPTRPK", "New Jersey Championship - Turnpike Division", "Championship", "2025-03-16", "USNJCMP");
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2024, 'USNJCMPTRPK', 4215, 7)");
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, opr_auto, opr_teleop, opr_endgame, matches) VALUES (2024, 'USNJCMPTRPK', 4215, 117.3, 30, 70, 17, 1)");
  await playAt(2024, "USNJCMPTRPK", "qual", 1, "Q1", 100, 120, [4215], [207]);
  // 7149's Worlds division, 2025–26.
  await ev("FTCCMP1ROSS", "FIRST Championship - FIRST Tech Challenge - Ross Division", "FIRSTChampionship", "2026-04-29", "FTCCMP1");
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'FTCCMP1ROSS', 7149, 19)");
  await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'FTCCMP1ROSS', 7149, 115.3, 1)");
  await match("FTCCMP1ROSS", "qual", "Q1", 180, 170, [7149], [23268]);
  // One venue stored spelled two ways: 4215 and 207 met at the misspelled one.
  await run("UPDATE events SET venue = 'River Dell High School', city = 'Oradell' WHERE season = 2025 AND code = 'USNJNOM2'");
  await run("UPDATE events SET venue = 'River Dale High School', city = 'Oradell' WHERE season = 2025 AND code = 'USNJNOM3'");
  await run("UPDATE events SET venue = 'River Dell High School', city = 'Oradell' WHERE season = 2025 AND code = 'USCALAQ1'");
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USCALAQ1', 207, 2)");
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USNJNOM3', 207, 5)");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USNJNOM3', 'qual', 0, 1, 207, 'blue', 1)");
  // One code, two events: USNJNELT2 was South Essex's tournament in 2024–25 and is East Bergen's in 2026–27 (not played
  // yet); East Bergen's 2025–26 tournament had its own code.
  await evAt(2024, "USNJNELT2", "South Essex Conference NE Edge League Tournament", "LeagueTournament", "2025-03-01");
  await evAt(2025, "USNJNOLT2", "East Bergen Conference Northern League Tournament", "LeagueTournament", "2026-02-21");
  await evAt(2026, "USNJNELT2", "East Bergen Conference Northeast League", "LeagueTournament", "2027-02-20");
  await playAt(2024, "USNJNELT2", "playoff", 1, "F1", 232, 193, [7149], [23268]);
  await playAt(2025, "USNJNOLT2", "playoff", 1, "F1", 188, 141, [4215, 207], [23268]);
  await run("INSERT INTO alliances (season, code, number, captain, pick1) VALUES (2024, 'USNJNELT2', 1, 7149, NULL), (2024, 'USNJNELT2', 2, 23268, NULL), (2025, 'USNJNOLT2', 1, 4215, 207), (2025, 'USNJNOLT2', 2, 23268, NULL)");
  await rebuildSearch();
});

describe("an event phrase reads the events the team played", () => {
  it("the team's own division, never another team's", async () => {
    const a = await ask("4215 matches at NJ championship");
    expect(a).toMatchObject({ title: "Results at New Jersey Championship - Parkway Division", headline: { value: "1-1-0" } });
  });
  it("a division and the finals it reached, read as one championship (23268's Turnpike Division)", async () => {
    for (const t of [23268, 7149]) {
      const r = await ask(`${t} matches at NJ championship`);
      expect(r.title).toBe("Results at New Jersey Championship (Turnpike Division and finals)");
      expect(r.headline).toMatchObject({ value: t === 23268 ? "3-0-0" : "1-2-0", label: "in 3 matches at New Jersey Championship (Turnpike Division and finals)" });
      expect(r.none).toBeUndefined();
    }
    // The division's matches come before the finals it fed, held the same day.
    const rows = (await ask("23268 matches at NJ championship")).blocks.find((b) => b.kind === "matches") as { rows: { event: { label: string } }[] };
    expect(rows.rows.at(-1)!.event.label).toBe("New Jersey Championship");
    expect(rows.rows[0].event.label).toBe("New Jersey Championship - Turnpike Division");
    expect((await ask("23268 record at NJ championship")).headline).toMatchObject({ value: "3-0-0" });
    // Rank and OPR are the division's: the finals rank only the alliances that reached them.
    expect((await ask("23268 rank at NJ championship")).headline).toMatchObject({ value: "#1 of 2" });
    expect((await ask("23268 opr at the New Jersey championship")).headline).toMatchObject({ value: "OPR 146.5" });
    // The division named outright is that division alone.
    expect((await ask("23268 matches at New Jersey Championship Turnpike")).title).toBe("Results at New Jersey Championship - Turnpike Division");
  });
  it("two meets of one name, read together; one match number at each is listed, never picked", async () => {
    const r = await ask("4215 record at P1-4 Northern League Meet");
    expect(r.title).toBe("Record at P1-4 AM Northern League Meet and P1-4 PM Northern League Meet");
    expect(r.headline).toMatchObject({ value: "2-2-0" });
    const m = await ask("4215 score in match 1 at P1-4 Northern League Meet");
    expect(m.blocks[0]).toMatchObject({ kind: "matches", title: "Match 1 at each event" });
    expect(m.blocks[0].kind === "matches" && m.blocks[0].rows).toHaveLength(2);
    const p = await ask("4215 score in match 1 in playoffs at P1-4 Northern League Meet");
    expect(p.blocks[0].kind === "matches" && p.blocks[0].rows.map((r) => r.label)).toEqual(["M1", "M1"]);
  });
  it("a remote event the team was ranked at is never said to be one it didn't play", async () => {
    expect((await ask("7149 rank at Garden State Remote Qualifier"))?.none ?? "").not.toMatch(/didn't play/);
  });
  it("a team that played none of them is told so, the event checked named, with its own events to ask about", async () => {
    for (const q of ["10809 matches at NJ championship", "10809 record at NJ championship", "10809 opr at the New Jersey championship"]) {
      const r = await ask(q);
      expect(r.none, q).toBe("Crow Force (10809) didn't play at New Jersey Championship in 2025–26, so it has no matches, rank or awards there. It's a team from California, and New Jersey Championship is New Jersey's. Its 2025–26 events are below.");
      expect(r.headline, q).toBeUndefined();
      expect(r.blocks[0], q).toMatchObject({ kind: "links", items: [{ label: "Los Angeles Qualifier", href: "/events/2025/USCALAQ1?team=10809" }] });
      expect(r.blocks[1], q).toMatchObject({ kind: "related", queries: [expect.stringContaining("los angeles qualifier")] });
    }
  });
});

describe("states, worlds and a team's own events (complex queries file)", () => {
  it("1, 45, 50, 51: states is the team's own state championship, the latest it played", async () => {
    for (const q of ["4215 matches at states", "4215 at states", "4215 state championship matches", "4215 New Jersey state championship matches"]) {
      const r = await ask(q);
      expect(r.title, q).toBe("Results at New Jersey Championship - Parkway Division");
      expect(r.blocks.find((b) => b.kind === "related"), q).toMatchObject({ queries: ["4215 matches at states in 2025"] });
    }
    // 55: a division and the finals it reached.
    expect((await ask("7149 matches at states")).title).toBe("Results at New Jersey Championship (Turnpike Division and finals)");
    // "Ever" is every season it played states, never only the latest.
    const ever = await ask("4215 matches at states ever");
    expect(ever.scope).toContain("All seasons");
    expect(ever.title).toBe("Matches at state championships");
    expect(ever.headline).toMatchObject({ value: "1-3-0", label: "in 4 matches at state championships" });
  });
  it("15, 33, 34, 52–54: a year is when the championship was held", async () => {
    for (const q of ["4215 matches at states in 2025", "4215 states 2025 matches"]) expect((await ask(q)).title, q).toBe("Results at New Jersey Championship - Turnpike Division");
    for (const q of ["4215 matches at states in 2026", "4215 states 2026 matches"]) expect((await ask(q)).title, q).toBe("Results at New Jersey Championship - Parkway Division");
  });
  it("47, 48, 60, 61, 58: states OPR, rank and record answer directly", async () => {
    expect((await ask("4215 states opr")).headline).toMatchObject({ value: "OPR 101.6" });
    expect((await ask("4215 state championship rank")).headline).toMatchObject({ value: "#2 of 2" });
    expect((await ask("4215 states wins and losses")).intent).toBe("record");
  });
  it("27, 56: a team with no state championship is told so", async () => {
    expect((await ask("10809 matches at states")).none).toMatch(/^Crow Force \(10809\) has no state championships on record/);
  });
  it("a state named with states is that state's, not the team's own elsewhere", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USCACMP', 'California Championship', 'Championship', 'Town', 'CA', 'USA', '2026-03-01', '2026-03-01', 't')");
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, 'USCACMP', 10809, 4)");
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USCACMP', 'qual', 0, 1, 'Q1', '2026-03-01T10:00:00Z', 1, 90, 90, 60, 60, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USCACMP', 'qual', 0, 1, 10809, 'red', 1)");
    clearAllCaches();
    try {
      expect((await ask("10809 matches at states")).title).toBe("Results at California Championship");
      expect((await ask("10809 New Jersey state championship matches")).none).toMatch(/^Crow Force \(10809\) has no New Jersey state championships on record/);
      expect((await ask("10809 california state championship matches")).title).toBe("Results at California Championship");
    } finally {
      for (const t of ["match_teams", "matches", "event_teams", "events"]) await run(`DELETE FROM ${t} WHERE season = 2025 AND code = 'USCACMP'`);
      clearAllCaches();
    }
  });
  it("32, 72, 73: Worlds is the latest completed season's, a division named is that division", async () => {
    for (const q of ["7149 matches at worlds", "7149 matches at worlds Ross division"]) {
      expect((await ask(q)).headline, q).toMatchObject({ value: "1-0-0", label: expect.stringMatching(/Ross Division$/) });
    }
  });
  it("20, 74: a date or a year with an event picks its season", async () => {
    expect((await ask("show me 4215's matches at the March 15 2026 NJ championship")).title).toBe("Results at New Jersey Championship - Parkway Division");
    expect((await ask("4215 matches at nj championship in 2025")).title).toBe("Results at New Jersey Championship - Turnpike Division");
  });
  it("42, 43, 44: league meets, and the team's own last and first event", async () => {
    expect((await ask("4215 matches at league meets this season")).title).toBe("Results at its 2025–26 league meets");
    expect((await ask("4215 matches at their last event")).title).toBe("Results at New Jersey Championship - Parkway Division");
    expect((await ask("4215 matches at their first event this season")).title).toMatch(/^Results at P1-4 (?:AM|PM) Northern League Meet$/);
  });
  it("19: a match type at an event", async () => {
    expect((await ask("4215's record in playoffs at nj championship")).title).toBe("Record in playoffs at New Jersey Championship - Parkway Division");
  });
});

describe("two teams at an event or a venue", () => {
  it("2, #622: one of them wasn't there, said so", async () => {
    const r = await ask("4215 and 10809 matches together at NJ championship");
    expect(r.none).toBe("Crow Force (10809) wasn't at New Jersey Championship - Parkway Division in 2025–26, so there are no matches together there. Hypnotic Robotics (4215) played it.");
    expect(r.blocks[0]).toMatchObject({ kind: "related" });
  });
  it("75: both there, their shared matches (division and finals)", async () => {
    const r = await ask("23268 and 7149 matches together at NJ championship");
    expect(r.headline).toMatchObject({ value: "3" });
  });
  it("#617–#620: a venue, partial or misspelled, with its other spellings in the same city", async () => {
    for (const q of ["4215 and 207 matches at river", "4215 and 207 matches at river dell", "4215 and 207 matches at river dell high schook"]) {
      const r = await ask(q);
      expect(r.title, q).toMatch(/River Dell High School/);
      expect(r.headline, q).toMatchObject({ value: "1" });
    }
    // The words after the teams still limit them: their one meeting there was a qualification match.
    const p = await ask("4215 and 207 matches at river dell in playoffs");
    expect(p.headline?.value ?? "0").toBe("0");
  });
  it("this season at an event is the season chosen, not an older one both teams played", async () => {
    // 4215's latest season is now 2026–27, a league meet only: the 2025–26 championship isn't this season's.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, 'USNJNOM9', 'Northern League Meet', 'LeagueMeet', 'Town', 'NJ', 'USA', '2026-11-01', '2026-11-01', 't')");
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2026, 'USNJNOM9', 'qual', 0, 1, 'Q1', '2026-11-01T10:00:00Z', 1, 90, 90, 60, 60, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2026, 'USNJNOM9', 'qual', 0, 1, 4215, 'red', 1)");
    clearAllCaches();
    try {
      const r = await searchAnswer("4215 and 207 matches together at nj championship this season", { limit: 25, full: true });
      expect(r.stat?.none).toBe("New Jersey Championship has no 2026–27 event on record, so Hypnotic Robotics (4215) and Critical Mass (207) have no matches together there in 2026–27.");
      expect(r.stat?.blocks[0]).toMatchObject({ queries: ["4215 and 207 matches together at nj championship in 2025–26"] });
      expect((await ask("4215 and 207 matches together at nj championship in 2025–26")).headline).toMatchObject({ value: "2" });
    } finally {
      for (const t of ["match_teams", "matches", "events"]) await run(`DELETE FROM ${t} WHERE season = 2026 AND code = 'USNJNOM9'`);
      clearAllCaches();
    }
  });
  it("another school in the same city is another venue", async () => {
    await run("UPDATE events SET venue = 'River Dell Middle School' WHERE season = 2025 AND code = 'USNJNOM3'");
    try {
      // Their one meeting was at USNJNOM3, now the middle school: the high school no longer takes it in.
      expect((await ask("4215 and 207 matches at river dell high school")).headline?.value ?? "0").toBe("0");
      const mid = await ask("4215 and 207 matches at river dell middle school");
      expect(mid.title).toMatch(/River Dell Middle School/);
      expect(mid.headline).toMatchObject({ value: "1" });
    } finally {
      await run("UPDATE events SET venue = 'River Dale High School' WHERE season = 2025 AND code = 'USNJNOM3'");
    }
  });
  it("4: no meeting at Worlds, the team with no Worlds matches named", async () => {
    expect((await ask("4215 vs 10809 at worlds who scored higher")).none).toMatch(/Crow Force \(10809\) has no matches at Worlds on record\./);
  });
});

describe("an event's distinctive words decide, and a reused code keeps its own name's seasons", () => {
  it("east bergen conference winning alliance: the East Bergen tournament, never South Essex's under the same code", async () => {
    const r = await ask("east bergen conference winning alliance");
    expect(r.scope).toContain("East Bergen Conference Northern League Tournament");
  });
  it("shared words never stand in for distinctive ones", () => {
    for (const [q, right, wrong] of [
      ["east bergen conference", "East Bergen Conference Northern League Tournament", "South Essex Conference NE Edge League Tournament"],
      ["northern league meet", "P3-6 Northern League Meet", "P2-8 Northeast League Meet"],
      ["parkway division", "New Jersey Championship - Parkway Division", "New Jersey Championship - Turnpike Division"],
    ]) {
      expect(eventFit(q, right), q).toBeGreaterThanOrEqual(0.75);
      expect(eventFit(q, wrong), q).toBeLessThan(0.75);
    }
  });
});

describe("a team number is never a year", () => {
  it("20205 isn't 2025 (a digit more), while a year still matches the next year's label", () => {
    expect(wordScore("20205", "2025")).toBe(0);
    expect(wordScore("20265", "2026")).toBe(0);
    expect(wordScore("20265", "2026bishkek")).toBe(0);
    expect(wordScore("2025", "2026")).toBeGreaterThan(0);
  });
});
