// @vitest-environment jsdom
// The Events page as a user drives it: the filter box keeps every keystroke and
// writes ?q=, Clear filters and back/forward bring the box along, and the list
// renders a first batch then more through the observer or the button, starting
// over when the filters change.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import type { EventListItem } from "../shared/api";
import { FIRST_EVENTS, MORE_EVENTS } from "./eventsList";

const today = new Date().toISOString().slice(0, 10);
const day = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// 150 upcoming events over ~10 weeks; every third one is in Texas.
const EVENTS: EventListItem[] = Array.from({ length: 150 }, (_, i) => ({
  code: `EV${i}`, name: `Event ${String(i).padStart(3, "0")}`, season: 2026, start: day(Math.floor(i / 2)), end: day(Math.floor(i / 2)),
  type: "Qualifier", typeLabel: "Qualifier", status: "upcoming", city: i % 3 === 0 ? "Austin" : "Edison", state: i % 3 === 0 ? "TX" : "NJ", country: "USA",
  teams: 0, matchesPlayed: 0, matchesTotal: 0,
}) as unknown as EventListItem);
const TEXAS = EVENTS.filter((_, i) => i % 3 === 0).length;

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => ({ data: path?.startsWith("/api/events") ? { events: EVENTS } : undefined, error: undefined, loading: false, reload: () => {} }),
}));
// Today's coin flips have their own tests (CoinFlipRadar.test.tsx).
vi.mock("../components/home/CoinFlipRadar", () => ({ CoinFlipRadarSection: () => null }));
vi.mock("../lib/meta",async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {} }));

// IntersectionObserver: record each observer so a test can bring the sentinel into view.
let observers: { cb: IntersectionObserverCallback; el?: Element; live: boolean }[] = [];
class FakeIO {
  rec: (typeof observers)[number];
  constructor(cb: IntersectionObserverCallback) { this.rec = { cb, live: true }; observers.push(this.rec); }
  observe(el: Element) { this.rec.el = el; }
  disconnect() { this.rec.live = false; }
  unobserve() {}
  takeRecords() { return []; }
}
const scrollToEnd = () => act(() => {
  const o = observers.filter((x) => x.live && x.el).at(-1)!;
  o.cb([{ isIntersecting: true, target: o.el! } as IntersectionObserverEntry], o as unknown as IntersectionObserver);
});

let loc = "";
let nav: NavigateFunction;
function Probe() { loc = useLocation().search; nav = useNavigate(); return null; }

const { default: EventsPage } = await import("./EventsPage");
const mount = (url = "/events") => render(<MemoryRouter initialEntries={[url]}><EventsPage /><Probe /></MemoryRouter>);
const cards = () => document.querySelectorAll('a[href^="/events/2026/"]').length;
const box = () => screen.getByLabelText("Filter events") as HTMLInputElement;
const type = (text: string) => { for (const ch of text) fireEvent.change(box(), { target: { value: box().value + ch } }); };

beforeEach(() => { observers = []; vi.stubGlobal("IntersectionObserver", FakeIO); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Events page filter box", () => {
  it("keeps every keystroke, filters the list and writes ?q=", async () => {
    mount();
    type("texas");
    expect(box().value).toBe("texas");
    expect(new URLSearchParams(loc).get("q")).toBe("texas");
    expect(document.body.textContent).toContain(`${TEXAS} events in`);
    expect(cards()).toBe(Math.min(TEXAS, FIRST_EVENTS));
    expect([...document.querySelectorAll('a[href^="/events/2026/"]')].every((a) => a.textContent!.includes("Texas"))).toBe(true);
  });

  it("keeps fast typing while the URL update is still pending", () => {
    mount();
    // One act: router updates (transitions) can't commit between keystrokes, as on a busy phone.
    // On main the box was driven by the URL, so each key replaced the last: "texas" became "s".
    act(() => type("texas"));
    expect(box().value).toBe("texas");
    expect(new URLSearchParams(loc).get("q")).toBe("texas");
    expect(cards()).toBe(Math.min(TEXAS, FIRST_EVENTS));
  });

  it("starts from ?q= and follows Clear filters and back/forward", () => {
    mount("/events?q=texas");
    expect(box().value).toBe("texas");
    fireEvent.click(screen.getAllByRole("button", { name: /Clear filters/ })[0]);
    expect(box().value).toBe("");
    expect(loc).toBe("");
    expect(cards()).toBe(FIRST_EVENTS);
    act(() => nav(-1)); // Clear filters pushed an entry; back brings the text back
    expect(new URLSearchParams(loc).get("q")).toBe("texas");
    expect(box().value).toBe("texas");
  });
});

describe("Events page batches", () => {
  it("renders a first batch, then more as the end comes into view or on Show more", () => {
    mount();
    expect(cards()).toBe(FIRST_EVENTS);
    scrollToEnd();
    expect(cards()).toBe(FIRST_EVENTS + MORE_EVENTS);
    fireEvent.click(screen.getByRole("button", { name: /Show more events/ }));
    expect(cards()).toBe(FIRST_EVENTS + 2 * MORE_EVENTS);
    expect(screen.getByRole("button", { name: /Show more events/ }).textContent).toContain(`${EVENTS.length - FIRST_EVENTS - 2 * MORE_EVENTS} more`);
  });

  it("goes back to the first batch when the filters change, and loads more again after", () => {
    mount();
    scrollToEnd();
    expect(cards()).toBe(FIRST_EVENTS + MORE_EVENTS);
    type("edison"); // 100 events in NJ
    expect(cards()).toBe(FIRST_EVENTS);
    scrollToEnd();
    expect(cards()).toBe(FIRST_EVENTS + MORE_EVENTS);
    fireEvent.click(screen.getByRole("button", { name: /Show more events/ }));
    expect(cards()).toBe(FIRST_EVENTS + 2 * MORE_EVENTS);
    scrollToEnd();
    expect(cards()).toBe(100);
    expect(screen.queryByRole("button", { name: /Show more events/ })).toBeNull();
  });
});

describe("Events page on a phone", () => {
  const phone = () => vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  const filtersButton = () => screen.getByRole("button", { name: /^Filters/, hidden: true });

  it("shows one row of chips for what's on, and the list right under it", () => {
    phone();
    mount("/events?region=USA:TX&status=upcoming&q=austin");
    const chips = screen.getByRole("list", { name: "Filters on" });
    expect([...chips.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove filter: Place: Texas", "Remove filter: Status: Upcoming", "Remove filter: Text: austin",
    ]);
    expect(filtersButton().getAttribute("aria-label")).toBe("Filters, 3 on");
    // The text box and status chips live in the sheet; the count and the events are on the page.
    expect(screen.queryByLabelText("Filter events")).toBeNull();
    expect(screen.getByText(`${TEXAS}`)).toBeTruthy();
    expect(cards()).toBeGreaterThan(0);
  });

  it("removing a chip updates the URL, and the text chip empties the box too", async () => {
    phone();
    mount("/events?region=USA:TX&q=austin");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Place: Texas" }));
    expect(new URLSearchParams(loc).get("region")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Text: austin" }));
    expect(new URLSearchParams(loc).get("q")).toBeNull();
    // Each chip's removal is a step Back undoes, the text one included.
    act(() => nav(-1));
    expect(new URLSearchParams(loc).get("q")).toBe("austin");
    expect(new URLSearchParams(loc).get("region")).toBeNull(); // one step: the place stays off
    expect(screen.getByRole("button", { name: "Remove filter: Text: austin" })).toBeTruthy();
    act(() => nav(1));
    expect(new URLSearchParams(loc).get("q")).toBeNull();
    fireEvent.click(filtersButton());
    expect(((await screen.findByLabelText("Filter events")) as HTMLInputElement).value).toBe("");
  });

  it("the sheet has the search box, status, place, type and dates; Escape closes it", async () => {
    phone();
    mount();
    const button = filtersButton();
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "Filters" });
    type("edison");
    expect(new URLSearchParams(loc).get("q")).toBe("edison");
    for (const name of [/^Place:/, /^Date range:/, /^Live now/]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Event type" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show 100 events" })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(screen.getByRole("button", { name: "Remove filter: Text: edison" })).toBeTruthy();
  });
});
