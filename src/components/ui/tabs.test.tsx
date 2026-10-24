import { describe, expect, it } from "vitest";
import { stripFade } from "./tabs";

describe("stripFade: which edge of a sideways-scrolling tab strip fades", () => {
  it("fades nothing when every tab fits", () => {
    expect(stripFade({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toBeUndefined();
    expect(stripFade({ scrollLeft: 0, scrollWidth: 301, clientWidth: 300 })).toBeUndefined(); // sub-pixel rounding
  });
  it("fades the end at the start, both ends midway, and the start at the end", () => {
    expect(stripFade({ scrollLeft: 0, scrollWidth: 500, clientWidth: 300 })).toBe("end");
    expect(stripFade({ scrollLeft: 100, scrollWidth: 500, clientWidth: 300 })).toBe("both");
    expect(stripFade({ scrollLeft: 200, scrollWidth: 500, clientWidth: 300 })).toBe("start");
  });
});
