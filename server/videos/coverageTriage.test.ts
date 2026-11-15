// Clip coverage triage on the live missing lists the owner brief names (Owner › Clip coverage, 2026-11-14): only an
// event a better check could still place is Actionable; "played before the broadcast started" never goes anywhere else
// on that reason alone (brief §6).
import { describe, expect, it } from "vitest";
import type { CoverageReason } from "../../src/shared/api";
import { baseTriage, seasonTriage, triageCoverage } from "./coverageTriage";

const CURRENT = 2026;
const many = (reason: CoverageReason, n: number) => Array.from({ length: n }, () => ({ reason }));

describe("clip coverage triage", () => {
  it("Flagstaff 2026 USAZFLQ, 15 of 26: 11 held back by an early start is Early start, not To review", () => {
    // Q3, Q5–Q6, Q8–Q9, Q13, Q15, Q19–Q20, M2, M4: "An early start would open on the match before (up to 5 min early)".
    const t = triageCoverage(2026, many("overlaps-previous", 11), CURRENT);
    expect(t.triage).toBe("early-start");
    expect(t.why).toBe("11 matches: An early start would open on the match before: not guessed, so no clip opens on the wrong match");
  });

  it("Glendale 2026 USAZGLQ1, 0 of 42 (its video unavailable): No timing, not To review", () => {
    const t = triageCoverage(2026, many("video-unavailable", 42), CURRENT);
    expect(t).toEqual({ triage: "no-timing", why: "42 matches: Video unavailable or private" });
  });

  it("most matches clipped, a few missing that the video may still hold: Actionable (AUSYQ2 2025, 42 of 53)", () => {
    // Q1 "Played before the broadcast started"; Q3–Q14, 10 of them, held back by an early start.
    const t = triageCoverage(2025, [...many("before-broadcast", 1), ...many("overlaps-previous", 10)], CURRENT);
    expect(t.triage).toBe("actionable");
    expect(t.why).toBe("1 match played before the broadcast started, by the clock: not yet checked against the video (10 more held back for other reasons)");
  });

  it("'played before the broadcast started' is never No timing, Early start or Old season on that reason alone", () => {
    for (const season of [2026, 2025, 2021]) {
      expect(triageCoverage(season, many("before-broadcast", 5), CURRENT).triage).toBe("actionable");
      expect(triageCoverage(season, [...many("before-broadcast", 1), ...many("video-unavailable", 40)], CURRENT).triage).toBe("actionable");
      expect(triageCoverage(season, [...many("after-broadcast", 1), ...many("overlaps-previous", 40)], CURRENT).triage).toBe("actionable");
    }
  });

  it("an older season than last is Old season, with its reason; last season isn't", () => {
    expect(triageCoverage(2022, many("gap-unplaced", 84), CURRENT)).toEqual({ triage: "old-season", why: "2022–23 season. 84 matches: Video shorter than its broadcast, missing time can't be placed" });
    expect(triageCoverage(2025, many("gap-unplaced", 84), CURRENT).triage).toBe("no-timing");
  });

  it("an early start that isn't most of the gap is No timing, naming the main reason and the rest", () => {
    // ROBUQ1 2022's shape, this season: 84 gap-unplaced, 27 held back by an early start.
    const t = triageCoverage(2026, [...many("gap-unplaced", 84), ...many("overlaps-previous", 27)], CURRENT);
    expect(t).toEqual({ triage: "no-timing", why: "84 matches: Video shorter than its broadcast, missing time can't be placed, and 27 more for other reasons" });
  });

  it("a match with no reason found stays Actionable", () => {
    expect(triageCoverage(2026, [{}], CURRENT).triage).toBe("actionable");
  });

  it("every reason that rests on the clock alone is Actionable, in any season, with wording that says so", () => {
    // Placed outside the video by comparing times only, never by looking at the video (brief §6): the same naive clock
    // comparison as before-broadcast, so the same category.
    const clock: [CoverageReason, string][] = [
      ["before-cut", "played before the video's first second, by the clock and its cut start: not yet checked against the video"],
      ["past-video-end", "played after the video's last second, by the clock: not yet checked against the video"],
      ["before-chapters", "played before the part its chapters confirm, by the clock: not yet checked against the video"],
      ["past-chapters", "played after the part its chapters confirm, by the clock: not yet checked against the video"],
      ["outside-span", "played outside every recording's time, by the clock: not yet checked against the video"],
    ];
    for (const [reason, words] of clock) {
      for (const season of [2026, 2025, 2021]) {
        const t = triageCoverage(season, [...many(reason, 2), ...many("video-unavailable", 30)], CURRENT);
        expect(t).toEqual({ triage: "actionable", why: `2 matches ${words} (30 more held back for other reasons)` });
      }
    }
  });

  it("what the video itself shows isn't Actionable: past the frames checked, an early start, no video", () => {
    for (const r of ["past-checked", "overlaps-previous", "video-unavailable", "no-recording-day"] as CoverageReason[]) {
      expect(triageCoverage(2026, many(r, 3), CURRENT).triage).not.toBe("actionable");
    }
  });

  it("an empty or missing list is Actionable: nothing says it's settled", () => {
    expect(triageCoverage(2026, [], CURRENT)).toEqual({ triage: "actionable", why: "No missing list to judge from: look at the event" });
    expect(triageCoverage(2021, [], CURRENT).triage).toBe("actionable");
  });

  it("Old season is decided when read, so it moves with the current season, and never hides Actionable", () => {
    const stored = baseTriage(many("gap-unplaced", 84));
    expect(stored.triage).toBe("no-timing");
    // 2024 is last season until the 2026 season starts: then it's Old season, without a recheck.
    expect(seasonTriage(stored, 2024, 2025).triage).toBe("no-timing");
    expect(seasonTriage(stored, 2024, 2026)).toEqual({ triage: "old-season", why: `2024–25 season. ${stored.why}` });
    expect(seasonTriage(baseTriage(many("before-broadcast", 1)), 2019, 2026).triage).toBe("actionable");
  });
});
