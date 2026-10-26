// @vitest-environment jsdom
// Predict's three modes: semantic tabs in a fixed order, the bare page opens Advancement, arrow keys move
// between modes with focus kept on the tab, and old Lab links still open the mode they meant.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026, useTitle: () => {} }));

const { default: PredictPage } = await import("./PredictPage");
const { TooltipProvider } = await import("../components/ui/overlay");

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "content-type": "application/json" } }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><PredictPage /></MemoryRouter></TooltipProvider>);
const selected = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.getAttribute("aria-label");

describe("Predict's modes", () => {
  it("three tabs in order, Advancement first and open by default", () => {
    page("/predict");
    const tabs = within(screen.getByRole("tablist", { name: "Predict mode" })).getAllByRole("tab").map((t) => t.getAttribute("aria-label"));
    expect(tabs).toEqual(["Advancement", "Scheduled", "Custom matchup"]);
    expect(selected()).toBe("Advancement");
  });

  it("arrow keys move between the modes and focus stays on the tab (Custom matchup's first box doesn't take it)", async () => {
    page("/predict?mode=scheduled");
    const scheduled = screen.getByRole("tab", { name: /Scheduled/ });
    scheduled.focus();
    fireEvent.keyDown(scheduled, { key: "ArrowRight" });
    const match = screen.getByRole("tab", { name: /Custom matchup/ });
    // Radix moves focus on the next tick; the focused tab is the chosen one (automatic activation).
    await waitFor(() => expect(match.getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement).toBe(match);
  });

  it("old Lab links open the mode they meant", () => {
    page("/predict?view=lab&mode=match&red=1,2");
    expect(selected()).toBe("Custom matchup");
    cleanup();
    page("/predict?view=events&mode=match");
    expect(selected()).toBe("Scheduled");
  });

  it("a custom matchup link opens Custom matchup with focus in its first empty box", () => {
    page("/predict?view=lab&mode=match");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Red team 1" }));
  });
});
