// @vitest-environment jsdom
// The event picker: events on today first, then the ones your teams are at, then by date, with a search for the
// rest. Each card says whether your teams compete there, how far scouting has got there (from the space's
// entries), and has one action: Scout this event.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventListItem } from "../../../shared/api";

const ev = (code: string, name: string, start: string, end = start, matchesTotal = 0, teams = 0) =>
  ({ season: 2026, code, name, start, end, city: "Newark", state: "NJ", matchesTotal, teams }) as unknown as EventListItem;
// Today is Sat Nov 7 2026.
const UPCOMING = [
  ev("USNJQ3", "NJ Qualifier 3", "2026-11-14"),
  ev("USNYQ1", "NY Qualifier 1", "2026-11-07", "2026-11-07", 30, 24),
  ev("USNJQ2", "NJ Qualifier 2", "2026-11-21"),
  ev("USNJCMP", "NJ Championship", "2027-02-20", "2027-02-21"),
];
const PAST = ev("USNJQ1", "NJ Qualifier 1", "2026-10-31", "2026-10-31", 28);
const SEARCHABLE = [...UPCOMING, PAST, ev("USPAQ1", "Philadelphia Qualifier", "2026-12-05")];
vi.mock("../../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api")>()),
  apiFetch: async (url: string) => {
    const u = new URL(url, "http://x");
    if (u.pathname.startsWith("/api/teams/")) return { events: [{ season: 2026, code: "USNJQ2", start: "2026-11-21", end: "2026-11-21" }, { season: 2026, code: "USNJQ1", start: "2026-10-31", end: "2026-10-31" }] };
    if (u.searchParams.get("from")) return { events: UPCOMING };
    const q = (u.searchParams.get("q") ?? "").toLowerCase();
    return { events: SEARCHABLE.filter((e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q)) };
  },
}));

const { EventChooser, orderEvents } = await import("./EventChooser");

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 7, 9, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const cards = () => within(screen.getByRole("list", { name: "Events" })).getAllByRole("listitem");
const entry = (team: number, kind: "pit" | "match", eventCode: string, matchLabel: string | null = null) => ({ team, kind, eventCode, matchLabel });

describe("orderEvents", () => {
  it("puts events on today first, then your teams', then the rest by date, and leaves out finished ones", () => {
    const rows = orderEvents([...UPCOMING, PAST], "2026-11-07", new Map([["USNJQ2", [4215]]]));
    expect(rows.map((r) => r.event.code)).toEqual(["USNYQ1", "USNJQ2", "USNJQ3", "USNJCMP"]);
    expect(rows[0]).toMatchObject({ today: true, ours: [] });
    expect(rows[1]).toMatchObject({ today: false, ours: [4215] });
  });
  it("counts a multi-day event as on today through its last day", () => {
    expect(orderEvents([ev("A", "A", "2026-11-06", "2026-11-08")], "2026-11-07")[0].today).toBe(true);
  });
});

describe("EventChooser", () => {
  it("lists events in order, marks where your team competes, and shows this space's progress there", async () => {
    const entries = [entry(1, "pit", "USNYQ1"), entry(2, "pit", "USNYQ1"), entry(2, "pit", "USNYQ1"), entry(3, "match", "USNYQ1", "Q1"), entry(4, "match", "usnyq1", "q1"), entry(5, "match", "USNYQ1", "Q2"), entry(6, "pit", "USNJQ3")];
    render(<EventChooser season={2026} entries={entries} ourTeams={[4215]} onPick={() => {}} />);
    await waitFor(() => expect(cards()).toHaveLength(4));
    expect(cards().map((c) => within(c).getAllByText(/Qualifier|Championship/)[0].textContent)).toEqual(["NY Qualifier 1", "NJ Qualifier 2", "NJ Qualifier 3", "NJ Championship"]);
    const today = cards()[0];
    expect(within(today).getByText("Today")).toBeTruthy();
    // Two teams' pits out of 24, and two matches with entries out of 30 (Q1 counted once, however it's spelled).
    expect(within(today).getByText("2 / 24")).toBeTruthy();
    expect(within(today).getByText("2 / 30")).toBeTruthy();
    expect(within(today).getByText("None of your teams are listed here")).toBeTruthy();
    expect(within(cards()[1]).getByText("Your team 4215 is competing")).toBeTruthy();
  });

  it("says nothing about your teams when the account has none", async () => {
    render(<EventChooser season={2026} entries={[]} ourTeams={[]} onPick={() => {}} />);
    await waitFor(() => expect(cards()).toHaveLength(4));
    expect(screen.queryByText(/your team/i)).toBeNull();
  });

  it("has one action per event, which picks it", async () => {
    const onPick = vi.fn();
    render(<EventChooser season={2026} entries={[]} ourTeams={[]} onPick={onPick} />);
    await waitFor(() => expect(cards()).toHaveLength(4));
    expect(within(cards()[1]).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(cards()[1]).getByRole("button", { name: "Scout NJ Qualifier 3" }));
    expect(onPick).toHaveBeenCalledWith("USNJQ3");
  });

  it("keeps the event already picked on screen even when it's over, with a way back to it", async () => {
    const onCancel = vi.fn();
    render(<EventChooser season={2026} entries={[]} ourTeams={[]} current="USNJQ1" onPick={() => {}} onCancel={onCancel} />);
    await waitFor(() => expect(cards()).toHaveLength(5));
    expect(within(cards()[0]).getByText("Picked")).toBeTruthy();
    expect(within(cards()[0]).getByRole("button", { name: "Scout NJ Qualifier 1" }).textContent).toContain("Keep scouting this event");
    fireEvent.click(screen.getByRole("button", { name: "Back to USNJQ1" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("searches by name, city or code", async () => {
    render(<EventChooser season={2026} entries={[]} ourTeams={[]} onPick={() => {}} />);
    await waitFor(() => expect(cards()).toHaveLength(4));
    fireEvent.change(screen.getByPlaceholderText("Search by event name, city or code"), { target: { value: "phila" } });
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(within(cards()[0]).getByText("Philadelphia Qualifier")).toBeTruthy();
  });
});
