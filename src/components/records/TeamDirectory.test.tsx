// @vitest-environment jsdom
// The team directory page (E1): the country filter lives in the URL (so paging, sorting,
// back/forward and copied links keep it), the counts are the server's, a listing is
// never presented as activity, and statistics still being prepared aren't shown as zero.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { DirectoryPage } from "../../shared/directory";

let page: DirectoryPage;
let asked: string[] = [];
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string | null) => { if (path) asked.push(path); return { data: page, error: undefined, loading: false, reload: () => {} }; },
}));
vi.mock("../../lib/personal", () => ({ useTeamFlags: () => ({ tracked: false, toggleTracked: () => {} }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

const base = (over: Partial<DirectoryPage> = {}): DirectoryPage => ({
  season: 2026, country: "CA", total: 120, withResults: 0, unplaced: 7, page: 1, pageSize: 50, sort: "team", dir: "asc",
  readiness: { state: "ready", resultsAt: "2026-10-17T12:00:00Z", statsAt: "2026-10-17T12:05:00Z" },
  rows: [
    { team: 30, name: "Maple", city: "Toronto", state: "ON", country: "Canada", rookieYear: 2022, hasResults: false },
    { team: 31, name: "Moose", city: null, state: null, country: "Canada", rookieYear: null, hasResults: true },
  ],
  ...over,
});

let search = "";
function Where() { search = useLocation().search; return null; }
const { TeamDirectory } = await import("./TeamDirectory");
const mount = (url: string) => render(<MemoryRouter initialEntries={[url]}><TeamDirectory season={2026} onSeason={() => {}} /><Where /></MemoryRouter>);

beforeEach(() => { asked = []; page = base(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TeamDirectory", () => {
  it("asks for the URL's country and shows its counts, without implying every listing is active", () => {
    mount("/teams?view=listed&country=CA&page=2");
    expect(asked.at(-1)).toBe("/api/directory/2026?country=CA&sort=team&dir=asc&page=2&pageSize=50");
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText(/doesn’t mean the team is active or has competed/)).toBeTruthy();
    expect(screen.getByText(/7 listings report no country/)).toBeTruthy();
    expect(screen.getByText("No results yet")).toBeTruthy();
    expect(screen.getByText("Has results")).toBeTruthy();
  });

  it("keeps the country through paging and sorting, and drops the page when the country changes", () => {
    page = base({ page: 1 });
    mount("/teams?view=listed&season=2025&country=CA");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(search).toBe("?view=listed&season=2025&country=CA&page=2");
    fireEvent.click(screen.getByRole("button", { name: /Rookie/ }));
    expect(search).toBe("?view=listed&season=2025&country=CA&sort=rookie");
    fireEvent.change(screen.getByRole("combobox", { name: "Country" }), { target: { value: "US" } });
    expect(search).toBe("?view=listed&season=2025&country=US&sort=rookie");
  });

  it("opens profiles in the season being browsed", () => {
    page = base({ season: 2025 });
    render(<MemoryRouter initialEntries={["/teams?view=listed&season=2025&country=CA"]}><TeamDirectory season={2025} onSeason={() => {}} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Maple/ }).getAttribute("href")).toBe("/teams/30?season=2025");
  });

  it("says when results are still being prepared instead of counting zero", () => {
    page = base({ readiness: { state: "preparing", resultsAt: "2026-10-17T12:00:00Z", statsAt: null } });
    mount("/teams?view=listed&country=CA");
    expect(screen.getAllByText("Being prepared").length).toBeGreaterThan(0);
    expect(screen.queryByText("No results yet")).toBeNull();
    expect(screen.getByRole("button", { name: /Check again/ })).toBeTruthy();
  });

  it("shows an unknown country as a problem (as the records tables do) rather than silently listing everyone", () => {
    page = base({ country: null });
    mount("/teams?view=listed&country=ZZ");
    expect(screen.getByText("Unknown country ZZ")).toBeTruthy();
    expect(asked).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Show every country/ }));
    expect(search).toBe("?view=listed");
    expect(asked.at(-1)).toBe("/api/directory/2026?sort=team&dir=asc&page=1&pageSize=50");
  });
});

describe("TeamDirectory on a phone", () => {
  beforeEach(() => vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })));
  const filtersButton = () => screen.getByRole("button", { name: /^Filters/, hidden: true });

  it("shows the country as a chip, the totals and the sort on short lines, the listing note on request", () => {
    mount("/teams?view=listed&country=CA&sort=rookie");
    expect(screen.getByRole("button", { name: "Remove filter: Country: Canada" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Country" })).toBeNull();
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText(/Sorted by/).textContent).toContain("rookie year");
    const about = screen.getByRole("button", { name: "What a listing means" });
    const note = document.getElementById(about.getAttribute("aria-controls")!)!;
    expect(note.hidden).toBe(true);
    fireEvent.click(about);
    expect(about.getAttribute("aria-expanded")).toBe("true");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/doesn’t mean the team is active/);
    expect(note.textContent).toMatch(/7 listings report no country/);
  });

  it("removing the country chip lists every country; the sheet holds the country and the sort", async () => {
    mount("/teams?view=listed&season=2025&country=CA&page=2");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Country: Canada" }));
    expect(search).toBe("?view=listed&season=2025");
    fireEvent.click(filtersButton());
    await screen.findByRole("dialog", { name: "Filters" });
    fireEvent.change(screen.getByRole("combobox", { name: "Country" }), { target: { value: "US" } });
    expect(search).toBe("?view=listed&season=2025&country=US");
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "name" } });
    expect(search).toBe("?view=listed&season=2025&country=US&sort=name");
    fireEvent.click(screen.getByRole("button", { name: "Show 120 teams" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
