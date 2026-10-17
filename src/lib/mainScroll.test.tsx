// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router-dom";
import { useRef } from "react";
import { chase, planScroll, RESTORE_WINDOW_MS, SCROLL_IDLE_MS, ScrollPositions, useMainScroll } from "./mainScroll";

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
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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

describe("useMainScroll", () => {
  const height = { current: 5000 };
  let nav: NavigateFunction;
  let main: HTMLElement;
  function Harness() {
    const ref = useRef<HTMLElement>(null);
    useMainScroll(ref);
    nav = useNavigate();
    return <div><main id="main" ref={(n) => { if (n && n !== main) { main = n; fakeScroller(n, height); } (ref as { current: HTMLElement | null }).current = n; }}><div /></main></div>;
  }
  const scrollTo = (y: number) => act(() => { main.scrollTop = y; main.dispatchEvent(new Event("scroll")); });
  const go = (to: string | number) => act(() => { if (typeof to === "number") nav(to); else nav(to); });

  it("starts a new page at the top and restores the old one on back and forward", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/teams/4215"]}><Harness /></MemoryRouter>);
    scrollTo(1200);
    go("/rankings");
    expect(main.scrollTop).toBe(0);
    scrollTo(300);
    go(-1);
    expect(main.scrollTop).toBe(1200);
    go(1);
    expect(main.scrollTop).toBe(300);
  });

  it("waits for a short page to grow back before reaching the saved position", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/events"]}><Harness /></MemoryRouter>);
    scrollTo(3000);
    go("/events/2025/X");
    height.current = 900; // the list is loading again: the page is short
    go(-1);
    expect(main.scrollTop).toBe(100);
    height.current = 2500; act(resize);
    expect(main.scrollTop).toBe(1700);
    height.current = 6000; act(resize);
    expect(main.scrollTop).toBe(3000);
  });

  it("gives up on the restore once the reader scrolls themselves", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/events"]}><Harness /></MemoryRouter>);
    scrollTo(3000);
    go("/teams");
    height.current = 900;
    go(-1);
    act(() => { main.dispatchEvent(new Event("wheel")); });
    height.current = 6000; act(resize);
    expect(main.scrollTop).toBe(100);
  });

  it("keeps the position for a query change on the same page", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/events/2025/X"]}><Harness /></MemoryRouter>);
    scrollTo(400);
    go("/events/2025/X?tab=matches");
    expect(main.scrollTop).toBe(400);
  });

  it("marks the area as scrolling until the scroll goes quiet", () => {
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/"]}><Harness /></MemoryRouter>);
    const area = main.parentElement!;
    scrollTo(10);
    expect(area.hasAttribute("data-scrolling")).toBe(true);
    act(() => { vi.advanceTimersByTime(SCROLL_IDLE_MS - 10); });
    scrollTo(20);
    act(() => { vi.advanceTimersByTime(SCROLL_IDLE_MS - 10); });
    expect(area.hasAttribute("data-scrolling")).toBe(true);
    act(() => { vi.advanceTimersByTime(20); });
    expect(area.hasAttribute("data-scrolling")).toBe(false);
  });

  it("does not restore a stale position into a fresh page load", () => {
    sessionStorage.setItem("cs-scroll", JSON.stringify([["default", 2222]]));
    height.current = 5000;
    render(<MemoryRouter initialEntries={["/teams/4215"]}><Harness /></MemoryRouter>);
    expect(main.scrollTop).toBe(0);
    go("/rankings");
    go(-1);
    expect(main.scrollTop).toBe(0);
  });
});
