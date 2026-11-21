// @vitest-environment jsdom
// The Shortlist in v8 (docs/design/v8-revamp-brief.md, <html data-v8>), rebuilt around "who do we pick?": the ranked
// list is first under the title; Compare is the one primary; ordering, CSV and the instructions wait in More; the
// pick numbers are neutral but for #1 in the accent; OPR, rank and record are white or grey, never coloured.
// With v8 off the page is drawn as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ShortlistTeam } from "../shared/api";

const h = vi.hoisted(() => ({ bookmarks: [101, 102] as number[] }));
vi.mock("../lib/personal", () => ({
  usePersonal: () => ({
    state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: h.bookmarks, shortlistNotes: {} }, user: null,
    stored: () => ({}), update: () => true,
  }),
}));

const { default: ShortlistPage } = await import("./ShortlistPage");
const { TooltipProvider } = await import("../components/ui/overlay");

const team = (n: number, opr: number, rank: number): ShortlistTeam => ({
  team: n, name: `Team ${n} name`, place: "Sydney", opr, oprRank: rank, of: 500, rating: null, ratingSd: null, record: "8-2-0",
  lastEvent: null, nextEvent: null, breakdown: { auto: null, teleop: null, endgame: null, event: null }, events: [],
});

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  h.bookmarks = [101, 102];
  vi.stubGlobal("fetch", async (path: string) => {
    if (path.startsWith("/api/shortlist")) return new Response(JSON.stringify({ season: 2025, teams: [team(101, 80, 3), team(102, 61.5, 40)] }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

const page = () => render(<TooltipProvider><MemoryRouter initialEntries={["/shortlist?season=2025"]}><ShortlistPage /></MemoryRouter></TooltipProvider>);
/** The default (primary) Button variant's own fill. */
const primaries = () => [...document.querySelectorAll('[data-slot="button"]')].filter((b) => b.className.includes("bg-accent text-accent-ink"));

describe("Shortlist, v8 on", () => {
  beforeEach(() => { document.documentElement.setAttribute("data-v8", ""); });

  it("opens on the ranked list with Compare as the one primary and the rest in More", async () => {
    page();
    await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
    expect(document.querySelector("[data-shortlist-v8]")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Shortlist");
    expect(primaries().map((b) => b.textContent!.trim())).toEqual(["Compare top 2"]);
    expect(screen.getByRole("button", { name: "More shortlist actions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Order picks/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^CSV$/ })).toBeNull();
  });

  it("pick #1 alone carries the accent; the numbers are not coloured", async () => {
    page();
    await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
    const [first, second] = screen.getAllByRole("img", { name: /^Pick \d$/ });
    expect(first.className).toContain("v8:text-accent");
    expect(second.className).not.toContain("v8:text-accent");
    expect(screen.getByText("#3").className).toContain("v8:text-text-muted");
  });

  it("an empty list is one empty state with the add box", () => {
    h.bookmarks = [];
    page();
    const empty = document.querySelector("[data-v8-empty]")!;
    expect(empty.textContent).toContain("Your shortlist is empty");
    expect(empty.querySelector('[role="combobox"]')).not.toBeNull();
  });
});

describe("Shortlist, v8 off", () => {
  it("is drawn as before", async () => {
    page();
    await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
    expect(document.querySelector("[data-shortlist-v8]")).toBeNull();
    expect(screen.getByRole("button", { name: /Order picks/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /CSV/ })).toBeTruthy();
  });
});
