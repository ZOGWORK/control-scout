// @vitest-environment jsdom
// The Lab's advancement view: picking another season changes the season (and clears the event, which belongs to
// the old one) in one URL write. Two writes in a row used to undo each other, so the season never changed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({
  ...(await orig<typeof import("../lib/meta")>()),
  useMeta: () => ({ seasons: [{ season: 2026, predictable: true, game: "Game A" }, { season: 2025, predictable: true, game: "Game B" }] }),
  useCurrentSeason: () => 2026, useTitle: () => {},
}));

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

  // The owner's report: with 4215 entered, unrelated events were listed ("its events are listed first"). Now the
  // picker suggests the team's events, and every event stays searchable (no lock-in to the team's).
  it("with a team chosen, the picker suggests its events; any event is still a search away", async () => {
    const ev = (code: string, name: string, city: string, state: string, type = "Qualifier") =>
      ({ season: 2025, code, name, type, typeLabel: type, city, state, country: "USA", start: "2025-11-01", end: "2025-11-01", teams: 0, matchesPlayed: 0, matchesTotal: 0, status: "upcoming" });
    const events = [ev("USALATQ", "Athens Qualifier", "Athens", "AL"), ev("USTXSOEDQ", "Curie Qualifier", "Edinburg", "TX"), ev("USNJNOLT", "Northern League Tournament", "Oradell", "NJ", "LeagueTournament")];
    const profile = (number: number, codes: string[]) => ({ team: { number, name: "Team" }, season: 2025, seasons: [2025, 2024], stats: null, events: codes.map((code) => ({ code })), awardsAllTime: [] });
    invalidate("/api/"); // the first test cached empty answers for these paths
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      const body = u.startsWith("/api/events") ? { events } : u.startsWith("/api/teams/4215?") ? profile(4215, ["USNJNOLT"]) : { events: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=advancement&season=2025&team=4215"]}><PredictPage /><Where /></MemoryRouter></TooltipProvider>);
    const trigger = () => document.getElementById("advancement-event") as HTMLButtonElement;
    await waitFor(() => expect(trigger()).toBeTruthy());
    // The team's events arrive, then the picker suggests them under the team's heading.
    await waitFor(() => { fireEvent.click(trigger()); expect(screen.getByText("4215's events")).toBeTruthy(); });
    const names = () => screen.queryAllByRole("option").map((o) => o.textContent ?? "");
    expect(names().some((n) => n.includes("Northern League Tournament"))).toBe(true);
    expect(names().some((n) => n.includes("Athens Qualifier"))).toBe(false);
    // City and full state names match, word by word; events outside the team's are found too.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Edinburg, Texas" } });
    expect(names().some((n) => n.includes("Curie Qualifier"))).toBe(true);
    fireEvent.click(screen.getAllByRole("option")[0]);
    await waitFor(() => expect(new URLSearchParams(where).get("code")).toBe("USTXSOEDQ"));
    expect(new URLSearchParams(where).get("team")).toBe("4215");
  });

  it("a team lookup that fails says so (with Try again); the picker still searches every event", async () => {
    invalidate("/api/");
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.startsWith("/api/teams/5555?")) return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: { "content-type": "application/json" } });
      const body = u.startsWith("/api/events") ? { events: [{ season: 2024, code: "USALATQ", name: "Athens Qualifier", type: "Qualifier", typeLabel: "Qualifier", city: "Athens", state: "AL", country: "USA", start: "2024-11-01", end: "2024-11-01", teams: 0, matchesPlayed: 0, matchesTotal: 0, status: "upcoming" }] } : { events: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=advancement&season=2024&team=5555"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Couldn't load 5555's events/));
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(document.getElementById("advancement-event")!);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Athens" } });
    expect(screen.getAllByRole("option").some((o) => o.textContent?.includes("Athens Qualifier"))).toBe(true);
  });

  it("the team is labelled optional, not a numbered step", () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=advancement&season=2025"]}><PredictPage /></MemoryRouter></TooltipProvider>);
    expect(screen.getByText("(optional)")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Team (optional)" })).toBeTruthy();
  });

  it("picking an event is a history entry, so Back returns to the one before", async () => {
    invalidate("/api/");
    const ev = (code: string, name: string) => ({ season: 2025, code, name, type: "Qualifier", typeLabel: "Qualifier", city: "Austin", state: "TX", country: "USA", start: "2099-11-01", end: "2099-11-01", teams: 0, matchesPlayed: 0, matchesTotal: 0, status: "upcoming" });
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.startsWith("/api/predict/event") || /^\/api\/events\/\d{4}\//.test(u)) return new Promise<Response>(() => {});
      return new Response(JSON.stringify(u.startsWith("/api/events") ? { events: [ev("AAQ1", "Alpha Qualifier"), ev("BBQ1", "Beta Qualifier")] } : { events: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    let back = () => {};
    function Back() { const nav = useNavigate(); back = () => nav(-1); return null; }
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=advancement&season=2025&code=AAQ1"]}><PredictPage /><Where /><Back /></MemoryRouter></TooltipProvider>);
    fireEvent.click(document.getElementById("advancement-event")!);
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "Beta" } });
    fireEvent.click(screen.getAllByRole("option")[0]);
    await waitFor(() => expect(new URLSearchParams(where).get("code")).toBe("BBQ1"));
    act(() => back());
    await waitFor(() => expect(new URLSearchParams(where).get("code")).toBe("AAQ1"));
  });

  it("Back to an entry without a team empties the team box, so it agrees with the result", async () => {
    invalidate("/api/");
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.startsWith("/api/predict/event") || /^\/api\/events\/\d{4}\//.test(u)) return new Promise<Response>(() => {});
      return new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    let back = () => {};
    function Back() { const nav = useNavigate(); back = () => nav(-1); return null; }
    let go = (_to: string) => {};
    function Go() { const nav = useNavigate(); go = (to) => nav(to); return null; }
    render(<TooltipProvider><MemoryRouter initialEntries={["/predict?mode=advancement&season=2025&code=AAQ1"]}><PredictPage /><Where /><Back /><Go /></MemoryRouter></TooltipProvider>);
    act(() => go("/predict?mode=advancement&season=2025&code=BBQ1"));
    const box = () => screen.getByRole("textbox", { name: "Team (optional)" }) as HTMLInputElement;
    fireEvent.change(box(), { target: { value: "4215" } });
    await waitFor(() => expect(new URLSearchParams(where).get("team")).toBe("4215"));
    act(() => back());
    await waitFor(() => expect(new URLSearchParams(where).get("code")).toBe("AAQ1"));
    expect(new URLSearchParams(where).get("team")).toBeNull();
    expect(box().value).toBe("");
  });
});
