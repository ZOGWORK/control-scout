import { afterEach, describe, expect, it } from "vitest";
import { clipCheck, clipCheckFindings, clipCheckTotals, clipPulled, setClipChecksForTests } from "./clipChecks";

afterEach(() => setClipChecksForTests([]));

describe("clock clips checked by their opening frame", () => {
  it("pulls only a clip whose first frame names another match; a blank one stays, to be read again", () => {
    setClipChecksForTests([{
      videoId: "v", code: "E", season: 2025, checked: "2026-11-15", ok: ["Q1"],
      pulled: { Q2: { t: 980, showed: "Q1" } }, unconfirmed: { Q3: { t: 1400, why: "no overlay at its first frame" } },
    }]);
    expect(clipCheck("v", "E", "Q1")).toEqual({ state: "ok" });
    expect(clipCheck("v", "E", "Q2")).toEqual({ state: "pulled", t: 980, showed: "Q1" });
    expect(clipPulled("v", "E", "Q2")).toBe(true);
    expect(clipPulled("v", "E", "Q3")).toBe(false);
    expect(clipCheck("v", "E", "Q9")).toBeNull();
    expect(clipCheck("other", "E", "Q1")).toBeNull();
    expect(clipCheckFindings()).toEqual([{ videoId: "v", season: 2025, code: "E", label: "Q2", t: 980, showed: "Q1" }]);
    expect(clipCheckTotals()).toEqual({ checked: 3, ok: 1, pulled: 1, unconfirmed: 1, noOverlayVideos: 0 });
  });

  it("counts a video with no readable overlay as can't be checked, and pulls none of it", () => {
    setClipChecksForTests([{ videoId: "old", code: "E", season: 2022, checked: "2026-11-15", noOverlay: true }]);
    expect(clipCheck("old", "E", "Q1")).toEqual({ state: "noOverlay" });
    expect(clipPulled("old", "E", "Q1")).toBe(false);
    expect(clipCheckTotals().noOverlayVideos).toBe(1);
  });
});
