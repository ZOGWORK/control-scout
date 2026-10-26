// @vitest-environment jsdom
// Predict's this-week list: events grouped by their start day (today first, past days that are over last),
// the most useful dozen first with "Show all", filters that search the whole week, every state, aria-pressed.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventListItem } from "../../shared/api";
import type { ApiState } from "../../lib/api";

const ev = (code: string, o: Partial<EventListItem> = {}): EventListItem => ({
  season: 2026, code, name: `Event ${code}`, type: "Qualifier", typeLabel: "Qualifier", city: "Austin", state: "TX", country: "USA",
  start: "2026-10-24", end: "2026-10-24", teams: 30, matchesPlayed: 0, matchesTotal: 0, status: "upcoming", ...o,
});

let api: ApiState<{ events: EventListItem[] }>;
const reload = vi.fn(async () => {});
const paths: string[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), useApi: (p: string) => { paths.push(p); return api; } }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useCurrentSeason: () => 2026 }));

const { WeekEvents, groupByDay, byUsefulness, dayLabel, weekStatus, weekKind, WEEK_FIRST } = await import("./WeekEvents");
const TODAY = "2026-10-24"; // a Saturday
const ok = (events: EventListItem[]) => { api = { data: { events }, error: undefined, loading: false, reload }; };
const onPick = vi.fn();
const mount = (picked: string | null = null) => render(<MemoryRouter><WeekEvents onPick={onPick} picked={picked} /></MemoryRouter>);

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 24, 15, 0)); paths.length = 0; onPick.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("helpers", () => {
  it("labels today, tomorrow and yesterday, then plain dates", () => {
    expect(dayLabel("2026-10-24", TODAY)).toBe("Today · Sat Oct 24");
    expect(dayLabel("2026-10-25", TODAY)).toBe("Tomorrow · Sun Oct 25");
    expect(dayLabel("2026-10-23", TODAY)).toBe("Yesterday · Fri Oct 23");
    expect(dayLabel("2026-10-28", TODAY)).toBe("Wed Oct 28");
  });

  it("groups by start day: in date order, a past day that's over last, undated at the end", () => {
    const days = groupByDay([
      ev("DONE", { start: "2026-10-22", end: "2026-10-22", status: "finished", matchesTotal: 10, matchesPlayed: 10 }),
      ev("SPAN", { start: "2026-10-23", end: "2026-10-25", status: "live", matchesTotal: 40, matchesPlayed: 20 }),
      ev("TBA", { start: null, end: null }),
      ev("NEXT", { start: "2026-10-27", end: "2026-10-27" }),
      ev("TODAY", { start: "2026-10-24" }),
    ], TODAY);
    expect(days.map((d) => d.label)).toEqual(["Yesterday · Fri Oct 23", "Today · Sat Oct 24", "Tue Oct 27", "Thu Oct 22", "Date to be announced"]);
    expect(days[0].events.map((e) => e.code)).toEqual(["SPAN"]); // a multi-day event sits under its start day
  });

  it("puts on now first, then matches to play, upcoming, and finished last", () => {
    const order = byUsefulness([
      ev("FIN", { status: "finished", matchesTotal: 5, matchesPlayed: 5 }),
      ev("LATER", { start: "2026-10-30", end: "2026-10-30" }),
      ev("SCHED", { start: "2026-10-26", end: "2026-10-26", matchesTotal: 30 }),
      ev("LIVE", { status: "live", matchesTotal: 30, matchesPlayed: 10 }),
    ], TODAY).map((e) => e.code);
    expect(order).toEqual(["LIVE", "SCHED", "LATER", "FIN"]);
  });

  it("names the status and the type group", () => {
    expect(weekStatus(ev("A", { matchesTotal: 12, matchesPlayed: 4 }))).toEqual({ kind: "toPlay", n: 8 });
    expect(weekStatus(ev("B", { status: "finished", matchesTotal: 12, matchesPlayed: 12 }))).toEqual({ kind: "finished" });
    expect(weekStatus(ev("C"))).toEqual({ kind: "noSchedule" });
    expect([weekKind("Championship"), weekKind("LeagueMeet"), weekKind("Scrimmage"), weekKind(null)]).toEqual(["advancing", "league", "other", "other"]);
  });
});

describe("WeekEvents", () => {
  it("asks for two days back to a week out, and shows rows by day with full names and status chips", () => {
    ok([
      ev("Q1", { name: "FIRST Tech Challenge Texas Region 3 Super Qualifier at the Very Long Venue Name", matchesTotal: 20, matchesPlayed: 5, status: "live" }),
      ev("M1", { type: "LeagueMeet", typeLabel: "League Meet", start: "2026-10-25", end: "2026-10-25", city: "Ramsey", state: "NJ" }),
    ]);
    mount();
    expect(paths[0]).toContain("season=2026");
    expect(paths[0]).toContain("from=2026-10-22");
    expect(paths[0]).toContain("to=2026-10-31");
    const today = screen.getByRole("region", { name: "Today · Sat Oct 24" });
    const row = within(today).getByRole("button", { name: /Very Long Venue Name/ });
    expect(within(row).getByText("15 to play")).toBeTruthy();
    expect(within(row).getByText("On now")).toBeTruthy();
    const tomorrow = screen.getByRole("region", { name: "Tomorrow · Sun Oct 25" });
    expect(within(tomorrow).getByText("No schedule yet")).toBeTruthy();
    expect(within(tomorrow).getByText("Ramsey, NJ, USA")).toBeTruthy();
    expect(within(tomorrow).getByText("League Meet")).toBeTruthy();
    // Few events: no filters, no "Show all".
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("marks the picked row with aria-pressed and picks by season and code", () => {
    ok([ev("A"), ev("B")]);
    mount("B");
    expect(screen.getByRole("button", { name: /Event B/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Event A/ }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /Event A/ }));
    expect(onPick).toHaveBeenCalledWith(2026, "A");
  });

  const many = () => [
    ...Array.from({ length: 16 }, (_, i) => ev(`U${String(i).padStart(2, "0")}`, { start: "2026-10-29", end: "2026-10-29" })),
    ev("LIVE1", { status: "live", matchesTotal: 30, matchesPlayed: 3, name: "Houston Championship" }),
    ev("SCH1", { start: "2026-10-26", end: "2026-10-26", matchesTotal: 30, type: "LeagueMeet", typeLabel: "League Meet", city: "Edinburg" }),
    ev("SCR1", { type: "Scrimmage", typeLabel: "Scrimmage", start: "2026-10-27", end: "2026-10-27" }),
  ];

  it("starts with the most useful dozen, and Show all lists the whole week", () => {
    ok(many());
    mount();
    expect(screen.getByText(`Showing ${WEEK_FIRST} of 19`)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Houston Championship/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Event SCH1/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Event U15/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 19" }));
    expect(screen.getByText("Showing 19 of 19")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Event U15/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();
  });

  it("filters search the whole week: text, type and has matches scheduled", () => {
    ok(many());
    mount();
    fireEvent.change(screen.getByRole("searchbox", { name: /Filter events/ }), { target: { value: "U15" } });
    expect(screen.getByText("Showing 1 of 19")).toBeTruthy(); // U15 was outside the first dozen
    expect(screen.getByRole("button", { name: /Event U15/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: /Filter events/ }), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "League" }));
    expect(screen.getByRole("button", { name: "League" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Showing 1 of 19")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scrimmage & other" }));
    expect(screen.getByRole("button", { name: /Event SCR1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All" }));

    fireEvent.click(screen.getByRole("switch", { name: "Has matches scheduled" }));
    expect(screen.getByText("Showing 2 of 19")).toBeTruthy();
    expect(screen.getAllByText(/to play$/)).toHaveLength(2);
  });

  it("says when no event matches and clears the filters", () => {
    ok(many());
    mount();
    fireEvent.change(screen.getByRole("searchbox", { name: /Filter events/ }), { target: { value: "nowhere at all" } });
    expect(screen.getByText("No events match these filters")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    expect(screen.getByText(`Showing ${WEEK_FIRST} of 19`)).toBeTruthy();
  });

  it("shows a skeleton while loading, an error with retry, and an empty week with a link to all events", () => {
    api = { data: undefined, error: undefined, loading: true, reload };
    mount();
    expect(screen.getByRole("status", { name: "Loading this week's events" })).toBeTruthy();
    cleanup();

    api = { data: undefined, error: Object.assign(new Error("Server error"), { status: 500, offline: false }), loading: false, reload };
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(reload).toHaveBeenCalled();
    cleanup();

    ok([]);
    mount();
    expect(screen.getByText("No events from Thu Oct 22 to Sat Oct 31")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse all events" }).getAttribute("href")).toBe("/events");
  });
});
