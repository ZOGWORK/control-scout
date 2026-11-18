// @vitest-environment jsdom
// The v8 sample Home: it starts with the search field and has no headline of any kind (no H1, not even a hidden one);
// its examples are the same on every visit and hold no team number; the next steps are plain links; no globe; and the
// track record's two figures sit side by side, each labelled, never blended, without the accent colour.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { HomeOverview } from "../shared/home";
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

const { default: PreviewHomePage, fixedExamples, EXAMPLE_COUNT } = await import("./PreviewHomePage");
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
    // The field is the page's first control.
    expect(container.querySelector("input")).toBe(field);
  });

  it("shows the same examples every visit, one of each kind, none with a team number", () => {
    const ex = fixedExamples();
    expect(ex).toHaveLength(EXAMPLE_COUNT);
    expect(fixedExamples()).toEqual(ex);
    expect(new Set(ex.map((s) => s.kind)).size).toBe(ex.length);
    for (const s of ex) {
      expect(HOME_SUGGESTIONS).toContain(s);
      expect(s.q).not.toMatch(/\b\d{3,5}\b/);
    }
    mount();
    for (const s of ex) expect(screen.getByRole("link", { name: s.label ?? s.q }).getAttribute("href")).toBe(`/search?q=${encodeURIComponent(s.q)}`);
  });

  it("has the next steps as plain links, the free note, and no globe", () => {
    const { container } = mount();
    const steps = within(screen.getByRole("navigation", { name: "Next steps" }));
    expect(steps.getByRole("link", { name: "Predict a match" }).getAttribute("href")).toBe("/predict");
    expect(steps.getByRole("link", { name: "Find an event" }).getAttribute("href")).toBe("/events");
    expect(steps.getByRole("link", { name: "This weekend" }).getAttribute("href")).toBe("/weekend");
    expect(screen.getByText(HOME_ABOUT)).toBeTruthy();
    expect(container.querySelector("[aria-label*='by country']")).toBeNull();
    expect(screen.getByRole("button", { name: /Find your team/ })).toBeTruthy();
  });

  it("puts the season in one line of links, with no made-up numbers while loading", () => {
    mount();
    expect(screen.queryByText(/team listings/)).toBeNull();
    cleanup();
    data = { "/api/home/overview": OVERVIEW };
    mount();
    expect(screen.getByRole("link", { name: "23 team listings" }).getAttribute("href")).toBe("/teams");
    expect(screen.getByRole("link", { name: "4 events" }).getAttribute("href")).toBe("/events");
    expect(screen.getByRole("link", { name: "9 match scores" }).getAttribute("href")).toBe("/matches");
  });

  it("shows the replay and the live calls side by side, each labelled, never in the accent colour", () => {
    const block = (n: number, decided: number, accuracy: number) => ({ n, decided, accuracy, upsets: decided - Math.round(decided * accuracy), brier: 0.2, baselineBrier: 0.25, byTier: { provisional: { n: 0 } } });
    data = {
      "/api/predict/accuracy": {
        engineVersion: "3.5.0", generatedAt: "2026-11-17T10:00:00Z", liveThreshold: 300, headline: null,
        seasons: [
          { season: 2025, label: "2025–26", backtest: block(41743, 41405, 0.738) },
          { season: 2026, label: "2026–27", backtest: null, live: block(4800, 4790, 0.648) },
        ],
      },
    };
    mount();
    const record = within(screen.getByRole("region", { name: "Prediction record" }));
    expect(record.getByText("Replay · 2025–26")).toBeTruthy();
    expect(record.getByText("74.8%")).toBeTruthy(); // engine 3.5's month-by-month replay, as the live Home shows it
    expect(record.getByText("Live calls · 2026–27 so far")).toBeTruthy();
    expect(record.getByText("64.8%")).toBeTruthy();
    for (const v of ["74.8%", "64.8%"]) expect(record.getByText(v).className).not.toMatch(/accent/);
  });
});
