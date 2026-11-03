// @vitest-environment jsdom
// While a search loads (just submitted from any box, or a new one run from /search itself): the loading screen
// (shapes of the results, a status line), never an older search's results left looking current. A direct visit whose
// results came with the page shows them while they refresh.
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "../shared/api";

const HIT: SearchHit = { kind: "team", ref: "6980", title: "6980 | Bad Wolf", subtitle: "Oradell, NJ, USA", season: 2026, match: "exact" };
const s = vi.hoisted(() => ({ busy: false, stale: false, hits: [] as unknown[], searchNow: vi.fn() }));
vi.mock("../components/search/SearchBox", async (orig) => ({
  ...(await orig<typeof import("../components/search/SearchBox")>()),
  useSearchHits: () => ({ hits: s.hits, answer: undefined, busy: s.busy, error: null, retry: () => {}, searchNow: s.searchNow, logPick: () => {}, stale: s.stale, prefer: "" }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data: undefined, loading: false, error: null }) }));

const { default: SearchPage } = await import("./SearchPage");

afterEach(() => { cleanup(); s.busy = false; s.stale = false; s.hits = []; s.searchNow.mockReset(); });
const show = () => render(<MemoryRouter initialEntries={["/search?q=6980"]}><SearchPage /></MemoryRouter>);
const loading = () => document.querySelector("[data-search-loading]");

describe("search results page, loading", () => {
  it("a search on its way with nothing to show: the loading screen, with its status line", () => {
    s.busy = true;
    show();
    expect(loading()).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Searching teams, events and matches…");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Searching for “6980”");
    expect(s.searchNow).toHaveBeenCalled(); // asked at once: a submitted query has no typing pause
  });
  it("a new search run from the page: the loading screen replaces the older results", () => {
    s.busy = true; s.stale = true; s.hits = [HIT];
    show();
    expect(loading()).toBeTruthy();
    expect(screen.queryByText(/Bad Wolf/)).toBeNull();
  });
  it("results that came with the page stay on screen while they refresh; answered, no loading screen", () => {
    s.busy = true; s.hits = [HIT];
    const { unmount } = show();
    expect(loading()).toBeNull();
    unmount();
    s.busy = false;
    show();
    expect(loading()).toBeNull();
  });
});
