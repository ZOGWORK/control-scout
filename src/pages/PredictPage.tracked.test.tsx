// @vitest-environment jsdom
// Tracked events as quick picks on Predict: one tap shows that event. Advancement offers only events that
// advance teams; Scheduled offers every tracked event. Nothing tracked: no row, and no list asked for it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

const tracked = vi.hoisted(() => ({ events: [] as string[] }));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: tracked.events }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025, useTitle: () => {} }));

const { default: PredictPage } = await import("./PredictPage");
const { invalidate } = await import("../lib/api");
const { TooltipProvider } = await import("../components/ui/overlay");

let where = "";
function Where() { const l = useLocation(); where = l.search; return null; }
const ev = (code: string, name: string, type: string) => ({ season: 2025, code, name, type, typeLabel: type, city: "Oradell", state: "NJ", country: "USA", start: "2099-11-01", end: "2099-11-01", teams: 0, matchesPlayed: 0, matchesTotal: 0, status: "upcoming" });
const asked: string[] = [];

beforeEach(() => {
  invalidate("/api/");
  asked.length = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    asked.push(u);
    // The event detail and the simulation: not needed here.
    if (/^\/api\/events\/\d{4}\//.test(u) || u.startsWith("/api/predict/event")) return new Promise<Response>(() => {});
    const body = u === "/api/events?season=2025" ? { events: [ev("USNJQ1", "Oradell Qualifier", "Qualifier"), ev("SCRIM1", "Bergen Scrimmage", "Scrimmage")] } : { events: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); tracked.events = []; });

const page = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><PredictPage /><Where /></MemoryRouter></TooltipProvider>);
const row = async () => within(await screen.findByRole("region", { name: "Currently tracking" }));

describe("Predict, tracked events as quick picks", () => {
  it("Advancement offers the tracked events that advance teams; a tap picks one, pressed", async () => {
    tracked.events = ["2025:USNJQ1", "2025:SCRIM1"];
    page("/predict?mode=advancement&season=2025");
    const r = await row();
    await waitFor(() => expect(r.getByRole("button", { name: /Oradell Qualifier/ })).toBeTruthy());
    expect(r.queryByRole("button", { name: /Bergen Scrimmage/ })).toBeNull();
    fireEvent.click(r.getByRole("button", { name: /Oradell Qualifier/ }));
    await waitFor(() => expect(new URLSearchParams(where).get("code")).toBe("USNJQ1"));
    expect(r.getByRole("button", { name: /Oradell Qualifier/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Scheduled offers every tracked event; a tap shows its scheduled predictions", async () => {
    tracked.events = ["2025:USNJQ1", "2025:SCRIM1"];
    page("/predict?mode=scheduled");
    const r = await row();
    await waitFor(() => expect(r.getByRole("button", { name: /Bergen Scrimmage/ })).toBeTruthy());
    fireEvent.click(r.getByRole("button", { name: /Bergen Scrimmage/ }));
    await waitFor(() => expect(new URLSearchParams(where).get("for")).toBe("event:2025:SCRIM1"));
  });

  it("nothing tracked: no row", async () => {
    page("/predict?mode=scheduled");
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(screen.queryByRole("region", { name: "Currently tracking" })).toBeNull();
  });

  it("a tracked event that can't be found still picks in Scheduled, and shows as picked", async () => {
    tracked.events = ["2025:GONE1"];
    page("/predict?mode=scheduled");
    const r = await row();
    const card = await waitFor(() => r.getByRole("button", { name: /GONE1/ }));
    fireEvent.click(card);
    await waitFor(() => expect(new URLSearchParams(where).get("for")).toBe("event:2025:GONE1"));
    await waitFor(() => expect(r.getByRole("button", { name: /GONE1/ }).getAttribute("aria-pressed")).toBe("true"));
  });
});
