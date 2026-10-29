import { describe, expect, it } from "vitest";
import { factorLabel } from "./factorLabel";

describe("factorLabel", () => {
  it("makes a 1-point gap singular", () => {
    expect(factorLabel("Red's autonomous is worth about 1 more points")).toBe("Red's autonomous is worth about 1 more point");
    expect(factorLabel("Blue tends to give away about 1 more penalty points than Red")).toBe("Blue tends to give away about 1 more penalty point than Red");
  });
  it("leaves other gaps and sentences alone", () => {
    expect(factorLabel("Red's autonomous is worth about 14 more points")).toBe("Red's autonomous is worth about 14 more points");
    expect(factorLabel("Red's autonomous is worth about 11 more points, mostly 1234")).toBe("Red's autonomous is worth about 11 more points, mostly 1234");
    expect(factorLabel("Endgame is about even")).toBe("Endgame is about even");
  });
});
