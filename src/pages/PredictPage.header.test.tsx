// @vitest-environment jsdom
// Predict with a team or event picked: the header keeps the selection readable on a 320px phone with a long
// name (the full team number never breaks, the name wraps instead of truncating), Open page stays a real
// button after the identity, and Close stays a 44px target. Presentation only: the predictions are unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { EventDetail, MatchView, TeamProfile } from "../shared/api";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], videoLinks: {}, predictionHistory: [] }, update: () => true, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => ({ seasons: [2026, 2025].map((season) => ({ season, predictable: true, game: "Game" })) }), useCurrentSeason: () => 2026, useTitle: () => {} }));

const { default: PredictPage } = await import("./PredictPage");
const { TooltipProvider } = await import("../components/ui/overlay");

const LONG_TEAM = "Ñandú Robotics Collective of the Greater Metropolitan Área Homeschool Association Superlongunbrokenwordwithoutanyspaces";
const LONG_EVENT = "FIRST Tech Challenge Queensland Brisbane Southside Qualifier Number Two Presented by Very Long Sponsor Name";

const profile: TeamProfile = {
  team: { number: 18360, name: LONG_TEAM, city: "Saint-Jean-sur-Richelieu", state: "Québec", country: "Canada" }, season: 2026, seasons: [2026, 2025],
  stats: { opr: {}, rating: null, record: { wins: 0, losses: 0, ties: 0, matches: 0, events: 1 }, avg: {} },
  events: [{ code: "CAQCQ1", name: "Québec Qualifier", start: "2099-01-10", end: "2099-01-11" }], awardsAllTime: [],
} as unknown as TeamProfile;
const alliance = (teams: number[]) => ({ teams: teams.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: null });
const upcoming = (n: number, pRed: number, tier: string, code = "CAQCQ1"): MatchView => ({
  season: 2026, code, key: `qual:1:${n}`, level: "qual", series: 1, number: n, label: `Q${n}`, time: null, startsAt: null, played: false,
  red: alliance([18360, 24089]), blue: alliance([14380, 23636]), video: null,
  prediction: { pRed, redMean: 112.4, blueMean: 97.6, tier, kind: "live", predictedAt: null },
} as unknown as MatchView);
const event: EventDetail = {
  event: { season: 2026, code: "AUBRQ2", name: LONG_EVENT, type: null, typeLabel: "Qualifier", divisionCode: null, region: null, city: "Brisbane", state: "QLD", country: "Australia", venue: null, start: "2099-11-15", end: "2099-11-16", remote: false, teams: 24, matchesPlayed: 0, matchesTotal: 2, status: "upcoming", website: null, livestream: null, timezone: null, source: "first" },
  field: [], matches: [upcoming(1, 0.71, "confident", "AUBRQ2"), upcoming(2, 0.38, "moderate", "AUBRQ2")], alliances: [], awards: [], advancement: null,
  forecastUnsupported: "Not in the test", live: null,
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", async (path: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/api/teams/18360?season=2026") return json(profile);
    if (path === "/api/teams/18360/matches?season=2026") return json({ matches: [upcoming(1, 0.62, "moderate"), upcoming(2, 0.27, "provisional")] });
    if (path === "/api/events/2026/AUBRQ2") return json(event);
    if (path.startsWith("/api/events")) return json({ events: [] });
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><PredictPage /></MemoryRouter></TooltipProvider>);
/** Everything in the picked section after its header: the predictions themselves. */
const predictions = (section: HTMLElement) => [...section.children].slice(1).map((el) => el.textContent).join("\n");

describe("Predict, the picked team's header", () => {
  it("keeps the full team number unbroken and lets a long name wrap, never truncating it", async () => {
    page("/predict?for=team:18360&season=2026");
    const section = await screen.findByRole("region", { name: "Predictions for team 18360" });
    const heading = await within(section).findByRole("heading", { level: 2, name: `18360 ${LONG_TEAM}` });
    expect(heading.className).not.toMatch(/\btruncate\b|line-clamp|text-ellipsis/);
    const number = within(heading).getByText("18360");
    expect(number.className).toMatch(/whitespace-nowrap/);
    // A name with no spaces still wraps (at a 320px phone it would otherwise push Close off the card).
    expect(heading.className).toMatch(/\[overflow-wrap:anywhere\]/);
    const sub = within(section).getByText("Saint-Jean-sur-Richelieu, Québec, Canada");
    expect(sub.className).not.toMatch(/\btruncate\b/);
  });

  it("Close is a 44px target, and keyboard order is identity, then Open page, then Close", async () => {
    page("/predict?for=team:18360&season=2026");
    const section = await screen.findByRole("region", { name: "Predictions for team 18360" });
    const close = within(section).getByRole("button", { name: "Clear selection" });
    expect(close.className).toMatch(/(^|\s)size-11(\s|$)/);
    expect(close.className).not.toMatch(/(^|\s)size-(8|9|10)(\s|$)/);
    const open = within(section).getByRole("link", { name: "Open team page" });
    expect(open.getAttribute("href")).toBe("/teams/18360?season=2026");
    // Open page precedes Close in the DOM, so Tab reaches it first.
    expect(open.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // On a phone, Open page sits on its own row under the identity (not squeezing it); beside it from sm up.
    expect(open.className).toMatch(/(^|\s)row-start-2(\s|$)/);
    expect(open.className).toMatch(/sm:row-start-1/);
  });

  it("predictions are unchanged by the header (same numbers, tiers and probabilities)", async () => {
    page("/predict?for=team:18360&season=2026");
    const section = await screen.findByRole("region", { name: "Predictions for team 18360" });
    await within(section).findAllByText("Q1");
    expect(predictions(section)).toMatchSnapshot();
  });
});

describe("Predict, the picked event's header", () => {
  it("shows the whole event name and its dates, wrapping instead of truncating", async () => {
    page("/predict?for=event:2026:AUBRQ2");
    const section = await screen.findByRole("region", { name: `Predictions for ${LONG_EVENT}` });
    const heading = within(section).getByRole("heading", { level: 2, name: LONG_EVENT });
    expect(heading.className).not.toMatch(/\btruncate\b|line-clamp/);
    const sub = within(section).getByText(/Nov 15.*16.*Brisbane, QLD, Australia/);
    expect(sub.className).not.toMatch(/\btruncate\b/);
    expect(within(section).getByRole("link", { name: "Open event page" }).getAttribute("href")).toBe("/events/2026/AUBRQ2");
    expect(within(section).getByRole("button", { name: "Clear selection" }).className).toMatch(/(^|\s)size-11(\s|$)/);
  });

  it("predictions are unchanged by the header", async () => {
    page("/predict?for=event:2026:AUBRQ2");
    const section = await screen.findByRole("region", { name: `Predictions for ${LONG_EVENT}` });
    await within(section).findAllByText("Q1");
    expect(predictions(section)).toMatchSnapshot();
  });
});
