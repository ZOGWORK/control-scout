// @vitest-environment jsdom
// The How it works page while it scrolls: the section nav works from offsets measured once (not every
// frame), reveals are CSS transitions marked by one shared observer, and the hero's example card only
// cycles while it is on screen.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IntersectionObserver: record each observed element, so a test can bring it into view.
let observed: { cb: IntersectionObserverCallback; io: IntersectionObserver; el: Element; opts?: IntersectionObserverInit }[] = [];
class FakeIO {
  constructor(private cb: IntersectionObserverCallback, private opts?: IntersectionObserverInit) {}
  observe(el: Element) { observed.push({ cb: this.cb, io: this as unknown as IntersectionObserver, el, opts: this.opts }); }
  unobserve(el: Element) { observed = observed.filter((o) => o.el !== el || o.io !== (this as unknown as IntersectionObserver)); }
  disconnect() { observed = observed.filter((o) => o.io !== (this as unknown as IntersectionObserver)); }
  takeRecords() { return []; }
}
const show = (el: Element, isIntersecting = true) => {
  for (const o of observed.filter((x) => x.el === el)) o.cb([{ isIntersecting, intersectionRatio: isIntersecting ? 1 : 0, target: el, boundingClientRect: el.getBoundingClientRect() } as IntersectionObserverEntry], o.io);
};

beforeEach(() => {
  observed = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("activeSection", async () => {
  const { activeSection, SECTIONS } = await import("./SectionNav");
  const tops = [{ id: "overview", top: 600 }, { id: "ratings", top: 2000 }, { id: "matches", top: 4000 }];
  it("is the last section starting above the reading line", () => {
    expect(activeSection(tops, 0, 300, 9000)).toBe("");
    expect(activeSection(tops, 400, 300, 9000)).toBe("overview");
    expect(activeSection(tops, 1699, 300, 9000)).toBe("overview");
    expect(activeSection(tops, 1701, 300, 9000)).toBe("ratings");
    expect(activeSection(tops, 5000, 300, 9000)).toBe("matches");
  });
  it("is the last section at the very bottom, which is too short to reach the line", () => {
    expect(activeSection(tops, 8999, 300, 9000)).toBe(SECTIONS[SECTIONS.length - 1].id);
    expect(activeSection([], 0, 300, 0)).toBe("");
  });
});

describe("SectionNav", async () => {
  const { SectionNav } = await import("./SectionNav");
  it("measures the sections when the page changes size, not on every scrolled frame", () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { frame = f; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { frame = null; });
    const resized: (() => void)[] = [];
    vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resized.push(cb); } observe() {} disconnect() {} });
    const el = document.createElement("section");
    el.id = "ratings";
    document.body.appendChild(el);
    const rect = vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ top: 2000 } as DOMRect);
    render(<SectionNav />);
    const reads = rect.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    for (const y of [100, 900, 2400]) {
      document.documentElement.scrollTop = y;
      act(() => { window.dispatchEvent(new Event("scroll")); frame?.(0); });
    }
    expect(rect.mock.calls.length).toBe(reads);
    expect(screen.getByRole("link", { name: "Ratings" }).getAttribute("aria-current")).toBe("location");
    act(() => resized.forEach((f) => f()));
    expect(rect.mock.calls.length).toBeGreaterThan(reads);
    el.remove();
    document.documentElement.scrollTop = 0;
  });
});

describe("Reveal", async () => {
  const { Reveal } = await import("./ui");
  it("is marked shown the first time it scrolls into view, by one observer shared by every reveal", () => {
    render(<><Reveal>one</Reveal><Reveal as="li" delay={0.2}>two</Reveal></>);
    const one = screen.getByText("one"), two = screen.getByText("two");
    expect(one.className).toContain("hiw-reveal");
    expect(two.tagName).toBe("LI");
    expect(two.style.transitionDelay).toBe("0.2s");
    expect(new Set(observed.map((o) => o.io)).size).toBe(1);
    expect(observed[0].opts).toMatchObject({ threshold: 0.08, rootMargin: "0px 0px -8% 0px" });
    show(one, false);
    expect(one.hasAttribute("data-shown")).toBe(false);
    show(one);
    expect(one.hasAttribute("data-shown")).toBe(true);
    expect(two.hasAttribute("data-shown")).toBe(false);
    // Once only: no longer watched.
    expect(observed.some((o) => o.el === one)).toBe(false);
  });
});

describe("Hero", async () => {
  const { Hero } = await import("./Hero");
  it("cycles the example card, and pulses its live dot, only while the card is on screen", () => {
    vi.useFakeTimers();
    render(<Hero />);
    const card = screen.getByRole("group", { name: /Example match predictions/ });
    const label = () => card.firstElementChild!.firstElementChild!.textContent;
    const first = label();
    const dot = card.querySelector(".hiw-live")!;
    act(() => { vi.advanceTimersByTime(5200 * 3); });
    expect(label()).toBe(first);
    expect(dot.classList.contains("hiw-live-on")).toBe(false);
    act(() => show(card));
    expect(dot.classList.contains("hiw-live-on")).toBe(true);
    act(() => { vi.advanceTimersByTime(5200); });
    expect(label()).not.toBe(first);
    const second = label();
    act(() => show(card, false));
    act(() => { vi.advanceTimersByTime(5200 * 3); });
    expect(label()).toBe(second);
    expect(dot.classList.contains("hiw-live-on")).toBe(false);
  });
});
