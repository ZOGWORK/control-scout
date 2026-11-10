// The match marked as not an official record, as search answers show it: a team's best score and the season's.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "../api/searchAnswer";
import type { StatAnswer, StatBlock } from "../../src/shared/searchStat";

const stat = async (q: string) => (await searchAnswer(q, { limit: 25, full: true })).stat as StatAnswer;
const matchRows = (a: StatAnswer) => a.blocks.filter((b): b is Extract<StatBlock, { kind: "matches" }> => b.kind === "matches").flatMap((b) => b.rows);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[23396, "Hivemind"], [24064, "Janktastrophe"], [17421, "Talon Tech"], [23509, "RoboRibbits"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NC', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'FPECAR', 'Carolinas Premier Event', 'Premier', 'Town', 'NC', 'USA', '2026-07-25', '2026-07-26', 't')");
  // Q49 (the marked one) and Q50, a lower score by the same teams.
  for (const [num, blueNp] of [[49, 714], [50, 300]] as const) {
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source)
      VALUES (2025, 'FPECAR', 'qual', 0, ?, ?, '2026-07-25T10:00:00Z', 1, 260, 205, 20, 175, 10, 10, ?, ?, 63, ?, 10, 55, 't')`, [num, `Q${num}`, blueNp + 10, blueNp, blueNp - 73]);
    for (const [t, a] of [[17421, "red"], [23509, "red"], [23396, "blue"], [24064, "blue"]] as const) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'FPECAR', 'qual', 0, ?, ?, ?, 1)", [num, t, a]);
    }
  }
  await rebuildSearch();
});

describe("a match that is not an official record, in answers", () => {
  it("a team's best score: the headline and its match box say so; the other match doesn't", async () => {
    const a = await stat("23396 highest score");
    expect(a.headline?.value).toBe("724 points");
    expect(a.headline?.sub).toMatch(/^Not an official record: /);
    const rows = matchRows(a);
    expect(rows.find((r) => r.label === "Q49")?.unofficial).toMatch(/^Not an official record: /);
    expect(rows.find((r) => r.label === "Q50")?.unofficial).toBeUndefined();
  });
  it("the season's best match: the headline and its match box say so", async () => {
    const a = await stat("highest scoring matches in decode");
    expect(a.headline?.sub).toMatch(/^Not an official record: /);
    expect(matchRows(a).find((r) => r.label === "Q49")?.unofficial).toMatch(/^Not an official record: /);
  });
  it("a narrowed best-score question (qualification matches only): its table row says so", async () => {
    const a = await stat("highest scoring qualifying matches in decode");
    const table = a.blocks.find((b): b is Extract<StatBlock, { kind: "table" }> => b.kind === "table")!;
    expect(table.rows.map((r) => r.cells.match)).toEqual(["Q49 (not an official record)", "Q50"]);
  });
});
