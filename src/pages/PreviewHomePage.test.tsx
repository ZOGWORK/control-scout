// @vitest-environment jsdom
// The v8 sample Home, second round: no headline of any kind, search first, three fixed team-number-free examples drawn
// as chips, Your team as a real card, Predict as the one solid (yellow) button and the other two actions as buttons,
// at most three events, no empty live column, and no yellow text link anywhere on the page.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { HomeOverview } from "../shared/home";
import type { MatchView } from "../shared/api";
import type { WeekendAnswer, WeekendEvent } from "../shared/weekend";
import { HOME_ABOUT } from "../shared/boot";
import { HOME_SUGGESTIONS } from "../shared/homeSuggestions";
import { pageModule } from "../shared/routes";

let data: Record<string, unknown> = {};
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    const key = path ? Object.keys(data).find((k) => path.startsWith(k)) : undefined;
    return { data: key ? data[key] : undefined, error: undefined, loading: !key, reload: () => {} };
  },
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {}, useMediaQuery: () => false, useMeta: () => null }));
const st = (myTeam: number | null) => ({ myTeam, tracked: { teams: [], events: [] }, bookmarks: [] });
let personal: { user: unknown; state: ReturnType<typeof st> } = { user: null, state: st(null) };
vi.mock("../lib/personal", () => ({ usePersonal: () => personal, hasAccountOnDevice: () => false }));

const OVERVIEW: HomeOverview = {
  season: 2026, generatedAt: "2026-11-17T12:00:00Z", dataAsOf: "2026-11-17T10:00:00Z", statsAt: null,
  coverage: { teamListings: 23, events: 4, matchScores: 9 },
  readiness: { state: "ready", resultsAt: "2026-11-17T10:00:00Z", statsAt: "2026-11-17T10:05:00Z" },
  countries: [], unmapped: [],
};
const ev = (i: number): WeekendEvent => ({
  season: 2026, code: `USXXQ${i}`, name: `Event ${i}`, type: "Qualifier", place: `Town ${i}, NJ, USA`, city: null, state: null, country: null,
  start: "2026-11-21", end: "2026-11-21", timezone: null, dates: null, teams: 20, status: "upcoming", href: `/events/2026/USXXQ${i}`,
});
const WEEKEND: WeekendAnswer = { which: "this", season: 2026, seasonLabel: "2026–27", window: { from: "2026-11-21", to: "2026-11-22", label: "Nov 21–22" }, region: null, events: [1, 2, 3, 4, 5].map(ev) };
const block = (n: number, decided: number, accuracy: number) => ({ n, decided, accuracy, upsets: decided - Math.round(decided * accuracy), brier: 0.2, baselineBrier: 0.25, byTier: { provisional: { n: 0 } } });
const record = (liveDecided: number) => ({
  engineVersion: "3.5.0", generatedAt: "2026-11-17T10:00:00Z", liveThreshold: 300, headline: null,
  seasons: [
    { season: 2025, label: "2025–26", backtest: block(41743, 41405, 0.738) },
    { season: 2026, label: "2026–27", backtest: null, live: block(Math.max(liveDecided, 12), liveDecided, 0.648) },
  ],
});

const { default: PreviewHomePage, fixedExamples, EXAMPLE_COUNT, WEEKEND_MAX, dayChip } = await import("./PreviewHomePage");
const mount = () => render(<MemoryRouter initialEntries={["/preview/home"]}><PreviewHomePage /></MemoryRouter>);

beforeEach(() => { data = {}; personal = { user: null, state: st(null) }; });
afterEach(cleanup);

describe("Sample home", () => {
  it("is its own route, so the real Home stays as it is", () => {
    expect(pageModule("/preview/home")).toBe("PreviewHomePage");
    expect(pageModule("/")).toBeNull();
  });

  it("has no headline of any kind and starts with the search field", () => {
    const { container } = mount();
    expect(container.querySelector("h1")).toBeNull();
    const field = screen.getByLabelText("Search teams, events and matches");
    expect(field.getAttribute("placeholder")).toBe("Search teams, events, matches…");
    expect(container.querySelector("input")).toBe(field);
    expect(container.querySelector("[aria-label*='by country']")).toBeNull(); // no globe
    expect(screen.getByText(HOME_ABOUT)).toBeTruthy();
  });

  it("shows three fixed examples as chips, none with a team number", () => {
    const ex = fixedExamples();
    expect(ex).toHaveLength(EXAMPLE_COUNT);
    expect(EXAMPLE_COUNT).toBe(3);
    expect(fixedExamples()).toEqual(ex);
    for (const s of ex) {
      expect(HOME_SUGGESTIONS).toContain(s);
      expect(s.q).not.toMatch(/\b\d{3,5}\b/);
    }
    const { container } = mount();
    const chips = [...container.querySelectorAll<HTMLAnchorElement>("[data-example-chip]")];
    expect(chips.map((c) => c.textContent)).toEqual(ex.map((s) => s.label ?? s.q));
    for (const [i, c] of chips.entries()) {
      expect(c.getAttribute("href")).toBe(`/search?q=${encodeURIComponent(ex[i].q)}`);
      expect(c.className).toMatch(/rounded-full/);
      expect(c.className).toMatch(/\bborder\b/);
      expect(c.className).toMatch(/tap-44/);
    }
  });

  it("draws Predict as the one solid button and the other two actions as bordered buttons", () => {
    mount();
    const steps = within(screen.getByRole("navigation", { name: "Next steps" }));
    const predict = steps.getByRole("link", { name: /Predict a match/ });
    expect(predict.getAttribute("href")).toBe("/predict");
    expect(predict.getAttribute("data-slot")).toBe("button");
    expect(predict.className).toMatch(/bg-accent\b/);
    for (const [name, href] of [["Find an event", "/events"], ["This weekend", "/weekend"]] as const) {
      const b = steps.getByRole("link", { name: new RegExp(name) });
      expect(b.getAttribute("href")).toBe(href);
      expect(b.getAttribute("data-slot")).toBe("button");
      expect(b.className).toMatch(/\bborder\b/);
      expect(b.className).not.toMatch(/bg-accent\b/);
    }
  });

  it("has no yellow text link anywhere, and one solid yellow element: Predict", () => {
    data = { "/api/home/overview": OVERVIEW, "/api/weekend": WEEKEND, "/api/predict/accuracy": record(4790) };
    const { container } = mount();
    const yellowText = [...container.querySelectorAll("a, button")].filter((el) => /\btext-accent(-text|-display)?(?![\w-])/.test(el.className)); // text-accent-ink is the dark text ON the yellow button
    expect(yellowText).toEqual([]);
    // A solid yellow fill at rest (a hover tint, "hover:bg-accent/10", is a variant, not a fill).
    const solid = [...container.querySelectorAll("[class]")].filter((el) => (el.getAttribute("class") ?? "").split(/\s+/).some((c) => /^bg-accent(\/|$)/.test(c)));
    expect(solid.map((el) => el.textContent?.trim())).toEqual(["Predict a match"]);
  });

  it("without a team, Your team is a real card with a real button", () => {
    const { container } = mount();
    const card = container.querySelector("[data-team-card]")!;
    expect(card.getAttribute("data-slot")).toBe("card");
    expect(card.className).not.toMatch(/dashed/);
    expect(within(card as HTMLElement).getByRole("button", { name: /Pick your team/ }).getAttribute("data-slot")).toBe("button");
  });

  it("with a team, the card shows its number, name, next match and the call with its tier word", () => {
    personal = { user: null, state: st(4215) };
    const next = {
      season: 2026, code: "USNJQ1", label: "Q12", played: false, startsAt: new Date(Date.now() + 3600_000).toISOString(), time: "2026-11-21T10:30:00",
      red: { teams: [{ number: 4215 }, { number: 1 }] }, blue: { teams: [{ number: 2 }, { number: 3 }] },
      prediction: { pRed: 0.64, tier: "moderate" },
    } as unknown as MatchView;
    data = {
      "/api/teams/4215/matches": { matches: [next] },
      "/api/teams-summary": { teams: [{ team: 4215, name: "Hypnotic Robotics", place: "Oradell, NJ, USA", nextEvent: { code: "USNJQ1", name: "NJ Qualifier 1", start: null, end: null, rank: null, record: null } }] },
    };
    const { container } = mount();
    const card = within(container.querySelector("[data-team-card]") as HTMLElement);
    expect(card.getByText("4215")).toBeTruthy();
    expect(card.getByText("Hypnotic Robotics")).toBeTruthy();
    expect(card.getByText(/Q12 · NJ Qualifier 1/)).toBeTruthy();
    expect(card.getByText("64%")).toBeTruthy();
    expect(card.getByText(/to win · fair/)).toBeTruthy();
  });

  it("lists at most three weekend events, one line each, and links to the rest", () => {
    data = { "/api/weekend": WEEKEND };
    const { container } = mount();
    expect(WEEKEND_MAX).toBe(3);
    const rows = container.querySelectorAll("[data-weekend-event]");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Sat 21");
    expect(screen.getByRole("link", { name: /All events/ }).getAttribute("href")).toBe("/weekend");
    expect(dayChip("2026-11-22")).toBe("Sun 22");
    expect(dayChip(null)).toBeNull();
  });

  it("puts the season in a stat row, each number a link named with its label", () => {
    data = { "/api/home/overview": OVERVIEW };
    mount();
    expect(screen.getByRole("link", { name: "23 team listings" }).getAttribute("href")).toBe("/teams");
    expect(screen.getByRole("link", { name: "4 events" }).getAttribute("href")).toBe("/events");
    expect(screen.getByRole("link", { name: "9 match scores" }).getAttribute("href")).toBe("/matches");
  });

  it("shows only the replay, and a line instead of an empty column, while no live call is decided", () => {
    data = { "/api/predict/accuracy": record(0) };
    const { container } = mount();
    const figures = container.querySelectorAll("[data-record-figure]");
    expect(figures).toHaveLength(1);
    expect(figures[0].textContent).toContain("74.8%");
    expect(screen.getByText("Live calls this season: none decided yet.")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("shows the replay and the live calls side by side once some are decided, never in yellow", () => {
    data = { "/api/predict/accuracy": record(4790) };
    const { container } = mount();
    const figures = [...container.querySelectorAll("[data-record-figure]")];
    expect(figures).toHaveLength(2);
    expect(figures[0].textContent).toContain("Replay · 2025–26");
    expect(figures[1].textContent).toContain("Live calls · 2026–27 so far");
    expect(figures[1].textContent).toContain("64.8%");
    for (const f of figures) expect(f.innerHTML).not.toMatch(/accent/);
    expect(screen.queryByText("Live calls this season: none decided yet.")).toBeNull();
  });
});
