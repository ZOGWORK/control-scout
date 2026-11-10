// Two alliances of two (allianceForecast): the engine's call for the lineup as named, red first, with Predict opened on
// it; with no forecaster ready, the ratings alone and never a made-up score.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../../db";

const explain = vi.fn();
let ready = true;
vi.mock("../../../predict/engine.js", () => ({
  readyForecaster: () => (ready ? Promise.resolve({ explain }) : null),
  recentRecords: async () => new Map(),
}));
vi.mock("../../../flags.js", () => ({ isEnabled: async () => true }));

const { allianceForecast, predictionSeasonOf } = await import("./predict");
const red = [{ number: 101, name: "Red One" }, { number: 102, name: "Red Two" }];
const blue = [{ number: 201, name: "Blue One" }, { number: 202, name: "Blue Two" }];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [team, rating, rank] of [[101, 90, 40], [102, 80, 60], [201, 120, 10], [202, 70, 90]]) {
    await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank) VALUES (2025, ?, ?, 3, ?)", [team, rating, rank]);
  }
});
beforeEach(() => {
  ready = true;
  explain.mockReset().mockReturnValue({
    winProbA: 0.39, predictedScoreA: 324, predictedScoreB: 344, confidence: { tier: "confident", reason: "Plenty of matches" },
  });
});

describe("allianceForecast", () => {
  it("asks the engine for the lineup as named and says its call", async () => {
    const s = await allianceForecast(red, blue, 2025);
    expect(explain).toHaveBeenCalledWith(2025, [101, 102], [201, 202], "qual", undefined, expect.any(Map));
    expect(s).toMatchObject({ intent: "alliance-predict", title: "Prediction: 101 & 102 vs 201 & 202 in 2025–26", split: 2 });
    expect(s.headline).toMatchObject({ value: "201 & 202 favoured", label: "61% to win · predicted 324–344", href: "/predict?mode=match&season=2025&red=101,102&blue=201,202" });
    const kpis = s.blocks.find((b) => b.kind === "kpis");
    expect(kpis?.kind === "kpis" && kpis.items.map((i) => i.value)).toEqual(["39%", "61%", "20 pts", "Confident"]);
    const table = s.blocks.find((b) => b.kind === "table");
    expect(table?.kind === "table" && table.rows.map((r) => [r.cells.team, r.cells.side])).toEqual([
      ["Red One (101)", "Red"], ["Red Two (102)", "Red"], ["Blue One (201)", "Blue"], ["Blue Two (202)", "Blue"],
    ]);
  });
  it("with no forecaster ready, the ratings alone: never a made-up score", async () => {
    ready = false;
    const s = await allianceForecast(red, blue, 2025);
    expect(explain).not.toHaveBeenCalled();
    expect(s.headline).toMatchObject({ value: "201 & 202 rated higher", label: "by 20.0 points per match together" });
    expect(JSON.stringify(s.blocks)).not.toMatch(/Predicted score/);
  });
  it("a team with no rating that season is named", async () => {
    const s = await allianceForecast(red, [blue[0], { number: 999, name: "Unrated" }], 2025);
    expect(s.none).toBe("No 2025–26 prediction rating for Unrated (999) yet.");
  });
});

describe("the season a prediction reads when none is named", () => {
  it("is the newest season every team has a rating in (what their team cards show), else the latest completed one", async () => {
    for (const team of [101, 201]) await run("INSERT INTO team_season_stats (season, team, rating_np, rating_sd, rating_rank) VALUES (2026, ?, 50, 9, 1)", [team]);
    expect(await predictionSeasonOf([101, 201])).toEqual({ season: 2026, why: "With no season named, the season is 2026–27, the latest season both teams have a prediction rating in, as their team cards show." });
    // One of them not rated in 2026–27 yet: the newest season both are.
    expect((await predictionSeasonOf([101, 202])).season).toBe(2025);
    expect((await predictionSeasonOf([101, 102, 201, 202])).why).toMatch(/latest season all 4 teams have a prediction rating in/);
  });
});
