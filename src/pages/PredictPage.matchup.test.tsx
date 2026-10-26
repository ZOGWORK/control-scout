// @vitest-environment jsdom
// Custom matchup: a second comparison without starting over. "Swap sides" on the result predicts the same four
// teams with the alliances swapped, straight away, and the URL (shareable) follows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026, useTitle: () => {} }));

const { default: PredictPage } = await import("./PredictPage");
const { invalidate } = await import("../lib/api");
const { TooltipProvider } = await import("../components/ui/overlay");

let where = "";
function Where() { const l = useLocation(); where = l.search; return null; }
const strength = (team: number) => ({ team, name: null, np: 50, sd: 10, auto: 10, teleop: 30, endgame: 10, matches: 8 });

beforeEach(() => {
  invalidate("/api/");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", async (url: string) => {
    const u = new URL(String(url), "http://x");
    if (u.pathname === "/api/predict/match") {
      const red = u.searchParams.get("red")!.split(",").map(Number), blue = u.searchParams.get("blue")!.split(",").map(Number);
      const pRed = red[0] === 1 ? 0.7 : 0.3;
      const body = { season: 2025, red, blue, winProbRed: pRed, winProbBlue: 1 - pRed, predictedRed: 100, predictedBlue: 90, rangeRed: [80, 120], rangeBlue: [70, 110], rangeLevel: 0.8, factors: [], confidence: { tier: "moderate", reason: "r", minMatches: 8, ratingShare: 1 }, teamsRed: red.map(strength), teamsBlue: blue.map(strength), engineVersion: "x" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ events: [], seasons: [] }), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Custom matchup", () => {
  it("Swap sides predicts the swapped alliances straight away and the link follows", async () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=match&season=2025&red=1,2&blue=3,4"]}><PredictPage /><Where /></MemoryRouter></TooltipProvider>);
    expect(await screen.findByText("Red 1 + 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Swap sides/ }));
    expect(await screen.findByText("Red 3 + 4")).toBeTruthy();
    await waitFor(() => expect(new URLSearchParams(where).get("red")).toBe("3,4"));
    expect(new URLSearchParams(where).get("blue")).toBe("1,2");
    expect((screen.getByRole("textbox", { name: "Red team 1" }) as HTMLInputElement).value).toBe("3");
  });

  it("the robots' ratings fold away; the three reasons stay in view", async () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=match&season=2025&red=1,2&blue=3,4"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    expect(await screen.findByRole("heading", { name: /Why: the top 3 factors/ })).toBeTruthy();
    expect(screen.getByText(/The robots' ratings/).closest("details")?.open).toBe(false);
  });
});
