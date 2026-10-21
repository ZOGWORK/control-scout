// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GLIDE_MAX_MS, revealInStrip, scrollStripTo, stopStripGlide } from "./revealInStrip";

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

describe("a strip's glide", () => {
  /** A strip whose glides are in flight: scrollTo is recorded, and the strip hasn't moved yet. */
  const gliding = (left: number, width: number) => {
    const s = box(left, width);
    const calls: ScrollToOptions[] = [];
    s.scrollTo = vi.fn((o?: ScrollToOptions | number) => { if (typeof o === "object") calls.push(o); }) as typeof s.scrollTo;
    return { s, calls };
  };

  it("glides to an item out of view, and stops there if the selection comes back to an item that already shows", () => {
    const { s, calls } = gliding(0, 300);
    revealInStrip(s, box(400, 100), 8, "smooth"); // the next view, past the end
    expect(calls).toEqual([{ left: 500 - 300 + 8, behavior: "smooth" }]);
    // Back straight away: the view left shows, so the glide towards the other one stops where the strip is.
    revealInStrip(s, box(20, 100), 8, "smooth");
    expect(calls[1]).toEqual({ left: 0, behavior: "auto" });
    // Stopped once: nothing more to stop.
    revealInStrip(s, box(20, 100), 8, "smooth");
    expect(calls).toHaveLength(2);
  });

  it("replaces a glide with the next one when the new item is out of view too", () => {
    const { s, calls } = gliding(0, 300);
    revealInStrip(s, box(400, 100), 8, "smooth");
    revealInStrip(s, box(-200, 100), 8, "smooth");
    expect(calls).toEqual([{ left: 208, behavior: "smooth" }, { left: 0, behavior: "smooth" }]);
  });

  it("leaves a strip alone that has no glide of its own on the way (the reader's swipe, a finished glide)", () => {
    const { s, calls } = gliding(0, 300);
    s.scrollLeft = 40;
    revealInStrip(s, box(100, 50), 8, "smooth");
    expect(calls).toHaveLength(0);
    scrollStripTo(s, 120, "smooth");
    s.scrollLeft = 120; // arrived
    stopStripGlide(s);
    expect(calls).toEqual([{ left: 120, behavior: "smooth" }]);
  });

  it("an instant scroll ends the remembered glide", () => {
    const { s, calls } = gliding(0, 300);
    scrollStripTo(s, 200, "smooth");
    scrollStripTo(s, 50);
    expect(s.scrollLeft).toBe(50);
    stopStripGlide(s);
    expect(calls).toEqual([{ left: 200, behavior: "smooth" }]);
  });
});

describe("a strip's glide is forgotten once it can't be ours and in flight", () => {
  afterEach(() => { vi.useRealTimers(); });
  const gliding = () => {
    const s = box(0, 300);
    const calls: ScrollToOptions[] = [];
    s.scrollTo = vi.fn((o?: ScrollToOptions | number) => { if (typeof o === "object") calls.push(o); }) as typeof s.scrollTo;
    return { s, calls };
  };
  /** The reader swipes the strip to `x` themselves, then a render reveals an item that shows. */
  const swipeThenReveal = (s: HTMLElement, x: number) => {
    s.scrollLeft = x;
    s.dispatchEvent(new Event("scroll"));
    revealInStrip(s, box(100, 50), 8, "smooth");
  };

  it("when it finishes (scrollend): the reader's swipe afterwards is never stopped", () => {
    const { s, calls } = gliding();
    scrollStripTo(s, 200, "smooth");
    s.scrollLeft = 200;
    s.dispatchEvent(new Event("scrollend"));
    swipeThenReveal(s, 90);
    expect(calls).toEqual([{ left: 200, behavior: "smooth" }]);
  });

  it("when it reaches its destination (no scrollend in this browser)", () => {
    const { s, calls } = gliding();
    scrollStripTo(s, 200, "smooth");
    s.scrollLeft = 120; s.dispatchEvent(new Event("scroll")); // on its way: still ours
    s.scrollLeft = 200; s.dispatchEvent(new Event("scroll")); // arrived
    swipeThenReveal(s, 90);
    expect(calls).toEqual([{ left: 200, behavior: "smooth" }]);
  });

  it("after GLIDE_MAX_MS at the latest", () => {
    vi.useFakeTimers();
    const { s, calls } = gliding();
    scrollStripTo(s, 200, "smooth");
    vi.advanceTimersByTime(GLIDE_MAX_MS);
    swipeThenReveal(s, 90);
    expect(calls).toEqual([{ left: 200, behavior: "smooth" }]);
  });

  it.each(["pointerdown", "wheel", "touchstart", "keydown"])("when the reader takes over (%s): stopped there once, then the strip is theirs", (type) => {
    const { s, calls } = gliding();
    scrollStripTo(s, 200, "smooth");
    s.scrollLeft = 60; // mid-glide
    s.dispatchEvent(new Event(type, { bubbles: true }));
    expect(calls).toEqual([{ left: 200, behavior: "smooth" }, { left: 60, behavior: "auto" }]);
    // Their swipe, a later render, more input: nothing of ours touches the strip again.
    swipeThenReveal(s, 90);
    s.dispatchEvent(new Event(type, { bubbles: true }));
    expect(calls).toHaveLength(2);
  });

  it("a later glide replaces an earlier one, whose finishing can't end the new one", () => {
    const { s, calls } = gliding();
    scrollStripTo(s, 200, "smooth");
    scrollStripTo(s, 400, "smooth");
    s.scrollLeft = 200; s.dispatchEvent(new Event("scroll")); // passing the first destination: the new glide is still on
    revealInStrip(s, box(100, 50), 8, "smooth");
    expect(calls).toEqual([{ left: 200, behavior: "smooth" }, { left: 400, behavior: "smooth" }, { left: 200, behavior: "auto" }]);
  });
});

describe("scrollStripTo", () => {
  it("aims a glide only as far as the strip can scroll, so its arrival is seen", () => {
    const s = box(0, 300);
    Object.defineProperty(s, "scrollWidth", { value: 500 });
    Object.defineProperty(s, "clientWidth", { value: 300 });
    const calls: ScrollToOptions[] = [];
    s.scrollTo = vi.fn((o?: ScrollToOptions | number) => { if (typeof o === "object") calls.push(o); }) as typeof s.scrollTo;
    scrollStripTo(s, 450, "smooth");
    s.scrollLeft = 200; s.dispatchEvent(new Event("scroll")); // as far as it goes: arrived
    s.scrollLeft = 120; // the reader's swipe
    stopStripGlide(s);
    expect(calls).toEqual([{ left: 200, behavior: "smooth" }]);
  });
});
