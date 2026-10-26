// @vitest-environment jsdom
// Scheduled shows scheduled matches only: an advancing event links to its odds in Advancement (one home for
// advancement odds) instead of running a second copy of the simulation here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026, useTitle: () => {} }));

const { default: PredictPage } = await import("./PredictPage");
const { invalidate } = await import("../lib/api");
const { TooltipProvider } = await import("../components/ui/overlay");

const asked: string[] = [];
const event = (type: string) => ({ season: 2026, code: "USNJQ1", name: "Oradell Qualifier", type, typeLabel: type, city: "Oradell", state: "NJ", country: "USA", start: "2099-11-01", end: "2099-11-01", status: "upcoming" });

function serve(type: string, forecastUnsupported = false) {
  invalidate("/api/");
  asked.length = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    asked.push(u);
    const body = u === "/api/events/2026/USNJQ1" ? { event: event(type), field: [], matches: [], alliances: [], awards: [], advancement: null, forecastUnsupported } : { events: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><PredictPage /></MemoryRouter></TooltipProvider>);

describe("Scheduled, an event picked", () => {
  it("an advancing event links to its odds in Advancement, and runs no simulation here", async () => {
    serve("Qualifier");
    page("/predict?mode=scheduled&for=event:2026:USNJQ1");
    const link = await screen.findByRole("link", { name: /See advancement odds/ });
    expect(link.getAttribute("href")).toBe("/predict?mode=advancement&season=2026&code=USNJQ1");
    expect(asked.some((u) => u.startsWith("/api/predict/event"))).toBe(false);
  });

  it("an event that doesn't advance teams has no advancement link", async () => {
    serve("Scrimmage");
    page("/predict?mode=scheduled&for=event:2026:USNJQ1");
    expect(await screen.findByRole("heading", { name: "Oradell Qualifier" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /See advancement odds/ })).toBeNull();
  });
});
