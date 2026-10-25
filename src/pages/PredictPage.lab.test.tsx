// @vitest-environment jsdom
// The Lab's advancement view: picking another season changes the season (and clears the event, which belongs to
// the old one) in one URL write. Two writes in a row used to undo each other, so the season never changed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({
  ...(await orig<typeof import("../lib/meta")>()),
  useMeta: () => ({ seasons: [{ season: 2026, predictable: true, game: "Game A" }, { season: 2025, predictable: true, game: "Game B" }] }),
  useCurrentSeason: () => 2026, useTitle: () => {},
}));
vi.mock("../components/layout/Search", () => ({ SEARCH_HINT: "Ctrl K", usePageSearch: () => null }));

const { default: PredictPage } = await import("./PredictPage");
const { invalidate } = await import("../lib/api");
const { TooltipProvider } = await import("../components/ui/overlay");

let where = "";
function Where() { const l = useLocation(); where = l.search; return null; }

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "content-type": "application/json" } }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Predict Lab: advancement", () => {
  it("changes the season and clears the old season's event", () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?view=lab&mode=advancement&season=2026&code=USXXQ1&team=4215"]}><PredictPage /><Where /></MemoryRouter></TooltipProvider>);
    fireEvent.click(screen.getByRole("radio", { name: /2025–26/ }));
    const q = new URLSearchParams(where);
    expect(q.get("season")).toBe("2025");
    expect(q.get("code")).toBeNull();
    expect(q.get("team")).toBe("4215");
  });

  // The owner's report: with 4215 entered, unrelated events were listed ("its events are listed first").
  it("with a team chosen, lists only its events; a team registered nowhere gets an empty state, not other events", async () => {
    const ev = (code: string, name: string, city: string, state: string, type = "Qualifier") =>
      ({ season: 2025, code, name, type, typeLabel: type, city, state, country: "USA", start: "2025-11-01", end: "2025-11-01", teams: 0, matchesPlayed: 0, matchesTotal: 0, status: "upcoming" });
    const events = [ev("USALATQ", "Athens Qualifier", "Athens", "AL"), ev("USTXSOEDQ", "Curie Qualifier", "Edinburg", "TX"), ev("USNJNOLT", "Northern League Tournament", "Oradell", "NJ", "LeagueTournament")];
    const profile = (number: number, codes: string[]) => ({ team: { number, name: "Team" }, season: 2025, seasons: [2025, 2024], stats: null, events: codes.map((code) => ({ code })), awardsAllTime: [] });
    invalidate("/api/"); // the first test cached empty answers for these paths
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      const body = u.startsWith("/api/events") ? { events } : u.startsWith("/api/teams/4215?") ? profile(4215, ["USNJNOLT"]) : u.startsWith("/api/teams/7777?") ? profile(7777, []) : { events: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?view=lab&mode=advancement&season=2025&team=4215"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    await waitFor(() => expect(screen.getByText("Northern League Tournament")).toBeTruthy());
    expect(screen.queryByText("Athens Qualifier")).toBeNull();
    expect(screen.queryByText("Curie Qualifier")).toBeNull();
    cleanup();

    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?view=lab&mode=advancement&season=2025&team=7777"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    await waitFor(() => expect(screen.getByText("7777 isn't registered for any 2025–26 event yet")).toBeTruthy());
    expect(screen.queryByText("Athens Qualifier")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search all events" }));
    expect(screen.getByText("Athens Qualifier")).toBeTruthy();
    // City and full state names match, word by word.
    fireEvent.change(screen.getByRole("textbox", { name: "Find an event" }), { target: { value: "Edinburg, Texas" } });
    expect(screen.getByText("Curie Qualifier")).toBeTruthy();
    expect(screen.queryByText("Athens Qualifier")).toBeNull();
  });
});
