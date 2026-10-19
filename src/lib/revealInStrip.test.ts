// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { revealInStrip } from "./revealInStrip";

const box = (left: number, width: number) => {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, bottom: 10, height: 10, x: left, y: 0, toJSON() {} }) as DOMRect;
  return el;
};

describe("revealInStrip", () => {
  it("does nothing when the item already shows", () => {
    const s = box(0, 300); s.scrollLeft = 40;
    revealInStrip(s, box(100, 50));
    expect(s.scrollLeft).toBe(40);
  });
  it("scrolls right so an item past the end shows, with a margin", () => {
    const s = box(10, 300);
    revealInStrip(s, box(280, 100));
    expect(s.scrollLeft).toBe(380 - 310 + 8);
  });
  it("scrolls left (never below 0) for an item before the start", () => {
    const s = box(10, 300); s.scrollLeft = 50;
    revealInStrip(s, box(-20, 100));
    expect(s.scrollLeft).toBe(50 - 30 - 8);
    revealInStrip(s, box(-200, 100));
    expect(s.scrollLeft).toBe(0);
  });
});
