import { afterEach, describe, expect, it } from "vitest";
import { frameNextStart, frameStart, hasFrames, plausibleStarts, setFrameTimingsForTests } from "./frameTimings";

afterEach(() => setFrameTimingsForTests([]));

describe("frame timings the server plays from", () => {
  it("never plays two starts closer than a match: both are left out", () => {
    // USTXNISLT's older read: Q34 at 17908, Q33 at 17978 (70 s on), Q35 at 18115 (137 s on).
    expect(plausibleStarts({ Q32: 17500, Q34: 17908, Q33: 17978, Q35: 18115, Q36: 18500 })).toEqual({ Q32: 17500, Q36: 18500 });
    setFrameTimingsForTests([{ videoId: "v", code: "E", checked: "2026-11-14", starts: { Q34: 17908, Q33: 17978, Q36: 18500 } }]);
    expect(frameStart("v", "E", "Q33")).toBeNull();
    expect(frameStart("v", "E", "Q34")).toBeNull();
    expect(frameStart("v", "E", "Q36")).toBe(18500);
    // A clip ends at the next start that is played, not at a left-out one.
    expect(frameNextStart("v", 17000)).toBe(18500);
  });
  it("counts a video as framed only with a start it can play", () => {
    setFrameTimingsForTests([{ videoId: "v", code: "E", checked: "2026-11-14", starts: {}, missing: { Q1: "no frame of the video could be read" } }]);
    expect(hasFrames("v", "E")).toBe(false);
  });
});
