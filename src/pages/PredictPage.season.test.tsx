// @vitest-environment jsdom
// An Advancement link whose event isn't in the season it opens with (the owner's report: ?code=FTCCMP1EDIS
// with for=team:4215 said "No event FTCCMP1EDIS in 2026" next to an empty team box). The team stays picked;
// a link that named no season moves to the event's own season and says so; one that named a season explains
// and offers that season or another event.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({
  ...(await orig<typeof import("../lib/meta")>()),
  useMeta: () => ({ seasons: [2026, 2025, 2024].map((season) => ({ season, predictable: true, game: "Game" })) }),
  useCurrentSeason: () => 2026, useTitle: () => {},
}));

const { default: PredictPage } = await import("./PredictPage");
const { invalidate } = await import("../lib/api");
const { TooltipProvider } = await import("../components/ui/overlay");

let where = "";
function Where() { const l = useLocation(); where = l.search; return null; }

const edison = { season: 2025, code: "FTCCMP1EDIS", name: "Edison Division", type: "FIRSTChampionship", typeLabel: "World Championship", city: "Houston", state: "TX", country: "USA", start: "2026-04-15", end: "2026-04-18" };

beforeEach(() => {
  invalidate("/api/");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  where = "";
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (u === "/api/events/2025/FTCCMP1EDIS") return json({ event: edison, field: [], matches: [], alliances: [], awards: [], advancement: null });
    if (/^\/api\/events\/\d{4}\//.test(u)) return json({ error: "No event" }, 404);
    if (u.startsWith("/api/predict/event")) return new Promise<Response>(() => {}); // the simulation: not needed here
    if (u.startsWith("/api/events")) return json({ events: [] });
    return json({ error: "nope" }, 404);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><PredictPage /><Where /></MemoryRouter></TooltipProvider>);

describe("Advancement, an event from another season", () => {
  it("a link with no season moves to the event's season, keeps the team, and says so", async () => {
    page("/predict?view=lab&mode=advancement&code=FTCCMP1EDIS&for=team:4215");
    await waitFor(() => expect(new URLSearchParams(where).get("season")).toBe("2025"));
    const q = new URLSearchParams(where);
    expect(q.get("team")).toBe("4215");
    expect(q.get("code")).toBe("FTCCMP1EDIS");
    expect(await screen.findByRole("heading", { name: "Edison Division" })).toBeTruthy();
    expect(screen.getByText("FTCCMP1EDIS is a 2025–26 event, so this shows 2025–26.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Team (optional)" }) as HTMLInputElement).value).toBe("4215");
  });

  it("the automatic season move replaces the entry, so Back doesn't land on the seasonless link and move again", async () => {
    let back = () => {};
    function Back() { const nav = useNavigate(); back = () => nav(-1); return null; }
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=scheduled", "/predict?mode=advancement&code=FTCCMP1EDIS&team=4215"]} initialIndex={1}><PredictPage /><Where /><Back /></MemoryRouter></TooltipProvider>);
    await waitFor(() => expect(new URLSearchParams(where).get("season")).toBe("2025"));
    act(() => back());
    await waitFor(() => expect(new URLSearchParams(where).get("mode")).toBe("scheduled"));
  });

  it("a link that named another season explains, and offers the event's season or another event", async () => {
    page("/predict?mode=advancement&season=2026&code=FTCCMP1EDIS&team=4215");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/FTCCMP1EDIS isn't a 2026–27 event/);
    expect(alert.textContent).toMatch(/It's from 2025–26\. Team 4215 is still picked\./);
    fireEvent.click(screen.getByRole("button", { name: "Show it in 2025–26" }));
    await waitFor(() => expect(new URLSearchParams(where).get("season")).toBe("2025"));
    expect(await screen.findByRole("heading", { name: "Edison Division" })).toBeTruthy();
  });

  it("an unknown code says so and Pick another event clears it, keeping the team", async () => {
    page("/predict?mode=advancement&season=2026&code=NOPE1&team=4215");
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert.textContent).toMatch(/No event NOPE1 in a season with predictions/));
    fireEvent.click(screen.getByRole("button", { name: /Pick another event/ }));
    const q = new URLSearchParams(where);
    expect(q.get("code")).toBeNull();
    expect(q.get("team")).toBe("4215");
  });

  it("a lookup that fails in another season is an error with Try again, not a missing event", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
      if (u === "/api/events/2026/FTCCMP1EDIS") return json({ error: "No event" }, 404);
      if (u.startsWith("/api/events/2025/")) return json({ error: "Server error" }, 500);
      return json(u.startsWith("/api/events") ? { events: [] } : { error: "No event" }, u.startsWith("/api/events?") ? 200 : 404);
    });
    page("/predict?mode=advancement&season=2026&code=FTCCMP1EDIS&team=4215");
    expect(await screen.findByRole("button", { name: /Try again/ })).toBeTruthy();
    expect(screen.queryByText(/No event FTCCMP1EDIS/)).toBeNull();
  });
});
