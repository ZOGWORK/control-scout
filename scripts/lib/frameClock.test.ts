import { describe, expect, it } from "vitest";
import { DRAWN_TRACKER, drawnAt, lowQuality, shotSecond } from "./frameClock";

describe("drawnAt: the frame a screenshot shows is the seek's", () => {
  const seek = { t: 3100, n0: 500 };
  it("a frame drawn after the seek, at its second, is the seek's (playing and paused)", () => {
    expect(drawnAt({ t: 3100.9, n: 527 }, seek, 1.2, false)).toBe(true);
    expect(drawnAt({ t: 3099.97, n: 501 }, seek, 1.2, true)).toBe(true);
  });
  it("the frame from before the seek (no new frame drawn yet) isn't, wherever it was", () => {
    // A busy mini: seeked and readyState 3, but the player still shows the last read's frame.
    expect(drawnAt({ t: 3100.2, n: 500 }, seek, 1.2, false)).toBe(false);
    expect(drawnAt(null, seek, 1.2, false)).toBe(false);
    expect(drawnAt(undefined, seek, 1.2, true)).toBe(false);
  });
  it("a new frame from another second isn't: the seek back from further on, or a stall short of it", () => {
    // The last read was 70 s on (confirmed): a frame drawn there after the seek began is the old position's.
    expect(drawnAt({ t: 3170.4, n: 503 }, seek, 1.2, false)).toBe(false);
    expect(drawnAt({ t: 3040, n: 503 }, seek, 1.2, false)).toBe(false);
  });
  it("playing, the frame may be as far on as the time waited, and a second more; paused, only its own second", () => {
    expect(drawnAt({ t: 3104.5, n: 640 }, seek, 4, false)).toBe(true);
    expect(drawnAt({ t: 3106, n: 640 }, seek, 4, false)).toBe(false);
    expect(drawnAt({ t: 3100.8, n: 501 }, seek, 4, true)).toBe(false);
  });
  it("takes its margins from the caller (the page has no module constants)", () => {
    expect(drawnAt({ t: 3099.2, n: 501 }, seek, 1, true, 1, 1)).toBe(true);
    expect(drawnAt({ t: 3099.2, n: 501 }, seek, 1, true, 0.5, 1)).toBe(false);
  });
  it("runs standing alone, as its source does in the page", () => {
    const inPage = new Function(`return (${drawnAt.toString()})`)() as typeof drawnAt;
    expect(inPage({ t: 3101, n: 510 }, seek, 1.2, false, 0.5, 1)).toBe(true);
    expect(inPage({ t: 3101, n: 500 }, seek, 1.2, false, 0.5, 1)).toBe(false);
  });
});

describe("shotSecond: a reading's second is its screenshot's, not the OCR's end", () => {
  it("midway between the player's second either side of the shot", () => {
    expect(shotSecond(3122.4, 3122.8)).toBeCloseTo(3122.6);
  });
  it("a start from it doesn't move with how long the OCR took", () => {
    // Timer at 2:10 left in TeleOp: 20 s in (Auto 30 + 8 + 120 - 130 = 28 s from the start). The OCR took 0.3 s on the
    // PC and 4 s on a busy mini; the old code took the second after it, the new one the screenshot's.
    const shot = shotSecond(3150, 3150.2), fast = 3150.3, busy = 3154;
    const startFrom = (at: number) => Math.round(at - 28);
    expect(startFrom(shot)).toBe(startFrom(fast));
    expect(startFrom(busy) - startFrom(shot)).toBe(4);
  });
});

describe("DRAWN_TRACKER", () => {
  it("is one expression the seek can test (true: tracking; false: no requestVideoFrameCallback)", () => {
    const run = (video: unknown) => new Function("document", "window", `return ${DRAWN_TRACKER}`)({ querySelector: () => video }, {});
    expect(run(null)).toBe(false);
    expect(run({})).toBe(false);
    let cb: ((now: number, m: { mediaTime: number; presentedFrames: number }) => void) | null = null;
    const v = { requestVideoFrameCallback: (f: typeof cb) => { cb = f; } };
    const win: { __drawn?: unknown } = {};
    expect(new Function("document", "window", `return ${DRAWN_TRACKER}`)({ querySelector: () => v }, win)).toBe(true);
    cb!(0, { mediaTime: 12.5, presentedFrames: 7 });
    expect(win.__drawn).toEqual({ t: 12.5, n: 7 });
    // Installed once: a second call reports tracking without a second callback chain.
    expect(new Function("document", "window", `return ${DRAWN_TRACKER}`)({ querySelector: () => v }, win)).toBe(true);
  });
});

describe("lowQuality: a 144p step after a seek is waited out", () => {
  it("a picture well under the player's tallest (720p, 1080p) is low", () => {
    expect(lowQuality(144, 720)).toBe(true);
    expect(lowQuality(360, 720)).toBe(true);
    expect(lowQuality(480, 1080)).toBe(true);
  });
  it("its own height, or near it, isn't; nor one the player hasn't drawn yet (0)", () => {
    expect(lowQuality(720, 720)).toBe(false);
    expect(lowQuality(720, 1080)).toBe(false);
    expect(lowQuality(0, 720)).toBe(false);
  });
  it("a player that has never shown 480p or more never waits (a low upload)", () => {
    expect(lowQuality(144, 360)).toBe(false);
    expect(lowQuality(240, 360)).toBe(false);
  });
  it("runs standing alone, as its source does in the page", () => {
    const inPage = new Function(`return (${lowQuality.toString()})`)() as typeof lowQuality;
    expect(inPage(144, 720)).toBe(true);
    expect(inPage(720, 720)).toBe(false);
  });
});
