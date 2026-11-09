// States and provinces by their teams' average OPR (families/placeAverages.ts): the logged ask (failed-search #1056),
// the order, the floor of teams a place needs, and only US states and Canadian provinces.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { CURRENT_SEASON } from "../../data/seasons";
import { searchAnswer } from "../searchAnswer";
import { MIN_TEAMS, readPlaceAverage } from "./families/placeAverages";

const S = CURRENT_SEASON;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // [country, state, how many teams, OPR each]: New Jersey and Texas have enough teams; Kansas has a strong few; a
  // region outside the US and Canada is never a state here.
  const places: [string, string, number, number][] = [["USA", "NJ", MIN_TEAMS, 50], ["USA", "TX", MIN_TEAMS + 2, 30], ["USA", "KS", 3, 90], ["Kazakhstan", "ALA", MIN_TEAMS, 80]];
  let n = 1000;
  for (const [country, state, count, opr] of places) {
    for (let i = 0; i < count; i++, n++) {
      await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, ?)", [n, `Team ${n}`, state, country]);
      await run("INSERT INTO team_season_stats (season, team, opr_np, matches) VALUES (?, ?, ?, 10)", [S, n, opr]);
    }
  }
});

describe("states by average OPR", () => {
  it("reads the logged ask and its plain forms, highest first unless lowest is asked", () => {
    for (const q of ["which state has the highest average OPR", "Which state has the best average opr?", "states by average opr", "state with the highest average opr"]) {
      expect(readPlaceAverage(q), q).toMatchObject({ order: "desc" });
    }
    expect(readPlaceAverage("which state has the lowest average opr")).toMatchObject({ order: "asc" });
    // Not a ranking of places: a team's own average, or cities.
    expect(readPlaceAverage("4215 average opr")).toBeNull();
    expect(readPlaceAverage("which city has the most teams")).toBeNull();
  });

  it("ranks US states and Canadian provinces with enough teams by their mean OPR", async () => {
    const a = await searchAnswer("which state has the highest average OPR", { limit: 25, learn: false });
    expect(a.step).toBe("deterministic");
    const rows = (a.stat?.blocks?.find((b) => b.kind === "table") as { rows: { cells: Record<string, unknown> }[] }).rows;
    expect(rows.map((r) => r.cells.place)).toEqual(["New Jersey", "Texas"]);
    expect(rows.map((r) => r.cells.avg)).toEqual(["50.0", "30.0"]);
    expect(a.stat?.headline?.value).toBe("New Jersey");
    const low = await searchAnswer("which state has the lowest average opr", { limit: 25, learn: false });
    expect((low.stat?.blocks?.find((b) => b.kind === "table") as { rows: { cells: Record<string, unknown> }[] }).rows[0].cells.place).toBe("Texas");
  });
});
