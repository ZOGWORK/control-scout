import { describe, expect, it } from "vitest";
import { CORNER_BOXES, cornerBox, zoomCss, type CornerBox } from "./frameZoom";

/** Where a point of the unzoomed frame lands under zoomCss's transform. */
function lands(css: string, px: number, py: number): [number, number] {
  const m = css.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/);
  if (!m) throw new Error(css);
  const [dx, dy, s] = m.slice(1).map(Number);
  return [px * s + dx, py * s + dy];
}

describe("zooming a picture-in-picture box to the whole frame", () => {
  it("puts the box's left edge at the frame's and its bottom `shift` below the frame's, as wide as the frame", () => {
    const css = zoomCss([877, 418, 403, 302], 120);
    const [lx, by] = lands(css, 877, 418 + 302);
    expect(lx).toBeCloseTo(0, 1);
    expect(by).toBeCloseTo(720 + 120, 1);
    const [rx] = lands(css, 877 + 403, 418);
    expect(rx).toBeCloseTo(1280, 1);
  });

  it("with no shift, the box's bottom edge is the frame's", () => {
    const [, by] = lands(zoomCss([100, 200, 640, 360], 0), 100, 560);
    expect(by).toBeCloseTo(720, 1);
  });

  it("refuses a box with no size", () => {
    expect(() => zoomCss([0, 0, 0, 100], 0)).toThrow(/width and a height/);
  });
});

describe("the corner box list", () => {
  const list: CornerBox[] = [{ season: 2025, code: "USCOFRQ", videoId: "w36Zw_uqfms", box: [877, 418, 403, 302], shift: 120, checked: "2026-11-18", seen: "box" }];

  it("finds a listed video's box, and nothing for any other video", () => {
    expect(cornerBox("w36Zw_uqfms", list)?.box).toEqual([877, 418, 403, 302]);
    expect(cornerBox("otherVideo1", list)).toBeNull();
  });

  it("lists each video once, with a box inside the 1280×720 player, the day it was measured and what it showed", () => {
    const ids = CORNER_BOXES.map((b) => b.videoId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of CORNER_BOXES) {
      const [x, y, w, h] = b.box;
      expect(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1280 && y + h <= 720).toBe(true);
      expect(b.videoId).toMatch(/^[\w-]{11}$/);
      expect(b.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.seen.length).toBeGreaterThan(10);
    }
  });
});
