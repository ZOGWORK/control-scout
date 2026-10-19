// What a match record says in words (the /matches phone summary): the winner and margin, and the result
// against the prediction, never a flat 0% or 100%.
import { describe, expect, it } from "vitest";
import { matchOutcome } from "./matchOutcome";

const o = (stats: Record<string, number | null>) => matchOutcome({ stats });

describe("matchOutcome", () => {
  it("names the winner and the margin", () => {
    expect(o({ redTotalPoints: 120, blueTotalPoints: 100 })).toMatchObject({ played: true, winner: "red", margin: 20, headline: "Red won by 20", prediction: null });
    expect(o({ redTotalPoints: 80, blueTotalPoints: 95 })).toMatchObject({ winner: "blue", headline: "Blue won by 15" });
    expect(o({ redTotalPoints: 50, blueTotalPoints: 50 })).toMatchObject({ winner: null, headline: "Tie, 50–50" });
  });

  it("says when a match has no scores yet", () => {
    expect(o({ redTotalPoints: null, blueTotalPoints: null, redPredictedWinPct: 60 })).toMatchObject({
      played: false, winner: null, headline: "Not played yet", prediction: { verdict: "pending", favourite: "red", text: "Red favoured (60%), not played yet" },
    });
  });

  it("states the result against the prediction", () => {
    expect(o({ redTotalPoints: 120, blueTotalPoints: 100, redPredictedWinPct: 70 }).prediction).toMatchObject({ verdict: "called", text: "Red favoured (70%), Red won" });
    expect(o({ redTotalPoints: 120, blueTotalPoints: 100, redPredictedWinPct: 30 }).prediction).toMatchObject({ verdict: "upset", favourite: "blue", text: "Blue favoured (70%), Red won" });
    expect(o({ redTotalPoints: 90, blueTotalPoints: 90, redPredictedWinPct: 55 }).prediction).toMatchObject({ verdict: "tie", text: "Red favoured (55%), ended in a tie" });
    expect(o({ redTotalPoints: 90, blueTotalPoints: 80, redPredictedWinPct: 50 }).prediction).toMatchObject({ verdict: "even", favourite: null, text: "Even call (50% each), Red won" });
  });

  it("never shows a flat 0% or 100% chance", () => {
    expect(o({ redTotalPoints: 1, blueTotalPoints: 0, redPredictedWinPct: 99.99 }).prediction!.chance).not.toBe("100%");
    expect(o({ redTotalPoints: 1, blueTotalPoints: 0, redPredictedWinPct: 0.01 }).prediction!.chance).not.toBe("100%");
  });
});
