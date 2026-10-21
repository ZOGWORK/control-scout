// The adapter reaches four of the shared Forecaster's steps (input.ts): fail loudly if an engine
// release renames one, instead of projections quietly stopping.
import { describe, expect, it } from "vitest";
import { Forecaster } from "@control-scout/predict-engine";
import { STEPS } from "./input";

describe("projections/input.ts", () => {
  it("finds every Forecaster step it uses", () => {
    for (const k of STEPS) {
      if (k === "book") continue; // abstract: each app's forecaster supplies it (ScoutForecaster.book)
      expect(typeof (Forecaster.prototype as unknown as Record<string, unknown>)[k], k).toBe("function");
    }
  });
});
