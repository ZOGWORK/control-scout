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
