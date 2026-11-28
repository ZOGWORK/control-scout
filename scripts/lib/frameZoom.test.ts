import { describe, expect, it } from "vitest";
import { BAR_FLOOR, CORNER_BOXES, FOUND_MIN, cornerBox, foundBox, outsidePart, reachesPart, sampleFinds, wholeBox, zoomCss, type CornerBox } from "./frameZoom";

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

  it("zooms every read to a box listed for the whole recording, none to one listed for part of it", () => {
    const part: CornerBox = { ...list[0], code: "USNDBIQ", videoId: "rLKw84eo9cQ", box: [859, 483, 421, 237], shift: 0, part: [0, 7200] };
    expect(wholeBox("w36Zw_uqfms", [...list, part])?.box).toEqual([877, 418, 403, 302]);
    // Part of it: the video read full size, the box only for the stretch read again (cornerBox still finds it).
    expect(wholeBox("rLKw84eo9cQ", [...list, part])).toBeNull();
    expect(cornerBox("rLKw84eo9cQ", [...list, part])?.part).toEqual([0, 7200]);
    expect(wholeBox("otherVideo1", list)).toBeNull();
  });

  it("reads a part box only over a stretch reaching into its part, and never keeps a start it placed outside it", () => {
    const part: [number, number] = [0, 7200];
    expect(reachesPart(0, 7252, part)).toBe(true);
    expect(reachesPart(7000, 9000, part)).toBe(true);
    // Wholly after the part (the full-size bar's hours): the box isn't on screen there.
    expect(reachesPart(7300, 20_000, part)).toBe(false);
    expect(reachesPart(9000, 12_000, [10_000, 11_000])).toBe(true);
    expect(reachesPart(0, 9000, [10_000, 11_000])).toBe(false);
    const at = (o: Record<string, number>) => new Map(Object.entries(o).map(([l, t]) => [l, { t }]));
    const before = at({ Q11: 7252, Q12: 7700 });
    expect(outsidePart(before, at({ Q2: 2509, Q3: 3071, Q11: 7252, Q12: 7700 }), part)).toEqual([]);
    // A new start past the part's end: the camera's frame, not the box's. Ones the full-size read placed stand.
    expect(outsidePart(before, at({ Q2: 2509, Q13: 8100, Q11: 7252, Q12: 7700 }), part)).toEqual(["Q13"]);
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
      if (b.part) expect(b.part[0] >= 0 && b.part[1] > b.part[0]).toBe(true);
    }
  });
});

describe("a box from a shrunk bar found on sampled frames", () => {
  const bar = { x0: 9, x1: 526, top: 70, bottom: 120 };

  it("zooms the bar most frames agree on to fill the width, its bottom row at a bottom bar's", () => {
    const found = [bar, null, { ...bar, bottom: 119 }, { x0: 3, x1: 535, top: 270, bottom: 311 }, { ...bar, x1: 559 }, bar, null];
    const z = foundBox(found)!;
    expect(z.box).toEqual([9, 70, 526 - 9, 50]);
    const css = zoomCss(z.box, z.shift);
    expect(lands(css, 9, 120)[0]).toBeCloseTo(0, 1);
    expect(lands(css, 9, 120)[1]).toBeCloseTo(BAR_FLOOR, 1);
    expect(lands(css, 526, 70)[0]).toBeCloseTo(1280, 1);
  });

  it("zooms nothing where too few frames agree (a results screen's halves, a stray patch of crowd)", () => {
    expect(foundBox([bar, { ...bar, bottom: 311 }, null, bar, null])).toBeNull();
    expect(foundBox([])).toBeNull();
    expect(FOUND_MIN).toBe(3);
  });
});

describe("sampling frames for a shrunk bar", () => {
  class OverTime extends Error {}
  const bar = { x0: 9, x1: 526, top: 70, bottom: 120 };

  it("counts a frame whose read failed as finding nothing, so the other frames still vote", async () => {
    const found = await sampleFinds([1, 2, 3, 4, 5], async (t) => { if (t === 2) throw new Error("seek refused"); return t === 5 ? null : bar; }, (e) => e instanceof OverTime);
    expect(found).toEqual([bar, null, bar, bar, null]);
    expect(foundBox(found)?.box).toEqual([9, 70, 517, 50]);
  });

  it("stops on the event's own time limit", async () => {
    await expect(sampleFinds([1, 2], async () => { throw new OverTime("over its limit"); }, (e) => e instanceof OverTime)).rejects.toThrow(/over its limit/);
  });
});
