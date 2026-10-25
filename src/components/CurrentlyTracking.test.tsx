// @vitest-environment jsdom
// "Currently tracking" on the Events page: nothing when nothing is tracked; otherwise a link per tracked
// event, live first, other seasons looked up one by one (and only those), "N more" past six.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useSyncExternalStore } from "react";
import type { EventListItem } from "../shared/api";

let tracked: string[] = [];
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: { tracked: { teams: [], events: tracked } } }) }));
// useApi as a tiny store: a path answers with the events in `answers` whose key it contains, or an error;
// answer() changes an answer later, as the shared retry does when the connection comes back.
const loads = new Set<string>();
let answers: Record<string, EventListItem[]> = {};
let version = 0;
const subs = new Set<() => void>();
const answer = (key: string, events: EventListItem[]) => act(() => { answers = { ...answers, [key]: events }; version++; subs.forEach((f) => f()); });
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
    if (!path) return { data: undefined, error: undefined, loading: false, reload: async () => {} };
    loads.add(path);
    const hit = Object.entries(answers).find(([k]) => path.includes(k));
    return hit ? { data: { events: hit[1] }, error: undefined, loading: false, reload: async () => {} }
      : { data: undefined, error: new Error("offline"), loading: false, reload: async () => {} };
  },
}));

const ev = (code: string, status: EventListItem["status"], start: string, more: Partial<EventListItem> = {}) =>
  ({ code, name: `Event ${code}`, season: 2026, start, end: start, status, type: "Qualifier", typeLabel: "Qualifier", teams: 0, matchesPlayed: 0, matchesTotal: 0, ...more }) as EventListItem;
const LIST = [ev("UP1", "upcoming", "2026-11-08"), ev("LIVE1", "live", "2026-10-25", { stream: true }), ev("DONE1", "finished", "2026-10-11"), ev("OTHER", "upcoming", "2026-11-01")];

const { CurrentlyTracking } = await import("./CurrentlyTracking");
const mount = (events: EventListItem[] | null = LIST, listSettled = true) =>
  render(<MemoryRouter><CurrentlyTracking season={2026} current={2026} events={events ?? undefined} listSettled={listSettled} /></MemoryRouter>);
const links = () => [...document.querySelectorAll("[data-currently-tracking] a")].map((a) => a.getAttribute("href"));

beforeEach(() => { tracked = []; loads.clear(); answers = {}; });
afterEach(cleanup);

describe("Currently tracking", () => {
  it("shows nothing when no event is tracked", () => {
    const { container } = mount();
    expect(container.innerHTML).toBe("");
    expect([...loads]).toEqual([]);
  });

  it("links each tracked event, live first, with the LIVE dot, and asks for nothing more", () => {
    tracked = ["2026:DONE1", "2026:UP1", "2026:LIVE1"];
    mount();
    expect(screen.getByRole("heading", { name: /Currently tracking/ }).textContent).toContain("3 events");
    expect(links()).toEqual(["/events/2026/LIVE1", "/events/2026/UP1", "/events/2026/DONE1"]);
    expect(document.querySelectorAll("[data-stream-live]")).toHaveLength(1);
    expect(screen.getAllByText(/^(Live|Upcoming|Finished)$/).map((x) => x.textContent!.trim())).toEqual(["Live", "Upcoming", "Finished"]);
    expect([...loads]).toEqual([]);
  });

  it("looks up another season's event on its own and says which season it's from", async () => {
    tracked = ["2025:OLDQ1", "2026:UP1"];
    answers = { "season=2025&q=OLDQ1": [ev("OLDQ1", "finished", "2025-03-01", { season: 2025 })] };
    mount();
    await waitFor(() => expect(links()).toEqual(["/events/2026/UP1", "/events/2025/OLDQ1"]));
    expect([...loads]).toEqual(["/api/events?season=2025&q=OLDQ1&all=1&limit=50"]);
    expect(screen.getByText("2025–26")).toBeTruthy();
  });

  it("waits for the season's list before looking up this season's events", () => {
    tracked = ["2026:UP1"];
    mount(null, false);
    expect([...loads]).toEqual([]);
    expect(links()).toEqual([]);
    expect(document.querySelector("[data-currently-tracking] .skeleton")).toBeTruthy();
  });

  it("keeps an event it can't find as a link to its page", async () => {
    tracked = ["2024:GONE"];
    mount();
    await waitFor(() => expect(screen.getByText("GONE")).toBeTruthy());
    expect(links()).toEqual(["/events/2024/GONE"]);
  });

  it("fills in a lookup that failed once its answer arrives (back online)", () => {
    tracked = ["2025:OLDQ1"];
    mount();
    expect(screen.getByText("OLDQ1")).toBeTruthy(); // failed: just the code, still a link
    answer("season=2025&q=OLDQ1", [ev("OLDQ1", "finished", "2025-03-01", { season: 2025 })]);
    expect(screen.getByText("Event OLDQ1")).toBeTruthy();
    expect(links()).toEqual(["/events/2025/OLDQ1"]);
  });

  it("shows six, then the rest on 'and N more'", () => {
    const many = Array.from({ length: 9 }, (_, i) => ev(`E${i}`, "upcoming", `2026-11-${String(i + 10)}`));
    tracked = many.map((e) => `2026:${e.code}`);
    mount(many);
    expect(links()).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "and 3 more" }));
    expect(links()).toHaveLength(9);
  });
});
