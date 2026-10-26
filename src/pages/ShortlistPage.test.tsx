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

  describe("adding a team on the page", () => {
    const hit = (n: number, name: string) => ({ kind: "team", ref: String(n), title: `${n} ${name}`, subtitle: "Perth, WA" });
    // Search answers with these teams (or fails); the shortlist itself answers as above.
    const searchWith = (hits: ReturnType<typeof hit>[] | "down") => vi.stubGlobal("fetch", async (path: string) => {
      paths.push(path);
      if (path.startsWith("/api/shortlist")) return new Response(JSON.stringify({ season: 2025, teams: [team(101, 80, 3), team(102, 61.5, 40)] }), { status: 200 });
      if (path.startsWith("/api/search")) {
        if (hits === "down") throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ hits }), { status: 200 });
      }
      throw new Error(`unexpected ${path}`);
    });
    const field = () => screen.getByRole("combobox", { name: "Add a team to your shortlist" });
    const type = (text: string) => { fireEvent.focus(field()); fireEvent.change(field(), { target: { value: text } }); };

    it("sits by Order picks: a team picked from the matches goes to the end of the personal list", async () => {
      searchWith([hit(5001, "Gearheads")]);
      mount();
      await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
      type("gear");
      const option = await screen.findByRole("option", { name: /5001.*Gearheads/ });
      fireEvent.mouseDown(option);
      await waitFor(() => expect(h.bookmarks).toEqual([101, 102, 5001]));
      expect(h.updates).toEqual(["bookmarks"]);
      expect(await screen.findByText("Added 5001 Gearheads to your shortlist as pick 3", { selector: ".sr-only" })).toBeTruthy();
    });

    it("marks teams already on the list, and picking one again doesn't add it twice", async () => {
      searchWith([hit(101, "Team 101 name"), hit(5002, "Other")]);
      mount();
      await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
      type("101");
      // Search's answer: the team on the list is marked, the other one isn't.
      expect((await screen.findByRole("option", { name: /5002.*Other/ })).textContent).not.toMatch(/On your shortlist/);
      const mine = screen.getByRole("option", { name: /101.*On your shortlist/ });
      fireEvent.mouseDown(mine);
      expect((await screen.findByRole("alert")).textContent).toBe("101 is already on your shortlist.");
      expect(h.bookmarks).toEqual([101, 102]);
      expect(h.updates).toEqual([]);
    });

    it("says when search finds nothing, and turns down a number that isn't a team", async () => {
      searchWith([]);
      mount();
      await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
      type("zzzz");
      expect(await screen.findByText("No team matches “zzzz”.", { selector: "li" })).toBeTruthy();
      type("99991");
      fireEvent.keyDown(await screen.findByRole("combobox", { expanded: true }), { key: "Enter" });
      expect((await screen.findByRole("alert")).textContent).toMatch(/There's no FTC team 99991 on record/);
      expect(h.bookmarks).toEqual([101, 102]);
    });

    it("says when search can't be reached, and still adds a typed number (no signal at a venue)", async () => {
      searchWith("down");
      mount();
      await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
      type("5003");
      expect(await screen.findByText(/Search isn't reachable right now/, { selector: "li" })).toBeTruthy();
      fireEvent.keyDown(field(), { key: "Enter" });
      await waitFor(() => expect(h.bookmarks).toEqual([101, 102, 5003]));
    });

    it("doesn't announce or offer Undo for a team another tab added during the check", async () => {
      searchWith([hit(5005, "Late")]);
      mount();
      await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
      type("late");
      const option = await screen.findByRole("option", { name: /5005.*Late/ });
      h.bookmarks = [101, 102, 5005]; // synced in after this render
      fireEvent.mouseDown(option);
      expect((await screen.findByRole("alert")).textContent).toBe("5005 is already on your shortlist.");
      expect(h.bookmarks).toEqual([101, 102, 5005]);
      expect(screen.queryByText(/Added 5005/)).toBeNull();
    });

    it("never grows the list past what it keeps", async () => {
      searchWith([hit(5006, "Over")]);
      mount();
      await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
      type("over");
      const option = await screen.findByRole("option", { name: /5006.*Over/ });
      h.bookmarks = Array.from({ length: 500 }, (_, i) => i + 1); // filled meanwhile
      fireEvent.mouseDown(option);
      expect((await screen.findByRole("alert")).textContent).toMatch(/The shortlist holds 500 teams/);
      expect(h.bookmarks).toHaveLength(500);
    });

    it("says it's searching while a typed number waits for search's answer", async () => {
      vi.stubGlobal("fetch", (path: string) => path.startsWith("/api/search") ? new Promise(() => {})
        : Promise.resolve(new Response(JSON.stringify({ season: 2025, teams: [team(101, 80, 3), team(102, 61.5, 40)] }), { status: 200 })));
      mount();
      await waitFor(() => expect(document.querySelectorAll("[data-reorder-key]")).toHaveLength(2));
      type("5007");
      expect(await screen.findByRole("option", { name: /5007/ })).toBeTruthy();
      expect(screen.getByText("Searching…", { selector: ".sr-only" })).toBeTruthy();
      expect(screen.queryByText(/team found/)).toBeNull();
    });

    it("shows an empty list how to add a team, with the same search", async () => {
      h.bookmarks = [];
      searchWith([hit(5004, "Firsts")]);
      mount();
      expect(screen.getByText("Your shortlist is empty")).toBeTruthy();
      expect(screen.getByText(/Search below for a team by number or name to add it/)).toBeTruthy();
      expect(screen.getByRole("link", { name: /Browse events/ })).toBeTruthy();
      type("5004");
      await screen.findByRole("option", { name: /5004.*Firsts/ });
      fireEvent.keyDown(field(), { key: "ArrowDown" });
      fireEvent.keyDown(field(), { key: "Enter" });
      await waitFor(() => expect(h.bookmarks).toEqual([5004]));
    });
  });
});
