// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, useLocation as useLocationProbe, useNavigate, type NavigateFunction } from "react-router-dom";
import { StrictMode, useRef } from "react";
import { chase, entryKey, HEADER_ID, pageScroller, pageTop, planScroll, scrollToElement, restoredSavedPosition, RESTORE_WINDOW_MS, SCROLL_IDLE_MS, ScrollPositions, usePageScroll } from "./pageScroll";

describe("planScroll", () => {
  const base = { prevPath: "/events", path: "/teams/4215", hash: "", saved: undefined };
  it("starts a new page at the top", () => {
    expect(planScroll({ ...base, action: "PUSH" })).toEqual({ kind: "top" });
    expect(planScroll({ ...base, action: "REPLACE" })).toEqual({ kind: "top" });
  });
  it("leaves the scroll alone for a query change on the same page (tabs, filters, sorting)", () => {
    expect(planScroll({ ...base, action: "PUSH", prevPath: "/teams", path: "/teams" })).toEqual({ kind: "keep" });
    expect(planScroll({ ...base, action: "REPLACE", prevPath: "/events/2025/X", path: "/events/2025/x/" })).toEqual({ kind: "keep" });
  });
  it("returns to the saved position on back/forward", () => {
    expect(planScroll({ ...base, action: "POP", saved: 1200 })).toEqual({ kind: "restore", y: 1200 });
    expect(planScroll({ ...base, action: "POP", saved: 0 })).toEqual({ kind: "restore", y: 0 });
  });
  it("leaves a back/forward with nothing saved (and a first load) alone", () => {
    expect(planScroll({ ...base, action: "POP" })).toEqual({ kind: "keep" });
    expect(planScroll({ ...base, action: "POP", prevPath: null })).toEqual({ kind: "keep" });
  });
  it("goes to a #hash's element", () => {
    expect(planScroll({ ...base, action: "PUSH", hash: "#accuracy" })).toEqual({ kind: "hash", id: "accuracy" });
    expect(planScroll({ ...base, action: "POP", prevPath: null, hash: "#a%20b" })).toEqual({ kind: "hash", id: "a b" });
    // A saved position wins over the hash on back/forward: the reader had scrolled on from it.
    expect(planScroll({ ...base, action: "POP", hash: "#accuracy", saved: 50 })).toEqual({ kind: "restore", y: 50 });
    // ...unless the browser followed a plain #link itself: that goes to the target.
    expect(planScroll({ ...base, action: "POP", hash: "#accuracy", saved: 50, fragment: true })).toEqual({ kind: "hash", id: "accuracy" });
  });
});

describe("ScrollPositions", () => {
  it("round-trips through storage and keeps only the newest entries", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const a = new ScrollPositions(storage);
    for (let i = 0; i < 70; i++) a.set(`k${i}`, i * 10.4);
    a.set("k5", 5); // touched again: newest
    a.save();
    const b = new ScrollPositions(storage);
    expect(b.get("k69")).toBe(718);
    expect(b.get("k5")).toBe(5);
    expect(b.get("k0")).toBeUndefined();
  });
  it("starts empty when storage is unreadable or throws", () => {
    expect(new ScrollPositions({ getItem: () => "{nope", setItem: () => {} }).get("x")).toBeUndefined();
    const s = new ScrollPositions({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    s.set("x", 3);
    expect(() => s.save()).not.toThrow();
    expect(s.get("x")).toBe(3);
  });
});

// ResizeObserver stand-in: tests call `resize()` to fire every observer.
const observers = new Set<() => void>();
const resize = () => { for (const cb of [...observers]) cb(); };
class FakeResizeObserver {
  private cb: () => void;
  constructor(cb: () => void) { this.cb = cb; }
  observe() { observers.add(this.cb); }
  disconnect() { observers.delete(this.cb); }
}

/** A scroller whose scrollTop clamps to its content height, as a browser's does. */
function fakeScroller(el: HTMLElement, height: { current: number }, viewport = 800) {
  let top = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = Math.max(0, Math.min(v, height.current - viewport)); },
  });
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("ResizeObserver", FakeResizeObserver); observers.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("chase", () => {
  it("re-applies on every resize until the window runs out", () => {
    const el = document.createElement("div"), content = document.createElement("div");
    const step = vi.fn();
    chase(el, content, step);
    expect(step).toHaveBeenCalledTimes(1);
    resize(); resize();
    expect(step).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(RESTORE_WINDOW_MS);
    resize();
    expect(step).toHaveBeenCalledTimes(3);
  });
  it.each(["wheel", "touchstart", "keydown", "pointerdown"])("stops as soon as the reader takes over (%s)", (type) => {
    const el = document.createElement("div"), content = document.createElement("div");
    const step = vi.fn();
    chase(el, content, step);
    el.dispatchEvent(new Event(type));
    resize();
    expect(step).toHaveBeenCalledTimes(1);
  });
});

describe("usePageScroll", () => {
  const height = { current: 5000 };
  let nav: NavigateFunction;
  let main: HTMLElement;
  // The page scrolls the document: its scroller stands in for a browser's, clamped to the content height.
  const page = document.documentElement;
  beforeEach(() => { fakeScroller(page, height); });
  afterEach(() => { delete (page as { scrollTop?: number }).scrollTop; });
  function Harness() {
    const ref = useRef<HTMLElement>(null);
    usePageScroll(ref);
    nav = useNavigate();
    return <div><main id="main" ref={(n) => { if (n) main = n; (ref as { current: HTMLElement | null }).current = n; }}><div><div id="sec" /></div></main></div>;
  }
  const scrollTo = (y: number) => act(() => { page.scrollTop = y; window.dispatchEvent(new Event("scroll")); });
  const go = (to: string | number) => act(() => { if (typeof to === "number") nav(to); else nav(to); });

  it("starts a new page at the top and restores the old one on back and forward", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/teams/4215"]}><Harness /></MemoryRouter>);
    scrollTo(1200);
    go("/rankings");
    expect(page.scrollTop).toBe(0);
    scrollTo(300);
    go(-1);
    expect(page.scrollTop).toBe(1200);
    go(1);
    expect(page.scrollTop).toBe(300);
  });

  it("waits for a short page to grow back before reaching the saved position", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/events"]}><Harness /></MemoryRouter>);
    scrollTo(3000);
    go("/events/2025/X");
    height.current = 900; // the list is loading again: the page is short
    go(-1);
    expect(page.scrollTop).toBe(100);
    height.current = 2500; act(resize);
    expect(page.scrollTop).toBe(1700);
    height.current = 6000; act(resize);
    expect(page.scrollTop).toBe(3000);
  });

  it("gives up on the restore once the reader scrolls themselves", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/events"]}><Harness /></MemoryRouter>);
    scrollTo(3000);
    go("/teams");
    height.current = 900;
    go(-1);
    act(() => { window.dispatchEvent(new Event("wheel")); });
    height.current = 6000; act(resize);
    expect(page.scrollTop).toBe(100);
  });

  it("keeps the saved position when the reader leaves again before a restore could reach it", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/events"]}><Harness /></MemoryRouter>);
    scrollTo(3000);
    go("/events/2025/X");
    height.current = 900; // back to a list that is still loading...
    go(-1);
    act(() => { window.dispatchEvent(new Event("scroll")); }); // ...clamped at 100
    go(1); // forward again before it grew
    height.current = 5000;
    go(-1);
    expect(page.scrollTop).toBe(3000);
  });

  it("says when arriving restored a saved position, so pages don't scroll themselves over it", () => {
    height.current = 5000;
    let loc = { key: "", pathname: "", search: "" };
    function Spy() { loc = useLocationProbe(); return null; }
    render(<MemoryRouter initialEntries={["/events/2025/X?match=q1"]}><Harness /><Spy /></MemoryRouter>);
    expect(restoredSavedPosition(loc)).toBe(false);
    scrollTo(2000);
    go("/teams/1");
    expect(restoredSavedPosition(loc)).toBe(false);
    go(-1);
    expect(restoredSavedPosition(loc)).toBe(true);
  });

  it("goes to a #hash on a first load, below the top bar, also under StrictMode's replayed effects", () => {
    height.current = 5000;
    // #sec starts 1748 px down the page, with the bar's height as its scroll margin.
    placeAt("sec", 1748, "48px");
    render(<StrictMode><MemoryRouter initialEntries={["/methodology#sec"]}><Harness /></MemoryRouter></StrictMode>);
    expect(page.scrollTop).toBe(1700);
  });

  it("keeps the position for a query change on the same page", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/events/2025/X"]}><Harness /></MemoryRouter>);
    scrollTo(400);
    go("/events/2025/X?tab=matches");
    expect(page.scrollTop).toBe(400);
  });

  it("returns to a tab switched in place (a replaced entry) even if the reader never scrolled on it", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/events/2025/X"]}><Harness /></MemoryRouter>);
    scrollTo(400);
    act(() => nav("/events/2025/X?tab=matches", { replace: true }));
    go("/teams/1");
    scrollTo(2500);
    go(-1);
    expect(page.scrollTop).toBe(400);
  });

  it("marks the area as scrolling until the scroll goes quiet, and flips nothing on <html>", () => {
    height.current = 5000;
    const { unmount } = render(<MemoryRouter initialEntries={["/"]}><Harness /></MemoryRouter>);
    const area = main.parentElement!;
    const html = document.documentElement;
    const htmlAttrs = () => html.getAttributeNames().sort().join(" ");
    const before = htmlAttrs();
    expect(area.hasAttribute("data-scrolling")).toBe(false);
    scrollTo(10);
    expect(area.hasAttribute("data-scrolling")).toBe(true);
    act(() => { vi.advanceTimersByTime(SCROLL_IDLE_MS - 10); });
    scrollTo(20);
    act(() => { vi.advanceTimersByTime(SCROLL_IDLE_MS - 10); });
    expect(area.hasAttribute("data-scrolling")).toBe(true);
    // An attribute flipped on <html> restyled every element with a hover style keyed off it, twice a scroll.
    expect(htmlAttrs()).toBe(before);
    act(() => { vi.advanceTimersByTime(20); });
    expect(area.hasAttribute("data-scrolling")).toBe(false);
    scrollTo(30);
    unmount();
    expect(area.hasAttribute("data-scrolling")).toBe(false);
  });

  it("restores the first page's position after a reload", () => {
    sessionStorage.setItem("cs-scroll", JSON.stringify([["default:/teams/4215", 2222]]));
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" }] as never);
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/teams/4215"]}><Harness /></MemoryRouter>);
    expect(page.scrollTop).toBe(2222);
    vi.restoreAllMocks();
  });

  it("follows a plain #link on the page (skip link, contents), and back/forward still return to where each entry was left", () => {
    height.current = 5000;
    history.replaceState(null, "", "/privacy");
    placeAt("sec", 2000, "72px");
    render(<BrowserRouter><Harness /></BrowserRouter>);
    // The browser reports a #link, and a back/forward, the same way: an entry with no router state, then popstate.
    const arrive = (url: string) => act(() => { history.replaceState(null, "", url); window.dispatchEvent(new PopStateEvent("popstate")); });
    const link = document.createElement("a");
    link.href = "#sec";
    main.append(link);
    // Clicked: the browser's own jump is held off here, so only the app's handling is measured.
    const follow = () => act(() => { link.addEventListener("click", (e) => e.preventDefault(), { once: true, capture: true }); link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    scrollTo(500);
    // A link the page itself took over (preventDefault) is left to it: nothing is followed.
    follow();
    expect(page.scrollTop).toBe(500);
    // Followed for real: the click is heard (not cancelled) and the browser adds the #sec entry.
    act(() => { link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    arrive("/privacy#sec");
    expect(page.scrollTop).toBe(1928);
    scrollTo(2600); // read on past the section
    arrive("/privacy"); // Back
    expect(page.scrollTop).toBe(500);
    arrive("/privacy#sec"); // Forward: where the reader had got to, not the section's heading
    expect(page.scrollTop).toBe(2600);
    history.replaceState(null, "", "/");
  });

  it("restores after a reload when the page changed its #hash in place, without the router (How it works contents)", () => {
    height.current = 5000;
    history.replaceState(null, "", "/methodology");
    const first = render(<BrowserRouter><Harness /></BrowserRouter>);
    // SectionNav's scrollToId: history.replaceState(history.state, "", "#ratings"), unheard by the router.
    history.replaceState(history.state, "", "/methodology#ratings");
    scrollTo(1800);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    first.unmount();
    page.scrollTop = 0;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" }] as never);
    render(<BrowserRouter><Harness /></BrowserRouter>);
    expect(page.scrollTop).toBe(1800);
    history.replaceState(null, "", "/");
  });

  it("keeps first pages at different addresses apart", () => {
    expect(entryKey({ key: "default", pathname: "/a", search: "?x=1" })).toBe("default:/a?x=1");
    expect(entryKey({ key: "k1", pathname: "/a", search: "" })).toBe("k1");
  });

  it("does not restore a stale position into a newly opened page", () => {
    sessionStorage.setItem("cs-scroll", JSON.stringify([["default:/teams/4215", 2222]]));
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/teams/4215"]}><Harness /></MemoryRouter>);
    expect(page.scrollTop).toBe(0);
    go("/rankings");
    go(-1);
    expect(page.scrollTop).toBe(0);
  });

  it("takes restoring over from the browser while mounted, and hands it back after", () => {
    history.scrollRestoration = "auto";
    const { unmount } = render(<MemoryRouter initialEntries={["/"]}><Harness /></MemoryRouter>);
    expect(history.scrollRestoration).toBe("manual");
    unmount();
    expect(history.scrollRestoration).toBe("auto");
  });

  it("scrolls the document, never <main>", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/teams/4215"]}><Harness /></MemoryRouter>);
    expect(pageScroller()).toBe(page);
    scrollTo(1200);
    go("/rankings");
    go(-1);
    expect(page.scrollTop).toBe(1200);
    expect(main.scrollTop).toBe(0);
  });
});

/** Lays the element with this id out `y` px down the page (as the page scrolls), with a scroll-margin-top. */
function placeAt(id: string, y: number, margin: string) {
  const rect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.id === id ? ({ top: y - document.documentElement.scrollTop } as DOMRect) : rect.call(this);
  });
  const style = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, p) => (el instanceof Element && el.id === id ? ({ scrollMarginTop: margin } as CSSStyleDeclaration) : style(el, p)));
}

describe("scrollToElement", () => {
  const height = { current: 5000 };
  beforeEach(() => { fakeScroller(document.documentElement, height); });
  afterEach(() => { vi.restoreAllMocks(); delete (document.documentElement as { scrollTop?: number }).scrollTop; document.body.innerHTML = ""; });
  const target = () => { const el = document.createElement("li"); el.id = "t"; document.body.append(el); return el; };

  it("puts the element its scroll margin below the top of the page, wherever the page is", () => {
    const el = target();
    placeAt("t", 2233, "128px");
    scrollToElement(el);
    expect(document.documentElement.scrollTop).toBe(2105);
    scrollToElement(el); // already there: stays
    expect(document.documentElement.scrollTop).toBe(2105);
    document.documentElement.scrollTop = 3000;
    scrollToElement(el);
    expect(document.documentElement.scrollTop).toBe(2105);
  });

  it("never goes above the top, and glides when asked to", () => {
    const el = target();
    placeAt("t", 40, "48px");
    scrollToElement(el);
    expect(document.documentElement.scrollTop).toBe(0);
    const to = vi.fn();
    vi.stubGlobal("scrollTo", to);
    placeAt("t", 900, "48px");
    scrollToElement(el, "smooth");
    expect(to).toHaveBeenCalledWith({ top: 852, behavior: "smooth" });
  });
});

describe("pageTop", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  it("is the bottom edge of the sticky top bar, or the top of the screen without one", () => {
    expect(pageTop()).toBe(0);
    const bar = document.createElement("header");
    bar.id = HEADER_ID;
    bar.getBoundingClientRect = () => ({ bottom: 48 }) as DOMRect;
    document.body.append(bar);
    expect(pageTop()).toBe(48);
  });
});
