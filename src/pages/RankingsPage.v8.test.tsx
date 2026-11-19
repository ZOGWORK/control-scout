// @vitest-environment jsdom
// The rankings area in v8 (docs/design/v8-revamp-brief.md §5 Tables, <html data-v8>): the rankings sub-nav is a tab
// strip (the current page white with the slate-blue line); the table has no box, a quiet head and 44px rows; #1 is the
// only rank in the accent; your team's row is white (a white edge, never the accent); the explanations sit behind one
// disclosure under the table; the league table (server-drawn first paint) is styled by CSS alone. With v8 off, every
// page draws as before: no tabs, the season note in its card, the swing line under the table.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { RegionRankingsResponse, RegionRow } from "../shared/regionRankings";
import type { RankingsResponse, RankingRow } from "../shared/rankings";
import type { LeagueStandingRow } from "../shared/leagues";

const regionRow = (rank: number, team: number, o: Partial<RegionRow> = {}): RegionRow => ({
  rank, world: rank * 10, team, name: `Team ${team}`, rating: 100 - rank, opr: 90 - rank, wins: 10 - rank, losses: rank, ties: 0, events: 3, ratedMatches: 12 + rank,
  move: 0, dRating: 0, trend: "flat", swing: 3, ...o,
} as unknown as RegionRow);
const NJ: RegionRankingsResponse = {
  season: 2026, week: null, asOf: "2026-11-14T00:00:00Z", baseline: "2026-11-02", weeks: ["2026-11-09"],
  region: { key: "USA:NJ", country: "USA", state: "NJ", name: "New Jersey" }, total: 3, worldRanked: 2678, stats: true, sort: "rank", page: 1, pages: 1, pageSize: 50,
  rows: [regionRow(1, 17670, { move: 2 }), regionRow(2, 4215, { move: -1, dRating: -1.2 }), regionRow(3, 23314, { move: "new", trend: null })],
  climbers: [{ team: 17670, name: "Team 17670", rank: 1, rating: 99, move: 2 }], fallers: [{ team: 4215, name: "Team 4215", rank: 2, rating: 98, move: -1 }],
  newcomers: [], newTotal: 0, unranked: [], unrankedTotal: 0, leagues: [],
};
const worldRow = (rank: number, team: number): RankingRow => ({ rank, team, name: `Team ${team}`, country: "USA", state: "NJ", rating: 90 - rank, dRating: 0, move: 0, trend: "flat", swing: 2 } as unknown as RankingRow);
const WORLD: RankingsResponse = {
  season: 2026, week: null, asOf: "2026-11-14T00:00:00Z", baseline: "2026-11-02", weeks: [], places: [], total: 2, ranked: 2, page: 1, pages: 1, pageSize: 50,
  rows: [worldRow(1, 17670), worldRow(2, 4215)],
} as unknown as RankingsResponse;

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    const u = path ? new URL(path, "http://x") : null;
    const data = u?.pathname === "/api/rankings/region" ? NJ : u?.pathname === "/api/rankings" ? WORLD : undefined;
    return { data, error: undefined, loading: false, reload: () => {} };
  },
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {}, useMeta: () => ({ seasons: [{ season: 2026, game: "BIOBUZZ", predictable: true }] }) }));
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()), usePersonal: () => ({ state: { myTeam: 4215 } }) }));

const { default: RegionRankingsPage } = await import("./RegionRankingsPage");
const { default: RankingsPage } = await import("./RankingsPage");
const { LeagueTable } = await import("../components/LeagueTable");
const { RankingsTabs } = await import("../components/rankings/v8");

const region = () => render(<MemoryRouter initialEntries={["/rankings/regions/USA/NJ"]}><Routes><Route path="/rankings/regions/:country/:state?" element={<RegionRankingsPage />} /></Routes></MemoryRouter>);
const world = () => render(<MemoryRouter initialEntries={["/rankings"]}><Routes><Route path="/rankings" element={<RankingsPage />} /></Routes></MemoryRouter>);
const v8 = (on: boolean) => { if (on) document.documentElement.setAttribute("data-v8", ""); else document.documentElement.removeAttribute("data-v8"); };
const cls = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

beforeEach(() => v8(true));
afterEach(() => { cleanup(); v8(false); });

describe("rankings in v8", () => {
  it("has the rankings tabs, the current page marked", () => {
    region();
    const tabs = screen.getByRole("navigation", { name: "Rankings" });
    const current = tabs.querySelector("[aria-current=page]");
    expect(current?.textContent).toBe("Regions");
    expect(current?.querySelector(".bg-accent")).toBeTruthy();
    expect([...tabs.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/rankings", "/rankings/regions", "/leagues", "/power-rankings"]);
  });

  it("draws the table with no box, 44px rows, #1 alone in the accent and your team in white", () => {
    region();
    const frame = document.querySelector("[data-region-table]");
    expect(cls(frame)).toEqual(expect.arrayContaining(["v8:border-0", "v8:bg-transparent"]));
    const row = (t: number) => document.querySelector(`[data-region-table] tr[data-team="${t}"]`)!;
    expect(cls(row(17670))).toContain("v8:h-11");
    expect(cls(row(17670).querySelector("[data-rank]"))).toContain("v8:text-accent");
    expect(cls(row(4215).querySelector("[data-rank]"))).not.toContain("v8:text-accent");
    // Yours: a white edge (text-base), never the accent.
    expect(cls(row(4215))).toContain("v8:shadow-[inset_2px_0_0_var(--color-text-base)]");
    expect(row(4215).className).not.toMatch(/v8:shadow-\[inset_2px_0_0_var\(--color-accent\)\]/);
    // Falling is muted, not red.
    expect(cls(row(4215).querySelector("td:nth-child(2) span"))).toContain("v8:text-text-muted");
  });

  it("puts the explanations behind one disclosure under the table", () => {
    region();
    const d = document.querySelector("details[data-disclosure]")!;
    expect(d.querySelector("summary")?.textContent).toBe("How region rankings work");
    expect(d.querySelector("[data-season-note]")?.textContent).toMatch(/Ratings are only comparable inside one season/);
    expect(document.querySelectorAll("[data-season-note]")).toHaveLength(1);
    expect(d.textContent).toMatch(/Swing/);
  });

  it("world rankings: the swing line moves into the disclosure, and the regions link is the tab", () => {
    world();
    expect(screen.getByRole("navigation", { name: "Rankings" }).querySelector("[aria-current=page]")?.textContent).toBe("World");
    expect(document.querySelector("details[data-disclosure] [data-swing-line]")).toBeTruthy();
    expect(document.querySelectorAll("[data-swing-line]")).toHaveLength(1);
    const mine = document.querySelector("tr[data-mine]")!;
    expect(mine.getAttribute("data-team")).toBe("4215");
    expect(cls(mine)).toContain("v8:shadow-[inset_2px_0_0_var(--color-text-base)]");
  });

  it("the league table, drawn on the server too, is styled by v8: classes alone", () => {
    const rows = [{ rank: 1, team: 1, name: "A", rs: 2, wins: 1, losses: 0, ties: 0, played: 3, meets: 1 }, { rank: 2, team: 2, name: "B", rs: 1, wins: 0, losses: 1, ties: 0, played: 3, meets: 1 }] as unknown as LeagueStandingRow[];
    render(<MemoryRouter><LeagueTable rows={rows} season={2026} team={2} frameless /></MemoryRouter>);
    expect(cls(document.querySelector("[data-league-table]"))).toEqual(expect.arrayContaining(["v8:border-0", "v8:bg-transparent"]));
    expect(cls(document.querySelector("tr[data-marked]"))).toContain("v8:shadow-[inset_2px_0_0_var(--color-text-base)]");
  });
});

describe("rankings with v8 off", () => {
  beforeEach(() => v8(false));

  it("has no tabs, keeps the season note card and the table's own notes", () => {
    region();
    expect(screen.queryByRole("navigation", { name: "Rankings" })).toBeNull();
    expect(document.querySelector("details[data-disclosure]")).toBeNull();
    expect(cls(document.querySelector("[data-season-note]"))).toEqual(expect.arrayContaining(["rounded-lg", "border", "bg-card"]));
    expect(document.querySelector("[data-region-table]")?.textContent).toMatch(/Sorted by rank/);
  });

  it("world rankings keep the swing line under the table and the regions link", () => {
    world();
    expect(document.querySelector("[data-swing-line]")?.closest("details")).toBeNull();
    expect(screen.getByRole("link", { name: "Rankings by region" })).toBeTruthy();
  });

  it("the server-drawn tabs are in the markup but hidden by CSS until v8", () => {
    render(<MemoryRouter><RankingsTabs at="leagues" season={2025} ssr /></MemoryRouter>);
    const nav = screen.getByRole("navigation", { name: "Rankings" });
    expect(cls(nav)).toEqual(expect.arrayContaining(["hidden", "v8:flex"]));
    expect(nav.querySelector("[aria-current=page]")?.getAttribute("href")).toBe("/leagues?season=2025");
  });
});
