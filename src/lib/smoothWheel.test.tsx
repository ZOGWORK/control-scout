// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { loader, useSmoothWheel } from "./smoothWheel";
import { jumpPageTo, scrollToElement, setSmoothWheel, SMOOTH_SCROLL_QUERY } from "./pageScroll";
import { keepNativeWheel, pageScrollLocked, startSmoothWheel } from "./smoothWheelEngine";

// A matchMedia whose answer for SMOOTH_SCROLL_QUERY can change, as a window resized across 1024 px would.
function screenQuery(desktop: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    get matches() { return desktop; },
    media: SMOOTH_SCROLL_QUERY,
    addEventListener: (_: string, f: () => void) => { listeners.add(f); },
    removeEventListener: (_: string, f: () => void) => { listeners.delete(f); },
  };
  vi.stubGlobal("matchMedia", (q: string) => (q === SMOOTH_SCROLL_QUERY ? mq : { matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  return { set(v: boolean) { desktop = v; for (const f of listeners) f(); } };
}

function Probe() { useSmoothWheel(); return null; }

// Settles the idle wait (setTimeout here: jsdom has no requestIdleCallback) and the engine's load.
async function settle() { await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe("useSmoothWheel", () => {
  const engines: { halt: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    engines.length = 0;
    vi.spyOn(loader, "load").mockImplementation(async () => { const e = { halt: vi.fn(), destroy: vi.fn() }; engines.push(e); return e; });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); setSmoothWheel(null); });

  it("never loads the engine on a phone, a tablet or under reduced motion (the query doesn't match)", async () => {
    screenQuery(false);
    render(<Probe />);
    await settle();
    expect(loader.load).not.toHaveBeenCalled();
  });

  it("never loads it without matchMedia (an old browser)", async () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Probe />);
    await settle();
    expect(loader.load).not.toHaveBeenCalled();
  });

  it("loads it on a desktop once the page is idle, and a jump the app makes then halts its glide", async () => {
    screenQuery(true);
    render(<Probe />);
    expect(loader.load).not.toHaveBeenCalled(); // not during the first paint
    await settle();
    expect(loader.load).toHaveBeenCalledTimes(1);
    jumpPageTo(0);
    expect(engines[0].halt).toHaveBeenCalledTimes(1);
  });

  it("hands scrolling back when the window narrows or reduced motion comes on, and starts again after", async () => {
    const screen = screenQuery(true);
    render(<Probe />);
    await settle();
    act(() => screen.set(false));
    expect(engines[0].destroy).toHaveBeenCalledTimes(1);
    jumpPageTo(0);
    expect(engines[0].halt).not.toHaveBeenCalled(); // no longer registered
    act(() => screen.set(true));
    await settle();
    expect(engines).toHaveLength(2);
  });

  it("never downloads the engine when the screen stops matching before the idle wait ends (a desktop narrowed to phone size)", async () => {
    const screen = screenQuery(true);
    render(<Probe />);
    act(() => screen.set(false)); // narrowed before the page went idle
    await settle();
    expect(loader.load).not.toHaveBeenCalled();
    act(() => screen.set(true)); // wide again: loads once, not twice
    await settle();
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a second load when a change keeps it a desktop (reduced motion off again)", async () => {
    const screen = screenQuery(true);
    render(<Probe />);
    act(() => screen.set(true));
    await settle();
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it("drops an engine that finished loading after the screen stopped matching", async () => {
    const screen = screenQuery(true);
    let finish!: () => void;
    vi.mocked(loader.load).mockImplementationOnce(() => new Promise((r) => { finish = () => { const e = { halt: vi.fn(), destroy: vi.fn() }; engines.push(e); r(e); }; }));
    render(<Probe />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    act(() => screen.set(false));
    await act(async () => { finish(); await Promise.resolve(); await Promise.resolve(); });
    expect(engines[0].destroy).toHaveBeenCalledTimes(1);
    jumpPageTo(0);
    expect(engines[0].halt).not.toHaveBeenCalled();
  });

  it("stops the engine when the shell unmounts", async () => {
    screenQuery(true);
    const { unmount } = render(<Probe />);
    await settle();
    unmount();
    expect(engines[0].destroy).toHaveBeenCalledTimes(1);
  });
});

describe("app scrolls and the wheel's glide", () => {
  afterEach(() => { setSmoothWheel(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

  it("a gliding scroll to an element halts the wheel first, so the two never fight", () => {
    const halt = vi.fn();
    setSmoothWheel({ halt });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === SMOOTH_SCROLL_QUERY }));
    const to = vi.fn(() => expect(halt).toHaveBeenCalled());
    vi.stubGlobal("scrollTo", to);
    const el = document.createElement("div");
    document.body.append(el);
    scrollToElement(el, "smooth");
    expect(to).toHaveBeenCalledTimes(1);
  });
});

describe("which wheels stay the browser's", () => {
  afterEach(() => { document.body.innerHTML = ""; document.body.removeAttribute("data-scroll-locked"); });

  it("dialogs, popovers, menus, listboxes and anything marked data-lenis-prevent", () => {
    document.body.innerHTML = `<div role="dialog" id="a"></div><div data-radix-popper-content-wrapper id="b"></div><ul role="listbox" id="c"></ul><div data-lenis-prevent id="d"></div><div role="menu" id="e"></div><main id="f"><table id="g"></table></main>`;
    for (const id of ["a", "b", "c", "d", "e"]) expect(keepNativeWheel(document.getElementById(id)!)).toBe(true);
    for (const id of ["f", "g"]) expect(keepNativeWheel(document.getElementById(id)!)).toBe(false);
  });

  it("knows when a dialog or sheet has locked the page", () => {
    expect(pageScrollLocked()).toBe(false);
    document.body.setAttribute("data-scroll-locked", "1");
    expect(pageScrollLocked()).toBe(true);
  });
});

describe("the engine (a real Lenis) with a wheel over the page", () => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  let engine: ReturnType<typeof startSmoothWheel> | null = null;
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", RO);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { engine?.destroy(); engine = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; document.body.removeAttribute("data-scroll-locked"); });

  // Whether the engine took the wheel for the page (Lenis cancels the browser's own scroll when it does).
  const wheelOver = (el: Element) => {
    const e = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it("takes the wheel over the page itself", () => {
    document.body.innerHTML = `<main><p id="t">row</p></main>`;
    engine = startSmoothWheel();
    expect(wheelOver(document.getElementById("t")!)).toBe(true);
  });

  it("leaves it to a dialog, popover, menu or data-lenis-prevent box even over a child deep inside one", () => {
    document.body.innerHTML = `
      <div role="dialog"><div><p><span id="a">deep in a dialog</span></p></div></div>
      <div data-radix-popper-content-wrapper><div role="group"><button id="b">in a popover</button></div></div>
      <ul role="menu"><li><a id="c">in a menu</a></li></ul>
      <section data-lenis-prevent><div><em id="d">in a marked box</em></div></section>`;
    engine = startSmoothWheel();
    for (const id of ["a", "b", "c", "d"]) expect(wheelOver(document.getElementById(id)!)).toBe(false);
  });

  it("a key ends a glide on its way, but a modifier pressed on its own does not", async () => {
    document.body.innerHTML = `<main><p id="t">row</p></main>`;
    // A page taller than the window, so a wheel has somewhere to glide to.
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => 5000 });
    engine = startSmoothWheel();
    const gliding = () => document.documentElement.classList.contains("lenis-smooth");
    wheelOver(document.getElementById("t")!);
    expect(gliding()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    expect(gliding()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
    expect(gliding()).toBe(false);
    delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
  });

  it("stands aside while a dialog or sheet locks the page", () => {
    document.body.innerHTML = `<main><p id="t">row</p></main>`;
    engine = startSmoothWheel();
    document.body.setAttribute("data-scroll-locked", "1");
    expect(wheelOver(document.getElementById("t")!)).toBe(false);
  });
});
