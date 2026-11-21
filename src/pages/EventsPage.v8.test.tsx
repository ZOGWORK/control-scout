// @vitest-environment jsdom
// Events and This weekend in v8 (docs/design/v8-revamp-brief.md §7.9, <html data-v8>): what's on now and next comes
// first in a card of fixed height, search leads the filters, status is underline tabs, the list is rows by week (no
// coloured stripes, no lift), and This weekend groups its events live → upcoming → finished. With v8 off, the
// classic cards and chips are drawn as before.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { EventListItem } from "../shared/api";
import type { WeekendAnswer } from "../shared/weekend";
import { nowAndNext, NOW_ROWS } from "./eventsList";
import { shortDates } from "../components/EventBrowse";

const today = new Date().toISOString().slice(0, 10);
const day = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ev = (i: number, status: EventListItem["status"], start: string, over: Partial<EventListItem> = {}) => ({
  code: `EV${i}`, name: `Event ${i}`, season: 2026, start, end: start, type: "Qualifier", typeLabel: "Qualifier", status,
  city: "Edison", state: "NJ", country: "USA", teams: 24, matchesPlayed: status === "live" ? 12 : 0, matchesTotal: status === "live" ? 40 : 0, ...over,
}) as unknown as EventListItem;
let EVENTS: EventListItem[] = [];
let listLoading = false;
let WEEKEND: WeekendAnswer;

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    if (path?.startsWith("/api/events")) return listLoading ? { data: undefined, error: undefined, loading: true, reload: () => {} } : { data: { events: EVENTS }, error: undefined, loading: false, reload: () => {} };
    if (path?.startsWith("/api/weekend")) return { data: WEEKEND, error: undefined, loading: false, reload: () => {} };
    return { data: undefined, error: undefined, loading: false, reload: () => {} };
  },
}));
vi.mock("../components/home/CoinFlipRadar", () => ({ CoinFlipRadarSection: () => null }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {} }));
vi.mock("./RankingsPage", async () => ({
  PlacePicker: () => <button type="button">Everywhere</button>, placeName: (k: string) => k,
  trigger: "trigger", active: "active", idle: "idle",
}));

let search = "";
function Probe() { search = useLocation().search; return null; }
const { default: EventsPage } = await import("./EventsPage");
const { default: WeekendPage } = await import("./WeekendPage");
const mount = (el: React.ReactNode, url = "/events") => render(<MemoryRouter initialEntries={[url]}>{el}<Probe /></MemoryRouter>);
const v8 = (on: boolean) => { if (on) document.documentElement.setAttribute("data-v8", ""); else document.documentElement.removeAttribute("data-v8"); };

beforeEach(() => {
  class IO { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } }
  vi.stubGlobal("IntersectionObserver", IO);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  EVENTS = [ev(1, "upcoming", day(2)), ev(2, "live", day(0), { stream: true }), ev(3, "upcoming", day(1)), ev(4, "finished", day(-1), { video: "clips" }),
    ...Array.from({ length: 6 }, (_, i) => ev(10 + i, "upcoming", day(3 + i)))];
  listLoading = false;
  WEEKEND = {
    which: "this", season: 2026, seasonLabel: "2026–27", window: { from: day(0), to: day(1), label: "Nov 21–22, 2026" }, region: null,
    events: [
      { season: 2026, code: "U1", name: "Upcoming One", type: "Qualifier", place: "Edison, NJ, USA", city: null, state: null, country: null, start: day(1), end: day(1), timezone: null, dates: "x", teams: 30, status: "upcoming", href: "/events/2026/U1" },
      { season: 2026, code: "L1", name: "Live One", type: "LeagueMeet", place: "Austin, TX, USA", city: null, state: null, country: null, start: day(0), end: day(0), timezone: null, dates: "x", teams: 12, status: "live", href: "/events/2026/L1" },
      { season: 2026, code: "F1", name: "Done One", type: "Scrimmage", place: null, city: null, state: null, country: null, start: day(0), end: day(0), timezone: null, dates: "x", teams: 0, status: "finished", href: "/events/2026/F1", recording: "https://example.test/rec" },
    ],
  };
  v8(true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); v8(false); });

describe("nowAndNext", () => {
  it("puts live first, then the next to start, then the latest finished, NOW_ROWS at most", () => {
    const r = nowAndNext(EVENTS);
    expect(r.items).toHaveLength(NOW_ROWS);
    expect(r.items.map((e) => e.code).slice(0, 3)).toEqual(["EV2", "EV3", "EV1"]);
    expect(r.live).toBe(1);
    const late = nowAndNext([ev(1, "finished", day(-3)), ev(2, "finished", day(-1)), ev(3, "upcoming", day(4))]);
    expect(late.items.map((e) => e.code)).toEqual(["EV3", "EV2", "EV1"]);
  });
  it("says a two-day event in one month as Nov 19–20", () => {
    expect(shortDates("2026-11-19", "2026-11-20")).toMatch(/^\D+ 19–20$/);
    expect(shortDates(null, null)).toBe("TBA");
  });
});

describe("Events page in v8", () => {
  it("opens with the title, a one-line summary and On now and next, live first", () => {
    mount(<EventsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Events" }).className).toContain("text-[1.375rem]");
    expect(document.querySelector("[data-events-summary]")!.textContent).toContain("1 live now");
    const now = screen.getByRole("region", { name: "On now and next" });
    const rows = now.querySelectorAll("[data-now-row]");
    expect(rows).toHaveLength(NOW_ROWS);
    expect(rows[0].getAttribute("data-now-row")).toBe("live");
    // The phone shows four: the rest are hidden by CSS, so the card's height is fixed before data.
    expect(now.querySelectorAll("li.max-sm\\:hidden")).toHaveLength(NOW_ROWS - 4);
  });

  it("keeps the same six-row card while the list loads", () => {
    listLoading = true;
    mount(<EventsPage />);
    const loading = document.querySelector("[data-events-now=loading]")!;
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.querySelectorAll("li")).toHaveLength(NOW_ROWS);
  });

  it("says Coming up on a quiet week, and its link to the live list only shows with live events", () => {
    EVENTS = EVENTS.map((e) => (e.status === "live" ? { ...e, status: "upcoming" as const } : e));
    mount(<EventsPage />);
    expect(screen.getByRole("heading", { name: "Coming up" })).toBeTruthy();
    expect(document.querySelector("[data-all-live]")).toBeNull();
  });

  it("switches the list to Live now from the card", () => {
    mount(<EventsPage />);
    fireEvent.click(document.querySelector("[data-all-live]")!);
    expect(search).toContain("status=live");
  });

  it("draws status as underline tabs and the list as rows with no lift or type stripe", () => {
    mount(<EventsPage />);
    const tabs = screen.getByRole("group", { name: "Status" });
    const all = within(tabs).getByRole("button", { name: /^All/ });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(all.className).toContain("v8:after:bg-accent");
    expect(document.querySelector("[data-event-weeks=v8]")).toBeTruthy();
    const row = document.querySelector('[data-event-row="EV2"]')!;
    expect(row.textContent).toContain("Live");
    expect(row.querySelector("[data-match-bar]")!.textContent).toContain("12/40");
    expect(document.querySelector(".lift")).toBeNull();
    expect(document.querySelector('[data-event-row="EV4"] [data-video="clips"]')).toBeTruthy();
  });

  it("draws the classic cards with v8 off", () => {
    v8(false);
    mount(<EventsPage />);
    expect(document.querySelector("[data-events-page]")).toBeNull();
    expect(document.querySelector("[data-events-now]")).toBeNull();
    expect(document.querySelector("[data-event-row]")).toBeNull();
    expect(document.querySelectorAll("a.lift").length).toBeGreaterThan(0);
  });
});

describe("This weekend in v8", () => {
  it("groups the events live, upcoming, finished, with the counts in the summary", () => {
    mount(<WeekendPage />, "/weekend");
    expect(screen.getByRole("heading", { level: 1, name: "This weekend" })).toBeTruthy();
    expect(document.querySelector("[data-weekend-count]")!.textContent).toContain("3 events · 1 live");
    expect([...document.querySelectorAll("[data-weekend-group]")].map((g) => g.getAttribute("data-weekend-group"))).toEqual(["live", "upcoming", "finished"]);
    const tab = screen.getByRole("tab", { name: "This weekend" });
    expect(tab.className).toContain("after:bg-accent");
    expect(tab.className.split(" ")).not.toContain("bg-accent");
    expect(screen.getByRole("link", { name: /Recording/ }).getAttribute("href")).toBe("https://example.test/rec");
  });

  it("shows one empty card with a way to the calendar on a weekend with none", () => {
    WEEKEND = { ...WEEKEND, events: [] };
    mount(<WeekendPage />, "/weekend");
    const empty = document.querySelector("[data-no-events]")!;
    expect(within(empty as HTMLElement).getByRole("link", { name: "Browse the season calendar" }).getAttribute("href")).toBe("/events");
  });

  it("draws the classic list with v8 off", () => {
    v8(false);
    mount(<WeekendPage />, "/weekend");
    expect(document.querySelector("[data-weekend-page]")).toBeNull();
    expect(document.querySelector("[data-weekend-group]")).toBeNull();
    expect(screen.getByRole("tab", { name: "This weekend" }).className).toContain("bg-accent");
  });
});
