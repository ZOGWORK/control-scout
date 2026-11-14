import { describe, expect, it } from "vitest";
import { labelRanges, missingGroups } from "./coverage";

describe("labelRanges", () => {
  it("joins runs of one kind of match", () => {
    expect(labelRanges(["Q11", "Q12", "Q13", "Q15", "M1", "M2", "F1"])).toBe("Q11–Q13, Q15, M1–M2, F1");
    expect(labelRanges(["Q1"])).toBe("Q1");
    // In play order (Q2 replayed before Q1, Q13 late): sorted first.
    expect(labelRanges(["Q2", "Q1", "Q3", "M1", "Q13", "Q4"])).toBe("Q1–Q4, Q13, M1");
    expect(labelRanges([])).toBe("");
    // Replays sort right after their match and stand alone.
    expect(labelRanges(["M2", "M1-2", "M1", "SF1-1", "M3"])).toBe("M1, M1-2, M2–M3, SF1-1");
  });
});

describe("missingGroups", () => {
  it("groups the matches without a clip by video and reason, in order", () => {
    const m = (label: string, why: string | null, videoId: string | null = "v") => ({ key: label, label, date: null, clip: why == null, videoId, ...(why ? { why } : {}) });
    expect(missingGroups([m("Q1", "Gap"), m("Q2", null), m("Q3", "Gap"), m("Q4", "No recording for Sunday", null)])).toEqual([
      { why: "Gap", videoId: "v", labels: ["Q1", "Q3"] },
      { why: "No recording for Sunday", videoId: null, labels: ["Q4"] },
    ]);
  });
});

describe("missingSignature", () => {
  it("changes when which matches lack a video changes, not only how many", async () => {
    const { missingSignature } = await import("../components/contributors/RecordingGaps");
    const a = [{ key: "q1", clip: undefined, video: null, time: null }, { key: "q2", clip: { videoId: "v", t: 1, url: "" }, video: null, time: null }];
    const b = [{ key: "q1", clip: { videoId: "v", t: 1, url: "" }, video: null, time: null }, { key: "q2", clip: undefined, video: null, time: null }];
    expect(missingSignature(a)).not.toBe(missingSignature(b));
    expect(missingSignature(a)).toBe(missingSignature([...a]));
    // The same match still missing, now with its real start: asks again.
    expect(missingSignature([{ ...a[0], time: "2026-03-07T14:00:00" }, a[1]])).not.toBe(missingSignature([{ ...a[0], time: "2026-03-07T14:00:00.5" }, a[1]]));
  });
});
