// @vitest-environment jsdom
// Predict's view switch: the chosen card's highlight is one shared-layout element (motion's layoutId), so
// switching views slides it from one card to the other instead of swapping two highlights. Motion is
// stood in for here so the test sees the props it would animate with; jsdom has no layout to measure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { forwardRef, type ReactNode } from "react";

vi.mock("../components/motion", async (orig) => {
  const real = await orig<typeof import("../components/motion")>();
  const Span = forwardRef<HTMLSpanElement, Record<string, unknown> & { children?: ReactNode }>(({ layoutId, transition: _t, initial: _i, animate: _a, ...rest }, ref) => (
    <span ref={ref} data-layout-id={layoutId as string | undefined} {...(rest as object)} />
  ));
  const m = new Proxy(real.m, { get: (t, k) => (k === "span" ? Span : (t as unknown as Record<string | symbol, unknown>)[k]) });
  return { ...real, m };
});
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026, useTitle: () => {} }));
vi.mock("../components/layout/Search", () => ({ SEARCH_HINT: "Ctrl K", usePageSearch: () => null }));

const { default: PredictPage } = await import("./PredictPage");
const { TooltipProvider } = await import("../components/ui/overlay");

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "content-type": "application/json" } }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Predict's view switch", () => {
  it("the highlight is one layoutId element that moves to the chosen card (so motion slides it)", () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    const switcher = () => within(screen.getByRole("tablist", { name: "Predict" }));
    const highlights = () => Array.from(document.querySelectorAll<HTMLElement>("[data-layout-id='predict-view-active']"));
    expect(highlights()).toHaveLength(1);
    expect(highlights()[0].closest("[role=tab]")?.textContent).toMatch(/^Scheduled/);
    fireEvent.click(switcher().getByRole("tab", { name: /Lab: advancement & matchups/ }));
    expect(highlights()).toHaveLength(1);
    expect(highlights()[0].closest("[role=tab]")?.textContent).toMatch(/^Lab: advancement & matchups/);
  });

  it("arrow keys move between the views and focus stays on the tab (the Lab's first box doesn't take it)", () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    const scheduled = screen.getByRole("tab", { name: /^Scheduled/ });
    scheduled.focus();
    fireEvent.keyDown(scheduled, { key: "ArrowRight" });
    const lab = screen.getByRole("tab", { name: /Lab: advancement & matchups/ });
    expect(lab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(lab);
  });

  it("the Lab opens on Advancement and puts focus in its empty team box", () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?view=lab"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    expect(screen.getByRole("tab", { name: /Advancement/ }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Team" }));
  });

  it("a custom matchup link opens Custom matchup with focus in its first empty box", () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?view=lab&mode=match"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Red team 1" }));
  });
});
