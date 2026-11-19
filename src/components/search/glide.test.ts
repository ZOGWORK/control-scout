// @vitest-environment jsdom
// Home's search → /search glide (./glide.ts): only to the results page, only in v8, only where the browser has View
// Transitions; otherwise the plain navigation. While it runs <html data-search-glide> is set, and it's cleared after.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canGlide, glideTo } from "./glide";

// Stands in for the browser API (jsdom has none); typed loosely so a partial transition object is enough.
const doc = document as unknown as { startViewTransition?: unknown };

describe("glideTo", () => {
  beforeEach(() => document.documentElement.setAttribute("data-v8", ""));
  afterEach(() => { document.documentElement.removeAttribute("data-v8"); document.documentElement.removeAttribute("data-search-glide"); delete doc.startViewTransition; });

  it("no View Transitions: navigates at once, no glide", () => {
    const go = vi.fn();
    expect(glideTo("/search?q=x", go)).toBe(false);
    expect(go).toHaveBeenCalledOnce();
    expect(document.documentElement.hasAttribute("data-search-glide")).toBe(false);
  });

  it("only the results page glides, and only in v8", () => {
    doc.startViewTransition = () => ({});
    expect(canGlide("/search?q=x")).toBe(true);
    expect(canGlide("/teams/6980")).toBe(false);
    document.documentElement.removeAttribute("data-v8");
    expect(canGlide("/search?q=x")).toBe(false);
  });

  it("with the API: marks the page while it runs, runs the navigation inside the transition, clears the mark after", async () => {
    let finish!: () => void;
    const finished = new Promise<void>((r) => { finish = r; });
    let update: (() => Promise<void> | void) | null = null;
    doc.startViewTransition = (cb: () => Promise<void> | void) => { update = cb; return { finished, ready: Promise.resolve(), updateCallbackDone: Promise.resolve() }; };
    const go = vi.fn();
    expect(glideTo("/search?q=x", go)).toBe(true);
    expect(document.documentElement.hasAttribute("data-search-glide")).toBe(true);
    expect(go).not.toHaveBeenCalled();
    await update!(); // the page never shows a box here, so it waits out its short limit
    expect(go).toHaveBeenCalledOnce();
    finish();
    await finished;
    await Promise.resolve();
    expect(document.documentElement.hasAttribute("data-search-glide")).toBe(false);
  });
});
