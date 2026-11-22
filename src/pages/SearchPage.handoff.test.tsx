// @vitest-environment jsdom
// Enter on a query the search box's dropdown has already answered: /search starts from that answer (the handoff,
// src/components/search/handoff.ts), so the results are on screen from the first frame and the loading screen is
// never shown. The page's own request then replaces them (here it never answers: what's on screen is the handoff's).
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../shared/api";
import { handOffAnswer } from "../components/search/handoff";
import { markDirect } from "../components/search/direct";

const HIT: SearchHit = { kind: "team", ref: "6980", title: "6980 | Bad Wolf", subtitle: "Oradell, NJ, USA", season: 2026, match: "exact" };
const ANSWER: SearchAnswer = { q: "6980", hits: [HIT], pages: [], step: "deterministic", weak: false };
const TOP: SearchAnswer = {
  q: "top rookie teams", step: "deterministic", weak: false, pages: [],
  hits: [{ kind: "team", ref: "19666", title: "19666 | Forever Knight", subtitle: "Austin, TX, USA", season: 2026 }],
  understood: { kind: "names", label: "Top rookie teams" },
};

// The page's own request is still on its way: nothing it answers can explain what the page shows.
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  apiFetch: () => new Promise(() => {}),
  useApi: () => ({ data: undefined, loading: false, error: null }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026 }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useServerFlag: () => false }));
vi.mock("../lib/personal", async (orig) => ({
  ...(await orig<typeof import("../lib/personal")>()),
  usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }),
}));

const { default: SearchPage } = await import("./SearchPage");

afterEach(cleanup);
const show = (url: string) => render(<MemoryRouter initialEntries={[url]}><SearchPage /></MemoryRouter>);
const loading = () => document.querySelector("[data-search-loading]");

describe("search results page, the answer Enter already had", () => {
  it("draws the handed-off answer at once: the results, never the loading screen", () => {
    handOffAnswer(ANSWER);
    show("/search?q=6980");
    expect(loading()).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Bad Wolf");
  });

  it("a submitted query keeps showing what the box handed over: Enter's mark never hides it behind the loading screen", () => {
    // The whole production path: the box answered these words, Enter marked the query for /search (a query whose
    // answer isn't in yet may name one page, src/components/search/direct.ts) and handed the answer over. The page's
    // own request is still out (the mock never answers): it draws the handoff, not the loading screen.
    markDirect("top rookie teams");
    handOffAnswer(TOP);
    show("/search?q=top%20rookie%20teams");
    expect(loading()).toBeNull();
    // The answer's page, drawn from the handoff: its title, and the team it found.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Top rookie teams");
    expect(screen.getAllByText(/Forever Knight/).length).toBeGreaterThan(0);
  });

  it("without a handed answer for these words, the same page still shows its loading screen while it asks", () => {
    handOffAnswer(ANSWER);
    show("/search?q=1234");
    expect(loading()).toBeTruthy();
    expect(screen.queryByText(/Bad Wolf/)).toBeNull();
  });
});
