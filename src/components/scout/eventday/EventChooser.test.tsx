// @vitest-environment jsdom
// The event picker is the Events page's list: the same filter bar and cards by week, each card a link to its event
// with its own Scout button under it. Your teams' events are marked and listed first as quick picks, and a card
// says how far this space's scouting has got there once there's any.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventListItem } from "../../../shared/api";

const ev = (code: string, name: string, start: string, status: EventListItem["status"], end = start, matchesTotal = 0, teams = 0) =>
  ({ season: 2026, code, name, start, end, status, type: "Qualifier", typeLabel: "Qualifier", city: "Newark", state: "NJ", country: "USA", matchesTotal, matchesPlayed: 0, teams }) as unknown as EventListItem;
// Today is Sat Nov 7 2026.
const EVENTS = [
  ev("USNJQ3", "NJ Qualifier 3", "2026-11-14", "upcoming"),
  ev("USNYQ1", "NY Qualifier 1", "2026-11-07", "live", "2026-11-07", 30, 24),
  ev("USNJQ2", "NJ Qualifier 2", "2026-11-21", "upcoming"),
  ev("USNJQ1", "NJ Qualifier 1", "2026-10-31", "finished", "2026-10-31", 28),
  // A practice day: fetched (a pit can be scouted there), but not in the default list, which is the Events page's set.
  { ...ev("USNJPD", "NJ Practice Day", "2026-10-24", "finished"), type: "PracticeDay", typeLabel: "Practice Day" } as EventListItem,
];
const asked: (string | null)[] = [];
vi.mock("../../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api")>()),
  useApi: (path: string | null) => (asked.push(path), { data: path?.startsWith("/api/events") ? { events: EVENTS } : undefined, error: undefined, loading: false, reload: () => {} }),
  apiFetch: async () => ({ events: [{ season: 2026, code: "USNJQ2", start: "2026-11-21", end: "2026-11-21" }, { season: 2026, code: "USNJQ1", start: "2026-10-31", end: "2026-10-31" }] }),
}));

const { EventChooser, ourUpcoming } = await import("./EventChooser");

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 7, 9, 0)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const entry = (team: number, kind: "pit" | "match", eventCode: string, matchLabel: string | null = null) => ({ team, kind, eventCode, matchLabel });
const card = (name: string) => screen.getByRole("listitem", { name });
const show = (props: Partial<Parameters<typeof EventChooser>[0]> = {}) =>
  render(<MemoryRouter><EventChooser season={2026} currentSeason={2026} onSeason={() => {}} entries={[]} ourTeams={[]} onPick={() => {}} {...props} /></MemoryRouter>);

describe("ourUpcoming", () => {
  it("is your teams' events not over yet, by date", () => {
    const ours = new Map([["USNJQ2", [4215]], ["USNJQ1", [4215]], ["USNYQ1", [99]]]);
    expect(ourUpcoming(EVENTS, ours, "2026-11-07").map((e) => e.code)).toEqual(["USNYQ1", "USNJQ2"]);
  });
});

describe("EventChooser", () => {
  it("has the Events page's filter bar and cards, each with a link to the event and its own Scout button", async () => {
    const onPick = vi.fn();
    show({ onPick });
    await waitFor(() => expect(card("NJ Qualifier 3")).toBeTruthy());
    expect(screen.getByRole("button", { name: /^Place:/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Event type" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Live now/ })).toBeTruthy();
    const c = card("NJ Qualifier 3");
    expect(within(c).getByRole("link").getAttribute("href")).toBe("/events/2026/USNJQ3");
    // The button sits beside the link, never inside it.
    expect(within(within(c).getByRole("link")).queryByRole("button")).toBeNull();
    fireEvent.click(within(c).getByRole("button", { name: "Scout NJ Qualifier 3" }));
    expect(onPick).toHaveBeenCalledWith("USNJQ3");
  });

  it("fetches every event type, practice days too (a pit can be scouted at any), but counts the Events page's set", async () => {
    show();
    await waitFor(() => expect(card("NJ Qualifier 3")).toBeTruthy());
    expect(asked.some((p) => p?.startsWith("/api/events") && new URL(p, "http://x").searchParams.get("all") === "1")).toBe(true);
    // Same counts as the Events page: the practice day is left out of the list and the status chips.
    expect(screen.queryByRole("listitem", { name: "NJ Practice Day" })).toBeNull();
    expect(screen.getByRole("button", { name: /^All/ }).textContent).toMatch(/4$/);
    expect(screen.getByRole("button", { name: /^Finished/ }).textContent).toMatch(/1$/);
  });

  it("filters like the Events page: by text and by status", async () => {
    show();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4));
    fireEvent.click(screen.getByRole("button", { name: /^Finished/ }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(card("NJ Qualifier 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter events" }), { target: { value: "NY" } });
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(card("NY Qualifier 1")).toBeTruthy();
  });

  it("marks your team's events, lists them first as quick picks, and shows this space's progress", async () => {
    const onPick = vi.fn();
    const entries = [entry(1, "pit", "USNYQ1"), entry(2, "pit", "USNYQ1"), entry(3, "match", "USNYQ1", "Q1"), entry(4, "match", "usnyq1", "q1")];
    show({ onPick, ourTeams: [4215], entries });
    await waitFor(() => expect(within(card("NJ Qualifier 2")).getByText("Your team 4215 is competing")).toBeTruthy());
    expect(within(card("NJ Qualifier 3")).queryByText(/your team/i)).toBeNull();
    // Two pits of 24, one match of 30 (Q1 counted once, however it's spelled).
    expect(within(card("NY Qualifier 1")).getByText("2 / 24")).toBeTruthy();
    expect(within(card("NY Qualifier 1")).getByText("1 / 30")).toBeTruthy();
    expect(within(card("NJ Qualifier 3")).queryByText(/Scouted/)).toBeNull();
    // The quick pick: upcoming only (USNJQ1 is over).
    const quick = screen.getAllByRole("button", { name: "Scout NJ Qualifier 2" }).find((b) => !b.closest("li"))!;
    fireEvent.click(quick);
    expect(onPick).toHaveBeenCalledWith("USNJQ2");
    expect(screen.getAllByRole("button", { name: "Scout NJ Qualifier 1" })).toHaveLength(1);
  });

  it("rings the event picked now, with Keep scouting and a way back", async () => {
    const onCancel = vi.fn();
    show({ current: "USNJQ1", onCancel });
    await waitFor(() => expect(card("NJ Qualifier 1")).toBeTruthy());
    expect(within(card("NJ Qualifier 1")).getByRole("button", { name: "Scout NJ Qualifier 1" }).textContent).toContain("Keep scouting this event");
    expect(within(card("NJ Qualifier 3")).getByRole("button").textContent).toContain("Scout this event");
    fireEvent.click(screen.getByRole("button", { name: "Back to USNJQ1" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
