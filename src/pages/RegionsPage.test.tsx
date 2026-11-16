// @vitest-environment jsdom
// The regions list (/rankings/regions): each country with its states, most rated teams first, the top team, the leagues
// there and a link to the region's page; searching by name narrows it; a season with no rated team says so.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { RegionsResponse } from "../shared/regionRankings";

const LIST: RegionsResponse = {
  season: 2026,
  regions: [
    { key: "USA", country: "USA", state: null, name: "USA", teams: 1500, top: { team: 1, name: "One", rating: 120 }, leagues: 40 },
    { key: "USA:TX", country: "USA", state: "TX", name: "Texas", teams: 300, top: { team: 1, name: "One", rating: 120 }, leagues: 0 },
    { key: "USA:NJ", country: "USA", state: "NJ", name: "New Jersey", teams: 111, top: { team: 17670, name: "Jersey", rating: 85.98 }, leagues: 6 },
    { key: "Romania", country: "Romania", state: null, name: "Romania", teams: 90, top: { team: 9, name: "Nine", rating: 70 }, leagues: 0 },
  ],
};
let data: RegionsResponse = LIST;
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data, error: undefined, loading: false, reload: () => {} }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {}, useMeta: () => ({ seasons: [{ season: 2026, game: "BIOBUZZ", predictable: true }] }) }));
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()), usePersonal: () => ({ state: { myTeam: null } }) }));

const { default: RegionsPage } = await import("./RegionsPage");
const mount = () => render(<MemoryRouter initialEntries={["/rankings/regions"]}><RegionsPage /></MemoryRouter>);
const keys = () => [...document.querySelectorAll("[data-region]")].map((a) => a.getAttribute("data-region"));
afterEach(() => { cleanup(); data = LIST; });

describe("the regions list", () => {
  it("lists countries with their states, most teams first, each to its page", () => {
    mount();
    expect(keys()).toEqual(["USA", "USA:TX", "USA:NJ", "Romania"]);
    const nj = document.querySelector('[data-region="USA:NJ"]')!;
    expect(nj.getAttribute("href")).toBe("/rankings/regions/USA/NJ?season=2026");
    expect(nj.textContent).toContain("#1 17670 Jersey · 86.0 · 6 leagues");
    expect(nj.textContent).toContain("111rated");
  });

  it("finds a region by name", () => {
    mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Search regions" }), { target: { value: "new jer" } });
    expect(keys()).toEqual(["USA", "USA:NJ"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Search regions" }), { target: { value: "atlantis" } });
    expect(screen.getByText("No region by that name")).toBeTruthy();
  });

  it("says so when no team is rated yet", () => {
    data = { season: 2026, regions: [] };
    mount();
    expect(screen.getByText(/No team is rated yet in 2026–27/)).toBeTruthy();
  });
});
