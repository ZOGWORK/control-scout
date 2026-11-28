// @vitest-environment jsdom
// A chart wider than its card (a phone) scrolls sideways; the side with more chart fades out, so the bars and labels
// don't look cut off at the card's edge.
import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { ScrollX } from "./ui";

const size = (el: HTMLElement, client: number, scroll: number, left = 0) => {
  Object.defineProperty(el, "clientWidth", { value: client, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: scroll, configurable: true });
  Object.defineProperty(el, "scrollLeft", { value: left, configurable: true, writable: true });
};

describe("ScrollX edge hint", () => {
  it("fades the right edge while more chart is past it, both edges mid-way, the left at the end", () => {
    const { container } = render(<ScrollX label="chart"><div /></ScrollX>);
    const el = container.querySelector<HTMLElement>("[data-scroll-x]")!;
    size(el, 358, 520);
    act(() => { el.dispatchEvent(new Event("scroll")); });
    expect(el.dataset.moreRight).toBe("true");
    expect(el.dataset.moreLeft).toBeUndefined();
    expect(el.style.maskImage).toMatch(/transparent\)$/);
    size(el, 358, 520, 80);
    act(() => { el.dispatchEvent(new Event("scroll")); });
    expect(el.dataset.moreLeft).toBe("true");
    expect(el.dataset.moreRight).toBe("true");
    size(el, 358, 520, 162);
    act(() => { el.dispatchEvent(new Event("scroll")); });
    expect(el.dataset.moreRight).toBeUndefined();
    expect(el.style.maskImage).toMatch(/^linear-gradient\(to right, ?transparent/);
  });

  it("draws no fade when the chart fits", () => {
    const { container } = render(<ScrollX label="chart"><div /></ScrollX>);
    const el = container.querySelector<HTMLElement>("[data-scroll-x]")!;
    size(el, 640, 640);
    act(() => { el.dispatchEvent(new Event("scroll")); });
    expect(el.style.maskImage).toBe("");
    expect(el.dataset.moreRight).toBeUndefined();
  });
});
