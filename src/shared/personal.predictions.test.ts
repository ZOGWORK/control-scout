// Saved predictions list each matchup once (the /predict "Your saved predictions" list showed one save twice):
// what localStorage holds is cleaned on read, an account merge keeps one, and saving again replaces the old one.
import { describe, expect, it } from "vitest";
import { cleanValue, dedupePredictions, mergeValue, type SavedPrediction } from "./personal";

const p = (id: string, red: number[], blue: number[], savedAt: number, season = 2026): SavedPrediction =>
  ({ id, season, red, blue, winProbRed: 0.6, predictedRed: 80, predictedBlue: 70, tier: "medium", savedAt });

describe("Saved predictions, one per matchup", () => {
  it("keeps the newest save of a matchup, whatever the team order inside an alliance", () => {
    const list = [p("a", [1, 2], [3, 4], 100), p("b", [5, 6], [7, 8], 300), p("c", [2, 1], [4, 3], 200)];
    expect(dedupePredictions(list).map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("keeps red-vs-blue and blue-vs-red apart, and seasons apart", () => {
    const list = [p("a", [1, 2], [3, 4], 100), p("b", [3, 4], [1, 2], 200), p("c", [1, 2], [3, 4], 300, 2025)];
    expect(dedupePredictions(list).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("cleans a stored list holding one save twice (what the device's localStorage had)", () => {
    const seeded = [p("x1", [16010, 21229], [19564, 19163], 2000), p("x2", [16010, 21229], [19564, 19163], 1000)];
    expect((cleanValue("predictionHistory", seeded) as SavedPrediction[]).map((x) => x.id)).toEqual(["x1"]);
  });

  it("an account merge lists a matchup saved on both devices (under two ids) once", () => {
    const account = { value: [p("acct", [1, 2], [3, 4], 100)], updatedAt: 1 };
    const local = { value: [p("dev", [1, 2], [3, 4], 200), p("other", [9, 10], [11, 12], 50)], updatedAt: 2 };
    expect(mergeValue("predictionHistory", account, local)!.value.map((x) => x.id)).toEqual(["dev", "other"]);
  });
});
