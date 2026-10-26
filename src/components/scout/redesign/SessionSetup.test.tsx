// @vitest-environment jsdom
// Scouting session setup: events on today first, then the account's team's, then by date; the suggested
// event is chosen to start with but nothing is handed over until Start; the choices are radio groups.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventListItem } from "../../../shared/api";

const ev = (code: string, name: string, start: string, end = start, matchesTotal = 0) =>
  ({ season: 2026, code, name, start, end, city: "Newark", state: "NJ", matchesTotal }) as unknown as EventListItem;
// Today is Sat Nov 7 2026.
const UPCOMING = [
  ev("USNJQ3", "NJ Qualifier 3", "2026-11-14"),
  ev("USNYQ1", "NY Qualifier 1", "2026-11-07", "2026-11-07", 30),
  ev("USNJQ2", "NJ Qualifier 2", "2026-11-21"),
  ev("USNJCMP", "NJ Championship", "2027-02-20", "2027-02-21"),
];
const PAST = ev("USNJQ1", "NJ Qualifier 1", "2026-10-31", "2026-10-31", 28);
const SEARCHABLE = [...UPCOMING, PAST, ev("USPAQ1", "Philadelphia Qualifier", "2026-12-05")];
const calls: string[] = [];
vi.mock("../../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api")>()),
  apiFetch: async (url: string) => {
    calls.push(url);
    const u = new URL(url, "http://x");
    if (u.pathname.startsWith("/api/teams/")) return { events: [{ season: 2026, code: "USNJQ2", start: "2026-11-21", end: "2026-11-21" }, { season: 2026, code: "USNJQ1", start: "2026-10-31", end: "2026-10-31" }] };
    if (u.searchParams.get("from")) return { events: UPCOMING };
    const q = (u.searchParams.get("q") ?? "").toLowerCase();
    return { events: SEARCHABLE.filter((e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q)) };
  },
}));

const { SessionSetup, orderEvents } = await import("./SessionSetup");

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 7, 9, 0)); calls.length = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const eventRadios = () => within(screen.getByRole("radiogroup", { name: "Where are you scouting?" })).getAllByRole("radio");
const names = () => eventRadios().map((r) => r.textContent?.split(/USNJ|USNY|USPA|Today/)[0]);

describe("orderEvents", () => {
  it("puts events on today first, then the team's, then the rest by date, and leaves out finished ones", () => {
    const rows = orderEvents([...UPCOMING, PAST], "2026-11-07", new Set(["USNJQ2"]));
    expect(rows.map((r) => r.event.code)).toEqual(["USNYQ1", "USNJQ2", "USNJQ3", "USNJCMP"]);
    expect(rows[0]).toMatchObject({ today: true, mine: false });
    expect(rows[1]).toMatchObject({ today: false, mine: true });
  });
  it("counts a multi-day event as on today through its last day", () => {
    expect(orderEvents([ev("A", "A", "2026-11-06", "2026-11-08")], "2026-11-07")[0].today).toBe(true);
  });
});

describe("SessionSetup", () => {
  it("lists today's event with its badge, then the team's events, then by date, and says when there's no schedule", async () => {
    render(<SessionSetup season={2026} myTeam={4215} onStart={() => {}} />);
    await waitFor(() => expect(eventRadios()).toHaveLength(4));
    expect(names()).toEqual(["NY Qualifier 1", "NJ Qualifier 2", "NJ Qualifier 3", "NJ Championship"]);
    const [first, second] = eventRadios();
    expect(within(first).getByText("Today")).toBeTruthy();
    expect(first.textContent).toContain("30 matches scheduled");
    expect(second.textContent).toContain("your team is here");
    expect(second.textContent).toContain("schedule not out yet");
    expect(calls.some((c) => c.startsWith("/api/teams/4215"))).toBe(true);
  });

  it("chooses the suggested event to start with but hands nothing over until Start", async () => {
    const onStart = vi.fn();
    render(<SessionSetup season={2026} suggestedEvent="USNJQ3" onStart={onStart} />);
    await waitFor(() => expect(eventRadios()).toHaveLength(4));
    const q3 = eventRadios().find((r) => r.textContent?.includes("NJ Qualifier 3"))!;
    expect(q3.getAttribute("aria-checked")).toBe("true");
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Start scouting/ }));
    expect(onStart).toHaveBeenCalledWith("USNJQ3", { kind: "alliance", side: "red" });
  });

  it("chooses a suggestion that arrives late, but never over the scout's own pick", async () => {
    const { rerender } = render(<SessionSetup season={2026} suggestedEvent={null} onStart={() => {}} />);
    await waitFor(() => expect(eventRadios()).toHaveLength(4));
    rerender(<SessionSetup season={2026} suggestedEvent="USNJQ3" onStart={() => {}} />);
    await waitFor(() => expect(eventRadios().find((r) => r.textContent?.includes("NJ Qualifier 3"))!.getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(eventRadios()[0]);
    rerender(<SessionSetup season={2026} suggestedEvent="USNJCMP" onStart={() => {}} />);
    await waitFor(() => expect(eventRadios()).toHaveLength(4));
    expect(eventRadios()[0].getAttribute("aria-checked")).toBe("true");
  });

  it("shows a suggested event that's already over first in the list, looked up by its code", async () => {
    render(<SessionSetup season={2026} suggestedEvent="usnjq1" onStart={() => {}} />);
    await waitFor(() => expect(eventRadios()).toHaveLength(5));
    expect(eventRadios()[0].textContent).toContain("NJ Qualifier 1");
    expect(eventRadios()[0].getAttribute("aria-checked")).toBe("true");
  });

  it("starts with the event and team slot picked", async () => {
    const onStart = vi.fn();
    render(<SessionSetup season={2026} onStart={onStart} />);
    await waitFor(() => expect(eventRadios()).toHaveLength(4));
    expect((screen.getByRole("button", { name: /Start scouting/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(eventRadios()[2]);
    fireEvent.click(screen.getByRole("radio", { name: /One team each match/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Blue 2" }));
    expect(screen.getByRole("radio", { name: "Blue 2" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Start scouting/ }));
    expect(onStart).toHaveBeenCalledWith("USNJQ2", { kind: "slot", slot: "blue2" });
  });

  it("opens on a running session; the arrow keys move through the choices", async () => {
    const onStart = vi.fn();
    render(<SessionSetup season={2026} initial={{ eventCode: "USNYQ1", watching: { kind: "alliance", side: "blue" } }} onStart={onStart} onCancel={() => {}} />);
    await waitFor(() => expect(eventRadios()).toHaveLength(4));
    const alliance = screen.getByRole("radio", { name: /One alliance/ });
    expect(alliance.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Blue" }).getAttribute("aria-checked")).toBe("true");
    alliance.focus();
    fireEvent.keyDown(alliance, { key: "ArrowDown" });
    const all = screen.getByRole("radio", { name: /All 4 teams/ });
    await waitFor(() => expect(document.activeElement).toBe(all));
    fireEvent.click(all);
    expect(all.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Blue" })).toBeNull();
    fireEvent.click(all); // choosing it again keeps it chosen
    expect(all.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(eventRadios()[1]);
    fireEvent.click(screen.getByRole("button", { name: /Start scouting/ }));
    expect(onStart).toHaveBeenCalledWith("USNJQ3", { kind: "all" });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("searches every event of the season and picks from the results", async () => {
    const onStart = vi.fn();
    render(<SessionSetup season={2026} onStart={onStart} />);
    await waitFor(() => expect(eventRadios()).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Search all events"), { target: { value: "phila" } });
    await waitFor(() => expect(names()).toEqual(["Philadelphia Qualifier"]));
    expect(screen.getByRole("status").textContent).toBe("1 event found");
    fireEvent.click(eventRadios()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(eventRadios()).toHaveLength(5); // the chosen event stays on screen, first
    fireEvent.click(screen.getByRole("button", { name: /Start scouting/ }));
    expect(onStart).toHaveBeenCalledWith("USPAQ1", { kind: "alliance", side: "red" });
  });
});
