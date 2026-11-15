// @vitest-environment jsdom
// The region page (/rankings/regions/USA/NJ): it asks the region API for the route's place with the URL's season, week,
// sort, page and team; shows the one-season note, this week's climbers/fallers/new teams, each row's rank in the region
// (world rank beside it), rating, record, OPR, events and rated matches; marks ?team='s row; sorting changes the URL's
// sort (never the rank numbers, which come from the server as they are); an unranked team is labeled, with no rank,
// rating or OPR; a region with no rated team says so; and its leagues link to their standings.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { RegionRankingsResponse, RegionRow } from "../shared/regionRankings";

let search = "";
let asked: string[] = [];
function Probe() { search = useLocation().search; return null; }

const row = (rank: number, team: number, o: Partial<RegionRow> = {}): RegionRow => ({
  rank, world: rank * 10, team, name: `Team ${team}`, rating: 100 - rank, opr: 90 - rank, wins: 10 - rank, losses: rank, ties: 0, events: 3, ratedMatches: 12 + rank,
  move: 0, dRating: 0, trend: "flat", ...o,
});
const NJ: RegionRankingsResponse = {
  season: 2026, week: null, asOf: "2026-11-14T00:00:00Z", baseline: "2026-11-02", weeks: ["2026-11-09", "2026-11-02"],
  region: { key: "USA:NJ", country: "USA", state: "NJ", name: "New Jersey" }, total: 3, worldRanked: 2678, stats: true, sort: "rank", page: 1, pages: 1, pageSize: 50,
  rows: [row(1, 17670, { move: 2 }), row(2, 4215, { move: -1, opr: 16.02, wins: 2, losses: 3, ties: 1, events: 1, ratedMatches: 6, rating: 28.34 }), row(3, 23314, { move: "new", trend: null })],
  climbers: [{ team: 17670, name: "Team 17670", rank: 1, rating: 99, move: 2 }], fallers: [{ team: 4215, name: "Team 4215", rank: 2, rating: 28.34, move: -1 }],
  newcomers: [{ team: 23314, name: "Team 23314", rank: 3, rating: 97 }], newTotal: 1,
  unranked: [{ team: 9001, name: "Two Matches", ratedMatches: 2 }, { team: 9002, name: "No Matches", ratedMatches: 0 }], unrankedTotal: 2,
  leagues: [{ season: 2026, region: "USNJ", code: "NE", name: "Northeast", place: "USA:NJ", placeName: "New Jersey", meetsPlayed: 2, meets: 4, teams: 18, top: { team: 17670, name: "Team 17670", rs: 2.4 } }],
};
let answer: (u: URL) => RegionRankingsResponse = () => NJ;

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    if (!path) return { data: undefined, error: undefined, loading: false, reload: () => {} };
    asked.push(path);
    const u = new URL(path, "http://x");
    return { data: u.pathname === "/api/rankings/region" ? answer(u) : undefined, error: undefined, loading: false, reload: () => {} };
  },
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {}, useMeta: () => ({ seasons: [{ season: 2026, game: "BIOBUZZ", predictable: true }, { season: 2025, game: "DECODE", predictable: true }] }) }));
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()), usePersonal: () => ({ state: { myTeam: null } }) }));

const { default: RegionRankingsPage } = await import("./RegionRankingsPage");
const mount = (url: string) => render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/rankings/regions/:country/:state?" element={<RegionRankingsPage />} /></Routes><Probe /></MemoryRouter>);
const q = () => new URLSearchParams(search);
const rowOf = (team: number) => document.querySelector<HTMLElement>(`[data-region-table] tr[data-team="${team}"]`)!;
const cells = (team: number) => [...rowOf(team).querySelectorAll("td")].map((c) => c.textContent?.trim());

afterEach(() => { cleanup(); asked = []; answer = () => NJ; });

describe("the region page", () => {
  it("asks for the route's region with the URL's season, sort, page and team", () => {
    mount("/rankings/regions/USA/NJ?season=2026&sort=opr&page=3&team=4215");
    const u = new URL(asked.find((p) => p.startsWith("/api/rankings/region"))!, "http://x");
    expect(Object.fromEntries(u.searchParams)).toEqual({ season: "2026", region: "USA:NJ", sort: "opr", page: "3", team: "4215" });
  });

  it("shows the one-season note, the week's moves and each row's numbers", () => {
    mount("/rankings/regions/USA/NJ");
    expect(document.querySelector("[data-season-note]")?.textContent).toMatch(/Ratings are only comparable inside one season\. Do not compare a 2025–26 rating to a 2026–27 rating\./);
    const movers = document.querySelector<HTMLElement>("[data-movers]")!;
    expect(within(movers).getByText("Biggest climbers")).toBeTruthy();
    expect(within(movers).getByText("Biggest fallers")).toBeTruthy();
    expect(movers.textContent).toMatch(/New to the table \(1\)/);
    // Rank 2 in New Jersey (world 20), move down 1, rating, OPR, record, events, rated matches.
    expect(cells(4215)).toEqual(["2W20", "1 down", expect.stringContaining("4215"), "28.3", "16.0", "2-3-1", "1", "6 matches", "Steady"]);
    expect(rowOf(23314).textContent).toContain("New");
  });

  it("marks the asked team's row", () => {
    mount("/rankings/regions/USA/NJ?team=4215");
    expect(rowOf(4215).hasAttribute("data-marked")).toBe(true);
    expect(rowOf(17670).hasAttribute("data-marked")).toBe(false);
  });

  it("sorting sets the URL's sort and keeps the team, never renumbering", () => {
    answer = (u) => (u.searchParams.get("sort") === "opr" ? { ...NJ, sort: "opr", rows: [NJ.rows[0], NJ.rows[2], NJ.rows[1]] } : NJ);
    mount("/rankings/regions/USA/NJ?team=4215&page=2");
    fireEvent.click(screen.getByRole("button", { name: "Sort by OPR" }));
    expect(q().get("sort")).toBe("opr");
    expect(q().get("team")).toBe("4215");
    // A new sort opens on the team's page: the page asked for goes.
    expect(q().get("page")).toBeNull();
    expect([...document.querySelectorAll("[data-region-table] [data-rank]")].map((e) => e.textContent)).toEqual(["1", "3", "2"]);
    expect(rowOf(4215).querySelector("[data-rank]")?.textContent).toBe("2");
  });

  it("labels an unranked team, with no rank, rating or OPR", () => {
    answer = () => ({ ...NJ, asked: { team: 9001, name: "Two Matches", status: "unranked", ratedMatches: 2 } });
    mount("/rankings/regions/USA/NJ?team=9001");
    expect(document.querySelector("[data-asked]")?.textContent).toBe("9001 Two Matches: Not ranked yet — 2 of 3 rated matches in 2026–27.");
    expect(rowOf(9001)).toBeNull();
    const list = document.querySelector<HTMLElement>("[data-unranked]")!;
    const li = list.querySelector<HTMLElement>('li[data-team="9001"]')!;
    expect(li.textContent).toBe("9001 Two MatchesNot ranked yet — 2 of 3 rated matches");
    expect(list.querySelector<HTMLElement>('li[data-team="9002"]')!.textContent).toContain("No rated matches yet");
  });

  it("says a region with no rated team has none, instead of an empty table", () => {
    answer = () => ({ ...NJ, region: { key: "USA:WY", country: "USA", state: "WY", name: "Wyoming" }, total: 0, rows: [], climbers: [], fallers: [], newcomers: [], newTotal: 0, leagues: [] });
    mount("/rankings/regions/USA/WY");
    expect(screen.getByText("No rated teams yet")).toBeTruthy();
    expect(document.querySelector("[data-region-table]")).toBeNull();
    expect(screen.getByText("No league plays in Wyoming in 2026–27.")).toBeTruthy();
  });

  it("lists its leagues, each to its standings, and links back to world rankings and the regions list", () => {
    mount("/rankings/regions/USA/NJ?season=2026");
    const leagues = document.querySelector<HTMLElement>("[data-region-leagues]")!;
    expect(within(leagues).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/leagues?season=2026", "/leagues/2026/USNJ/NE"]);
    expect(leagues.textContent).toContain("2 of 4 meets played · 18 teams");
    const nav = screen.getByRole("navigation", { name: "More rankings" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/rankings?season=2026&region=USA%3ANJ", "/rankings?season=2026", "/rankings/regions?season=2026"]);
  });

  it("a past week hides today's stats and says why", () => {
    answer = () => ({ ...NJ, week: "2026-11-09", stats: false, rows: NJ.rows.map((r) => ({ ...r, opr: null, wins: null, losses: null, ties: null, events: null, ratedMatches: null })) });
    mount("/rankings/regions/USA/NJ?week=2026-11-09");
    expect(screen.queryByRole("button", { name: "Sort by OPR" })).toBeNull();
    expect(document.querySelector("[data-week-note]")).toBeTruthy();
  });
});
