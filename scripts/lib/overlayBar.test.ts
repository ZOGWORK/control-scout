import { describe, expect, it } from "vitest";
import { overlayBand, overlayBar } from "./videoFrames";

// A 1280 × 720 frame: a camera's crowd (grey, with rows of dark red seats like FiT-North's gym, 107, 15, 2) and FTC Live's
// score bar drawn from x0 to x1, rows top to bottom: blue, a white timer box with black digits at its centre, red, the
// blue half's middle rows broken by a white score badge 8% of the bar wide (as USTXNAM1 2024's bar, the screen shrunk into the top left).
function frame(bar: { x0: number; x1: number; top: number; bottom: number } | null, seats = true) {
  const w = 1280, h = 720, px = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, [r, g, b]: number[]) => { const i = (y * w + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, seats && y % 30 < 12 ? [107, 15, 2] : [150, 140, 135]);
  if (bar) {
    const span = bar.x1 - bar.x0, mid = bar.x0 + span / 2, tw = span * 0.105;
    const t0 = Math.round(mid - tw / 2), t1 = Math.round(mid + tw / 2);
    for (let y = bar.top; y < bar.bottom; y++) for (let x = bar.x0; x < bar.x1; x++) {
      const badge = y > bar.top + 8 && y < bar.bottom - 8 && Math.abs(x - (bar.x0 + span * 0.29)) < span * 0.04;
      const digit = x > t0 + 10 && x < t1 - 10 && y > bar.top + 15 && y < bar.bottom - 15 && x % 7 < 2;
      put(x, y, x >= t0 && x <= t1 ? (digit ? [10, 10, 10] : [255, 255, 255]) : x < t0 ? (badge ? [250, 250, 250] : [3, 101, 174]) : [232, 31, 39]);
    }
  }
  return px;
}

describe("a score bar drawn small in the frame", () => {
  it("is found where the producer put it, its ends past the white score badges and short of the red seats beyond", () => {
    const b = overlayBar(frame({ x0: 0, x1: 533, top: 70, bottom: 120 }), 1280, 720)!;
    expect(b).not.toBeNull();
    expect(b.top).toBe(70);
    expect(b.bottom).toBe(120);
    expect(b.x0).toBeLessThanOrEqual(35);
    expect(b.x1).toBeGreaterThanOrEqual(500);
    expect(b.x1).toBeLessThanOrEqual(540);
    // overlayBand, looking across the whole width, finds none: why the reader read nothing on it.
    expect(overlayBand(frame({ x0: 0, x1: 533, top: 70, bottom: 120 }), 1280, 720)).toBeNull();
  });

  it("is found in another corner and at another size too", () => {
    const b = overlayBar(frame({ x0: 877, x1: 1280, top: 640, bottom: 680 }), 1280, 720)!;
    expect(b).not.toBeNull();
    expect([b.top, b.bottom]).toEqual([640, 680]);
    expect(b.x0).toBeLessThanOrEqual(905);
    expect(b.x1).toBeGreaterThanOrEqual(1250);
  });

  it("isn't found on a frame with no bar, nor a bar too short to be one", () => {
    expect(overlayBar(frame(null), 1280, 720)).toBeNull();
    expect(overlayBar(frame({ x0: 0, x1: 533, top: 70, bottom: 76 }), 1280, 720)).toBeNull();
  });

  it("leaves a full-size bar to overlayBand", () => {
    expect(overlayBar(frame({ x0: 0, x1: 1280, top: 600, bottom: 700 }, false), 1280, 720)).toBeNull();
  });
});
