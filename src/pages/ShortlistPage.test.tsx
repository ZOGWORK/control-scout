// @vitest-environment jsdom
// The personal Shortlist after its rows moved to components/shortlist/PickRows (shared with the
// workspace pick list, Task 11): still the member's own list and private notes, from personal state only,
// never the workspace's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ShortlistTeam } from "../shared/api";

const h = vi.hoisted(() => ({ bookmarks: [101, 102] as number[], notes: { "101": "mine" } as Record<string, string>, updates: [] as string[] }));
vi.mock("../lib/personal", () => ({
  usePersonal: () => ({
    state: { bookmarks: h.bookmarks, shortlistNotes: h.notes }, user: null,
    stored: () => h.notes,
    update: (key: string, fn: (v: unknown) => unknown) => { h.updates.push(key); if (key === "bookmarks") h.bookmarks = fn(h.bookmarks) as number[]; return true; },
  }),
}));
vi.mock("../components/layout/Search", () => ({ useSearch: () => ({ open: () => {} }) }));

const { default: ShortlistPage } = await import("./ShortlistPage");
const { TooltipProvider } = await import("../components/ui/overlay");

const team = (n: number, opr: number, rank: number): ShortlistTeam => ({
  team: n, name: `Team ${n} name`, place: "Sydney", opr, oprRank: rank, of: 500, rating: null, ratingSd: null, record: "8-2-0",
  lastEvent: null, nextEvent: null, breakdown: { auto: null, teleop: null, endgame: null, event: null }, events: [],
});
let paths: string[] = [];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  h.bookmarks = [101, 102]; h.updates = []; paths = [];
  vi.stubGlobal("fetch", async (path: string) => {
    paths.push(path);
    if (path.startsWith("/api/shortlist")) return new Response(JSON.stringify({ season: 2025, teams: [team(101, 80, 3), team(102, 61.5, 40)] }), { status: 200 });
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ShortlistPage", () => {
  it("shows the member's own picks with inline OPR and world rank and their private notes; reorders personal state only", async () => {
    render(<TooltipProvider><MemoryRouter initialEntries={["/shortlist?season=2025"]}><ShortlistPage /></MemoryRouter></TooltipProvider>);
    await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
    expect(screen.getByText("#3")).toBeTruthy();
    expect(screen.getByLabelText("Private note on team 101")).toHaveProperty("value", "mine");
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder 102/ }), { key: "ArrowUp" });
    expect(h.bookmarks).toEqual([102, 101]);
    expect(h.updates).toEqual(["bookmarks"]);
    expect(paths.every((p) => p.startsWith("/api/shortlist"))).toBe(true);
  });

  const mount = () => render(<TooltipProvider><MemoryRouter initialEntries={["/shortlist?season=2025"]}><ShortlistPage /></MemoryRouter></TooltipProvider>);

  it("shows a first visit (an empty list) how it works, with no toggle to find it behind", () => {
    h.bookmarks = [];
    mount();
    expect(screen.getByText("Your shortlist is empty")).toBeTruthy();
    expect(screen.getByRole("region", { name: "How the shortlist works" }).textContent).toMatch(/Drag the grip to rank your picks, or focus it and use the arrow keys/);
    expect(screen.queryByRole("button", { name: /How it works/ })).toBeNull();
  });

  it("puts a returning scout's candidates first, with the instructions behind a How it works button", async () => {
    mount();
    await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
    expect(screen.queryByRole("region", { name: "How the shortlist works" })).toBeNull();
    // Compare and the other secondary actions stay visible, with their words.
    expect(screen.getByRole("link", { name: /Compare top 2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Order picks/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /CSV/ })).toBeTruthy();
    const toggle = screen.getByRole("button", { name: /How it works/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const help = screen.getByRole("region", { name: "How the shortlist works" });
    expect(toggle.getAttribute("aria-controls")).toBe(help.id);
    expect(help.textContent).toMatch(/eight named colours/);
    expect(help.textContent).toMatch(/Tick up to 4 teams to compare/);
    fireEvent.click(toggle);
    expect(screen.queryByRole("region", { name: "How the shortlist works" })).toBeNull();
  });
});
