// The scope's clauses (./clauses.ts): official events only for scores and records, except an event the question names
// itself ("26000 at APOC", an off-season event), whose own matches are the answer.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { eventInScope, officialClause, type Scope } from "./clauses";

const apoc = { season: 2025, code: "AUSYOS", type: "OffSeason" };
const nj = { season: 2025, code: "USNJCMP", type: "Championship" };

describe("officialClause", () => {
  it("keeps official events only when no event is named", () => {
    expect(officialClause()(apoc)).toBe(false);
    expect(officialClause()(nj)).toBe(true);
    expect(eventInScope({ season: 2025 })(apoc)).toBe(false);
  });

  it("keeps an off-season event the question names, and only that one", () => {
    const s: Scope = { season: 2025, event: { season: 2025, code: "AUSYOS", name: "APOC" } } as Scope;
    expect(eventInScope(s)(apoc)).toBe(true);
    expect(eventInScope(s)({ ...apoc, code: "AUOTHER" })).toBe(false);
    expect(eventInScope(s)(nj)).toBe(false);
  });
});

describe("an answer about a named off-season event", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    for (const [n, name] of [[26000, "Kookaburra Bots"], [26001, "Wombat Works"]] as const) {
      await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Sydney', 'NSW', 'Australia', 2022)", [n, name]);
      await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
    }
    for (const [code, name, type] of [["AUSYOS", "Asia Pacific Open Championship", "OffSeason"], ["AUNSWQ1", "New South Wales Qualifier", "Qualifier"], ["AUSCRIM", "Sydney Spring Scrimmage", "Scrimmage"]]) {
      await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, source) VALUES (2025, ?, ?, ?, 'Sydney', 'NSW', 'Australia', '2026-01-10', '2026-01-10', 'Australia/Sydney', 't')", [code, name, type]);
      await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, breakdown, source)
                 VALUES (2025, ?, 'qual', 0, 1, 'Q1', '2026-01-10T10:00:00', 1, 150, 150, 50, 80, 20, 0, 90, 90, 30, 40, 20, 0, 1, 't')`, [code]);
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, ?, 'qual', 0, 1, 26000, 'red')", [code]);
      await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties, qual_played) VALUES (2025, ?, 26000, 1, 1, 0, 0, 1)", [code]);
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, ?, 'qual', 0, 1, 26001, 'blue')", [code]);
      await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties, qual_played) VALUES (2025, ?, 26001, 2, 0, 1, 0, 1)", [code]);
    }
    await rebuildSearch();
  });

  it("its method says the event's own matches count; an official event's does not", async () => {
    const { NAMED_OFF_SEASON } = await import("./index");
    const off = await searchAnswer("26000 record at asia pacific open championship 2025-26", { learn: false, limit: 25 });
    expect(off.stat?.definition).toContain(NAMED_OFF_SEASON);
    const official = await searchAnswer("26000 record at new south wales qualifier 2025-26", { learn: false, limit: 25 });
    expect(official.stat?.definition ?? "").not.toContain(NAMED_OFF_SEASON);
  });

  it("a scrimmage named is called a scrimmage, never an off-season event", async () => {
    const { NAMED_OFF_SEASON, NAMED_SCRIMMAGE } = await import("./index");
    const a = await searchAnswer("26000 record at sydney spring scrimmage 2025-26", { learn: false, limit: 25 });
    expect(a.stat?.definition).toContain(NAMED_SCRIMMAGE);
    expect(a.stat?.definition).not.toContain(NAMED_OFF_SEASON);
  });

  it("two teams' meetings at a named off-season event say the exception too", async () => {
    const { NAMED_OFF_SEASON } = await import("./index");
    const a = await searchAnswer("26000 vs 26001 head to head at asia pacific open championship 2025-26", { learn: false, limit: 25 });
    expect(a.stat?.definition).toContain(NAMED_OFF_SEASON);
  });
});
