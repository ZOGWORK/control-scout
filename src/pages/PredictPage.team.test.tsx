// @vitest-environment jsdom
// Predict with a team picked: the Lab is one click away with the team already in, and earlier seasons'
// predictions (every played match with its call, and how many were right) are a season switch away.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { MatchView, TeamProfile } from "../shared/api";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => ({ seasons: [2026, 2025, 2024].map((season) => ({ season, predictable: true, game: "Game" })) }), useCurrentSeason: () => 2026, useTitle: () => {} }));
vi.mock("../components/layout/Search", () => ({ SEARCH_HINT: "Ctrl K", usePageSearch: () => null }));

const { default: PredictPage, labMatchHref, labAdvancementHref } = await import("./PredictPage");
const { TooltipProvider } = await import("../components/ui/overlay");

const profile = (season: number, played: boolean): TeamProfile => ({
  team: { number: 4215, name: "Gearheads", city: "Oradell", state: "NJ", country: "USA" }, season, seasons: [2026, 2025, 2024],
  stats: played ? { opr: {}, rating: null, record: { wins: 2, losses: 1, ties: 0, matches: 3, events: 1 }, avg: {} } : null,
  events: [], awardsAllTime: [],
} as unknown as TeamProfile);
const alliance = (teams: number[], total: number) => ({ teams: teams.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: { total, np: total, auto: 0, teleop: 0, endgame: 0, pen: 0 } });
const played = (n: number, red: number, blue: number, pRed: number, kind: "live" | "backtest" = "live"): MatchView => ({
  season: 2025, code: "USNJQ1", key: `qual:1:${n}`, level: "qual", series: 1, number: n, label: `Q${n}`, time: null, startsAt: null, played: true,
  red: alliance([4215, 1], red), blue: alliance([2, 3], blue), video: null,
  prediction: { pRed, redMean: 0, blueMean: 0, tier: "moderate", kind, predictedAt: null },
} as unknown as MatchView);

let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  where = "";
  vi.stubGlobal("fetch", async (path: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/api/teams/4215?season=2026") return json(profile(2026, false));
    if (path === "/api/teams/4215?season=2025") return json(profile(2025, true));
    if (path === "/api/teams/4215/matches?season=2025") return json({ matches: [played(1, 100, 80, 0.7), played(2, 60, 90, 0.6), played(3, 120, 70, 0.8)] });
    if (path === "/api/teams/4215/matches?season=2024") return json({ matches: [played(1, 100, 80, 0.7), played(2, 60, 90, 0.4, "backtest"), played(3, 50, 90, 0.7, "backtest")].map((m) => ({ ...m, season: 2024 })) });
    if (path === "/api/teams/4215?season=2024") return json(profile(2024, true));
    if (path.startsWith("/api/teams/4215/matches")) return json({ matches: [] });
    if (path.startsWith("/api/events")) return json({ events: [] });
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><PredictPage /><Where /></MemoryRouter></TooltipProvider>);

describe("Predict, a team picked", () => {
  it("links into the Lab with the team filled in", () => {
    expect(labMatchHref(4215, 2025)).toBe("/predict?view=lab&mode=match&season=2025&red=4215");
    expect(labAdvancementHref(4215, 2025)).toBe("/predict?view=lab&mode=advancement&season=2025&team=4215");
  });

  it("before the team plays this season: last season's calls, how many were right, and the way into the Lab", async () => {
    page("/predict?for=team:4215");
    const box = within(await screen.findByRole("region", { name: "Predictions for team 4215" }));
    expect(await box.findByText("How the calls did in 2025–26")).toBeTruthy();
    expect(box.getByText(/No results in 2026–27 yet, so this is 2025–26/)).toBeTruthy();
    // Q1 and Q3 called right (red favoured, red won); Q2 wrong.
    expect(box.getByText("2 of 3")).toBeTruthy();
    expect(box.getByRole("link", { name: /Predict a matchup/ }).getAttribute("href")).toBe("/predict?view=lab&mode=match&season=2025&red=4215");
  });

  it("live and replayed calls are tallied apart, each named", async () => {
    page("/predict?for=team:4215&season=2024");
    const box = within(await screen.findByRole("region", { name: "Predictions for team 4215" }));
    const tally = within(await box.findByRole("list", { name: "Calls right" }));
    expect(tally.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1 of 1 live calls (logged before the match) right (100%)",
      "1 of 2 replayed calls (made afterward from only the data before each match, not live) right (50%)",
    ]);
  });

  it("an earlier season from the switch stays in the URL", async () => {
    page("/predict?for=team:4215&season=2026");
    const box = within(await screen.findByRole("region", { name: "Predictions for team 4215" }));
    expect(await box.findByText("Next matches")).toBeTruthy();
    fireEvent.click(await box.findByRole("radio", { name: /^2025–26/ }));
    await waitFor(() => expect(where).toContain("season=2025"));
    expect(await box.findByText("How the calls did in 2025–26")).toBeTruthy();
  });

  it("the view cards are solid, chosen or hovered (no see-through fill over the page grid)", () => {
    page("/predict");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).not.toMatch(/(^|\s)(hover:)?bg-[a-z-]+\/\[?0?\.?\d/);
      expect(tab.className).toMatch(/bg-card|bg-\[color-mix\(in_srgb,var\(--color-accent\)_12%,var\(--color-card\)\)\]/);
    }
  });

  it("the Lab is a card that says what it does", () => {
    page("/predict");
    const lab = screen.getByRole("tab", { name: /Lab: any matchup/ });
    expect(lab.textContent).toMatch(/any four teams/);
    fireEvent.click(lab);
    expect(where).toContain("view=lab");
  });
});
