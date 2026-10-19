// @vitest-environment jsdom
// The team directory page (E1): the country filter lives in the URL (so paging, sorting,
// back/forward and copied links keep it), the counts are the server's, a listing is
// never presented as activity, and statistics still being prepared aren't shown as zero.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
afterEach(cleanup);

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

  it("says when results are still being prepared instead of counting zero", () => {
    page = base({ readiness: { state: "preparing", resultsAt: "2026-10-17T12:00:00Z", statsAt: null } });
    mount("/teams?view=listed&country=CA");
    expect(screen.getAllByText("Being prepared").length).toBeGreaterThan(0);
    expect(screen.queryByText("No results yet")).toBeNull();
    expect(screen.getByRole("button", { name: /Check again/ })).toBeTruthy();
  });

  it("shows an unknown country rather than silently listing everyone", () => {
    page = base({ country: null });
    mount("/teams?view=listed&country=ZZ");
    expect(screen.getByText(/“ZZ” isn’t a country code we know/)).toBeTruthy();
    expect(asked.at(-1)).toBe("/api/directory/2026?sort=team&dir=asc&page=1&pageSize=50");
  });
});
