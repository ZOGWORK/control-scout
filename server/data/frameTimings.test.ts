import { afterEach, describe, expect, it } from "vitest";
import { frameConfidence, frameOpen, frameStart, hasFrames, outsideRecording, plausibleStarts, setFrameTimingsForTests } from "./frameTimings";

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

describe("a match proven not in the recording, from its first and last frames", () => {
  const quals = (n: number) => Array.from({ length: n }, (_, i) => `Q${i + 1}`);
  it("settles matches FTC Live counts as played when the recording opens (CABCVIQ2 2025: 4 / 23 at 0:00:03)", () => {
    const row = { opensOn: { at: 3, played: 4, of: 23 } };
    expect(outsideRecording(row, "Q4", quals(23))).toBe("played before the recording starts: at 0:00:03 it shows 4 of 23 matches played");
    expect(outsideRecording(row, "Q5", quals(23))).toBeNull();
  });
  it("settles matches before the first one it opens on, and after the last one it ends on", () => {
    // USORIMLT 2025 opens on the playoffs (M1); USTXSASQ 2025's recording ends on Q17.
    const order = [...quals(14), "M1", "M2"];
    expect(outsideRecording({ opensOn: { at: 20, label: "M1" } }, "Q14", order)).toMatch(/before the recording starts: it opens on M1 at 0:00:20/);
    expect(outsideRecording({ opensOn: { at: 20, label: "M1" } }, "M2", order)).toBeNull();
    expect(outsideRecording({ endsOn: { at: 8600, label: "Q17" } }, "Q18", quals(40))).toMatch(/after the recording ends: it ends on Q17 at 2:23:20/);
    expect(outsideRecording({ endsOn: { at: 8600, label: "Q17" } }, "Q17", quals(40))).toBeNull();
  });
  it("proves nothing from an opening read further in than its edge, or with no edge read", () => {
    expect(outsideRecording({ opensOn: { at: 720, label: "M1" } }, "Q3", [...quals(14), "M1"])).toBeNull();
    expect(outsideRecording({}, "Q3", quals(14))).toBeNull();
  });
});
