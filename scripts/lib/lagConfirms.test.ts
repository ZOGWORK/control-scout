import { describe, expect, it } from "vitest";
import { LAG_READS, lagConfirms } from "./videoFrames";

// USTXNONUAMM1 2026 Q22: Q21's final 0:00 card stays up until about 6416 s; Q22's own bar, read at 6425, runs from 6403.
describe("a bar late onto its match", () => {
  const read = (o: Partial<{ at: number; label: string | null; start: number | null; division: "own" | "other" | null }>) => ({ at: 6423, label: "Q22", start: 6403, division: null, ...o });

  it("is confirmed by a read into the match whose bar names it and runs from the same start", () => {
    expect(lagConfirms(read({}), 6423, "Q22", 6403, 6)).toBe(true);
    expect(lagConfirms(read({ start: 6408 }), 6423, "Q22", 6403, 6)).toBe(true);
  });

  it("isn't by a bar still on the match before, another start, a sibling division's, or a seek that didn't land", () => {
    expect(lagConfirms(read({ at: 6413, label: "Q21", start: null }), 6413, "Q22", 6403, 6)).toBe(false);
    expect(lagConfirms(read({ start: 6440 }), 6423, "Q22", 6403, 6)).toBe(false);
    expect(lagConfirms(read({ start: null }), 6423, "Q22", 6403, 6)).toBe(false);
    expect(lagConfirms(read({ division: "other" }), 6423, "Q22", 6403, 6)).toBe(false);
    expect(lagConfirms(read({ at: 6430 }), 6423, "Q22", 6403, 6)).toBe(false);
  });

  it("is read for well inside Auto and the switch, at most 30 s in", () => {
    expect(Math.max(...LAG_READS)).toBeLessThanOrEqual(30);
  });
});
