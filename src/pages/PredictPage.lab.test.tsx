// @vitest-environment jsdom
// The Lab's advancement view: picking another season changes the season (and clears the event, which belongs to
// the old one) in one URL write. Two writes in a row used to undo each other, so the season never changed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({
  ...(await orig<typeof import("../lib/meta")>()),
  useMeta: () => ({ seasons: [{ season: 2026, predictable: true, game: "Game A" }, { season: 2025, predictable: true, game: "Game B" }] }),
  useCurrentSeason: () => 2026, useTitle: () => {},
}));
vi.mock("../components/layout/Search", () => ({ SEARCH_HINT: "Ctrl K", usePageSearch: () => null }));

const { default: PredictPage } = await import("./PredictPage");
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
});
