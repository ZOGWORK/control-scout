// @vitest-environment jsdom
// /rankings on a phone: the season, a chip per place (and the week, when one is picked) and a Filters button
// in one row that wraps, so a filter's × is never off to the side (it used to sit at x350–429 inside a
// sideways strip at 390px). Each chip takes its place out of the URL; the sheet holds the place picker, My
// region and the week.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { RankingPlaces, RankingsResponse } from "../shared/rankings";

let search = "";
function Probe() { search = useLocation().search; return null; }

const answer = (places: string[], week: string | null): RankingsResponse => ({
  season: 2025, week, asOf: "2026-10-12T00:00:00Z", baseline: null, weeks: ["2026-10-12", "2026-10-05"], places, ranked: 900, total: 40, page: 1, pages: 1, pageSize: 50,
  rows: [{ rank: 1, team: 7, name: "Seven", state: "TX", country: "USA", rating: 80, move: null, dRating: null, trend: null } as unknown as RankingsResponse["rows"][number]],
});
const PLACES: RankingPlaces = { season: 2025, countries: [{ country: "USA", teams: 800, states: [{ state: "TX", teams: 90 }, { state: "OH", teams: 60 }] }], weeks: [], mine: "USA:TX" };

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    if (!path) return { data: undefined, error: undefined, loading: false, reload: () => {} };
    const u = new URL(path, "http://x");
    const data = u.pathname === "/api/rankings/places" ? PLACES
      : u.pathname === "/api/rankings" ? answer((u.searchParams.get("region") ?? "").split(",").filter(Boolean), u.searchParams.get("week")) : undefined;
    return { data, error: undefined, loading: false, reload: () => {} };
  },
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2025, useTitle: () => {}, useMeta: () => ({ seasons: [{ season: 2025, game: "DECODE", predictable: true }] }) }));
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()), usePersonal: () => ({ state: { myTeam: 7 } }) }));

const { default: RankingsPage } = await import("./RankingsPage");
const mount = (url: string) => render(<MemoryRouter initialEntries={[url]}><RankingsPage /><Probe /></MemoryRouter>);
const q = () => new URLSearchParams(search);
const filtersButton = () => screen.getByRole("button", { name: /^Filters/, hidden: true });

beforeEach(() => vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("rankings on a phone", () => {
  it("shows a chip per place and for the week, in a row that wraps rather than scrolls", () => {
    mount("/rankings?region=USA:TX,USA:OH&week=2026-10-05");
    const list = screen.getByRole("list", { name: "Filters on" });
    expect([...list.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove filter: Place: Texas", "Remove filter: Place: Ohio", expect.stringMatching(/^Remove filter: Week of /),
    ]);
    expect(list.parentElement!.className).toContain("flex-wrap");
    expect(list.parentElement!.className).not.toContain("overflow-x-auto");
    expect(screen.queryByRole("button", { name: /^Region:/ })).toBeNull();
    expect(screen.getByText(/40 of 900 rated teams/)).toBeTruthy();
  });

  it("removing a place chip keeps the other places and the week", () => {
    mount("/rankings?region=USA:TX,USA:OH&week=2026-10-05");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Place: Texas" }));
    expect(q().get("region")).toBe("USA:OH");
    expect(q().get("week")).toBe("2026-10-05");
    fireEvent.click(screen.getByRole("button", { name: /^Remove filter: Week of / }));
    expect(q().get("week")).toBeNull();
    expect(q().get("region")).toBe("USA:OH");
  });

  it("the sheet holds the place picker, My region and the week; Clear filters empties them", async () => {
    mount("/rankings?region=USA:OH&week=2026-10-05");
    fireEvent.click(filtersButton());
    await screen.findByRole("dialog", { name: "Filters" });
    expect(screen.getByRole("button", { name: /^Region:/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Week" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /My region/ }));
    expect(q().get("region")).toBe("USA:TX");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(q().get("region")).toBeNull();
    expect(q().get("week")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 40 teams" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
