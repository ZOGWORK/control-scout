// How a stated range is described: its level and, when measured, how often such ranges really held (with the
// sample), never "8 in 10" as if that were measured.
import { describe, expect, it } from "vitest";
import { rangeCoverageLine, rangeSentence } from "./scoreRange";

const c = { season: 2026, label: "2026–27 BIOBUZZ", level: 0.8, live: { n: 5322, coverage: 0.9105599398722285 }, backtest: { n: 6450, coverage: 0.9344186046511628 } };

describe("range coverage", () => {
  it("states the live coverage with its sample, the replay's beside it, and which way it runs", () => {
    expect(rangeCoverageLine(c)).toBe("80% ranges have held 91.1% of 5,322 live alliance scores in 2026–27 BIOBUZZ (93.4% of 6,450 in its season replay), so they run wider than 80%.");
    expect(rangeCoverageLine({ ...c, live: { n: 100, coverage: 0.81 }, backtest: null })).toBe("80% ranges have held 81.0% of 100 live alliance scores in 2026–27 BIOBUZZ, close to the stated 80%.");
    expect(rangeCoverageLine({ ...c, live: { n: 100, coverage: 0.7 } })).toMatch(/so they run narrower than 80%\.$/);
    expect(rangeCoverageLine(null)).toBeNull();
  });
  it("a range's title says the stated level, and the measured coverage when known, never '8 in 10'", () => {
    expect(rangeSentence([104, 132], 0.8)).toBe("80% range 104–132");
    expect(rangeSentence([104, 132], 0.8, c)).toBe("80% range 104–132; 80% ranges have held 91.1% of 5,322 live alliance scores (2026–27 BIOBUZZ)");
  });
});
