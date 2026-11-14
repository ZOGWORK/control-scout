// @vitest-environment jsdom
// The home page's season strip with no signal: the totals this device last loaded, with the offline note; nothing
// loaded yet, no strip at all (never an error a retry can't fix, never a made-up number). Online, an error still
// says so with Try again.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, type ApiState } from "../../lib/api";
import { markOffline } from "../../lib/offline/saved";
import type { HomeOverview } from "../../shared/home";
import { SeasonCoverage } from "./HomeSections";

const OVERVIEW: HomeOverview = {
  season: 2026, generatedAt: "2026-10-17T12:00:00Z", dataAsOf: "2026-10-17T10:00:00Z", statsAt: null,
  coverage: { teamListings: 8123, events: 412, matchScores: 9050 },
  readiness: { state: "ready", resultsAt: "2026-10-17T10:00:00Z", statsAt: "2026-10-17T10:05:00Z" },
  countries: [], unmapped: [],
};
const state = (o: Partial<ApiState<HomeOverview>>): ApiState<HomeOverview> => ({ data: undefined, error: undefined, loading: false, reload: async () => {}, ...o });
const mount = (s: ApiState<HomeOverview>) => render(<MemoryRouter><SeasonCoverage state={s} /></MemoryRouter>);
const setOnline = (on: boolean) => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => on });

beforeEach(() => setOnline(true));
afterEach(() => { cleanup(); setOnline(true); });

describe("SeasonCoverage offline", () => {
  it("shows the last totals this device loaded, with the offline note", () => {
    setOnline(false);
    const kept = markOffline(structuredClone(OVERVIEW), { season: 2026, savedAt: Date.now() - 3600_000, dataAsOf: null, kept: true });
    const { container } = mount(state({ data: kept, error: new ApiError(0, "You're offline.", true) }));
    expect(screen.getByText((8123).toLocaleString())).toBeTruthy();
    expect(container.querySelector("[data-offline-kept]")?.textContent).toMatch(/Offline: last loaded on this device/);
    expect(screen.queryByText(/couldn.t load/)).toBeNull();
  });

  it("nothing loaded on this device yet: no strip, no error", () => {
    setOnline(false);
    const { container } = mount(state({ error: new ApiError(0, "You're offline.", true) }));
    expect(container.innerHTML).toBe("");
  });

  it("online, a failed load still says so with Try again", () => {
    mount(state({ error: new ApiError(503, "Request failed (503)") }));
    expect(screen.getByText(/Season totals couldn.t load/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });

  it("an answer from the server has no offline note", () => {
    const { container } = mount(state({ data: OVERVIEW }));
    expect(container.querySelector("[data-offline-kept]")).toBeNull();
  });
});
