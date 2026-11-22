// @vitest-environment jsdom
// A cold /search draws the server's first paint at once (src/lib/searchBoot.ts), and only for the visit that was
// opened with it: words come back to later (a link, Back) arrive with nothing in hand and wait for their own answer,
// as a search box's handoff does (src/components/search/handoff.ts).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../shared/api";

const HIT: SearchHit = { kind: "team", ref: "6980", title: "6980 | Bad Wolf", subtitle: "Oradell, NJ, USA", season: 2026, match: "exact" };
const ANSWER: SearchAnswer = { q: "6980", hits: [HIT], pages: [], step: "deterministic", weak: false };
const OTHER: SearchAnswer = {
  q: "top rookie teams", step: "deterministic", weak: false, pages: [],
  hits: [{ kind: "team", ref: "19666", title: "19666 | Forever Knight", subtitle: "Austin, TX, USA", season: 2026 }],
  understood: { kind: "names", label: "Top rookie teams" },
};

// This document was opened cold at /search?q=6980: its first paint is what the server sent with it.
vi.mock("../lib/searchBoot", () => ({ BOOT_HITS: { q: "6980", hits: [{ kind: "team", ref: "6980", title: "6980 | Bad Wolf", subtitle: "Oradell, NJ, USA", season: 2026, match: "exact" }] }, readBootHits: () => null }));

// The page's own requests: each waits until a test answers it, so what's on screen is never its answer by accident.
const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })),
  useApi: () => ({ data: undefined, loading: false, error: null }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026 }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useServerFlag: () => false }));
vi.mock("../lib/personal", async (orig) => ({
  ...(await orig<typeof import("../lib/personal")>()),
  usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }),
}));

const { default: SearchPage } = await import("./SearchPage");

afterEach(() => { cleanup(); pending.length = 0; });
const loading = () => document.querySelector("[data-search-loading]");
const answer = async (match: RegExp, body: unknown) => {
  const i = pending.findIndex((p) => match.test(p.url));
  expect(i, `a request for ${match}`).toBeGreaterThanOrEqual(0);
  const [p] = pending.splice(i, 1);
  await act(async () => { p.resolve(body); });
};
function Where() { const at = useLocation(); return <p data-testid="at">{at.pathname}{at.search}</p>; }
function Go({ to, label }: { to: string; label: string }) {
  const nav = useNavigate();
  return <button type="button" onClick={() => nav(to)}>{label}</button>;
}

describe("search results page opened cold", () => {
  it("draws its first paint at once, and that seeds only the visit it was painted for", async () => {
    render(
      <MemoryRouter initialEntries={["/search?q=6980"]}>
        <SearchPage /><Where />
        <Go to="/search?q=top%20rookie%20teams" label="another" />
        <Go to="/search?q=6980" label="back to it" />
      </MemoryRouter>,
    );
    // Cold at /search?q=6980: the server's links are on screen from the first frame, no loading screen.
    expect(loading()).toBeNull();
    expect(screen.getAllByText(/Bad Wolf/).length).toBeGreaterThan(0);
    // Away to another query, which answers itself…
    fireEvent.click(screen.getByRole("button", { name: "another" }));
    await answer(/q=top%20rookie%20teams&/, OTHER);
    pending.length = 0;
    // …and back: this visit arrived with nothing in hand, so it waits for its own answer instead of drawing the
    // first paint's links again.
    fireEvent.click(screen.getByRole("button", { name: "back to it" }));
    expect(screen.getByTestId("at").textContent).toBe("/search?q=6980");
    expect(loading()).toBeTruthy();
    await answer(/q=6980&/, ANSWER);
    expect(loading()).toBeNull();
  });
});
