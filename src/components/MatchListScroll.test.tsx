// @vitest-environment jsdom
// A link to one match (?match=) brings it into view once. Live updates that add matches to the list
// (the playoffs being drawn) must not pull the page back to it after the reader has scrolled on.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate, useSearchParams, type NavigateFunction } from "react-router-dom";
import type { MatchView } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0 }));
const restored = vi.hoisted(() => ({ on: false }));
vi.mock("../lib/pageScroll", () => ({ restoredSavedPosition: () => restored.on, scrollToElement: (...a: unknown[]) => scrolled(...a), smoothBehavior: () => "smooth" }));

const { MatchList } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[]) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: null });
const match = (n: number): MatchView => ({
  season: 2025, code: "RPTQ1", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null, startsAt: null, played: false,
  red: side([11, 12]), blue: side([13, 14]), video: null, prediction: null,
});

const scrolled = vi.fn();
beforeEach(() => {
  scrolled.mockClear();
  Element.prototype.scrollIntoView = scrolled;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const view = (matches: MatchView[], initialOpen: string | null) => (
  <MemoryRouter><TooltipProvider><MatchList matches={matches} initialOpen={initialOpen} /></TooltipProvider></MemoryRouter>
);

it("scrolls to the linked match once, not again when matches are added", () => {
  const { rerender } = render(view([match(1), match(2)], "qual:0:2"));
  expect(scrolled).toHaveBeenCalledTimes(1);
  act(() => rerender(view([match(1), match(2), match(3)], "qual:0:2")));
  act(() => rerender(view([match(1), match(2), match(3), match(4)], "qual:0:2")));
  expect(scrolled).toHaveBeenCalledTimes(1);
});

it("waits for the linked match to arrive, and follows a new link", () => {
  const { rerender } = render(view([], "qual:0:2"));
  expect(scrolled).not.toHaveBeenCalled();
  act(() => rerender(view([match(1), match(2)], "qual:0:2")));
  expect(scrolled).toHaveBeenCalledTimes(1);
  act(() => rerender(view([match(1), match(2)], "qual:0:1")));
  expect(scrolled).toHaveBeenCalledTimes(2);
});

it("follows the same match link again on a new visit, with the list still mounted", () => {
  let nav: NavigateFunction = () => {};
  function Page() {
    nav = useNavigate();
    const [sp] = useSearchParams();
    return <TooltipProvider><MatchList matches={[match(1), match(2)]} initialOpen={sp.get("match")} /></TooltipProvider>;
  }
  render(<MemoryRouter initialEntries={["/events/2025/RPTQ1?match=qual:0:2"]}><Page /></MemoryRouter>);
  expect(scrolled).toHaveBeenCalledTimes(1);
  act(() => nav("/events/2025/RPTQ1"));
  act(() => nav("/events/2025/RPTQ1?match=qual:0:2"));
  expect(scrolled).toHaveBeenCalledTimes(2);
});

it("leaves the scroll to Back/Forward when they restored a saved position", () => {
  restored.on = true;
  try {
    render(view([match(1), match(2)], "qual:0:2"));
    expect(scrolled).not.toHaveBeenCalled();
  } finally { restored.on = false; }
});

// The list reads in schedule order whatever the API's (start-time) order: a match played late keeps its place.
it("lists matches by number, never by start time", () => {
  const { container } = render(view([match(2), match(3), match(1), match(10), match(4)], null));
  expect([...container.querySelectorAll("[data-match]")].map((r) => r.getAttribute("data-match"))).toEqual(["qual:0:1", "qual:0:2", "qual:0:3", "qual:0:4", "qual:0:10"]);
});

it("keeps the order when the first match was played last; a newest-first list says so", () => {
  const order = (c: HTMLElement) => [...c.querySelectorAll("[data-match]")].map((r) => r.getAttribute("data-match"));
  const { container, rerender } = render(view([match(2), match(3), match(4), match(1)], null));
  expect(order(container)).toEqual(["qual:0:1", "qual:0:2", "qual:0:3", "qual:0:4"]);
  act(() => rerender(view([match(2), match(1)], null)));
  expect(order(container)).toEqual(["qual:0:1", "qual:0:2"]);
  act(() => rerender(<MemoryRouter><TooltipProvider><MatchList matches={[match(1), match(4), match(2), match(3)]} newestFirst /></TooltipProvider></MemoryRouter>));
  expect(order(container)).toEqual(["qual:0:4", "qual:0:3", "qual:0:2", "qual:0:1"]);
});

const phone = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};
const liveView = (live: string | null, n = 3) => (
  <MemoryRouter><TooltipProvider><MatchList matches={Array.from({ length: n }, (_, i) => match(i + 1))} live={live} /></TooltipProvider></MemoryRouter>
);

it("marks only the live match's row, in its own place", () => {
  const { container, rerender } = render(liveView("qual:0:2"));
  const rows = [...container.querySelectorAll("[data-match]")];
  expect(rows.map((r) => r.hasAttribute("data-live"))).toEqual([false, true, false]);
  act(() => rerender(liveView(null)));
  expect(container.querySelectorAll("[data-live]")).toHaveLength(0);
});

it("on a phone, opens on the live match once per visit; elsewhere never moves the page", () => {
  phone(true);
  const { rerender } = render(liveView("qual:0:2"));
  expect(scrolled).toHaveBeenCalledTimes(1);
  expect((scrolled.mock.calls[0][0] as Element).getAttribute("data-match")).toBe("qual:0:2");
  act(() => rerender(liveView("qual:0:3")));
  expect(scrolled).toHaveBeenCalledTimes(1);
  cleanup();
  phone(false);
  render(liveView("qual:0:2"));
  expect(scrolled).toHaveBeenCalledTimes(1);
});

// The row under the mouse stands forward through a scroll too: the scroll shield takes :hover away then, so the
// list follows the pointer itself (data-focus), on pointer moves and on scrolls.
it("marks the row under the mouse, and follows it as the page scrolls under a still pointer", () => {
  const resizeCallbacks: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resizeCallbacks.push(cb); } observe() {} disconnect() {} });
  window.matchMedia = ((q: string) => ({ matches: q.includes("hover: hover"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const { container } = render(liveView("qual:0:1"));
  const row = (n: number) => container.querySelector(`[data-match="qual:0:${n}"] [data-row]`)!;
  const shield = document.createElement("div");
  let under: Element = row(2).querySelector("[data-match-label]")!;
  document.elementsFromPoint = () => [shield, under];
  const fire = (type: string, extra: object = {}) => act(() => { window.dispatchEvent(Object.assign(new Event(type), extra)); });
  fire("pointermove", { pointerType: "mouse", clientX: 10, clientY: 10 });
  expect(container.querySelectorAll("[data-focus]")).toEqual(expect.objectContaining({ length: 1 }));
  expect(row(2).hasAttribute("data-focus")).toBe(true);
  under = row(3);
  fire("scroll");
  expect(row(2).hasAttribute("data-focus")).toBe(false);
  expect(row(3).hasAttribute("data-focus")).toBe(true);
  // The list changing size under a still pointer (details opening above it) re-checks the row under it.
  under = row(2);
  act(() => { resizeCallbacks.forEach((cb) => cb()); });
  expect(row(2).hasAttribute("data-focus")).toBe(true);
  expect(row(3).hasAttribute("data-focus")).toBe(false);
  // A finger never marks a row.
  under = row(1);
  fire("pointermove", { pointerType: "touch", clientX: 10, clientY: 10 });
  expect(row(2).hasAttribute("data-focus")).toBe(true);
});

it("watches the list's size again when it comes back after an empty view", () => {
  const observed: Element[] = [];
  vi.stubGlobal("ResizeObserver", class { observe(el: Element) { observed.push(el); } disconnect() {} });
  window.matchMedia = ((q: string) => ({ matches: q.includes("hover: hover"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const { container, rerender } = render(liveView(null, 0));
  expect(observed).toHaveLength(0);
  act(() => rerender(liveView(null, 3)));
  expect(observed.at(-1)).toBe(container.querySelector(".match-list"));
});
