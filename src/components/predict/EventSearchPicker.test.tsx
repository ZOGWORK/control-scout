// @vitest-environment jsdom
// The event search picker: suggestions before typing (the team's events, else the nearest), search over every
// event with the team's first, keyboard picking, and the loading, error and empty states.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { EventListItem } from "../../shared/api";

type Answer = { data?: { events: EventListItem[] }; error?: Error; loading?: boolean };
let answer: Answer = {};
const paths: string[] = [];
const reload = vi.fn(async () => {});
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string | null) => {
    if (path) paths.push(path);
    return { data: answer.data, error: answer.error, loading: !!answer.loading, reload };
  },
}));

const { EventSearchPicker } = await import("./EventSearchPicker");

const ev = (code: string, name: string, start: string, more: Partial<EventListItem> = {}) =>
  ({ season: 2025, code, name, type: "Qualifier", typeLabel: "Qualifier", city: "Austin", state: "TX", country: "USA", start, end: start, teams: 0, matchesPlayed: 0, matchesTotal: 0, status: "upcoming", ...more }) as EventListItem;

const LONG = "Campeonato Regional de Robótica FIRST Tech Challenge de la Ciudad Autónoma de Buenos Aires y Provincia, Clasificatorio Oficial";
const EVENTS = [
  ev("PAST1", "Austin Early Qualifier", "2025-10-04"),
  ev("SOON1", "Dallas Qualifier", "2025-11-01", { city: "Dallas" }),
  ev("SOON2", "Houston Qualifier", "2025-11-08", { city: "Houston" }),
  ev("LATER", "Texas State Championship", "2026-03-01", { type: "Championship", typeLabel: "Championship" }),
  ev("ARBA", LONG, "2025-12-06", { city: "Buenos Aires", state: null, country: "Argentina" }),
  ev("MEET1", "Dallas League Meet 1", "2025-10-20", { type: "LeagueMeet", typeLabel: "League Meet", city: "Dallas" }),
  ev("SCRIM", "Plano Scrimmage", "2025-10-11", { type: "Scrimmage", typeLabel: "Scrimmage", city: "Plano" }),
];

function Harness(p: { team?: number | null; teamCodes?: Set<string> | null; initial?: string | null; advancingOnly?: boolean }) {
  const [v, setV] = useState<string | null>(p.initial ?? null);
  return (
    <>
      <EventSearchPicker season={2025} value={v} onChange={setV} team={p.team} teamCodes={p.teamCodes} advancingOnly={p.advancingOnly} id="pick" />
      <span data-testid="value">{v ?? ""}</span>
    </>
  );
}

const trigger = () => document.getElementById("pick") as HTMLButtonElement;
const openPicker = () => { fireEvent.click(trigger()); return screen.getByRole("combobox"); };
const names = () => screen.queryAllByRole("option").map((o) => o.querySelector("span span")!.textContent);
const type = (box: HTMLElement, text: string) => fireEvent.change(box, { target: { value: text } });

beforeAll(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
beforeEach(() => {
  answer = { data: { events: EVENTS } }; paths.length = 0; reload.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2025, 9, 25));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("EventSearchPicker", () => {
  it("asks for the season's event list once, the same request the Predict page makes", () => {
    render(<Harness />);
    expect(new Set(paths)).toEqual(new Set(["/api/events?season=2025"]));
  });

  it("shows a placeholder until an event is chosen", () => {
    render(<Harness />);
    expect(trigger().textContent).toContain("Search events by name, city or code");
    expect(screen.queryByRole("button", { name: /Clear event/ })).toBeNull();
  });

  it("suggests advancing events nearest today (upcoming first, then the most recent) without a team", () => {
    render(<Harness />);
    openPicker();
    expect(screen.getByText("Suggested")).toBeTruthy();
    expect(names()).toEqual(["Dallas Qualifier", "Houston Qualifier", LONG, "Texas State Championship", "Austin Early Qualifier"]);
    expect(screen.getByRole("status").textContent).toBe("5 suggested events");
  });

  it("suggests the team's events, upcoming first, under the team's heading", () => {
    render(<Harness team={18360} teamCodes={new Set(["PAST1", "LATER", "MEET1"])} />);
    openPicker();
    expect(screen.getByText("18360's events")).toBeTruthy();
    // League meets don't advance teams, so they aren't offered.
    expect(names()).toEqual(["Texas State Championship", "Austin Early Qualifier"]);
  });

  it("filters as you type, with no team", () => {
    render(<Harness />);
    const box = openPicker();
    type(box, "houston");
    expect(names()).toEqual(["Houston Qualifier"]);
    expect(screen.getByRole("status").textContent).toBe("1 event found");
  });

  it("lists the team's events first with a badge, and every other event stays reachable", () => {
    render(<Harness team={18360} teamCodes={new Set(["SOON2"])} />);
    const box = openPicker();
    type(box, "qualifier");
    expect(names()).toEqual(["Houston Qualifier", "Dallas Qualifier", "Austin Early Qualifier"]);
    const rows = screen.getAllByRole("option");
    expect(within(rows[0]).getByText("18360’s event")).toBeTruthy();
    expect(within(rows[1]).queryByText("18360’s event")).toBeNull();
    type(box, "dallas");
    expect(names()).toEqual(["Dallas Qualifier"]);
  });

  it("picks with the keyboard, and focus goes back to the trigger", async () => {
    render(<Harness />);
    const box = openPicker();
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
    fireEvent.keyDown(box, { key: "End" });
    expect(screen.getAllByRole("option").at(-1)!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "Home" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByTestId("value").textContent).toBe("SOON2");
    expect(screen.queryByRole("combobox")).toBeNull();
    // Radix hands focus back a tick after the popover unmounts.
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
    expect(trigger().textContent).toContain("Houston Qualifier");
  });

  it("leaves Enter to an input method while it's composing", () => {
    render(<Harness />);
    const box = openPicker();
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(screen.getByTestId("value").textContent).toBe("");
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("keeps a row highlighted when the team's events arrive while open", () => {
    const { rerender } = render(<Harness team={18360} teamCodes={null} />);
    const box = openPicker();
    fireEvent.keyDown(box, { key: "End" });
    expect(box.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[4].id);
    rerender(<Harness team={18360} teamCodes={new Set(["SOON2", "LATER"])} />);
    expect(names()).toEqual(["Houston Qualifier", "Texas State Championship"]);
    expect(box.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByTestId("value").textContent).toBe("SOON2");
  });

  it("closes on Escape without changing the choice, focus back on the trigger", async () => {
    render(<Harness initial="SOON1" />);
    const box = openPicker();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByTestId("value").textContent).toBe("SOON1");
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("shows the chosen event's full name, dates, place and type, and clears it", () => {
    render(<Harness initial="ARBA" />);
    const chosen = trigger().querySelector("[data-picker-chosen]")!;
    expect(chosen.textContent).toBe(LONG);
    expect(chosen.className).not.toMatch(/truncate|line-clamp/);
    expect(trigger().textContent).toContain("Dec 6, 2025");
    expect(trigger().textContent).toContain("Buenos Aires, Argentina");
    expect(trigger().textContent).toContain("Qualifier");
    fireEvent.click(screen.getByRole("button", { name: /Clear event/ }));
    expect(screen.getByTestId("value").textContent).toBe("");
    expect(document.activeElement).toBe(trigger());
  });

  it("never truncates a long name in the list either", () => {
    render(<Harness />);
    type(openPicker(), "buenos aires");
    const row = screen.getByRole("option");
    expect(row.textContent).toContain(LONG);
    expect(row.innerHTML).not.toMatch(/truncate|line-clamp/);
  });

  it("says when nothing matches, explains non-advancing matches, and clears the search", () => {
    render(<Harness />);
    const box = openPicker();
    type(box, "plano");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/No qualifier, league tournament or championship matches “plano”/)).toBeTruthy();
    expect(screen.getByText(/1 other event matches, but it doesn’t advance teams/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("No events found");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((box as HTMLInputElement).value).toBe("");
    expect(names()).toHaveLength(5);
  });

  it("finds scrimmages and meets too when advancingOnly is off", () => {
    render(<Harness advancingOnly={false} />);
    type(openPicker(), "plano");
    expect(names()).toEqual(["Plano Scrimmage"]);
  });

  it("renders at most 50 results and says how many matched", () => {
    answer = { data: { events: Array.from({ length: 120 }, (_, k) => ev(`Q${k}`, `Qualifier ${k}`, "2025-11-01")) } };
    render(<Harness />);
    type(openPicker(), "qualifier");
    expect(screen.getAllByRole("option")).toHaveLength(50);
    expect(screen.getByRole("status").textContent).toBe("120 events found, showing the first 50");
    expect(screen.getByText("Showing 50 of 120")).toBeTruthy();
  });

  it("shows a skeleton while loading", () => {
    answer = { loading: true };
    render(<Harness />);
    openPicker();
    expect(document.querySelector("[data-picker-loading]")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading events");
  });

  it("offers Try again when the list fails", async () => {
    answer = { error: new Error("offline") };
    render(<Harness />);
    openPicker();
    expect(screen.getByRole("alert").textContent).toContain("Couldn’t load 2025–26 events");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Try again/ })); });
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("opens as a full-screen sheet with its own title and close on a phone", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 639px"), addEventListener() {}, removeEventListener() {} }));
    try {
      render(<Harness />);
      openPicker();
      const sheet = screen.getByRole("dialog", { name: "Choose event" });
      expect(sheet.getAttribute("data-slot")).toBe("sheet-content");
      expect(sheet.querySelectorAll("[data-picker-scroll]")).toHaveLength(1);
      fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(trigger()));
    } finally { vi.unstubAllGlobals(); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); }
  });
});
