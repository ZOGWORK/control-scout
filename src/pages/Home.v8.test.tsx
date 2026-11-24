// @vitest-environment jsdom
// Home under v8 is the dashboard (src/components/home/HomeDashboard.tsx): the mark and search first, four Try chips,
// then Events live now, Top teams and Your teams, in that order, with no headline. The v8 shell draws the sidebar,
// your picture, the wash and Report a bug, so Home draws none of them. Without v8, Home is the old one.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { EventListItem } from "../shared/api";

let data: Record<string, unknown> = {};
const fetched: string[] = [];
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  apiFetch: async (path: string) => { fetched.push(path); return { hits: [] }; },
  useApi: (path: string | null) => {
    const key = path ? Object.keys(data).find((k) => path.startsWith(k)) : undefined;
    return { data: key ? data[key] : undefined, error: undefined, loading: !key, reload: () => {} };
  },
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {}, useMediaQuery: () => false, useMeta: () => null }));
const st = (myTeam: number | null) => ({ myTeam, tracked: { teams: [], events: [] }, bookmarks: [] });
let personal: { user: unknown; state: ReturnType<typeof st> } = { user: null, state: st(null) };
vi.mock("../lib/personal", () => ({ usePersonal: () => personal, hasAccountOnDevice: () => false }));
vi.mock("../components/home/AtlasMap", () => ({ default: () => <div data-testid="map" />, loadWorld: () => Promise.resolve([]) }));

const event = (i: number, played: number, total: number): EventListItem => ({
  season: 2026, code: `USXXQ${i}`, name: `Event ${i}`, type: "Qualifier", typeLabel: "Qualifier", city: "Town", state: "NJ", country: "USA",
  start: "2026-11-18", end: "2026-11-18", teams: 20, matchesPlayed: played, matchesTotal: total, status: "live",
} as EventListItem);

const { default: Home } = await import("./Home");
const { SEARCH_DEBOUNCE_MS } = await import("../components/search/SearchBox");
let at = "";
function Where() { at = useLocation().pathname + useLocation().search; return null; }
const mount = () => render(<MemoryRouter initialEntries={["/"]}><Home /><Where /></MemoryRouter>);

beforeEach(() => { data = {}; personal = { user: null, state: st(null) }; });
afterEach(() => { cleanup(); document.documentElement.removeAttribute("data-v8"); });

describe("Home under v8", () => {
  beforeEach(() => document.documentElement.setAttribute("data-v8", ""));

  it("is the dashboard: the mark and search first, four chips, then the three cards in order, no headline", () => {
    const { container } = mount();
    const dash = container.querySelector("[data-home-dashboard]") as HTMLElement;
    expect(dash).toBeTruthy();
    expect(container.querySelector("h1")).toBeNull();
    // Search comes before every card, with the mark above it.
    const searchSection = screen.getByRole("region", { name: "Search" });
    expect(searchSection.querySelector("[data-mark]")).toBeTruthy();
    expect(within(searchSection).getByRole("combobox", { name: /Search teams, events and matches/ })).toBeTruthy();
    const firstCard = container.querySelector("[data-card]")!;
    expect(searchSection.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("[data-example-chip]")).toHaveLength(4);
    expect([...container.querySelectorAll("[data-card]")].map((c) => c.getAttribute("data-card"))).toEqual(["live", "top", "team"]);
  });

  it("a Try chip runs like Enter: its words go in the box, then it glides to /search (plain navigation without the API)", async () => {
    const { container } = mount();
    const chip = container.querySelector<HTMLAnchorElement>("[data-example-chip]")!;
    const box = within(screen.getByRole("region", { name: "Search" })).getByRole("combobox", { name: /Search teams, events and matches/ }) as HTMLTextAreaElement;
    const doc = document as unknown as { startViewTransition?: unknown };
    let update: (() => Promise<void> | void) | null = null;
    doc.startViewTransition = (cb: () => Promise<void> | void) => { update = cb; return { finished: new Promise(() => {}), ready: Promise.resolve(), updateCallbackDone: Promise.resolve() }; };
    try {
      fireEvent.click(chip);
      expect(document.documentElement.hasAttribute("data-search-glide")).toBe(true);
      // The box shows the chip's words before the browser takes its first picture (the next frame, after this click).
      const q = new URLSearchParams(chip.getAttribute("href")!.split("?")[1]).get("q");
      expect(box.value).toBe(q);
      expect(at).toBe("/");
      // Shown, not searched: past the typing pause the box has asked the API nothing and shows no spinner.
      fetched.length = 0;
      await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 150));
      expect(fetched.filter((f) => f.startsWith("/api/search"))).toEqual([]);
      expect(box.closest("[data-search-field]")!.querySelector(".animate-spin")).toBeNull();
      await update!();
      expect(at).toBe(chip.getAttribute("href"));
    } finally { delete doc.startViewTransition; document.documentElement.removeAttribute("data-search-glide"); }
  });

  it("a Try chip without View Transitions navigates at once; a modified click is left to the browser", () => {
    const { container } = mount();
    const chip = container.querySelector<HTMLAnchorElement>("[data-example-chip]")!;
    // Not cancelled: the browser opens it in a new tab.
    expect(fireEvent.click(chip, { ctrlKey: true })).toBe(true);
    expect(at).toBe("/");
    fireEvent.click(chip);
    expect(at).toBe(chip.getAttribute("href"));
  });

  it("leaves the sidebar, corner, wash and bug button to the shell, and the old Home's pieces out", () => {
    const { container } = mount();
    for (const sel of ["[data-sample-sidebar]", "[data-corner-tools]", "[data-wash]", "[data-sample-home]", "[data-testid=map]"]) expect(container.querySelector(sel)).toBeNull();
    expect(screen.queryByRole("link", { name: /Predict a match/ })).toBeNull();
  });

  it("asks for a team with a plain button when none is set, and shows yours when it is", () => {
    const { container, unmount } = mount();
    const pick = container.querySelector("[data-pick-team]") as HTMLElement;
    expect(pick.textContent).toContain("Pick your team");
    expect(pick.className).not.toMatch(/(^|\s)bg-accent(\s|$)/);
    unmount();
    personal = { user: null, state: st(4215) };
    data = { "/api/teams-summary": { teams: [{ team: 4215, name: "Gear Gremlins", place: "Oradell, NJ, USA" }] }, "/api/teams/4215/matches": { matches: [] } };
    const again = mount();
    expect(again.container.querySelector("[data-pick-team]")).toBeNull();
    expect(screen.getByRole("heading", { name: /Your team/ })).toBeTruthy();
    expect(screen.getByText("Gear Gremlins")).toBeTruthy();
  });

  it("keeps mint for progress and the #1 rank, and live red with the slow ring", () => {
    data = { "/api/events": { events: [event(1, 10, 60)] } };
    const { container } = mount();
    const ring = container.querySelector("[data-live-dot] [data-live-pulse]")!;
    expect(ring.getAttribute("class")).toContain("animate-[live-ring_2s");
    expect(ring.getAttribute("class")).toContain("motion-reduce:hidden");
    const fills = [...container.querySelectorAll("*")].filter((el) => /(^|\s)bg-accent(\s|$)/.test(el.getAttribute("class") ?? ""));
    expect(fills.length).toBe(1);
    expect(fills[0].hasAttribute("data-progress")).toBe(true);
  });
});

describe("Home without v8", () => {
  it("is the old Home: the headline and both main actions, no dashboard", () => {
    const { container } = mount();
    expect(container.querySelector("[data-home-dashboard]")).toBeNull();
    expect(container.querySelector("h1")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Predict a match/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Find an event/ })).toBeTruthy();
  });
});
