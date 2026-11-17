// @vitest-environment jsdom
// The leagues list (/leagues): leagues grouped by where they play, each to its standings, each place to its region
// rankings. The league page (/leagues/:season/:region/:code): links back to its region's page and the leagues list, and
// Scout's rating, OPR and region rank beside FIRST's standing ("Not rated yet" where there's no rating), the region
// rank linking to the team's row on its region page.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { LeaguesResponse } from "../shared/regionRankings";
import type { LeagueStandings } from "../shared/leagues";

const LIST: LeaguesResponse = {
  season: 2026,
  leagues: [
    { season: 2026, region: "USNJ", code: "NE", name: "Northeast", place: "USA:NJ", placeName: "New Jersey", meetsPlayed: 2, meets: 4, teams: 18, top: { team: 17670, name: "Jersey", rs: 2.4 } },
    { season: 2026, region: "USNJ", code: "SO", name: "South", place: "USA:NJ", placeName: "New Jersey", meetsPlayed: 0, meets: 3, teams: 0, top: null },
    { season: 2026, region: "USTX", code: "LS", name: "Lone Star", place: "USA:TX", placeName: "Texas", meetsPlayed: 1, meets: 5, teams: 12, top: { team: 1, name: "One", rs: 3 } },
  ],
};
const NE: LeagueStandings = {
  season: 2026, region: "USNJ", code: "NE", name: "Northeast", location: null, place: "New Jersey", placeKey: "USA:NJ", readAt: null, meets: [],
  rows: [
    { rank: 1, team: 4215, name: "Hypnotic Robotics", wins: 4, losses: 1, ties: 0, rs: 2.4, tbp: null, played: 5, meets: 2, scout: { rating: 29.59, opr: 16.02, ratedMatches: 6, region: "USA:NJ", regionName: "New Jersey", regionRank: 39 } },
    { rank: 2, team: 9001, name: "New Team", wins: 1, losses: 1, ties: 0, rs: 1, tbp: null, played: 2, meets: 1, scout: { rating: null, opr: null, ratedMatches: 2, region: "USA:NJ", regionName: "New Jersey", regionRank: null } },
  ],
};
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => ({ data: path?.endsWith("/conferences") ? { season: 2026, region: "USNJ", code: "NE", conferences: [] } : path?.startsWith("/api/leagues/") ? NE : path?.startsWith("/api/leagues") ? LIST : undefined, error: undefined, loading: false, reload: () => {} }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {}, useMeta: () => ({ seasons: [{ season: 2026, game: "BIOBUZZ", predictable: true }] }) }));

const { default: LeaguesPage } = await import("./LeaguesPage");
const { default: LeaguePage } = await import("./LeaguePage");
afterEach(cleanup);

describe("the leagues list", () => {
  it("groups leagues by where they play, each to its standings and each place to its rankings", () => {
    render(<MemoryRouter initialEntries={["/leagues"]}><LeaguesPage /></MemoryRouter>);
    const nj = screen.getByRole("region", { name: "New Jersey" });
    expect([...nj.querySelectorAll("[data-league]")].map((a) => a.getAttribute("href"))).toEqual(["/leagues/2026/USNJ/NE", "/leagues/2026/USNJ/SO"]);
    expect(nj.textContent).toContain("2 of 4 meets played · 18 teams");
    expect(nj.textContent).toContain("#1 by RS: 17670 Jersey (2.40)");
    expect(nj.textContent).toContain("No standings yet");
    expect(within(nj).getByRole("link", { name: "New Jersey rankings →" }).getAttribute("href")).toBe("/rankings/regions/USA/NJ?season=2026");
  });
});

describe("a league's page", () => {
  const mount = () => render(<MemoryRouter initialEntries={["/leagues/2026/USNJ/NE?team=4215"]}><Routes><Route path="/leagues/:season/:region/:code" element={<LeaguePage />} /></Routes></MemoryRouter>);
  it("links back to its region's rankings and the leagues list", () => {
    mount();
    const nav = screen.getByRole("navigation", { name: "League links" });
    // A New Jersey league, no My team set: its conference rankings too.
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["New Jersey rankings", "/rankings/regions/USA/NJ?season=2026"], ["All leagues", "/leagues?season=2026"], ["View Conference Rankings", "#conferences"]]);
    expect(document.querySelector("[data-conferences]")).toBeTruthy();
  });

  it("shows Scout's numbers beside FIRST's, and Not rated yet where there's no rating", () => {
    mount();
    const rows = document.querySelectorAll("[data-league-table] tbody tr");
    expect(rows[0].textContent).toContain("2.40");
    expect(rows[0].querySelector("[data-scout-rating]")?.textContent).toBe("29.6");
    expect(rows[0].querySelector("[data-region-rank]")?.getAttribute("href")).toBe("/rankings/regions/USA/NJ?season=2026&team=4215");
    expect(rows[0].querySelector("[data-region-rank]")?.textContent).toBe("#39 NJ");
    expect(rows[1].querySelector("[data-scout-rating]")?.textContent).toBe("Not rated yet");
    expect(rows[1].querySelector("[data-region-rank]")).toBeNull();
  });
});
