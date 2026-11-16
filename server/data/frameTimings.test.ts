import { afterEach, describe, expect, it } from "vitest";
import { frameConfidence, frameOpen, frameStart, hasFrames, plausibleStarts, setFrameTimingsForTests } from "./frameTimings";

afterEach(() => setFrameTimingsForTests([]));

describe("frame timings the server plays from", () => {
  it("never plays two starts closer than a match: both are left out", () => {
    // USTXNISLT's older read: Q34 at 17908, Q33 at 17978 (70 s on), Q35 at 18115 (137 s on).
    expect(plausibleStarts({ Q32: 17500, Q34: 17908, Q33: 17978, Q35: 18115, Q36: 18500 })).toEqual({ Q32: 17500, Q36: 18500 });
    setFrameTimingsForTests([{ videoId: "v", code: "E", checked: "2026-11-14", starts: { Q34: 17908, Q33: 17978, Q36: 18500 } }]);
    expect(frameStart("v", "E", "Q33")).toBeNull();
    expect(frameStart("v", "E", "Q34")).toBeNull();
    expect(frameStart("v", "E", "Q36")).toBe(18500);
    // Nor is a left-out start given a confidence: it never becomes a clip.
    expect(frameConfidence("v", "E", "Q33")).toBeNull();
    expect(frameConfidence("v", "E", "Q36")).toBe("high");
  });
  it("plays two close starts where the recording cut the first short and each clip opens on its own match", () => {
    // USTXSASQ 2025: the stream cuts from Q14 at 1:07 to Q13's results, then Q15, 151 s after Q14 began.
    const starts = { Q14: 7838, Q15: 7989 };
    expect(plausibleStarts(starts, { Q14: 7826, Q15: 7977 })).toEqual(starts);
    // Without both openings checked, or closer than a cut can explain, they overlap as before.
    expect(plausibleStarts(starts, { Q14: 7826 })).toEqual({});
    expect(plausibleStarts({ Q14: 7838, Q15: 7900 }, { Q14: 7826, Q15: 7888 })).toEqual({});
    setFrameTimingsForTests([{ videoId: "v", code: "E", checked: "2026-11-16", starts, opens: { Q14: 7826, Q15: 7977 } }]);
    expect(frameStart("v", "E", "Q14")).toBe(7838);
    expect(frameStart("v", "E", "Q15")).toBe(7989);
  });
  it("counts a video as framed only with a start it can play", () => {
    setFrameTimingsForTests([{ videoId: "v", code: "E", checked: "2026-11-14", starts: {}, missing: { Q1: "no frame of the video could be read" } }]);
    expect(hasFrames("v", "E")).toBe(false);
  });
  it("plays a checked row's starts only where the clip's opening frame names the match, and opens there", () => {
    // Q1 opened on its own overlay 12 s before its start; Q2's opening couldn't be checked: not a clip.
    setFrameTimingsForTests([{ videoId: "v", code: "E", checked: "2026-11-15", starts: { Q1: 1000, Q2: 1500 }, opens: { Q1: 988 } }]);
    expect(frameStart("v", "E", "Q1")).toBe(1000);
    expect(frameOpen("v", "E", "Q1")).toBe(988);
    expect(frameStart("v", "E", "Q2")).toBeNull();
    expect(frameConfidence("v", "E", "Q2")).toBeNull();
    // A live start whose opening frame named nothing (--verify) keeps playing until it's read again.
    setFrameTimingsForTests([{ videoId: "v", code: "E", checked: "2026-11-14", starts: { Q1: 1000, Q2: 1500 }, opens: { Q1: 988 }, unconfirmed: ["Q2"] }]);
    expect(frameStart("v", "E", "Q2")).toBe(1500);
    expect(frameOpen("v", "E", "Q2")).toBeNull();
    // A row from before the opening check (no opens) plays as it did.
    setFrameTimingsForTests([{ videoId: "v", code: "E", checked: "2026-11-14", starts: { Q1: 1000 } }]);
    expect(frameStart("v", "E", "Q1")).toBe(1000);
    expect(frameOpen("v", "E", "Q1")).toBeNull();
  });
});
