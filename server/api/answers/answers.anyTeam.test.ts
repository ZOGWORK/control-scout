// The 260-query list asked of other teams than 4215 and 6980 (server/api/answers/): an event phrase that names several
// events reads the ones the team played. "NJ championship" is a team's own division (and the finals, when it played
// them), never 4215's Parkway Division; an AM and a PM meet of one name are read together; a team that played none
// of them is told so, the event checked named. A team number never fuzzy-matches a year.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { wordScore } from "../../../src/shared/fuzzy";
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
      expect(r.none, q).toBe("Crow Force (10809) didn't play at New Jersey Championship in 2025–26, so it has no matches, rank or awards there. Its 2025–26 events are below.");
      expect(r.headline, q).toBeUndefined();
      expect(r.blocks[0], q).toMatchObject({ kind: "related", queries: [expect.stringContaining("los angeles qualifier")] });
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
